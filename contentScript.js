const api = 'https://api.byeai.tech'; // Use this in production
// const api = 'http://localhost:8000' //USe this for local testing
const cats = [
  { id: 'ai-general', label: 'AI-General' },
  { id: 'ai-script', label: 'AI-Script' },
  { id: 'ai-thumbnail', label: 'AI-Thumbnail' },
  { id: 'ai-music', label: 'AI-Music' },
  { id: 'ai-voice', label: 'AI-Voice' },
  { id: 'deepfake', label: 'Deepfake' },
  { id: 'other', label: 'Other' }
];
const blockedKey = 'blockedIds';
const scopeKey = 'banCategories';
const INLINE_ID = 'byeai-inline-button';

const known = new Map();
const anchorsById = new Map();
const hiddenTiles = new Map();
let banCategories = {};
let currentVideoId = null;

const getVid = url => {
  try {
    const u = new URL(url, location.href);
    return u.pathname === '/watch' ? u.searchParams.get('v') : null;
  } catch { return null; }
};

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
  if (location.pathname !== '/watch') return null;
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
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
    const tile = a.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer');
    if (tile) {
      hideTile(tile, id);
    }
  });

  processSidebarVideos();
}

function processSidebarVideos() {
  const sidebar = document.querySelector('#secondary');
  if (!sidebar) return;

  sidebar.querySelectorAll('ytd-compact-video-renderer').forEach(tile => {
    const anchor = tile.querySelector('a.yt-simple-endpoint');
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
}

function applyUnflag(id) {
  known.set(id, { flagged: false });
  (hiddenTiles.get(id) || []).forEach(show);
  hiddenTiles.delete(id);
  processSidebarVideos();
}

async function fetchFlags(ids) {
  if (!ids.length) return;
  try {
    const res = await fetch(`${api}/flags?ids=${ids.join(',')}`);
    if (!res.ok) throw new Error('API request failed');
    const remoteData = await res.json();
    const flaggedMap = new Map((remoteData.videos || []).map(v => [v.id, v.category]));
    ids.forEach(id => {
      if (flaggedMap.has(id)) {
        applyFlag(id, flaggedMap.get(id));
      } else {
        known.set(id, { flagged: false });
      }
    });
  } catch {
    ids.forEach(id => known.set(id, { flagged: false }));
  }
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
  document.querySelectorAll('a#video-title-link, a.yt-simple-endpoint').forEach(processAnchor);
  processSidebarVideos();
  
  const unknown = [...known.entries()].filter(([, v]) => v.flagged === null).map(([k]) => k);
  if (unknown.length > 0) fetchFlags(unknown);
}

function injectInlineButton() {
  if (location.pathname !== '/watch') return;
  
  const vid = getCurrentVideoId();
  if (!vid) return;
  
  const existingButton = document.getElementById(INLINE_ID);
  if (existingButton) {
    existingButton.remove();
  }
  
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
  const isAlreadyFlagged = videoData?.flagged === true;
  
  const btn = document.createElement('button');
  btn.id = INLINE_ID;
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

function showPicker(id) {
  const box = document.createElement('div');
  Object.assign(box.style, {position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',
    background:'#fff',border:'1px solid #ccc',boxShadow:'0 2px 8px rgba(0,0,0,.2)',zIndex:99999,
    borderRadius:'8px',minWidth:'200px'});
  
  const header = document.createElement('div');
  header.textContent = 'Why is this AI-generated?';
  Object.assign(header.style, {padding:'12px 16px',borderBottom:'1px solid #eee',
    fontWeight:'bold',fontSize:'14px'});
  box.appendChild(header);
  
  cats.forEach(c=>{
    const row=document.createElement('div');row.textContent=c.label;
    Object.assign(row.style,{padding:'12px 16px',cursor:'pointer',fontSize:'14px'});
    row.onmouseenter=()=>row.style.background='#f5f5f5';
    row.onmouseleave=()=>row.style.background='#fff';
    row.onclick=()=>{
      const viewCount = extractViewCount();
      chrome.runtime.sendMessage({type:'flag',id,cat:c.id,viewCount, flagSource: 'inline_button'});
      box.remove();
    };
    box.appendChild(row);
  });
  
  const cancel = document.createElement('div');
  cancel.textContent = 'Cancel';
  Object.assign(cancel.style, {padding:'12px 16px',cursor:'pointer',fontSize:'14px',
    borderTop:'1px solid #eee',color:'#666',textAlign:'center'});
  cancel.onmouseenter=()=>cancel.style.background='#f5f5f5';
  cancel.onmouseleave=()=>cancel.style.background='#fff';
  cancel.onclick=()=>box.remove();
  box.appendChild(cancel);
  
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
    applyFlag(m.id, m.category || 'local');
    
        if (m.id === getCurrentVideoId()) {
      injectInlineButton();
    }

    if (m.serverResponse) {
      const source = m.serverResponse.view_count_source === 'api' ? 'API' : 'page';
      const msg = `Video flagged! Score: ${m.serverResponse.new_score.toFixed(1)}/${m.serverResponse.threshold} (views via ${source})`;
      if (m.showUndo) {
        toastMsg(msg, () => chrome.runtime.sendMessage({type: 'unblock', id: m.id}));
      } else {
        toastMsg(msg, null);
      }
    } else if (m.showUndo) {
      toastMsg('Video hidden.', () => chrome.runtime.sendMessage({type: 'unblock', id: m.id}));
    }
  }
  
  if (m.type === 'videoUnblocked') { 
    applyUnflag(m.id); 
    toastMsg('Video restored.', () => {}); 
  }
  
  if (m.type === 'cleared') location.reload();
});

chrome.storage.local.get([blockedKey, scopeKey]).then(store => {
  banCategories = store[scopeKey] ?? cats.reduce((o, c) => ({ ...o, [c.id]: true }), {});
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
