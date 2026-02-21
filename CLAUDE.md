# Claude Context

## Project Overview
**Buglin** - Chrome extension for exploratory testing of forms. Three main features:
1. **Autofill Detection** - Highlights form fields at risk of triggering browser autofill
2. **Test Data Injection** - Right-click context menu to fill fields with test payloads
3. **Word Scanner** - Scans page for forbidden words and highlights them

## Architecture
- **manifest.json** - Chrome Extension Manifest V3 configuration
- **background.js** - Service worker for badge updates, context menu handling, and payload loading
- **utils.js** - Shared utilities for all contexts: background.js, content scripts, popup, and tests (`DEFAULT_FORBIDDEN_WORDS`, `truncate`, `getItemTitle`, `getItemValue`, `addToRecentList`, `validatePayloads`, `getBadgeColor`)
- **analysis.js** - Pure analysis logic (testable without DOM), exports `analyzeFieldAttributes()`
- **content.js** - DOM interactions, overlay rendering, uses analysis.js for risk detection (exports functions for testing)
- **wordscanner.js** - Word Scanner feature module (scans page for forbidden words, highlights them)
- **payloads.json** - Test data organized by category (loaded via fetch to avoid Unicode parsing issues)
- **styles.css** - Overlay and tooltip styling
- **popup.html/popup.js** - Extension popup UI for toggling detection
- **analysis.test.js** - Jest tests for pure analysis logic (65 tests)
- **content.test.js** - Jest tests for DOM-dependent logic with jsdom, using actual content.js exports (36 tests)
- **background.test.js** - Jest tests for service worker logic (27 tests)

## Autofill Detection (analysis.js + content.js)
- **analysis.js** - Pure logic module (no DOM dependencies, testable)
  - `AUTOFILL_KEYWORDS` - List of field name patterns that trigger autofill (PII-focused, excludes generic terms)
  - `AUTOCOMPLETE_VALUES_THAT_TRIGGER` - Autocomplete attributes that enable autofill
  - `SAFE_AUTOCOMPLETE_VALUES` - Values that disable autofill (off, one-time-code, etc.)
  - `INJECTABLE_INPUT_TYPES` - Input types that can receive text input
  - `analyzeFieldAttributes(attrs)` - Pure function, takes attributes object, returns risk analysis
  - `escapeHtml(str)` - Escapes HTML special characters to prevent XSS
  - `isInjectableElement(info)` - Pure function to check if element can receive text input
- **content.js** - DOM interactions
  - `analyzeField()` - Extracts DOM attributes, calls `analyzeFieldAttributes()`, handles visibility
  - `createOverlay()` - Creates visual overlay with badge and tooltip (HTML-escaped to prevent XSS)
  - `scanPage()` - Scans all inputs/textareas (WeakMap caching for mutation handler)
  - `repositionOverlays()` - Updates overlay positions without recreation (~60fps throttle)
  - `updateBadge()` - Sends stats to background script for badge update
  - `reconcileStats()` - Validates fieldStats against actual overlays to prevent drift
  - `observeDOM()` / `stopObserving()` - MutationObserver lifecycle management (prevents memory leaks)
  - `startReconcileInterval()` / `stopReconcileInterval()` - Periodic stats validation (every 30s)
  - `addScrollListeners()` / `removeScrollListeners()` - Scroll/resize event listener lifecycle (added on enable, removed on disable)
  - Listens to `chrome.storage.onChanged` for toggle sync across all frames/iframes

## Test Data Injection (background.js)
- Payloads loaded from `payloads.json` via `ensureInitialized()` (handles service worker suspension)
- `payloadLookup` Map stores menu ID → payload data (robust lookup, no string parsing)
- Context menu with categories: Emails, Text size, URLs, Numbers, Addresses, Whitespace, Names, Lorems, File paths, SQL, XSS, Null, Cursed, Characters, Emojis, Long
- **Recently used** - Tracks last 5 used payloads for quick access (optimized: only recent section is rebuilt, not entire menu)
- **Operational modes** (radio buttons):
  - `inject` - Replace field value with payload
  - `append` - Simulate pasting (append to existing value)
  - `copy` - Copy payload to clipboard
- Sends action message to content script based on selected mode (with error handling for navigated frames)
- Content script validates target element and shows notifications on success/failure

## Word Scanner (wordscanner.js)
- Separate module for scanning page text for forbidden words
- `scanForForbiddenWords()` - Full page scan using TreeWalker (used on initial load)
- `scanSubtreesForForbiddenWords(roots)` - Incremental scan of specific subtrees (used on mutations)
- `highlightForbiddenWordsInNode()` - Highlights matches in individual text nodes
- `removeWordHighlights()` - Cleans up all highlights, including orphaned ones
- `startWordScannerObserver()` / `stopWordScannerObserver()` - MutationObserver lifecycle for dynamic content
- `initWordScanner()` - Auto-initializes from storage on load
- Listens to `chrome.storage.onChanged` for toggle and word list changes
- Skips script/style/noscript elements and existing highlights
- Escapes special regex characters in forbidden words
- Uses 300ms debounce for mutation handling
- **Incremental scanning**: Only rescans affected subtrees on DOM mutations (not entire document)

## Risk Levels
- **High (red)** - Will trigger autofill (email/tel types, autocomplete attributes)
- **Medium (orange)** - May trigger form history (has name without autocomplete="off")
- **Low (green)** - Minimal risk

## Messages
- `fillField` - replace field value with payload
- `appendField` - append payload to existing field value
- `copyToClipboard` - copy payload to clipboard
- `updateBadge` - update extension icon badge with autofill risk stats
- `updateWordScannerBadge` - update extension icon badge with forbidden word count (purple badge)
- `showNotification` - display a notification to the user (used by background.js for error feedback)

## Testing
- `npm test` - Run all tests (128 total)
- `npm run test:watch` - Run in watch mode
- `npm run test:coverage` - Run with coverage report
- **analysis.test.js** (65 tests) - Pure functions: skipped types, HIGH/MEDIUM/LOW risk scenarios, priority, normalization, escapeHtml, isInjectableElement
- **content.test.js** (36 tests) - Tests actual content.js and wordscanner.js exports: analyzeField, createOverlay, removeAllOverlays, reconcileStats, showNotification, isInjectable, CSS.escape, Word Scanner integration tests (scanForForbiddenWords, scanSubtreesForForbiddenWords, highlightForbiddenWordsInNode, removeWordHighlights)
- **background.test.js** (27 tests) - Service worker utilities from utils.js: truncate, getItemTitle, getItemValue, addToRecentList, validatePayloads, getBadgeColor, DEFAULT_FORBIDDEN_WORDS

## Common Issues
- **Overlay positioning**: Overlays use `position: fixed` with viewport-relative coordinates from `getBoundingClientRect()`. This handles CSS transforms on ancestors correctly. Scroll events are captured on both window and nested scroll containers to reposition overlays.
- Tooltips use fixed positioning and are appended to body to avoid z-index issues
- Hidden/zero-dimension fields are skipped to avoid ghost overlays
- `all_frames: true` enables detection in iframes
- Context menus require extension reload to register (created on install)
- **Payloads in JSON**: Test payloads are stored in `payloads.json` rather than inline in JS. This avoids syntax errors from special Unicode characters (curly quotes, control chars, etc.) that break JS string parsing. The JSON file is loaded via `fetch()` at service worker startup.
- **Service worker suspension**: MV3 service workers can be suspended after ~30s of inactivity. `ensureInitialized()` handles lazy reinitialization when the worker wakes up. `createMenus()` is async and awaits each `contextMenus.create()` call via `createMenuItem()` helper, ensuring `payloadLookup` is fully populated before initialization completes.
- **Incremental scanning**: DOM mutations only analyze new fields (WeakMap cache), scroll/resize repositions overlays without recreation.
- **MutationObserver lifecycle**: Observer is stored in `domObserver` variable and properly disconnected when detection is disabled to prevent memory leaks.
- **XSS protection**: All user-controlled field attributes are HTML-escaped before rendering in tooltips using `escapeHtml()`. CSS selectors use `CSS.escape()` to prevent selector injection from malicious field IDs.
- **Message error handling**: `sendMessage` calls include error callbacks to handle cases where target frames have navigated away.
- **Toggle via storage**: Detection enable/disable is handled exclusively via `chrome.storage.onChanged` listener, not direct messages. This ensures consistent state across all frames (including iframes) and proper lifecycle management of reconcileInterval.
- **Private element associations**: Uses WeakMaps (`overlayMap`, `tooltipMap`, `tooltipTimeoutMap`) instead of underscore-prefixed properties on DOM elements. This avoids namespace pollution and potential conflicts with browser APIs or other extensions.
