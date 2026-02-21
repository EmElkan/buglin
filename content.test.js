/**
 * @jest-environment jsdom
 */

// Mock Chrome APIs BEFORE requiring modules that use them
const mockChrome = {
  storage: {
    local: {
      // Use setTimeout to defer callback, matching real chrome.storage.local.get behavior.
      // This prevents "Cannot access before initialization" errors from let-declared
      // variables that haven't been initialized during synchronous module load.
      get: jest.fn((keys, callback) => setTimeout(() => callback({ autofillDetectorEnabled: false }), 0)),
      set: jest.fn()
    },
    onChanged: {
      addListener: jest.fn()
    }
  },
  runtime: {
    onMessage: {
      addListener: jest.fn()
    },
    sendMessage: jest.fn().mockResolvedValue({ success: true }),
    lastError: null
  }
};
global.chrome = mockChrome;

// Import shared utilities (makes DEFAULT_FORBIDDEN_WORDS available globally before wordscanner.js)
const utils = require('./utils');
global.DEFAULT_FORBIDDEN_WORDS = utils.DEFAULT_FORBIDDEN_WORDS;

// Import pure functions from analysis.js
const {
  analyzeFieldAttributes,
  escapeHtml,
  isInjectableElement
} = require('./analysis');

// Import Word Scanner functions for testing
const wordscanner = require('./wordscanner');

// Make analysis.js functions available globally (as content.js expects)
global.analyzeFieldAttributes = analyzeFieldAttributes;
global.escapeHtml = escapeHtml;
global.isInjectableElement = isInjectableElement;

// Polyfill CSS.escape for jsdom (not available by default)
if (typeof CSS === 'undefined') {
  global.CSS = {};
}
if (typeof CSS.escape !== 'function') {
  // https://drafts.csswg.org/cssom/#the-css.escape()-method
  CSS.escape = function(value) {
    const str = String(value);
    const length = str.length;
    let result = '';
    for (let i = 0; i < length; i++) {
      const char = str.charAt(i);
      const code = str.charCodeAt(i);
      if (code === 0) {
        result += '\uFFFD';
      } else if (
        (code >= 0x0001 && code <= 0x001F) || code === 0x007F ||
        (i === 0 && code >= 0x0030 && code <= 0x0039) ||
        (i === 1 && code >= 0x0030 && code <= 0x0039 && str.charCodeAt(0) === 0x002D)
      ) {
        result += '\\' + code.toString(16) + ' ';
      } else if (
        code >= 0x0080 ||
        code === 0x002D ||
        code === 0x005F ||
        (code >= 0x0030 && code <= 0x0039) ||
        (code >= 0x0041 && code <= 0x005A) ||
        (code >= 0x0061 && code <= 0x007A)
      ) {
        result += char;
      } else {
        result += '\\' + char;
      }
    }
    return result;
  };
}

// Import content.js functions (after chrome mock and globals are set up)
const content = require('./content');

// Helper to create a test input field
function createInput(attrs = {}) {
  const input = document.createElement('input');
  Object.entries(attrs).forEach(([key, value]) => {
    input.setAttribute(key, value);
  });
  document.body.appendChild(input);
  return input;
}

// Helper to create a visible input with dimensions
function createVisibleInput(attrs = {}) {
  const input = createInput(attrs);
  // jsdom doesn't calculate layout, so we mock getBoundingClientRect
  input.getBoundingClientRect = () => ({
    width: 200,
    height: 30,
    top: 100,
    left: 100,
    right: 300,
    bottom: 130
  });
  return input;
}

/**
 * Tests for content.js using actual exported functions.
 */
describe('content.js DOM functions', () => {
  beforeEach(() => {
    // Clear DOM
    document.body.innerHTML = '';

    // Reset content.js state
    content.setIsEnabled(true);
    content.setFieldStats({ high: 0, medium: 0, low: 0, total: 0 });
    content.stopObserving();
    content.stopReconcileInterval();
    content.removeScrollListeners();

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('analyzeField', () => {
    test('returns analysis for visible email input', () => {
      const input = createVisibleInput({ type: 'email', name: 'user_email' });
      // Mock getComputedStyle for jsdom
      input.style.display = 'block';

      const result = content.analyzeField(input);
      expect(result).not.toBeNull();
      expect(result.riskLevel).toBe('high');
      expect(result.element).toBe(input);
    });

    test('returns null for hidden input (zero dimensions)', () => {
      const input = createInput({ type: 'text', name: 'email' });
      // Default jsdom getBoundingClientRect returns all zeros
      const result = content.analyzeField(input);
      expect(result).toBeNull();
    });

    test('returns null for display:none input', () => {
      const input = createVisibleInput({ type: 'text', name: 'email' });
      input.style.display = 'none';

      const result = content.analyzeField(input);
      expect(result).toBeNull();
    });

    test('includes label text from for attribute', () => {
      const input = createVisibleInput({ type: 'text', id: 'test-field', autocomplete: 'off' });
      const label = document.createElement('label');
      label.setAttribute('for', 'test-field');
      label.textContent = 'Email Address';
      document.body.appendChild(label);

      const result = content.analyzeField(input);
      expect(result).not.toBeNull();
      // Label contains "email" keyword which should produce an info risk
      expect(result.risks.some(r => r.message.includes('Label'))).toBe(true);
    });

    test('includes label text from parent label', () => {
      const label = document.createElement('label');
      label.textContent = 'Phone Number ';
      const input = document.createElement('input');
      input.setAttribute('type', 'text');
      input.setAttribute('autocomplete', 'off');
      label.appendChild(input);
      document.body.appendChild(label);

      // Mock dimensions on input
      input.getBoundingClientRect = () => ({
        width: 200, height: 30, top: 100, left: 100, right: 300, bottom: 130
      });

      const result = content.analyzeField(input);
      expect(result).not.toBeNull();
      expect(result.risks.some(r => r.message.includes('Label'))).toBe(true);
    });
  });

  describe('createOverlay', () => {
    test('creates overlay with correct class for risk level', () => {
      const input = createVisibleInput({ type: 'email' });
      const analysis = {
        element: input,
        riskLevel: 'high',
        risks: [{ type: 'error', message: 'type="email" triggers autofill' }],
        attributes: { tagName: 'input', type: 'email', name: '', id: '', autocomplete: '', placeholder: '' }
      };

      const overlay = content.createOverlay(analysis);
      expect(overlay.classList.contains('autofill-risk-high')).toBe(true);
      expect(overlay.classList.contains('autofill-detector-overlay')).toBe(true);
    });

    test('creates badge with risk level text', () => {
      const input = createVisibleInput({ type: 'text' });
      const analysis = {
        element: input,
        riskLevel: 'medium',
        risks: [{ type: 'warning', message: 'No autocomplete' }],
        attributes: { tagName: 'input', type: 'text', name: '', id: '', autocomplete: '', placeholder: '' }
      };

      const overlay = content.createOverlay(analysis);
      const badge = overlay.querySelector('.autofill-detector-badge');
      expect(badge).not.toBeNull();
      expect(badge.textContent).toBe('MEDIUM');
      expect(badge.classList.contains('autofill-badge-medium')).toBe(true);
    });

    test('replaces existing overlay for same element', () => {
      const input = createVisibleInput({ type: 'email' });
      const analysis = {
        element: input,
        riskLevel: 'high',
        risks: [{ type: 'error', message: 'test' }],
        attributes: { tagName: 'input', type: 'email', name: '', id: '', autocomplete: '', placeholder: '' }
      };

      content.createOverlay(analysis);
      content.createOverlay(analysis);

      // Should only have one overlay, not two
      expect(document.querySelectorAll('.autofill-detector-overlay').length).toBe(1);
    });

    test('escapes HTML in tooltip content to prevent XSS', () => {
      const input = createVisibleInput({ type: 'text' });
      const analysis = {
        element: input,
        riskLevel: 'medium',
        risks: [{ type: 'warning', message: 'test risk' }],
        attributes: {
          tagName: 'input', type: 'text',
          name: '<script>alert("xss")</script>',
          id: '', autocomplete: '', placeholder: ''
        }
      };

      content.createOverlay(analysis);
      const tooltipMap = content.getTooltipMap();
      const tooltip = tooltipMap.get(input);
      expect(tooltip.innerHTML).toContain('&lt;script&gt;');
      expect(tooltip.innerHTML).not.toContain('<script>alert');
    });
  });

  describe('overlay cleanup via removeAllOverlays', () => {
    test('removes all overlays and tooltips from DOM', () => {
      const input = createVisibleInput({ type: 'email' });
      const analysis = {
        element: input,
        riskLevel: 'high',
        risks: [{ type: 'error', message: 'test' }],
        attributes: { tagName: 'input', type: 'email', name: '', id: '', autocomplete: '', placeholder: '' }
      };

      content.createOverlay(analysis);
      expect(document.querySelectorAll('.autofill-detector-overlay').length).toBe(1);

      content.removeAllOverlays();
      expect(document.querySelectorAll('.autofill-detector-overlay').length).toBe(0);
      expect(document.querySelectorAll('.autofill-detector-tooltip').length).toBe(0);
    });

    test('clears WeakMap associations', () => {
      const input = createVisibleInput({ type: 'email' });
      const analysis = {
        element: input,
        riskLevel: 'high',
        risks: [{ type: 'error', message: 'test' }],
        attributes: { tagName: 'input', type: 'email', name: '', id: '', autocomplete: '', placeholder: '' }
      };

      content.createOverlay(analysis);
      expect(content.getOverlayMap().has(input)).toBe(true);
      expect(content.getTooltipMap().has(input)).toBe(true);

      content.removeAllOverlays();
      expect(content.getOverlayMap().has(input)).toBe(false);
      expect(content.getTooltipMap().has(input)).toBe(false);
      expect(content.getAnalyzedFields().has(input)).toBe(false);
    });
  });

  describe('fieldStats reconciliation', () => {
    test('reconcileStats correctly counts overlays by risk level', () => {
      // Manually create overlays of different risk levels
      ['high', 'medium', 'medium', 'low'].forEach(level => {
        const div = document.createElement('div');
        div.className = `autofill-detector-overlay autofill-risk-${level}`;
        document.body.appendChild(div);
      });

      // Set stale stats
      content.setFieldStats({ high: 0, medium: 0, low: 0, total: 0 });

      content.reconcileStats();

      const stats = content.getFieldStats();
      expect(stats.high).toBe(1);
      expect(stats.medium).toBe(2);
      expect(stats.low).toBe(1);
      expect(stats.total).toBe(4);
    });

    test('reconcileStats corrects drifted stats', () => {
      // Create one high overlay
      const overlay = document.createElement('div');
      overlay.className = 'autofill-detector-overlay autofill-risk-high';
      document.body.appendChild(overlay);

      // Set wildly wrong stats
      content.setFieldStats({ high: 5, medium: 3, low: 1, total: 9 });

      content.reconcileStats();

      const stats = content.getFieldStats();
      expect(stats.high).toBe(1);
      expect(stats.medium).toBe(0);
      expect(stats.low).toBe(0);
      expect(stats.total).toBe(1);
    });

    test('reconcileStats sends badge update when drift detected', () => {
      content.setFieldStats({ high: 5, medium: 0, low: 0, total: 5 });

      content.reconcileStats();

      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'updateBadge',
        stats: { high: 0, medium: 0, low: 0, total: 0 }
      });
    });

    test('reconcileStats does not send badge update when stats match', () => {
      content.setFieldStats({ high: 0, medium: 0, low: 0, total: 0 });
      mockChrome.runtime.sendMessage.mockClear();

      content.reconcileStats();

      expect(mockChrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('notification creation', () => {
    test('showNotification creates notification element in DOM', () => {
      content.showNotification('Test message');

      const notification = document.querySelector('.autofill-detector-notification');
      expect(notification).not.toBeNull();
      expect(notification.textContent).toBe('Test message');
    });

    test('showNotification uses red background for errors', () => {
      content.showNotification('Error message', true);

      const notification = document.querySelector('.autofill-detector-notification');
      // jsdom converts hex to rgb()
      expect(notification.style.background).toBe('rgb(239, 68, 68)');
    });

    test('showNotification uses green background for success', () => {
      content.showNotification('Success message', false);

      const notification = document.querySelector('.autofill-detector-notification');
      expect(notification.style.background).toBe('rgb(34, 197, 94)');
    });
  });

  describe('isInjectable', () => {
    test('returns true for text input element', () => {
      const input = createInput({ type: 'text' });
      expect(content.isInjectable(input)).toBe(true);
    });

    test('returns true for textarea element', () => {
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      expect(content.isInjectable(textarea)).toBe(true);
    });

    test('returns false for checkbox', () => {
      const input = createInput({ type: 'checkbox' });
      expect(content.isInjectable(input)).toBe(false);
    });

    test('returns false for null', () => {
      expect(content.isInjectable(null)).toBe(false);
    });
  });

  describe('label association via analyzeField', () => {
    test('CSS.escape handles adversarial IDs safely', () => {
      // Adversarial ID that could break naive selector interpolation
      const adversarialId = 'foo"] { } [data-x="';
      const input = createVisibleInput({ type: 'text', id: adversarialId, autocomplete: 'off' });
      const label = document.createElement('label');
      label.setAttribute('for', adversarialId);
      label.textContent = 'Malicious Label';
      document.body.appendChild(label);

      // analyzeField should not throw on adversarial IDs
      expect(() => content.analyzeField(input)).not.toThrow();
    });
  });

});


describe('Word Scanner feature', () => {
  // Uses actual functions from wordscanner.js
  const {
    highlightForbiddenWordsInNode,
    removeWordHighlights,
    getHighlights,
    setForbiddenWords,
    setWordScannerEnabled
  } = wordscanner;

  // Reset state before each test
  beforeEach(() => {
    document.body.innerHTML = '';
    getHighlights().clear();
    document.querySelectorAll('.word-scanner-highlight').forEach(el => el.remove());
  });

  describe('highlightForbiddenWordsInNode', () => {
    test('highlights single forbidden word in text node', () => {
      const container = document.createElement('div');
      container.textContent = 'Welcome to our partner program';
      document.body.appendChild(container);
      const textNode = container.firstChild;

      const pattern = /\b(partner)\b/gi;
      highlightForbiddenWordsInNode(textNode, pattern);

      expect(getHighlights().size).toBe(1);
      expect(container.querySelectorAll('.word-scanner-highlight').length).toBe(1);
      expect(container.querySelector('.word-scanner-highlight').textContent).toBe('partner');
    });

    test('highlights multiple forbidden words in same text node', () => {
      const container = document.createElement('div');
      container.textContent = 'Our partner and partners work together';
      document.body.appendChild(container);
      const textNode = container.firstChild;

      const pattern = /\b(partner|partners)\b/gi;
      highlightForbiddenWordsInNode(textNode, pattern);

      expect(getHighlights().size).toBe(2);
      expect(container.querySelectorAll('.word-scanner-highlight').length).toBe(2);
    });

    test('preserves text before and after forbidden words', () => {
      const container = document.createElement('div');
      container.textContent = 'Hello partner world';
      document.body.appendChild(container);
      const textNode = container.firstChild;

      const pattern = /\b(partner)\b/gi;
      highlightForbiddenWordsInNode(textNode, pattern);

      expect(container.textContent).toBe('Hello partner world');
      expect(container.childNodes.length).toBe(3); // text, span, text
    });

    test('handles case-insensitive matching', () => {
      const container = document.createElement('div');
      container.textContent = 'PARTNER Partner partner';
      document.body.appendChild(container);
      const textNode = container.firstChild;

      const pattern = /\b(partner)\b/gi;
      highlightForbiddenWordsInNode(textNode, pattern);

      expect(getHighlights().size).toBe(3);
      const highlightTexts = [...container.querySelectorAll('.word-scanner-highlight')].map(h => h.textContent);
      expect(highlightTexts).toEqual(['PARTNER', 'Partner', 'partner']);
    });

    test('does not highlight partial word matches', () => {
      const container = document.createElement('div');
      container.textContent = 'partnership departner unpartnerlike';
      document.body.appendChild(container);
      const textNode = container.firstChild;

      const pattern = /\b(partner)\b/gi;
      highlightForbiddenWordsInNode(textNode, pattern);

      expect(getHighlights().size).toBe(0);
    });

    test('sets correct title attribute on highlights', () => {
      const container = document.createElement('div');
      container.textContent = 'Contact our partner';
      document.body.appendChild(container);
      const textNode = container.firstChild;

      const pattern = /\b(partner)\b/gi;
      highlightForbiddenWordsInNode(textNode, pattern);

      const highlight = container.querySelector('.word-scanner-highlight');
      expect(highlight.title).toBe('Forbidden word: "partner"');
    });
  });

  describe('removeWordHighlights', () => {
    test('removes all highlights and restores text', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      container.textContent = 'Hello partner world';
      const textNode = container.firstChild;
      const pattern = /\b(partner)\b/gi;
      highlightForbiddenWordsInNode(textNode, pattern);

      expect(getHighlights().size).toBe(1);
      expect(container.querySelectorAll('.word-scanner-highlight').length).toBe(1);

      removeWordHighlights();

      expect(container.querySelectorAll('.word-scanner-highlight').length).toBe(0);
      expect(getHighlights().size).toBe(0);
      expect(container.textContent).toBe('Hello partner world');
    });

    test('handles orphaned highlights not in Set', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const orphan = document.createElement('span');
      orphan.className = 'word-scanner-highlight';
      orphan.textContent = 'group';
      container.appendChild(orphan);

      removeWordHighlights();

      expect(container.querySelectorAll('.word-scanner-highlight').length).toBe(0);
      expect(container.textContent).toBe('group');
    });

    test('handles already removed highlights gracefully', () => {
      const container = document.createElement('div');
      container.textContent = 'test partner here';
      document.body.appendChild(container);
      const textNode = container.firstChild;
      const pattern = /\b(partner)\b/gi;
      highlightForbiddenWordsInNode(textNode, pattern);

      const highlight = container.querySelector('.word-scanner-highlight');
      highlight.remove();

      expect(() => removeWordHighlights()).not.toThrow();
      expect(getHighlights().size).toBe(0);
    });
  });

  describe('scanForForbiddenWords integration', () => {
    const { scanForForbiddenWords } = wordscanner;

    test('skips script and style elements during full scan', () => {
      setWordScannerEnabled(true);
      setForbiddenWords(['partner']);

      const script = document.createElement('script');
      script.textContent = 'var partner = "test";';
      document.body.appendChild(script);

      const style = document.createElement('style');
      style.textContent = '.partner { color: red; }';
      document.body.appendChild(style);

      const visible = document.createElement('p');
      visible.textContent = 'Contact our partner';
      document.body.appendChild(visible);

      scanForForbiddenWords();

      // Only the visible <p> should be highlighted, not script/style contents
      expect(getHighlights().size).toBe(1);
      expect(visible.querySelector('.word-scanner-highlight').textContent).toBe('partner');
    });

    test('does not re-highlight already highlighted words', () => {
      setWordScannerEnabled(true);
      setForbiddenWords(['partner']);

      const container = document.createElement('div');
      container.textContent = 'Hello partner';
      document.body.appendChild(container);

      scanForForbiddenWords();
      expect(getHighlights().size).toBe(1);

      // Second scan should clear and re-scan, not double-highlight
      scanForForbiddenWords();
      expect(getHighlights().size).toBe(1);
      expect(container.querySelectorAll('.word-scanner-highlight').length).toBe(1);
    });

    test('sends badge update with correct count via chrome.runtime.sendMessage', () => {
      setWordScannerEnabled(true);
      setForbiddenWords(['partner', 'todo']);
      mockChrome.runtime.sendMessage.mockClear();

      const container = document.createElement('div');
      container.textContent = 'Our partner has a todo item';
      document.body.appendChild(container);

      scanForForbiddenWords();

      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'updateWordScannerBadge',
          count: 2
        })
      );
    });
  });

  describe('incremental scanning', () => {
    const { scanSubtreesForForbiddenWords } = wordscanner;

    test('scanSubtreesForForbiddenWords only scans provided roots', () => {
      setWordScannerEnabled(true);
      setForbiddenWords(['partner']);

      const container1 = document.createElement('div');
      container1.textContent = 'Hello partner';
      document.body.appendChild(container1);

      const container2 = document.createElement('div');
      container2.textContent = 'World partner';
      document.body.appendChild(container2);

      const container3 = document.createElement('div');
      container3.textContent = 'No match here';
      document.body.appendChild(container3);

      scanSubtreesForForbiddenWords([container1]);
      expect(container1.querySelectorAll('.word-scanner-highlight').length).toBe(1);
      expect(container2.querySelectorAll('.word-scanner-highlight').length).toBe(0);
      expect(container3.querySelectorAll('.word-scanner-highlight').length).toBe(0);

      scanSubtreesForForbiddenWords([container2]);
      expect(container2.querySelectorAll('.word-scanner-highlight').length).toBe(1);

      scanSubtreesForForbiddenWords([container3]);
      expect(container3.querySelectorAll('.word-scanner-highlight').length).toBe(0);

      expect(getHighlights().size).toBe(2);
    });
  });
});
