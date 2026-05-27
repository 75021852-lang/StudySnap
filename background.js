// background.js — StudySnap Service Worker
//
// Flow:
//   popup.js  ->  [captureAndAnalyze]  ->  background.js
//                                            | captureVisibleTab
//                                            | analyzeWithAI  (OpenAI or Anthropic)
//                                            | inject content.js + overlay.css
//                                            v
//                                         content.js  ->  overlay shown on page

// ── Message listener ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'captureAndAnalyze') {
    runCaptureFlow(sendResponse);
    return true;
  }
  if (message.action === 'saveFeedback') {
    updateHistoryFeedback(message.entryId, message.feedback);
    return false;
  }
});

// ── Main flow ─────────────────────────────────────────────────

async function runCaptureFlow(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id) {
      return sendResponse({ success: false, error: 'No active tab found.' });
    }

    // Capture the visible area of the page as a PNG data URL
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });

    // Analyze the screenshot with the configured AI provider
    const result = await analyzeWithAI(screenshotDataUrl);

    // Generate a shared ID so the overlay and the history entry stay linked
    const entryId = Date.now();

    // Inject the overlay stylesheet and content script into the page
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['overlay.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });

    // Give the content script a moment to initialize before messaging it
    await delay(150);

    await chrome.tabs.sendMessage(tab.id, { action: 'showOverlay', data: { ...result, entryId } });

    // Save to history with the same ID (non-blocking)
    saveToHistory(result, entryId);

    sendResponse({ success: true });

  } catch (err) {
    console.error('[StudySnap]', err);
    sendResponse({ success: false, error: friendlyError(err.message) });
  }
}

// ── AI Analysis ───────────────────────────────────────────────

async function analyzeWithAI(screenshotDataUrl) {
  // Load the user's saved provider and API key
  const { studysnap_provider: provider = 'openai', studysnap_apikey: apiKey } =
    await chrome.storage.local.get(['studysnap_provider', 'studysnap_apikey']);

  if (!apiKey) {
    // Guide the user to the settings panel instead of a generic error
    throw new Error('NO_API_KEY');
  }

  return provider === 'anthropic'
    ? callAnthropic(screenshotDataUrl, apiKey)
    : callOpenAI(screenshotDataUrl, apiKey);
}

// ── OpenAI GPT-4o Vision ──────────────────────────────────────

async function callOpenAI(screenshotDataUrl, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: [
          { type: 'text',      text: STUDY_PROMPT },
          { type: 'image_url', image_url: { url: screenshotDataUrl } },
        ],
      }],
    }),
  });

  await assertResponseOK(response);

  const json = await response.json();
  return parseAIResponse(json.choices[0].message.content);
}

// ── Anthropic Claude Vision ───────────────────────────────────

async function callAnthropic(screenshotDataUrl, apiKey) {
  // Anthropic expects raw base64, without the "data:image/png;base64," prefix
  const base64Image = screenshotDataUrl.split(',')[1];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':                              'application/json',
      'x-api-key':                                 apiKey,
      'anthropic-version':                         '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: 'image/png', data: base64Image },
          },
          { type: 'text', text: STUDY_PROMPT },
        ],
      }],
    }),
  });

  await assertResponseOK(response);

  const json = await response.json();
  return parseAIResponse(json.content[0].text);
}

// ── Prompt ────────────────────────────────────────────────────

const STUDY_PROMPT = `You are a helpful study assistant analyzing a screenshot of a study or quiz page.

STEP 1 - Identify the question type:
- WRITING ASSIGNMENT: asks the student to write a paragraph or essay, especially when formatting requirements are listed (highlight colors, bold, underline, color-code by grammar type)
- MULTIPLE CHOICE: options labeled A/B/C/D or listed as radio buttons
- TRUE / FALSE: only two options: True and False
- FILL-IN-THE-BLANK: a sentence with a blank/gap the student must complete
- SENTENCE COMPLETION: a partial sentence (often ending with "...") where the student types the rest
- SHORT ANSWER / OPEN TEXT: an empty text box with no sentence stem
- MATCHING / OTHER: anything else

STEP 2 - Pick the FIRST unanswered question (no checkmark, no selection, no "correct/incorrect" banner).

STEP 3 - Format the answer based on type:

* WRITING ASSIGNMENT -> Write a complete, high-quality paragraph (8+ sentences) that fully answers the prompt. Read ALL formatting requirements visible on screen and apply every one using ONLY these HTML tags:
  - Topic sentence                      -> <u>sentence</u>
  - Subordinate conjunctions            -> <span class="ss-blue">word or phrase</span>
    (although, because, since, while, if, when, as, unless, until, after, before, even though)
  - Coordinate conjunctions             -> <span class="ss-green">word</span>
    (for, and, nor, but, or, yet, so -- only when joining two independent clauses)
  - Transitional adverbs                -> <span class="ss-red">word</span>
    (furthermore, however, therefore, moreover, consequently, nevertheless, additionally, finally, meanwhile, thus)
  - Words/phrases showing tense variety -> <strong>word or phrase</strong>
    (mix past simple, past perfect, present perfect, and future naturally)
  Each required element must appear at least twice. Every sentence must flow logically.
  Return the full formatted HTML paragraph as the "answer" field. Use NO other HTML tags.

* MULTIPLE CHOICE -> answer is the option letter + text, e.g. "B) The mitochondria"
* TRUE / FALSE -> answer is just "True" or "False"
* FILL-IN-THE-BLANK / SENTENCE COMPLETION -> answer is ONLY the words that go in the blank, written so they fit naturally inside the sentence. Do NOT repeat the whole sentence. The completion must make the FULL sentence feel like a meaningful, coherent thought -- avoid vague or tautological fillers. Use context clues to infer a specific, logical completion.
* SHORT ANSWER -> a concise, complete sentence that directly answers the question
* If no unanswered question is visible -> set confidence to 0

Respond with ONLY a valid JSON object -- no markdown, no extra text:
{
  "questionType": "select",
  "answer": "The answer -- for writing assignments use the HTML formatting tags described above",
  "why": "A 1-2 sentence explanation of why this answer is correct",
  "deepExplanation": "A deeper explanation to help the student truly understand the concept (2-4 sentences)",
  "confidence": 85
}

"questionType" must be one of:
- "select"   -> multiple choice or true/false (student clicks an existing option)
- "type"     -> fill-in-the-blank, sentence completion, or open short-answer (student types text)
- "writing"  -> full paragraph/essay assignment with formatting requirements

If no unanswered question is visible, set confidence to 0 and answer: "No unanswered question detected -- scroll to the next question and try again."`;

// ── Response parsing ──────────────────────────────────────────

function parseAIResponse(text) {
  // Strip markdown code fences if the model wrapped the JSON in them
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const parsed = JSON.parse(cleaned); // throws on invalid JSON -- caught upstream

  // Normalise questionType -- default to 'select' so unknown values degrade gracefully
  const rawType    = String(parsed.questionType ?? '').toLowerCase();
  const questionType = ['type', 'writing'].includes(rawType) ? rawType : 'select';

  return {
    questionType,
    answer:          String(parsed.answer          ?? 'No answer found.'),
    why:             String(parsed.why             ?? ''),
    deepExplanation: String(parsed.deepExplanation ?? ''),
    confidence:      Math.min(100, Math.max(0, Number(parsed.confidence) || 50)),
  };
}

// ── History ───────────────────────────────────────────────────

async function saveToHistory(result, id = Date.now()) {
  try {
    const { studysnap_history: history = [] } = await chrome.storage.local.get('studysnap_history');
    const entry = {
      id,
      ts:           id,
      questionType: result.questionType,
      answer:       result.answer,
      why:          result.why,
      confidence:   result.confidence,
      feedback:     null,
    };
    const updated = [entry, ...history].slice(0, 50);
    await chrome.storage.local.set({ studysnap_history: updated });
  } catch (err) {
    console.warn('[StudySnap] History save failed:', err);
  }
}

async function updateHistoryFeedback(entryId, feedback) {
  try {
    const { studysnap_history: history = [] } = await chrome.storage.local.get('studysnap_history');
    const updated = history.map(e => e.id === entryId ? { ...e, feedback } : e);
    await chrome.storage.local.set({ studysnap_history: updated });
  } catch (err) {
    console.warn('[StudySnap] Feedback save failed:', err);
  }
}

// ── Helpers ───────────────────────────────────────────────────

async function assertResponseOK(response) {
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  const msg  = body.error?.message || `API error ${response.status}`;
  throw new Error(msg);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function friendlyError(raw = '') {
  const r = raw.toLowerCase();

  if (raw === 'NO_API_KEY') {
    return 'No API key saved -- click the gear icon in the popup to add yours.';
  }
  if (raw.includes('401') || r.includes('unauthorized') || r.includes('invalid api key') || r.includes('authentication')) {
    return 'Invalid API key. Open Settings to check it.';
  }
  if (raw.includes('429') || r.includes('rate limit') || r.includes('quota') || r.includes('too many requests')) {
    return 'Rate limit reached. Wait a moment and try again.';
  }
  if (r.includes('credit') || r.includes('billing') || r.includes('balance') || r.includes('payment') || r.includes('quota')) {
    return 'Quota or credit limit reached. Add billing credits to your AI provider account.';
  }
  if (r.includes('dangerous-direct-browser-access') || r.includes('cors')) {
    return 'Anthropic browser header missing -- please reload the extension and try again.';
  }
  if (r.includes('overloaded') || r.includes('capacity') || r.includes('529')) {
    return 'Claude is overloaded right now. Wait a moment and try again.';
  }
  if ((r.includes('model') && (r.includes('not found') || r.includes('unknown') || r.includes('invalid'))) || raw.includes('404')) {
    return 'Model not found. Try reloading the extension -- Settings may need to be re-saved.';
  }
  if (r.includes('json') || r.includes('unexpected token') || r.includes('syntaxerror')) {
    return 'AI returned an unexpected response format. Try again.';
  }
  if (raw.includes('Cannot access') || raw.includes('chrome://') || raw.includes('extension://')) {
    return 'Cannot capture this page. Navigate to a regular website first.';
  }
  if (raw.includes('Content Security Policy')) {
    return 'This page blocks script injection. Try a different website.';
  }
  if (r.includes('failed to fetch') || r.includes('networkerror') || r.includes('load failed')) {
    return 'Network error -- check your internet connection.';
  }
  console.warn('[StudySnap] Unmatched error:', raw);
  return `Error: ${raw.slice(0, 80) || 'Something went wrong. Please try again.'}`;
}
