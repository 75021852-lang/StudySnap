// utils.js — Shared utilities loaded by popup.html
// These are available as global functions in the popup context.

/**
 * Returns a label and hex color for a given confidence score (0–100).
 * Used to color the confidence bar and label consistently.
 */
function getConfidenceInfo(score) {
  if (score >= 80) return { label: 'High confidence',    color: '#22c55e' };
  if (score >= 60) return { label: 'Medium confidence',  color: '#f59e0b' };
  return              { label: 'Low confidence',     color: '#ef4444' };
}

/**
 * Safely escapes a string for insertion into innerHTML.
 * Prevents XSS when displaying user-controlled or API-returned text.
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * Useful for simulating delays or debouncing.
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
