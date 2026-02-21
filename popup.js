// Popup script

const enableToggle = document.getElementById('enableToggle');
const wordScannerToggle = document.getElementById('wordScannerToggle');
const wordListContainer = document.getElementById('wordListContainer');
const wordListInput = document.getElementById('wordListInput');
const saveWordListBtn = document.getElementById('saveWordList');

// Note: DEFAULT_FORBIDDEN_WORDS is provided by utils.js (loaded before this script)

// Load saved state
chrome.storage.local.get(['autofillDetectorEnabled', 'wordScannerEnabled', 'forbiddenWords'], (result) => {
  enableToggle.checked = result.autofillDetectorEnabled !== false;
  wordScannerToggle.checked = result.wordScannerEnabled === true;

  // Load word list
  const words = result.forbiddenWords || DEFAULT_FORBIDDEN_WORDS;
  wordListInput.value = words.join(', ');

  // Show word list config if scanner is enabled
  if (wordScannerToggle.checked) {
    wordListContainer.classList.add('visible');
  }
});

// Toggle handler - storage change triggers update in all frames via storage.onChanged listener
enableToggle.addEventListener('change', () => {
  chrome.storage.local.set({ autofillDetectorEnabled: enableToggle.checked });
});

// Word scanner toggle handler
wordScannerToggle.addEventListener('change', () => {
  chrome.storage.local.set({ wordScannerEnabled: wordScannerToggle.checked });

  // Show/hide word list config
  if (wordScannerToggle.checked) {
    wordListContainer.classList.add('visible');
  } else {
    wordListContainer.classList.remove('visible');
  }
});

// Save word list handler
saveWordListBtn.addEventListener('click', () => {
  const input = wordListInput.value;
  const words = input
    .split(',')
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 0);

  if (words.length === 0) {
    wordListInput.value = DEFAULT_FORBIDDEN_WORDS.join(', ');
    chrome.storage.local.set({ forbiddenWords: DEFAULT_FORBIDDEN_WORDS });
  } else {
    chrome.storage.local.set({ forbiddenWords: words });
  }

  // Visual feedback
  saveWordListBtn.textContent = 'Saved!';
  setTimeout(() => {
    saveWordListBtn.textContent = 'Save';
  }, 1000);
});

