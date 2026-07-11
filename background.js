import './constants.js';

const idKey = 'clientHash';
const blockedKey = 'blockedIds';
const scopeKey = 'banCategories';
const analyticsKey = 'analytics';
const flagOnlyKey = 'flagOnly';
const statsKey = 'stats';
const STATS_DAY_CAP = 90;
const api = BYEAI.API;
const cats = BYEAI.CATS;

const getVid = url => {
  try {
    const u = new URL(url);
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  } catch { return null; }
};

async function ensureId() {
  const s = await chrome.storage.local.get(idKey);
  if (!s[idKey]) await chrome.storage.local.set({ [idKey]: crypto.randomUUID() });
}

async function ensureDefaults() {
  const store = await chrome.storage.local.get([scopeKey, analyticsKey]);
  const updates = {};
  if (!store[scopeKey]) updates[scopeKey] = cats.reduce((o, c) => ({ ...o, [c.id]: true }), {});
  if (store[analyticsKey] === undefined) updates[analyticsKey] = false;
  if (Object.keys(updates).length > 0) await chrome.storage.local.set(updates);
}

function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'byeai_root',
      title: 'ByeAI: flag as AI-generated',
      contexts: ['link', 'image', 'video']
    });
    cats.forEach(c => chrome.contextMenus.create({
      id: `cat_${c.id}`,
      parentId: 'byeai_root',
      title: c.label,
      contexts: ['link', 'image', 'video']
    }));
  });
}

async function sendVote(id, cat, viewCount = 0, flagSource = 'unknown') {
  try {
    const { clientHash } = await chrome.storage.local.get(idKey);
    const { analytics } = await chrome.storage.local.get(analyticsKey);
    
    const payload = {
      videoId: id,
      category: cat,
      clientHash,
      timestamp: Date.now(),
      viewCount: viewCount || 0,
      flagSource
    };
    
    if (analytics) {
      payload.analytics = {
        name: 'vote',
        path: `flag/${flagSource}`,
        props: {
          category: cat,
          source: flagSource
        }
      };
    }
    
    const response = await fetch(`${api}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    if (response.ok) return await response.json();
    if (response.status === 409) return { alreadyVoted: true };
    console.warn('ByeAI: Vote submission failed:', response.status);
    return null;
  } catch (error) {
    console.warn('ByeAI: Vote submission error:', error);
    return null;
  }
}

async function sendChannelVote(channelId, category) {
  try {
    const { clientHash } = await chrome.storage.local.get(idKey);
    const payload = {
      channelId,
      category,
      clientHash,
      timestamp: Date.now(),
    };
    const response = await fetch(`${api}/channel/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) console.warn('ByeAI: Channel vote failed:', response.status);
  } catch (e) {
    console.warn('ByeAI: Channel vote error:', e);
  }
}

async function getSessionId() {
  const sessionKey = 'sessionId';
  let { sessionId } = await chrome.storage.session?.get(sessionKey) || {};
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    await chrome.storage.session?.set({ [sessionKey]: sessionId });
  }
  return sessionId;
}

async function storeBlock(id) {
  const { blockedIds = [] } = await chrome.storage.local.get(blockedKey);
  if (!blockedIds.includes(id)) {
    blockedIds.push(id);
    await chrome.storage.local.set({ [blockedKey]: blockedIds });
  }
}

async function removeBlock(id) {
  const { blockedIds = [] } = await chrome.storage.local.get(blockedKey);
  await chrome.storage.local.set({ [blockedKey]: blockedIds.filter(x => x !== id) });
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// recordHide() counts only user-initiated hides (their own flag actions).
// Server-side consensus hides are NOT counted here — they would inflate
// stats with videos the user never actually saw, since /flags hides on first scan.
// Accepts a single category or an array. totalHidden + byDay increment once
// per call (one video); byCategory increments per supplied category.
async function recordHide(categories) {
  const cats = Array.isArray(categories) ? categories : [categories];
  if (cats.length === 0) return;
  const { [statsKey]: stats = null } = await chrome.storage.local.get(statsKey);
  const next = stats || {
    totalHidden: 0,
    byCategory: {},
    byDay: {},
    firstSeenAt: Date.now(),
  };
  next.totalHidden += 1;
  for (const c of cats) {
    next.byCategory[c] = (next.byCategory[c] || 0) + 1;
  }
  const day = todayKey();
  next.byDay[day] = (next.byDay[day] || 0) + 1;

  // Trim to STATS_DAY_CAP days (keep newest, drop oldest)
  const days = Object.keys(next.byDay).sort();
  while (days.length > STATS_DAY_CAP) {
    const oldest = days.shift();
    delete next.byDay[oldest];
  }

  await chrome.storage.local.set({ [statsKey]: next });
}

function broadcast(msg, tabId = null) {
  if (tabId) {
    chrome.tabs.sendMessage(tabId, msg, () => chrome.runtime.lastError);
  } else {
    chrome.tabs.query({ url: '*://www.youtube.com/*' }, tabs => {
      tabs.forEach(t => chrome.tabs.sendMessage(t.id, msg, () => chrome.runtime.lastError));
    });
  }
}

ensureId();
ensureDefaults();
buildMenus();
chrome.action.setBadgeBackgroundColor({ color: '#dc3545' });

// Clear the badge when a tab starts a full-page navigation; if the destination
// is YouTube, the content script re-reports the count after its first scan.
// (Reading the destination URL would need the "tabs" permission — this avoids it.)
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    chrome.action.setBadgeText({ tabId, text: '' });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  buildMenus();
  ensureDefaults();
});

chrome.runtime.onStartup?.addListener(buildMenus);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.menuItemId.startsWith('cat_')) return;
  const cat = info.menuItemId.slice(4);
  const id = getVid(info.linkUrl) || getVid(info.srcUrl) || getVid(info.pageUrl);
  if (!id) return;

  const { [flagOnlyKey]: flagOnly = false } = await chrome.storage.local.get(flagOnlyKey);
  const serverResponse = await sendVote(id, cat, 0, 'context_menu');
  if (!flagOnly) {
    await storeBlock(id);
    if (!serverResponse?.alreadyVoted) await recordHide([cat]);
  }

  broadcast({
    type: 'videoFlagged', id, category: cat, showUndo: !flagOnly, shadowMode: flagOnly,
    serverResponse: serverResponse?.alreadyVoted ? null : serverResponse,
    alreadyVoted: !!serverResponse?.alreadyVoted
  }, tab?.id);
});


chrome.runtime.onMessage.addListener(async (msg, sender) => {
  switch (msg.type) {
    case 'flagMultiple': {
      const { [flagOnlyKey]: flagOnly = false } = await chrome.storage.local.get(flagOnlyKey);
      const categories = msg.categories || [];
      const flagSource = msg.flagSource || 'popup';
      let serverResponse = null;
      let dupCount = 0;
      for (const cat of categories) {
        const resp = await sendVote(msg.id, cat, msg.viewCount || 0, flagSource);
        if (resp?.alreadyVoted) dupCount++;
        else if (resp && !serverResponse) serverResponse = resp;
      }
      const alreadyVoted = categories.length > 0 && dupCount === categories.length;
      if (!flagOnly) {
        await storeBlock(msg.id);
        if (!alreadyVoted) await recordHide(categories);
      }
      const targetTabId = sender.tab?.id || msg.tabId;
      broadcast({
        type: 'videoFlagged',
        id: msg.id,
        categories,
        showUndo: !flagOnly,
        shadowMode: flagOnly,
        serverResponse,
        alreadyVoted
      }, targetTabId);
      break;
    }
    case 'flagChannel': {
      const categories = msg.categories || [];
      for (const cat of categories) {
        await sendChannelVote(msg.channelId, cat);
      }
      broadcast({ type: 'channelFlagged', channelId: msg.channelId }, sender.tab?.id);
      break;
    }
    case 'unblock':
      await removeBlock(msg.id);
      broadcast({ type: 'videoUnblocked', id: msg.id }, sender.tab?.id);
      break;
    case 'clearAll':
      await chrome.storage.local.set({ [blockedKey]: [] });
      broadcast({ type: 'cleared' });
      break;
    case 'updateBadge': {
      const tabId = sender.tab?.id;
      if (tabId) {
        chrome.action.setBadgeText({ tabId, text: msg.count > 0 ? String(msg.count) : '' });
      }
      break;
    }
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[scopeKey]) {
    broadcast({ type: 'settingsChanged' });
  }
});
