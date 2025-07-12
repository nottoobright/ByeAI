const cats = ['AI-script','AI-image/thumbnail','AI-music','AI-voice-over','Deepfake/video','Other'];
const blockedKey = 'blockedIds';
const flagUI = document.getElementById('flagUI');
const listUI = document.getElementById('listUI');
const catsDiv = document.getElementById('cats');
const listDiv = document.getElementById('list');
const clearBtn = document.getElementById('clearAll');

// Simple text without over-engineering
document.querySelector('#flagUI h3').textContent = 'Flag this video';
document.getElementById('settings').textContent = '⚙ Settings';
document.querySelector('#listUI h3').textContent = 'Blocked items';
clearBtn.textContent = 'Clear all';

document.getElementById('settings').onclick = () => chrome.runtime.openOptionsPage();

chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
  const u = new URL(tab.url);
  const isWatch = u.pathname === '/watch';
  flagUI.hidden = !isWatch;
  listUI.hidden = false;
  
  if (isWatch) {
    const vid = u.searchParams.get('v');
    catsDiv.innerHTML = '';
    
    cats.forEach((c, index) => {
      const b = document.createElement('button');
      b.textContent = c;
      b.setAttribute('aria-label', `Flag as ${c}`);
      b.setAttribute('tabindex', '0');
      
      const activate = () => {
        chrome.runtime.sendMessage({ type: 'flag', id: vid, cat: c, tabId: tab.id });
        window.close();
      };
      
      b.onclick = activate;
      b.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      };
      
      catsDiv.appendChild(b);
    });
  }
  
  // Load and display blocked videos
  await loadBlockedList();
  
  clearBtn.onclick = () => {
    chrome.runtime.sendMessage({ type: 'clearAll' });
    listDiv.innerHTML = '';
  };
});

async function loadBlockedList() {
  const { blockedIds = [] } = await chrome.storage.local.get(blockedKey);
  listDiv.innerHTML = '';
  
  blockedIds.forEach(id => {
    const row = document.createElement('div');
    row.setAttribute('role', 'listitem');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';
    row.style.padding = '4px 0';
    
    const videoSpan = document.createElement('span');
    videoSpan.textContent = id;
    videoSpan.style.fontSize = '12px';
    videoSpan.style.wordBreak = 'break-all';
    
    const unhideBtn = document.createElement('button');
    unhideBtn.textContent = 'Unhide';
    unhideBtn.setAttribute('aria-label', `Unhide video ${id}`);
    unhideBtn.onclick = () => {
      chrome.runtime.sendMessage({ type: 'unblock', id });
      row.remove();
    };
    
    row.appendChild(videoSpan);
    row.appendChild(unhideBtn);
    listDiv.appendChild(row);
  });
}

// Listen for storage changes to update the list
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[blockedKey]) {
    loadBlockedList();
  }
});

// Add keyboard navigation styles
const style = document.createElement('style');
style.textContent = `
  button:focus {
    outline: 2px solid #1976d2;
    outline-offset: 2px;
  }
  
  [role="listitem"] {
    border-bottom: 1px solid #eee;
  }
  
  [role="listitem"]:last-child {
    border-bottom: none;
  }
`;
document.head.appendChild(style);
