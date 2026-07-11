const api = BYEAI.API;
const cats = BYEAI.CATS;
const blockedKey = 'blockedIds';
const scopeKey = 'banCategories';
const INLINE_ID = 'byeai-inline-button';

const known = new Map();
const anchorsById = new Map();
const hiddenTiles = new Map();
const knownChannels = new Map();  // channelId -> { flagged: bool, category: string }
let banCategories = {};
let hideFlaggedChannels = true;
let currentVideoId = null;

const getVid = url => {
  try {
    const u = new URL(url, location.href);
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  } catch { return null; }
};

const TILE_SELECTOR = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-reel-item-renderer',
  'yt-lockup-view-model',
  'ytm-shorts-lockup-view-model'
].join(', ');

const hide = t => t && (t.style.display = 'none');
const show = t => t && (t.style.display = '');

function extractViewCount() {
  const selectors = [
    'ytd-watch-metadata #info-text',
    '.ytd-video-primary-info-renderer #info-text',
    '#count .view-count',
    'ytd-watch-info-text #count',
    '.ytd-watch-metadata #owner-container + #info-text'
  ];
  
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const text = element.textContent || element.innerText;
      const match = text.match(/([0-9,]+)\s*views?/i);
      if (match) {
        return parseInt(match[1].replace(/,/g, ''), 10);
      }
    }
  }
  
  try {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.textContent;
      if (content.includes('ytInitialPlayerResponse')) {
        const match = content.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
        if (match) {
          const data = JSON.parse(match[1]);
          return parseInt(data.videoDetails?.viewCount || 0, 10);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to extract view count from ytInitialPlayerResponse');
  }
  
  return 0;
}

function extractCurrentChannelId() {
  // First try ytInitialPlayerResponse — most reliable
  try {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.textContent;
      if (content.includes('ytInitialPlayerResponse')) {
        const match = content.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
        if (match) {
          const data = JSON.parse(match[1]);
          const cid = data.videoDetails?.channelId;
          if (cid && /^UC[\w-]{22}$/.test(cid)) return cid;
        }
      }
    }
  } catch {}

  // Fallback: parse the channel link in the page header
  const link = document.querySelector('ytd-channel-name a, ytd-video-owner-renderer a');
  if (link?.href) {
    const m = link.href.match(/\/channel\/(UC[\w-]{22})/);
    if (m) return m[1];
  }
  return null;
}

function extractTileChannelId(tile) {
  // Tiles on home/search have the channel link in #channel-info or .ytd-channel-name
  const link = tile.querySelector('a[href*="/channel/UC"], a[href*="/@"]');
  if (!link?.href) return null;
  const m = link.href.match(/\/channel\/(UC[\w-]{22})/);
  return m ? m[1] : null;
  // Note: @handle links don't give us a UC ID; we accept those won't match.
}

function shouldHideVideo(videoData) {
  if (!videoData || !videoData.flagged) return false;
  if (videoData.category === 'local') return true;
  return banCategories[videoData.category] === true;
}

function remember(id, tile) {
  if (!hiddenTiles.has(id)) hiddenTiles.set(id, []);
  if (!hiddenTiles.get(id).includes(tile)) hiddenTiles.get(id).push(tile);
}

function getCurrentVideoId() {
  if (location.pathname === '/watch') {
    return new URLSearchParams(window.location.search).get('v');
  }
  const m = location.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function hideTile(tile, id) {
  if (tile && tile.style.display !== 'none') {
    hide(tile);
    remember(id, tile);
  }
}

function hideVideo(id) {
  if (!shouldHideVideo(known.get(id))) return;

  const videoAnchors = anchorsById.get(id) || [];
  videoAnchors.forEach(a => {
    const tile = a.closest(TILE_SELECTOR);
    if (tile) {
      hideTile(tile, id);
    }
  });

  processSidebarVideos();
}

function processSidebarVideos() {
  const sidebar = document.querySelector('#secondary');
  if (!sidebar) return;

  sidebar.querySelectorAll('ytd-compact-video-renderer, yt-lockup-view-model').forEach(tile => {
    const anchor = tile.querySelector('a.yt-simple-endpoint, a[href*="/watch?v="], a[href^="/shorts/"]');
    if (!anchor) return;

    const id = getVid(anchor.href);
    if (!id) return;

    if (!anchorsById.has(id)) anchorsById.set(id, []);
    if (!anchorsById.get(id).includes(anchor)) {
      anchorsById.get(id).push(anchor);
    }

    if (shouldHideVideo(known.get(id))) {
      hideTile(tile, id);
    }
  });
}

function applyFlag(id, category = 'local') {
  known.set(id, { flagged: true, category });
  hideVideo(id);
  processSidebarVideos();
  if (id === getCurrentVideoId()) injectInlineButton();
}

function applyUnflag(id) {
  known.set(id, { flagged: false });
  (hiddenTiles.get(id) || []).forEach(show);
  hiddenTiles.delete(id);
  processSidebarVideos();
}

const MAX_IDS_PER_REQUEST = 100;   // server rejects >100 ids per /flags or /channels request
let fetchBackoffUntil = 0;         // no API requests before this timestamp
const inFlightVideos = new Set();
const inFlightChannels = new Set();

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function noteFetchFailure(res) {
  // Only the delta-seconds form of Retry-After is supported; the HTTP-date form
  // intentionally falls back to the 30 s default. Note the server must send
  // Access-Control-Expose-Headers: Retry-After for this header to be visible
  // cross-origin (that server change lands in a later task).
  const retryAfter = parseInt(res?.headers?.get?.('Retry-After'), 10);
  const seconds = Number.isFinite(retryAfter) ? Math.min(Math.max(retryAfter, 1), 300) : 30;
  fetchBackoffUntil = Date.now() + seconds * 1000;
}

async function fetchFlags(ids) {
  ids = ids.filter(id => !inFlightVideos.has(id));
  if (!ids.length || Date.now() < fetchBackoffUntil) return;
  ids.forEach(id => inFlightVideos.add(id));
  try {
    for (const batch of chunk(ids, MAX_IDS_PER_REQUEST)) {
      if (Date.now() < fetchBackoffUntil) return;
      const res = await fetch(`${api}/flags?ids=${batch.join(',')}`);
      if (!res.ok) { noteFetchFailure(res); return; }
      const remoteData = await res.json();
      const flaggedMap = new Map((remoteData.videos || []).map(v => [v.id, v.category]));
      batch.forEach(id => {
        if (flaggedMap.has(id)) {
          applyFlag(id, flaggedMap.get(id));
        } else {
          known.set(id, { flagged: false });
        }
      });
    }
  } catch {
    noteFetchFailure(null);
  } finally {
    ids.forEach(id => inFlightVideos.delete(id));
  }
}

async function fetchChannelFlags(channelIds) {
  const unknown = channelIds.filter(id => !knownChannels.has(id) && !inFlightChannels.has(id));
  if (!unknown.length || Date.now() < fetchBackoffUntil) return;
  unknown.forEach(id => inFlightChannels.add(id));
  try {
    for (const batch of chunk(unknown, MAX_IDS_PER_REQUEST)) {
      if (Date.now() < fetchBackoffUntil) return;
      const res = await fetch(`${api}/channels?ids=${batch.join(',')}`);
      if (!res.ok) { noteFetchFailure(res); return; }
      const data = await res.json();
      const flagged = new Map((data.channels || []).map(c => [c.id, c.category]));
      batch.forEach(id => {
        if (flagged.has(id)) {
          knownChannels.set(id, { flagged: true, category: flagged.get(id) });
        } else {
          knownChannels.set(id, { flagged: false });
        }
      });
    }
  } catch {
    noteFetchFailure(null);
  } finally {
    unknown.forEach(id => inFlightChannels.delete(id));
  }
}

function shouldHideChannel(channelId) {
  if (!hideFlaggedChannels) return false;
  const data = knownChannels.get(channelId);
  return !!data?.flagged;
}

function hideTilesForFlaggedChannels() {
  document.querySelectorAll(TILE_SELECTOR).forEach(tile => {
    const cid = extractTileChannelId(tile);
    if (cid && shouldHideChannel(cid)) {
      hide(tile);
    }
  });
}

function processAnchor(a) {
  const id = getVid(a.href);
  if (!id) return;
  
  if (!anchorsById.has(id)) anchorsById.set(id, []);
  if (!anchorsById.get(id).includes(a)) anchorsById.get(id).push(a);
  
  if (known.has(id)) {
    hideVideo(id);
  } else {
    known.set(id, { flagged: null });
  }
}

function scanAllTiles() {
  document.querySelectorAll('a#video-title-link, a.yt-simple-endpoint, a[href^="/shorts/"], a[href*="youtube.com/shorts/"]').forEach(processAnchor);
  processSidebarVideos();

  const currentId = getCurrentVideoId();
  if (currentId && !known.has(currentId)) known.set(currentId, { flagged: null });

  const unknown = [...known.entries()].filter(([, v]) => v.flagged === null).map(([k]) => k);
  if (unknown.length > 0) fetchFlags(unknown);

  if (hideFlaggedChannels) {
    const cids = new Set();
    document.querySelectorAll(TILE_SELECTOR).forEach(tile => {
      const cid = extractTileChannelId(tile);
      if (cid) cids.add(cid);
    });
    if (cids.size > 0) {
      fetchChannelFlags([...cids]).then(() => hideTilesForFlaggedChannels());
    } else {
      hideTilesForFlaggedChannels();
    }
  }
}

function injectInlineButton() {
  if (location.pathname !== '/watch') return;

  const vid = getCurrentVideoId();
  if (!vid) return;

  const selectors = [
    'ytd-watch-metadata #title h1',
    'ytd-video-primary-info-renderer #title h1',
    '#title h1',
    'h1.title',
    'h1.ytd-video-primary-info-renderer'
  ];

  let titleElem = null;
  for (const sel of selectors) {
    titleElem = document.querySelector(sel);
    if (titleElem) break;
  }
  if (!titleElem) return;

  const videoData = known.get(vid);
  const isAlreadyFlagged = videoData?.flagged === true || videoData?.shadowFlagged === true;
  const state = isAlreadyFlagged ? 'flagged' : 'fresh';

  const existing = document.getElementById(INLINE_ID);
  const upToDate = existing && existing.dataset.vid === vid &&
                   existing.dataset.state === state && titleElem.contains(existing);
  if (!upToDate) {
    existing?.remove();
    const btn = document.createElement('button');
    btn.id = INLINE_ID;
    btn.dataset.vid = vid;
    btn.dataset.state = state;
    btn.textContent = isAlreadyFlagged ? 'Already Flagged' : 'Flag AI';
    btn.style.marginLeft = '12px';
    btn.style.padding = '6px 10px';
    btn.style.border = 'none';
    btn.style.borderRadius = '6px';
    btn.style.cursor = isAlreadyFlagged ? 'default' : 'pointer';
    btn.style.background = isAlreadyFlagged ? '#888' : '#e84545';
    btn.style.color = '#fff';
    btn.style.fontSize = '12px';
    btn.style.fontWeight = 'bold';
    if (!isAlreadyFlagged) {
      btn.onclick = () => showPicker(vid);
    }
    titleElem.appendChild(btn);
  }

  const channelId = extractCurrentChannelId();
  const existingChan = document.getElementById('byeai-channel-button');
  if (channelId) {
    const chanUpToDate = existingChan && existingChan.dataset.cid === channelId &&
                         titleElem.contains(existingChan);
    if (!chanUpToDate) {
      existingChan?.remove();
      const chanBtn = document.createElement('button');
      chanBtn.id = 'byeai-channel-button';
      chanBtn.dataset.cid = channelId;
      chanBtn.textContent = 'Flag channel';
      chanBtn.title = 'Vote to flag this channel as AI-generated';
      Object.assign(chanBtn.style, {
        marginLeft: '6px', padding: '6px 10px', border: 'none',
        borderRadius: '6px', cursor: 'pointer', background: '#555',
        color: '#fff', fontSize: '12px', fontWeight: 'bold'
      });
      chanBtn.onclick = () => showChannelPicker(channelId);
      titleElem.appendChild(chanBtn);
    }
  } else {
    existingChan?.remove();
  }
}

function showPicker(id) {
  const selectedCategories = new Set();
  
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)', zIndex: 99998
  });
  overlay.onclick = () => { overlay.remove(); box.remove(); };
  document.body.appendChild(overlay);
  
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
    background: '#fff', boxShadow: '0 4px 24px rgba(0,0,0,.2)', zIndex: 99999,
    borderRadius: '12px', minWidth: '280px', maxWidth: '320px', overflow: 'hidden'
  });
  
  const header = document.createElement('div');
  header.textContent = '🚩 Flag this video';
  Object.assign(header.style, {
    padding: '16px 20px', borderBottom: '1px solid #eee',
    fontWeight: '600', fontSize: '16px', background: '#fafafa'
  });
  box.appendChild(header);
  
  const catContainer = document.createElement('div');
  Object.assign(catContainer.style, { padding: '8px 12px' });
  
  cats.forEach(c => {
    const row = document.createElement('label');
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center', padding: '10px 12px',
      cursor: 'pointer', fontSize: '14px', borderRadius: '8px',
      margin: '4px 0', border: '1px solid #e0e0e0', background: '#fff',
      transition: 'all 0.15s ease'
    });
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = c.id;
    Object.assign(checkbox.style, {
      marginRight: '10px', width: '16px', height: '16px',
      accentColor: '#dc3545', cursor: 'pointer'
    });
    
    checkbox.onchange = () => {
      if (checkbox.checked) {
        selectedCategories.add(c.id);
        row.style.borderColor = '#dc3545';
        row.style.background = '#fff5f5';
      } else {
        selectedCategories.delete(c.id);
        row.style.borderColor = '#e0e0e0';
        row.style.background = '#fff';
      }
      updateSubmitBtn();
    };
    
    const label = document.createElement('span');
    label.textContent = c.label;
    
    row.appendChild(checkbox);
    row.appendChild(label);
    row.onmouseenter = () => { if (!checkbox.checked) row.style.background = '#f8f8f8'; };
    row.onmouseleave = () => { if (!checkbox.checked) row.style.background = '#fff'; };
    catContainer.appendChild(row);
  });
  
  box.appendChild(catContainer);
  
  const hint = document.createElement('div');
  hint.textContent = 'Select one or more categories';
  Object.assign(hint.style, {
    padding: '8px 20px', fontSize: '12px', color: '#888', textAlign: 'center'
  });
  box.appendChild(hint);
  
  const btnContainer = document.createElement('div');
  Object.assign(btnContainer.style, {
    padding: '12px 16px', borderTop: '1px solid #eee',
    display: 'flex', gap: '8px'
  });
  
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  Object.assign(cancelBtn.style, {
    flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '8px',
    background: '#fff', color: '#666', fontSize: '14px', cursor: 'pointer'
  });
  cancelBtn.onmouseenter = () => cancelBtn.style.background = '#f5f5f5';
  cancelBtn.onmouseleave = () => cancelBtn.style.background = '#fff';
  cancelBtn.onclick = () => { overlay.remove(); box.remove(); };
  
  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit Flag';
  submitBtn.disabled = true;
  Object.assign(submitBtn.style, {
    flex: 1, padding: '10px', border: 'none', borderRadius: '8px',
    background: '#ccc', color: '#fff', fontSize: '14px', fontWeight: '600',
    cursor: 'not-allowed', transition: 'all 0.15s ease'
  });
  
  const updateSubmitBtn = () => {
    const count = selectedCategories.size;
    if (count === 0) {
      submitBtn.disabled = true;
      submitBtn.style.background = '#ccc';
      submitBtn.style.cursor = 'not-allowed';
      submitBtn.textContent = 'Submit Flag';
      hint.textContent = 'Select one or more categories';
    } else {
      submitBtn.disabled = false;
      submitBtn.style.background = '#dc3545';
      submitBtn.style.cursor = 'pointer';
      submitBtn.textContent = count === 1 ? 'Submit Flag' : `Submit ${count} Flags`;
      hint.textContent = `${count} categor${count === 1 ? 'y' : 'ies'} selected`;
    }
  };
  
  submitBtn.onclick = () => {
    if (selectedCategories.size === 0) return;
    const viewCount = extractViewCount();
    const categories = Array.from(selectedCategories);
    chrome.runtime.sendMessage({
      type: 'flagMultiple',
      id,
      categories,
      viewCount,
      flagSource: 'inline_button'
    });
    overlay.remove();
    box.remove();
  };
  
  submitBtn.onmouseenter = () => { if (!submitBtn.disabled) submitBtn.style.background = '#c82333'; };
  submitBtn.onmouseleave = () => { if (!submitBtn.disabled) submitBtn.style.background = '#dc3545'; };
  
  btnContainer.appendChild(cancelBtn);
  btnContainer.appendChild(submitBtn);
  box.appendChild(btnContainer);
  
  document.body.appendChild(box);
}

function showChannelPicker(channelId) {
  const selectedCategories = new Set();

  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)', zIndex: 99998
  });
  overlay.onclick = () => { overlay.remove(); box.remove(); };
  document.body.appendChild(overlay);

  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
    background: '#fff', boxShadow: '0 4px 24px rgba(0,0,0,.2)', zIndex: 99999,
    borderRadius: '12px', minWidth: '280px', maxWidth: '320px', overflow: 'hidden'
  });

  const header = document.createElement('div');
  header.textContent = '🚩 Flag this channel';
  Object.assign(header.style, {
    padding: '16px 20px', borderBottom: '1px solid #eee',
    fontWeight: '600', fontSize: '16px', background: '#fafafa'
  });
  box.appendChild(header);

  const catContainer = document.createElement('div');
  Object.assign(catContainer.style, { padding: '8px 12px' });

  cats.forEach(c => {
    const row = document.createElement('label');
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center', padding: '10px 12px',
      cursor: 'pointer', fontSize: '14px', borderRadius: '8px',
      margin: '4px 0', border: '1px solid #e0e0e0', background: '#fff',
    });
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = c.id;
    Object.assign(checkbox.style, { marginRight: '10px', accentColor: '#dc3545' });
    checkbox.onchange = () => {
      if (checkbox.checked) selectedCategories.add(c.id);
      else selectedCategories.delete(c.id);
      submitBtn.disabled = selectedCategories.size === 0;
    };
    const label = document.createElement('span');
    label.textContent = c.label;
    row.appendChild(checkbox);
    row.appendChild(label);
    catContainer.appendChild(row);
  });
  box.appendChild(catContainer);

  const btnContainer = document.createElement('div');
  Object.assign(btnContainer.style, {
    padding: '12px 16px', borderTop: '1px solid #eee', display: 'flex', gap: '8px'
  });
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  Object.assign(cancelBtn.style, {
    flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '8px',
    background: '#fff', color: '#666', fontSize: '14px', cursor: 'pointer'
  });
  cancelBtn.onclick = () => { overlay.remove(); box.remove(); };
  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit Flag';
  submitBtn.disabled = true;
  Object.assign(submitBtn.style, {
    flex: 1, padding: '10px', border: 'none', borderRadius: '8px',
    background: '#dc3545', color: '#fff', fontSize: '14px', fontWeight: '600', cursor: 'pointer'
  });
  submitBtn.onclick = () => {
    if (selectedCategories.size === 0) return;
    chrome.runtime.sendMessage({
      type: 'flagChannel',
      channelId,
      categories: [...selectedCategories],
    });
    overlay.remove();
    box.remove();
    toastMsg('Channel flag submitted', null);
  };
  btnContainer.appendChild(cancelBtn);
  btnContainer.appendChild(submitBtn);
  box.appendChild(btnContainer);

  document.body.appendChild(box);
}

function toastMsg(msg, undo) {
  let toast = document.createElement('div');
  Object.assign(toast.style,{position:'fixed',bottom:'24px',left:'50%',transform:'translateX(-50%)',
    background:'#323232',color:'#fff',padding:'12px 24px',borderRadius:'4px',fontSize:'14px',
    display:'flex',gap:'20px',zIndex:99999});
  toast.textContent=msg;
  if (undo) {
    const u=document.createElement('span');u.textContent='Undo';
    u.style.textDecoration='underline';u.style.cursor='pointer';
    u.onclick=()=>{undo();toast.remove();toast=null;};
    toast.appendChild(u);
  }
  document.body.appendChild(toast);
  setTimeout(()=>{toast?.remove();toast=null;},10_000);
}

function initialize() {
  const newVideoId = getCurrentVideoId();
  if (newVideoId !== currentVideoId) {
    currentVideoId = newVideoId;
    setTimeout(() => {
      scanAllTiles();
      injectInlineButton();
    }, 500);
  } else {
    scanAllTiles();
    injectInlineButton();
  }
}

chrome.runtime.onMessage.addListener(m => {
  if (m.type === 'videoFlagged') {
    if (!m.shadowMode) {
      applyFlag(m.id, m.category || 'local');
    } else {
      const existing = known.get(m.id) || { flagged: false };
      existing.shadowFlagged = true;
      known.set(m.id, existing);
    }

    if (m.id === getCurrentVideoId()) {
      injectInlineButton();
    }

    let baseMsg;
    if (m.shadowMode) {
      baseMsg = 'Flag submitted (not hiding)';
    } else if (m.alreadyVoted) {
      baseMsg = 'You already flagged this video.';
    } else if (m.serverResponse) {
      baseMsg = `Video flagged! Score: ${m.serverResponse.new_score.toFixed(1)}/${m.serverResponse.threshold}`;
    } else {
      baseMsg = 'Video hidden.';
    }

    if (m.showUndo) {
      toastMsg(baseMsg, () => chrome.runtime.sendMessage({ type: 'unblock', id: m.id }));
    } else {
      toastMsg(baseMsg, null);
    }
  }
  
  if (m.type === 'videoUnblocked') {
    applyUnflag(m.id);
    toastMsg('Video restored.', null);
  }
  
  if (m.type === 'cleared') location.reload();
});

chrome.storage.local.get([blockedKey, scopeKey, 'hideFlaggedChannels']).then(store => {
  banCategories = store[scopeKey] ?? cats.reduce((o, c) => ({ ...o, [c.id]: true }), {});
  hideFlaggedChannels = store.hideFlaggedChannels !== false;  // default ON
  (store[blockedKey] || []).forEach(id => known.set(id, { flagged: true, category: 'local' }));
  initialize();
});

let scanTimeout = null;
const debouncedScan = () => {
  clearTimeout(scanTimeout);
  scanTimeout = setTimeout(() => {
    scanAllTiles();
    injectInlineButton();
  }, 200);
};

const observer = new MutationObserver(debouncedScan);
observer.observe(document.body, { childList: true, subtree: true });

window.addEventListener('yt-navigate-finish', initialize);
window.addEventListener('popstate', initialize);

let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(initialize, 100);
  }
}, 500);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.hideFlaggedChannels) {
    hideFlaggedChannels = changes.hideFlaggedChannels.newValue !== false;
    if (hideFlaggedChannels) hideTilesForFlaggedChannels();
    else location.reload();  // simplest way to undo channel-based hiding
  }
});

