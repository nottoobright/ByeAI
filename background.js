const idKey = 'clientHash';
const blockedKey = 'blockedIds';
const scopeKey = 'banCategories';
const analyticsKey = 'analytics';
const api = 'https://api.byeai.tech'; // Use this in production
//const api = 'http://localhost:8000' // Use this for local testing
const cats = [
  'AI-script','AI-image/thumbnail','AI-music',
  'AI-voice-over','Deepfake/video','Other'
];

const getVid = url => {
  try {
    const u = new URL(url);
    return u.pathname === '/watch' ? u.searchParams.get('v') : null;
  } catch { return null; }
};

async function ensureId() {
  const s = await chrome.storage.local.get(idKey);
  if (!s[idKey]) await chrome.storage.local.set({ [idKey]: crypto.randomUUID() });
}

async function ensureDefaults() {
  const store = await chrome.storage.local.get([scopeKey, analyticsKey]);
  const updates = {};
  if (!store[scopeKey]) updates[scopeKey] = cats.reduce((o, c) => ({ ...o, [c]: true }), {});
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
      id: `cat_${c}`,
      parentId: 'byeai_root',
      title: c,
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
    
    if (!response.ok) {
      console.warn('ByeAI: Vote submission failed:', response.status);
    }
  } catch (error) {
    console.warn('ByeAI: Vote submission error:', error);
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

chrome.runtime.onInstalled.addListener(() => {
  buildMenus();
  ensureDefaults();
});

chrome.runtime.onStartup?.addListener(buildMenus);

chrome.contextMenus.onClicked.addListener(async info => {
  if (!info.menuItemId.startsWith('cat_')) return;
  const cat = info.menuItemId.slice(4);
  const id = getVid(info.linkUrl) || getVid(info.srcUrl) || getVid(info.pageUrl);
  if (!id) return;
  // The backend will fetch the view count if it's 0 and source is context_menu

  await Promise.all([sendVote(id, cat, 0, 'context_menu'), storeBlock(id)]);
  broadcast({ type: 'videoFlagged', id, category: cat, showUndo: true });
});


chrome.runtime.onMessage.addListener(async (msg, sender) => {
  switch (msg.type) {
    case 'flag':
      const serverResponse = await sendVote(msg.id, msg.cat, msg.viewCount, msg.flagSource);
      await storeBlock(msg.id);
      broadcast({ type: 'videoFlagged', id: msg.id, category: msg.cat, showUndo: true, serverResponse }, sender.tab?.id);
      break;
    case 'unblock':
      await removeBlock(msg.id);
      broadcast({ type: 'videoUnblocked', id: msg.id }, sender.tab?.id);
      break;
    case 'clearAll':
      await chrome.storage.local.set({ [blockedKey]: [] });
      broadcast({ type: 'cleared' });
      break;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[scopeKey]) {
    broadcast({ type: 'settingsChanged' });
  }
});
