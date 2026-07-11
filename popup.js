const cats = BYEAI.CATS;

const blockedKey = 'blockedIds';
const flagUI = document.getElementById('flagUI');
const listUI = document.getElementById('listUI');
const catsDiv = document.getElementById('cats');
const listDiv = document.getElementById('list');
const clearBtn = document.getElementById('clearAll');
const submitBtn = document.getElementById('submitFlag');
const selectionHint = document.getElementById('selectionHint');

let selectedCategories = new Set();
let currentVideoId = null;
let currentTabId = null;

document.getElementById('settings').onclick = () => chrome.runtime.openOptionsPage();

document.getElementById('viewStats').onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('stats.html') });
};

function updateSubmitButton() {
  const count = selectedCategories.size;
  submitBtn.disabled = count === 0;
  
  if (count === 0) {
    selectionHint.textContent = 'Select one or more categories';
    submitBtn.textContent = 'Submit Flag';
  } else if (count === 1) {
    selectionHint.textContent = '1 category selected';
    submitBtn.textContent = 'Submit Flag';
  } else {
    selectionHint.textContent = `${count} categories selected`;
    submitBtn.textContent = `Submit ${count} Flags`;
  }
}

function createCategoryItem(cat) {
  const item = document.createElement('div');
  item.className = 'category-item';
  item.setAttribute('data-id', cat.id);
  
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = `cat-${cat.id}`;
  checkbox.name = 'category';
  checkbox.value = cat.id;
  
  const label = document.createElement('label');
  label.htmlFor = `cat-${cat.id}`;
  label.textContent = cat.label;
  
  item.appendChild(checkbox);
  item.appendChild(label);
  
  // Click on entire row toggles checkbox
  item.onclick = (e) => {
    if (e.target !== checkbox) {
      checkbox.checked = !checkbox.checked;
    }
    
    if (checkbox.checked) {
      selectedCategories.add(cat.id);
      item.classList.add('selected');
    } else {
      selectedCategories.delete(cat.id);
      item.classList.remove('selected');
    }
    updateSubmitButton();
  };
  
  return item;
}

chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
  const u = new URL(tab.url);
  const shortsMatch = u.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
  const isWatch = u.pathname === '/watch' || !!shortsMatch;
  flagUI.hidden = !isWatch;

  if (isWatch) {
    currentVideoId = shortsMatch ? shortsMatch[1] : u.searchParams.get('v');
    currentTabId = tab.id;
    
    catsDiv.innerHTML = '';
    selectedCategories.clear();
    
    cats.forEach(cat => {
      const item = createCategoryItem(cat);
      catsDiv.appendChild(item);
    });
    
    updateSubmitButton();
    
    // Submit button handler
    submitBtn.onclick = () => {
      if (selectedCategories.size === 0) return;
      
      // Send message for each selected category
      const categories = Array.from(selectedCategories);
      chrome.runtime.sendMessage({ 
        type: 'flagMultiple', 
        id: currentVideoId, 
        categories: categories,
        tabId: currentTabId 
      });
      
      window.close();
    };
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
  
  if (blockedIds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No blocked videos yet';
    listDiv.appendChild(empty);
    return;
  }
  
  blockedIds.forEach(id => {
    const row = document.createElement('div');
    row.className = 'blocked-item';
    row.setAttribute('role', 'listitem');
    
    const videoSpan = document.createElement('span');
    videoSpan.textContent = id;
    
    const unhideBtn = document.createElement('button');
    unhideBtn.textContent = 'Unhide';
    unhideBtn.setAttribute('aria-label', `Unhide video ${id}`);
    unhideBtn.onclick = () => {
      chrome.runtime.sendMessage({ type: 'unblock', id });
      row.remove();
      // Check if list is now empty
      if (listDiv.children.length === 0) {
        loadBlockedList();
      }
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
