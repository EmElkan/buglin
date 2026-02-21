// Word Scanner Feature Module
// Scans page for forbidden words and highlights them

// Note: DEFAULT_FORBIDDEN_WORDS is provided by utils.js (loaded before this script)

// State
let wordScannerEnabled = false;
let forbiddenWords = [...DEFAULT_FORBIDDEN_WORDS];
const wordScannerHighlights = new Set();

// MutationObserver for word scanner (handles dynamic content)
let wordScannerObserver = null;
let wordScannerRescanTimeout = null;

// Scan page for forbidden words and highlight them
function scanForForbiddenWords() {
  if (!wordScannerEnabled) return;
  if (!document.body) {
    // Body not ready, try again soon
    setTimeout(scanForForbiddenWords, 100);
    return;
  }

  // Pause observer to prevent infinite loop from our own DOM changes
  if (wordScannerObserver) {
    wordScannerObserver.disconnect();
  }

  // Remove existing highlights first
  removeWordHighlights();

  // Build regex pattern for all forbidden words (case-insensitive, whole words)
  if (forbiddenWords.length === 0) {
    updateWordScannerBadge();
    // Reconnect observer before returning
    if (wordScannerObserver && wordScannerEnabled) {
      wordScannerObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
    return;
  }
  // Escape special regex characters in words
  const escapedWords = forbiddenWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`\\b(${escapedWords.join('|')})\\b`, 'gi');

  // Walk through all text nodes
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        // Skip script, style, and our own elements
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tagName = parent.tagName.toLowerCase();
        if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.classList.contains('word-scanner-highlight') ||
            parent.classList.contains('autofill-detector-overlay') ||
            parent.classList.contains('autofill-detector-tooltip')) {
          return NodeFilter.FILTER_REJECT;
        }
        // Skip if no forbidden words
        if (!pattern.test(node.textContent)) {
          return NodeFilter.FILTER_REJECT;
        }
        pattern.lastIndex = 0; // Reset regex
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const nodesToProcess = [];
  let node;
  while ((node = walker.nextNode())) {
    nodesToProcess.push(node);
  }

  // Process nodes (separate loop to avoid tree modification during walk)
  for (const textNode of nodesToProcess) {
    highlightForbiddenWordsInNode(textNode, pattern);
  }

  updateWordScannerBadge();

  // Reconnect observer after DOM modifications are done
  if (wordScannerObserver && wordScannerEnabled) {
    wordScannerObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
}

// Highlight forbidden words in a single text node
function highlightForbiddenWordsInNode(textNode, pattern) {
  const text = textNode.textContent;
  pattern.lastIndex = 0;

  const fragments = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      fragments.push(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    // Create highlight span
    const highlight = document.createElement('span');
    highlight.className = 'word-scanner-highlight';
    highlight.textContent = match[0];
    highlight.title = `Forbidden word: "${match[0]}"`;
    fragments.push(highlight);
    wordScannerHighlights.add(highlight);

    lastIndex = pattern.lastIndex;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    fragments.push(document.createTextNode(text.slice(lastIndex)));
  }

  // Replace original text node with fragments
  if (fragments.length > 0) {
    const parent = textNode.parentNode;
    for (const fragment of fragments) {
      parent.insertBefore(fragment, textNode);
    }
    parent.removeChild(textNode);
  }
}

// Remove all word scanner highlights
function removeWordHighlights() {
  for (const highlight of wordScannerHighlights) {
    if (highlight.parentNode) {
      const textNode = document.createTextNode(highlight.textContent);
      highlight.parentNode.replaceChild(textNode, highlight);
    }
  }
  wordScannerHighlights.clear();

  // Also clean up any orphaned highlights
  document.querySelectorAll('.word-scanner-highlight').forEach(el => {
    const textNode = document.createTextNode(el.textContent);
    el.parentNode.replaceChild(textNode, el);
  });
}

// Update badge with word scanner count
function updateWordScannerBadge() {
  const count = wordScannerHighlights.size;
  chrome.runtime.sendMessage({
    action: 'updateWordScannerBadge',
    count
  }).catch(() => {});
}

// Pending mutation targets for incremental scanning
let pendingMutationTargets = new Set();

// Scan only specific subtrees for forbidden words (incremental scan)
function scanSubtreesForForbiddenWords(roots) {
  if (!wordScannerEnabled || forbiddenWords.length === 0) return;

  // Build regex pattern
  const escapedWords = forbiddenWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`\\b(${escapedWords.join('|')})\\b`, 'gi');

  const acceptNode = (node) => {
    const parent = node.parentElement;
    if (!parent) return NodeFilter.FILTER_REJECT;
    const tagName = parent.tagName.toLowerCase();
    if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') {
      return NodeFilter.FILTER_REJECT;
    }
    if (parent.classList.contains('word-scanner-highlight') ||
        parent.classList.contains('autofill-detector-overlay') ||
        parent.classList.contains('autofill-detector-tooltip')) {
      return NodeFilter.FILTER_REJECT;
    }
    if (!pattern.test(node.textContent)) {
      return NodeFilter.FILTER_REJECT;
    }
    pattern.lastIndex = 0;
    return NodeFilter.FILTER_ACCEPT;
  };

  // Scan each root subtree
  for (const root of roots) {
    // Skip if root is no longer in DOM
    if (!document.body.contains(root)) continue;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      { acceptNode }
    );

    const nodesToProcess = [];
    let node;
    while ((node = walker.nextNode())) {
      nodesToProcess.push(node);
    }

    for (const textNode of nodesToProcess) {
      highlightForbiddenWordsInNode(textNode, pattern);
    }
  }

  updateWordScannerBadge();
}

function startWordScannerObserver() {
  if (wordScannerObserver) return;

  wordScannerObserver = new MutationObserver((mutations) => {
    if (!wordScannerEnabled) return;

    // Collect affected nodes for incremental scanning
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        // For added nodes, scan the added subtrees
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
            pendingMutationTargets.add(node);
          }
        }
      } else if (mutation.type === 'characterData') {
        // For text changes, scan the parent element
        if (mutation.target.parentElement) {
          pendingMutationTargets.add(mutation.target.parentElement);
        }
      }
    }

    // Debounce incremental rescans for dynamic content
    clearTimeout(wordScannerRescanTimeout);
    wordScannerRescanTimeout = setTimeout(() => {
      if (pendingMutationTargets.size === 0) return;

      // Pause observer to prevent infinite loop
      wordScannerObserver.disconnect();

      // Copy and clear pending targets
      const targets = [...pendingMutationTargets];
      pendingMutationTargets.clear();

      // Scan only affected subtrees
      scanSubtreesForForbiddenWords(targets);

      // Reconnect observer
      if (wordScannerEnabled) {
        wordScannerObserver.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true
        });
      }
    }, 300);
  });

  wordScannerObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function stopWordScannerObserver() {
  if (wordScannerObserver) {
    wordScannerObserver.disconnect();
    wordScannerObserver = null;
  }
  if (wordScannerRescanTimeout) {
    clearTimeout(wordScannerRescanTimeout);
    wordScannerRescanTimeout = null;
  }
  pendingMutationTargets.clear();
}

// Run scan when DOM is ready
function runWordScannerWhenReady() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scanForForbiddenWords();
      startWordScannerObserver();
    });
  } else {
    scanForForbiddenWords();
    startWordScannerObserver();
  }
}

// Initialize word scanner from storage
function initWordScanner() {
  chrome.storage.local.get(['wordScannerEnabled', 'forbiddenWords'], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Failed to load word scanner state:', chrome.runtime.lastError.message);
      return;
    }
    wordScannerEnabled = result.wordScannerEnabled === true;
    if (result.forbiddenWords && Array.isArray(result.forbiddenWords)) {
      forbiddenWords = result.forbiddenWords;
    }
    if (wordScannerEnabled) {
      runWordScannerWhenReady();
    }
  });

  // Listen for word scanner toggle and word list changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    // Handle word list changes
    if (changes.forbiddenWords) {
      const newWords = changes.forbiddenWords.newValue;
      if (newWords && Array.isArray(newWords)) {
        forbiddenWords = newWords;
        // Rescan if scanner is enabled
        if (wordScannerEnabled) {
          scanForForbiddenWords();
        }
      }
    }

    // Handle toggle changes
    if (changes.wordScannerEnabled) {
      const newEnabled = changes.wordScannerEnabled.newValue === true;
      if (newEnabled === wordScannerEnabled) return;

      wordScannerEnabled = newEnabled;
      if (wordScannerEnabled) {
        runWordScannerWhenReady();
      } else {
        stopWordScannerObserver();
        removeWordHighlights();
        updateWordScannerBadge();
      }
    }
  });
}

// Auto-initialize when loaded as content script
initWordScanner();

// Export for testing (Node.js environment)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_FORBIDDEN_WORDS,
    scanForForbiddenWords,
    scanSubtreesForForbiddenWords,
    highlightForbiddenWordsInNode,
    removeWordHighlights,
    updateWordScannerBadge,
    startWordScannerObserver,
    stopWordScannerObserver,
    runWordScannerWhenReady,
    initWordScanner,
    // Expose state getters for testing
    getWordScannerEnabled: () => wordScannerEnabled,
    setWordScannerEnabled: (val) => { wordScannerEnabled = val; },
    getForbiddenWords: () => forbiddenWords,
    setForbiddenWords: (words) => { forbiddenWords = words; },
    getHighlights: () => wordScannerHighlights
  };
}
