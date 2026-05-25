// popup.js — Controls the extension popup (main, history, settings views)

document.addEventListener('DOMContentLoaded', () => {

  // ── Element refs: Main view ─────────────────────────────────
  const viewMain   = document.getElementById('viewMain');
  const captureBtn = document.getElementById('captureBtn');
  const loadingEl  = document.getElementById('loading');
  const statusEl   = document.getElementById('status');
  const btnText    = captureBtn.querySelector('.btn-text');
  const historyBtn = document.getElementById('historyBtn');
  const gearBtn    = document.getElementById('gearBtn');

  // ── Element refs: History view ──────────────────────────────
  const viewHistory      = document.getElementById('viewHistory');
  const historyBackBtn   = document.getElementById('historyBackBtn');
  const clearHistoryBtn  = document.getElementById('clearHistoryBtn');
  const historyList      = document.getElementById('historyList');

  // ── Element refs: Settings view ─────────────────────────────
  const viewSettings   = document.getElementById('viewSettings');
  const backBtn        = document.getElementById('backBtn');
  const providerSelect = document.getElementById('providerSelect');
  const apiKeyInput    = document.getElementById('apiKeyInput');
  const toggleVisBtn   = document.getElementById('toggleVisBtn');
  const keySavedBadge  = document.getElementById('keySavedBadge');
  const saveBtn        = document.getElementById('saveBtn');
  const settingsStatus = document.getElementById('settingsStatus');

  // ────────────────────────────────────────────────────────────
  // View switching
  // ────────────────────────────────────────────────────────────

  historyBtn.addEventListener('click', () => {
    switchToView(viewHistory, 'right');
    loadHistory();
  });

  historyBackBtn.addEventListener('click', () => switchToView(viewMain, 'left'));

  gearBtn.addEventListener('click', () => {
    switchToView(viewSettings, 'right');
    loadSettings();
  });

  backBtn.addEventListener('click', () => switchToView(viewMain, 'left'));

  function switchToView(target, direction) {
    document.querySelectorAll('.view').forEach(v => { v.hidden = true; });
    target.hidden = false;
    const cls = direction === 'right' ? 'slide-in-right' : 'slide-in-left';
    target.classList.add(cls);
    target.addEventListener('animationend', () => target.classList.remove(cls), { once: true });
  }

  // ────────────────────────────────────────────────────────────
  // Capture flow
  // ────────────────────────────────────────────────────────────

  captureBtn.addEventListener('click', () => {
    setLoading(true);
    clearStatus();

    chrome.runtime.sendMessage({ action: 'captureAndAnalyze' }, (response) => {
      if (chrome.runtime.lastError) {
        setLoading(false);
        showStatus('error', 'Extension error — please try again.');
        return;
      }

      setLoading(false);

      if (response?.success) {
        showStatus('success', '✓ Answer ready — check the page!');
        setTimeout(() => window.close(), 1800);
      } else {
        showStatus('error', response?.error || 'Something went wrong.');
      }
    });
  });

  function setLoading(active) {
    captureBtn.disabled = active;
    loadingEl.hidden    = !active;
    btnText.textContent = active ? 'Analyzing…' : 'Capture Question';
  }

  function showStatus(type, msg) {
    statusEl.textContent = msg;
    statusEl.className   = `status ${type}`;
  }

  function clearStatus() {
    statusEl.textContent = '';
    statusEl.className   = 'status';
  }

  // ────────────────────────────────────────────────────────────
  // History: load & render
  // ────────────────────────────────────────────────────────────

  async function loadHistory() {
    const { studysnap_history: history = [] } =
      await chrome.storage.local.get('studysnap_history');
    renderHistory(history);
  }

  function renderHistory(history) {
    if (history.length === 0) {
      historyList.innerHTML = `
        <div class="history-empty">
          <span class="history-empty-icon">📋</span>
          No answers yet.<br>Capture a question to get started!
        </div>`;
      return;
    }

    historyList.innerHTML = history.map(entry => {
      const conf        = getConfidenceInfo(entry.confidence);
      const time        = formatTime(entry.ts);
      const feedbackBadge = entry.feedback === 'correct'
        ? '<span class="history-badge correct">👍</span>'
        : entry.feedback === 'incorrect'
          ? '<span class="history-badge incorrect">👎</span>'
          : '';
      return `
        <div class="history-item">
          <div class="history-item-header">
            <span class="history-time">${time}</span>
            <div class="history-item-meta">
              ${feedbackBadge}
              <span class="history-conf" style="color:${conf.color}">${entry.confidence}%</span>
            </div>
          </div>
          <div class="history-answer" data-answer></div>
          <div class="history-why"   data-why></div>
        </div>`;
    }).join('');

    // Set text safely (XSS protection — no innerHTML for user/AI data)
    const items = historyList.querySelectorAll('.history-item');
    history.forEach((entry, i) => {
      items[i].querySelector('[data-answer]').textContent = entry.answer;
      items[i].querySelector('[data-why]').textContent   = entry.why;
    });
  }

  function formatTime(ts) {
    const date    = new Date(ts);
    const now     = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (isToday) return `Today, ${time}`;

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;

    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + `, ${time}`;
  }

  // ────────────────────────────────────────────────────────────
  // History: clear with double-tap confirmation
  // ────────────────────────────────────────────────────────────

  let clearPending = false;
  let clearTimer   = null;

  clearHistoryBtn.addEventListener('click', async () => {
    if (!clearPending) {
      // First tap — ask for confirmation
      clearPending = true;
      clearHistoryBtn.textContent = 'Tap again to clear';
      clearHistoryBtn.classList.add('confirming');
      clearTimer = setTimeout(resetClearBtn, 2500);
      return;
    }

    // Second tap — confirmed, clear everything
    clearTimeout(clearTimer);
    await chrome.storage.local.remove('studysnap_history');
    resetClearBtn();
    renderHistory([]);
  });

  function resetClearBtn() {
    clearPending = false;
    clearHistoryBtn.textContent = '🗑';
    clearHistoryBtn.classList.remove('confirming');
  }

  // ────────────────────────────────────────────────────────────
  // Settings: load saved values
  // ────────────────────────────────────────────────────────────

  async function loadSettings() {
    const data = await chrome.storage.local.get(['studysnap_provider', 'studysnap_key_saved']);

    if (data.studysnap_provider) providerSelect.value = data.studysnap_provider;

    const hasSavedKey       = Boolean(data.studysnap_key_saved);
    keySavedBadge.hidden    = !hasSavedKey;
    apiKeyInput.placeholder = hasSavedKey
      ? 'Enter a new key to replace the saved one…'
      : getKeyPlaceholder(providerSelect.value);

    apiKeyInput.value        = '';
    apiKeyInput.type         = 'password';
    toggleVisBtn.textContent = 'Show';
    setSettingsStatus('', '');
  }

  providerSelect.addEventListener('change', () => {
    if (keySavedBadge.hidden) apiKeyInput.placeholder = getKeyPlaceholder(providerSelect.value);
  });

  function getKeyPlaceholder(provider) {
    return provider === 'anthropic' ? 'sk-ant-… (Anthropic key)' : 'sk-… (OpenAI key)';
  }

  // ────────────────────────────────────────────────────────────
  // Settings: show / hide key toggle
  // ────────────────────────────────────────────────────────────

  toggleVisBtn.addEventListener('click', () => {
    const isHidden           = apiKeyInput.type === 'password';
    apiKeyInput.type         = isHidden ? 'text' : 'password';
    toggleVisBtn.textContent = isHidden ? 'Hide' : 'Show';
    if (isHidden) {
      const len = apiKeyInput.value.length;
      apiKeyInput.setSelectionRange(len, len);
    }
  });

  // ────────────────────────────────────────────────────────────
  // Settings: save
  // ────────────────────────────────────────────────────────────

  saveBtn.addEventListener('click', async () => {
    const provider = providerSelect.value;
    const key      = apiKeyInput.value.trim();

    if (key) {
      const err = validateKey(key);
      if (err) { setSettingsStatus('error', err); return; }
    }

    const toSave = { studysnap_provider: provider };
    if (key) {
      toSave.studysnap_apikey    = key;
      toSave.studysnap_key_saved = true;
    }

    await chrome.storage.local.set(toSave);

    apiKeyInput.value        = '';
    apiKeyInput.type         = 'password';
    toggleVisBtn.textContent = 'Show';

    if (key) {
      keySavedBadge.hidden    = false;
      apiKeyInput.placeholder = 'Enter a new key to replace the saved one…';
    }

    setSettingsStatus('success', key ? '✓ Key saved!' : '✓ Provider updated!');
    setTimeout(() => setSettingsStatus('', ''), 2500);
  });

  function validateKey(key) {
    if (key.length < 16) return 'That key looks too short — double-check it.';
    return null;
  }

  function setSettingsStatus(type, msg) {
    settingsStatus.textContent = msg;
    settingsStatus.className   = type ? `settings-status ${type}` : 'settings-status';
  }

});
