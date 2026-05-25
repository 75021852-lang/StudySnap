# ⚡ StudySnap — AI Study Assistant Chrome Extension

StudySnap is a Chrome extension that helps you understand on-screen questions fast.
Click the extension, capture the visible page, and get an instant AI-powered answer with a short explanation and confidence score — all in a clean floating overlay.

---

## File Structure

```
StudySnap/
├── manifest.json          Chrome extension config (Manifest V3)
├── popup.html             Extension popup UI
├── popup.css              Popup styles
├── popup.js               Popup logic & messaging
├── background.js          Service worker: screenshot + AI + injection
├── content.js             Injected into pages: builds the overlay
├── overlay.css            Styles for the floating answer overlay
├── utils.js               Shared utility functions (loaded by popup)
├── icons/
│   └── generate-icons.html  Open in browser to download icon PNGs
└── README.md              This file
```

---

## Step-by-Step Install Instructions

### 1. Generate the icon files

1. Open `icons/generate-icons.html` in Chrome (File → Open File, or drag it into Chrome)
2. Click each of the three download buttons
3. Save `icon16.png`, `icon48.png`, and `icon128.png` into the `icons/` folder

### 2. Load the extension into Chrome

1. Open Chrome and go to: `chrome://extensions`
2. Turn on **Developer mode** (toggle, top-right corner)
3. Click **Load unpacked**
4. Select the `StudySnap/` folder (the one containing `manifest.json`)
5. The StudySnap extension will appear in the list with a ⚡ icon

### 3. Pin the extension (optional but recommended)

1. Click the puzzle-piece icon (🧩) in the Chrome toolbar
2. Find **StudySnap** and click the pin icon next to it
3. The ⚡ icon will appear in your toolbar for easy access

---

## Testing Instructions

### Test 1 — Popup renders correctly

1. Click the ⚡ StudySnap icon in the toolbar
2. You should see the dark popup with the "Capture Question" button

### Test 2 — Full mock capture flow

1. Navigate to any regular website (e.g., `https://wikipedia.org`)
2. Click the ⚡ StudySnap icon
3. Click **Capture Question**
4. The popup shows "Analyzing your question…" with a spinner
5. After ~1.5 seconds, it shows "✓ Answer ready — check the page!" and closes
6. On the page, a dark overlay appears in the top-right corner showing:
   - **Answer** — the mock answer text
   - **Why** — a brief explanation
   - **📖 Deep Explanation** — click to expand/collapse
   - **Confidence** — a colored progress bar (87%)

### Test 3 — Overlay controls

1. Click **📖 Deep Explanation** — the panel expands with more detail
2. Click it again — the panel collapses
3. Click **×** — the overlay fades out and disappears

### Test 4 — Error handling

1. Open a new tab (`chrome://newtab`)
2. Click the extension and try to capture
3. You should see: "Cannot capture this page. Navigate to a regular website first."

---

## Where to Add the Real AI API

Open `background.js` and find the `analyzeWithAI()` function (around line 56).

Replace the mock return block with a real API call. Here is a template using **GPT-4o Vision** (OpenAI) and **Claude 3.5 Sonnet Vision** (Anthropic) as examples:

### Option A — OpenAI GPT-4o Vision

```js
// ── ADD YOUR KEY HERE ──
const OPENAI_API_KEY = 'sk-...'; // Replace with your real key

async function analyzeWithAI(screenshotDataUrl) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are a study assistant. Look at this screenshot and answer any question visible.
Return a JSON object with these exact keys:
- answer: string (the direct answer)
- why: string (1-2 sentence explanation)
- deepExplanation: string (a deeper explanation for learning)
- confidence: number (0-100)
Return only the JSON object, no markdown.`,
            },
            {
              type: 'image_url',
              image_url: { url: screenshotDataUrl },
            },
          ],
        },
      ],
    }),
  });

  const json = await response.json();
  const text = json.choices[0].message.content;
  return JSON.parse(text); // Parse the JSON the model returned
}
```

### Option B — Anthropic Claude Vision

```js
// ── ADD YOUR KEY HERE ──
const ANTHROPIC_API_KEY = 'sk-ant-...'; // Replace with your real key

async function analyzeWithAI(screenshotDataUrl) {
  // Strip the "data:image/png;base64," prefix — Claude wants raw base64
  const base64Image = screenshotDataUrl.split(',')[1];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-7',
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: base64Image },
            },
            {
              type: 'text',
              text: `You are a study assistant. Look at this screenshot and answer any question visible.
Return a JSON object with these exact keys:
- answer: string (the direct answer)
- why: string (1-2 sentence explanation)
- deepExplanation: string (a deeper explanation for learning)
- confidence: number (0-100)
Return only the JSON object, no markdown.`,
            },
          ],
        },
      ],
    }),
  });

  const json = await response.json();
  const text = json.content[0].text;
  return JSON.parse(text);
}
```

### Important: API Key Security

> **Never commit your API key to a public repository.**
>
> For a production extension, store the key in `chrome.storage.local` via a settings panel,
> or proxy requests through your own backend server instead of calling the API directly from
> the extension (this hides the key from the client entirely).

---

## Version 2 Ideas

| Feature | What it does |
|---|---|
| **Settings panel** | Let users enter and save their own API key without editing code |
| **Model selector** | Choose between GPT-4o, Claude, or Gemini from the popup |
| **History log** | Keep a local log of past captures and answers |
| **Export to notes** | Copy the answer card as Markdown or plain text |
| **Region capture** | Let the user draw a selection box instead of capturing the whole screen |
| **Keyboard shortcut** | Trigger capture without opening the popup (e.g. Ctrl+Shift+S) |
| **Math rendering** | Render LaTeX/MathML in the overlay for math questions |
| **Multi-language** | Translate answers into the user's language |
| **Highlight mode** | Let the user select text and snap only that question |
| **Light theme** | Auto-match the page's color scheme |
| **PDF support** | Capture and analyze questions from PDF viewer tabs |
