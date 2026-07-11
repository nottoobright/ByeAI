const catLabels = Object.fromEntries(BYEAI.CATS.map(c => [c.id, c.label]));
catLabels.local = 'Manual';

function lastNDays(n) {
  const out = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function render() {
  const { stats } = await chrome.storage.local.get('stats');
  if (!stats) {
    document.getElementById('total').textContent = '0';
    document.getElementById('since').textContent = 'No flags yet — start flagging to see stats.';
    document.getElementById('bars').innerHTML = '<div class="empty">No data yet.</div>';
    document.getElementById('categories').innerHTML = '<div class="empty">No data yet.</div>';
    return;
  }

  document.getElementById('total').textContent = stats.totalHidden.toLocaleString();
  document.getElementById('since').textContent =
    `Tracking since ${new Date(stats.firstSeenAt).toLocaleDateString()}`;

  // Bars (last 30 days)
  const days = lastNDays(30);
  const counts = days.map(d => stats.byDay[d] || 0);
  const max = Math.max(1, ...counts);
  const barsEl = document.getElementById('bars');
  barsEl.innerHTML = '';
  days.forEach((d, i) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = `${(counts[i] / max) * 100}%`;
    bar.dataset.count = counts[i];
    bar.dataset.day = d;
    barsEl.appendChild(bar);
  });

  // Categories (sorted desc by count)
  const catsEl = document.getElementById('categories');
  catsEl.innerHTML = '';
  const sorted = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    catsEl.innerHTML = '<div class="empty">No category data yet.</div>';
  } else {
    sorted.forEach(([id, count]) => {
      const row = document.createElement('div');
      row.className = 'cat-row';
      const left = document.createElement('span');
      left.textContent = catLabels[id] || id;
      const right = document.createElement('span');
      right.textContent = count.toLocaleString();
      row.appendChild(left);
      row.appendChild(right);
      catsEl.appendChild(row);
    });
  }
}

render();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.stats) render();
});
