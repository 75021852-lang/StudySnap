// content.js — Injected into the active page by StudySnap
// Builds and manages the floating answer overlay.

(function () {
  'use strict';

  if (window.__studySnapLoaded) return;
  window.__studySnapLoaded = true;

  let overlayEl     = null;
  let currentEntryId = null; // tracks which history entry this overlay belongs to

  // ── Listen for messages from the background service worker ──────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'showOverlay') {
      renderOverlay(message.data);
      sendResponse({ ok: true });
    }
    return false;
  });

  // ── Render (or replace) the overlay ─────────────────────────────────────────

  function renderOverlay(data) {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }

    currentEntryId = data.entryId ?? null;
    overlayEl = buildOverlay(data);
    document.body.appendChild(overlayEl);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlayEl.classList.add('ss-visible');
        const fill = overlayEl.querySelector('.ss-conf-fill');
        if (fill) fill.style.width = fill.dataset.target;
      });
    });
  }

  function closeOverlay() {
    if (!overlayEl) return;
    overlayEl.classList.remove('ss-visible');
    const el = overlayEl;
    overlayEl = null;
    setTimeout(() => el.remove(), 320);
  }

  // ── Build the overlay DOM ────────────────────────────────────────────────────

  function buildOverlay(data) {
    const { answer, why, deepExplanation, confidence, questionType } = data;
    const conf   = confidenceInfo(confidence);
    const isType = questionType === 'type'; // true = student must type; false = student selects

    const root = document.createElement('div');
    root.id = 'studysnap-overlay';

    root.innerHTML = `
      <div class="ss-header">
        <div class="ss-brand">
          <span class="ss-brand-icon">⚡</span>
          <span class="ss-brand-name">StudySnap</span>
        </div>
        <button class="ss-close" aria-label="Close StudySnap">×</button>
      </div>

      <div class="ss-body">

        <div class="ss-section">
          <div class="ss-answer-header">
            <div class="ss-label">Answer</div>
            ${isType
              ? `<button class="ss-copy-btn" title="Copy answer to clipboard">Copy</button>`
              : `<span class="ss-answer-tag">Select on page</span>`
            }
          </div>
          <div class="ss-answer-text ${isType ? 'ss-answer-type' : 'ss-answer-select'}"></div>
        </div>

        <div class="ss-section">
          <div class="ss-label">Why</div>
          <div class="ss-why-text"></div>
        </div>

        ${deepExplanation ? `
          <button class="ss-expand-btn" aria-expanded="false">
            <span class="ss-expand-icon">📖</span>
            <span>Deep Explanation</span>
            <span class="ss-chevron" aria-hidden="true">▾</span>
          </button>
          <div class="ss-deep-panel" role="region"></div>
        ` : ''}

        <div class="ss-conf-section">
          <div class="ss-conf-row">
            <span class="ss-label">Confidence</span>
            <span class="ss-conf-value"></span>
          </div>
          <div class="ss-conf-track" role="progressbar" aria-valuemin="0" aria-valuemax="100">
            <div class="ss-conf-fill" data-target="${confidence}%" style="width:0%"></div>
          </div>
          <div class="ss-conf-label"></div>
        </div>

        <div class="ss-feedback-row">
          <span class="ss-feedback-label">Was this correct?</span>
          <div class="ss-feedback-btns">
            <button class="ss-thumb ss-thumb-up"   aria-label="Yes, correct">👍</button>
            <button class="ss-thumb ss-thumb-down" aria-label="No, incorrect">👎</button>
          </div>
        </div>

      </div>
    `;

    // ── Text content (XSS-safe) ────────────────────────────────────────────────
    root.querySelector('.ss-answer-text').textContent = answer;
    root.querySelector('.ss-why-text').textContent    = why;
    if (deepExplanation) root.querySelector('.ss-deep-panel').textContent = deepExplanation;

    // ── Confidence ─────────────────────────────────────────────────────────────
    const confValue = root.querySelector('.ss-conf-value');
    const confFill  = root.querySelector('.ss-conf-fill');
    const confLabel = root.querySelector('.ss-conf-label');
    confValue.textContent     = `${confidence}%`;
    confValue.style.color     = conf.color;
    confLabel.textContent     = conf.label;
    confLabel.style.color     = conf.color;
    confFill.style.background = conf.color;

    // ── Close ──────────────────────────────────────────────────────────────────
    root.querySelector('.ss-close').addEventListener('click', closeOverlay);

    // ── Copy answer to clipboard ───────────────────────────────────────────────
   const copyBtn = root.querySelector('.ss-copy-btn');
if (copyBtn) {
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(answer);
      copyBtn.textContent = '✓ Copied!';
      copyBtn.classList.add('ss-copy-success');
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.classList.remove('ss-copy-success');
      }, 2000);
    } catch {
      copyBtn.textContent = 'Failed';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    }
  });
}

    // ── Deep explanation expand/collapse ───────────────────────────────────────
    const expandBtn = root.querySelector('.ss-expand-btn');
    if (expandBtn) {
      const panel   = root.querySelector('.ss-deep-panel');
      const chevron = root.querySelector('.ss-chevron');
      expandBtn.addEventListener('click', () => {
        const isOpen = panel.classList.toggle('ss-deep-open');
        chevron.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
        expandBtn.setAttribute('aria-expanded', String(isOpen));
      });
    }

    // ── Thumbs up / down feedback ──────────────────────────────────────────────
    const thumbUp    = root.querySelector('.ss-thumb-up');
    const thumbDown  = root.querySelector('.ss-thumb-down');
    const feedLabel  = root.querySelector('.ss-feedback-label');

    function applyFeedback(type) {
      // Visual state
      thumbUp.classList.toggle('ss-thumb-active-up',   type === 'correct');
      thumbUp.classList.toggle('ss-thumb-dimmed',      type === 'incorrect');
      thumbDown.classList.toggle('ss-thumb-active-down', type === 'incorrect');
      thumbDown.classList.toggle('ss-thumb-dimmed',      type === 'correct');
      feedLabel.textContent = type === 'correct' ? '✓ Marked correct' : '✗ Marked incorrect';
      feedLabel.style.color = type === 'correct' ? '#22c55e' : '#f87171';

      // Persist to history entry
      if (currentEntryId) {
        chrome.runtime.sendMessage({ action: 'saveFeedback', entryId: currentEntryId, feedback: type });
      }
    }

    thumbUp.addEventListener('click',   () => applyFeedback('correct'));
    thumbDown.addEventListener('click', () => applyFeedback('incorrect'));

    return root;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function confidenceInfo(score) {
    if (score >= 80) return { label: 'High confidence',   color: '#22c55e' };
    if (score >= 60) return { label: 'Medium confidence', color: '#f59e0b' };
    return              { label: 'Low confidence',    color: '#ef4444' };
  }

})();
