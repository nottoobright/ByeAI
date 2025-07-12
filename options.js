const cats = ['AI-script','AI-image/thumbnail','AI-music','AI-voice-over','Deepfake/video','Other'];
const scopeKey = 'banCategories';
const analyticsKey = 'analytics';
const blockedKey = 'blockedIds';

const catsDiv = document.getElementById('cats');
const analyticsBox = document.getElementById('analytics');
const exportBtn = document.getElementById('export');
const importBtn = document.getElementById('import');
const importFile = document.getElementById('importFile');

// Simple text
document.title = 'ByeAI Settings';
document.querySelector('h2').textContent = 'ByeAI Settings';
document.querySelector('legend').textContent = 'Block categories';
document.querySelector('label span').textContent = 'Enable anonymous analytics';
exportBtn.textContent = 'Export blocked list';
importBtn.textContent = 'Import blocked list';

async function load() {
  const store = await chrome.storage.local.get([scopeKey, analyticsKey]);
  const active = store[scopeKey] ?? cats.reduce((o, c) => ({ ...o, [c]: true }), {});
  
  catsDiv.innerHTML = '';
  
  cats.forEach(c => {
    const lbl = document.createElement('label');
    lbl.className = 'cat';
    lbl.style.display = 'flex';
    lbl.style.alignItems = 'center';
    lbl.style.margin = '8px 0';
    lbl.setAttribute('tabindex', '0');
    
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!active[c];
    cb.style.marginRight = '8px';
    cb.setAttribute('aria-labelledby', `cat-${c}`);
    cb.onchange = () => saveCat(c, cb.checked);
    
    const span = document.createElement('span');
    span.id = `cat-${c}`;
    span.textContent = c;
    span.style.fontSize = '14px';
    
    // Keyboard support for label
    lbl.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        cb.checked = !cb.checked;
        saveCat(c, cb.checked);
      }
    };
    
    lbl.appendChild(cb);
    lbl.appendChild(span);
    catsDiv.appendChild(lbl);
  });
  
  analyticsBox.checked = !!store[analyticsKey];
  addCategoryControls();
}

function addCategoryControls() {
  const controls = document.createElement('div');
  controls.style.marginTop = '12px';
  controls.style.display = 'flex';
  controls.style.gap = '8px';
  
  const selectAll = document.createElement('button');
  selectAll.textContent = 'Select All';
  selectAll.className = 'btn';
  selectAll.style.fontSize = '12px';
  selectAll.style.padding = '4px 8px';
  selectAll.setAttribute('aria-label', 'Select all categories');
  selectAll.onclick = () => toggleAllCategories(true);
  
  const selectNone = document.createElement('button');
  selectNone.textContent = 'Select None';
  selectNone.className = 'btn';
  selectNone.style.fontSize = '12px';
  selectNone.style.padding = '4px 8px';
  selectNone.setAttribute('aria-label', 'Select no categories');
  selectNone.onclick = () => toggleAllCategories(false);
  
  controls.appendChild(selectAll);
  controls.appendChild(selectNone);
  catsDiv.appendChild(controls);
}

function toggleAllCategories(enabled) {
  const checkboxes = catsDiv.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => {
    if (cb !== analyticsBox) {
      cb.checked = enabled;
      const cat = cats[Array.from(checkboxes).indexOf(cb)];
      if (cat) saveCat(cat, enabled);
    }
  });
}

async function saveCat(cat, val) {
  const s = await chrome.storage.local.get(scopeKey);
  const obj = s[scopeKey] ?? {};
  obj[cat] = val;
  await chrome.storage.local.set({ [scopeKey]: obj });
  showFeedback(`${cat} ${val ? 'enabled' : 'disabled'}`);
}

function showFeedback(message) {
  const existing = document.getElementById('feedback');
  if (existing) existing.remove();
  
  const feedback = document.createElement('div');
  feedback.id = 'feedback';
  feedback.textContent = message;
  feedback.setAttribute('role', 'alert');
  feedback.setAttribute('aria-live', 'polite');
  feedback.style.cssText = `
    position: fixed; top: 20px; right: 20px; background: #4caf50; 
    color: white; padding: 8px 16px; border-radius: 4px; font-size: 12px;
    z-index: 1000; opacity: 1; transition: opacity 0.3s;
  `;
  document.body.appendChild(feedback);
  
  setTimeout(() => {
    feedback.style.opacity = '0';
    setTimeout(() => feedback.remove(), 300);
  }, 2000);
}

analyticsBox.onchange = async () => {
  await chrome.storage.local.set({ [analyticsKey]: analyticsBox.checked });
  showFeedback(`Analytics ${analyticsBox.checked ? 'enabled' : 'disabled'}`);
};

exportBtn.onclick = async () => {
  try {
    const { blockedIds = [] } = await chrome.storage.local.get(blockedKey);
    const { banCategories } = await chrome.storage.local.get(scopeKey);
    
    const exportData = {
      blockedIds,
      banCategories,
      exportDate: new Date().toISOString(),
      version: '0.6.0'
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url,
      filename: `byeai_export_${new Date().toISOString().split('T')[0]}.json`,
      saveAs: true
    });
    showFeedback('Export started');
  } catch (error) {
    showFeedback('Export failed');
  }
};

importBtn.onclick = () => importFile.click();

importFile.onchange = async () => {
  const f = importFile.files[0];
  if (!f) return;
  
  try {
    const text = await f.text();
    const data = JSON.parse(text);
    
    const updates = {};
    
    if (Array.isArray(data.blockedIds)) {
      updates[blockedKey] = data.blockedIds;
    } else if (Array.isArray(data)) {
      updates[blockedKey] = data;
    }
    
    if (data.banCategories && typeof data.banCategories === 'object') {
      updates[scopeKey] = data.banCategories;
    }
    
    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
      showFeedback(`Import successful: ${Object.keys(updates).length} settings updated`);
      setTimeout(() => load(), 1000);
    } else {
      showFeedback('No valid data found in file');
    }
  } catch (error) {
    showFeedback('Import failed: Invalid file format');
  }
  
  importFile.value = '';
};

// Add keyboard navigation styles
const style = document.createElement('style');
style.textContent = `
  .cat:hover, .cat:focus {
    background-color: #f5f5f5;
    border-radius: 4px;
    padding: 4px;
    margin: 4px -4px;
    outline: none;
  }
  
  .cat:focus {
    box-shadow: 0 0 0 2px #1976d2;
  }
  
  fieldset {
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 12px;
  }
  
  legend {
    font-weight: bold;
    padding: 0 8px;
  }
  
  button:focus {
    outline: 2px solid #1976d2;
    outline-offset: 2px;
  }
`;
document.head.appendChild(style);

load();
