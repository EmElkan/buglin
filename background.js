// Background service worker

// Import shared utilities (must be at top level for MV3 service workers)
importScripts('utils.js');

let PAYLOADS = {};
let currentMode = 'inject';
let recentPayloads = []; // { category, index, value }

// Map menu item IDs to payload data for robust lookups
const payloadLookup = new Map();

// Track initialization state
let initPromise = null;
let isInitialized = false;

// Note: validatePayloads is provided by utils.js (loaded via importScripts)

// Initialize/reinitialize the service worker state
async function initialize() {
  try {
    const [data, storage] = await Promise.all([
      fetch(chrome.runtime.getURL('payloads.json')).then(r => r.json()),
      chrome.storage.local.get(['operationalMode', 'recentPayloads'])
    ]);

    validatePayloads(data);
    PAYLOADS = data;
    currentMode = storage.operationalMode || 'inject';
    recentPayloads = storage.recentPayloads || [];
    await createMenus();
    isInitialized = true;
  } catch (err) {
    console.error('Failed to initialize:', err);
    throw err;
  }
}

// Ensure initialization completes before proceeding
async function ensureInitialized() {
  if (isInitialized && Object.keys(PAYLOADS).length > 0) {
    return;
  }

  if (!initPromise) {
    initPromise = initialize().finally(() => {
      initPromise = null;
    });
  }

  await initPromise;
}

// Start initialization on service worker load
ensureInitialized();

// Operational modes
const MODES = [
  { id: 'inject', title: 'Inject value', action: 'fillField' },
  { id: 'append', title: 'Simulate pasting', action: 'appendField' },
  { id: 'copy', title: 'Copy to clipboard', action: 'copyToClipboard' }
];

// Promisify chrome.contextMenus.create for proper async handling
function createMenuItem(options) {
  return new Promise((resolve) => {
    chrome.contextMenus.create(options, () => {
      // Ignore errors (e.g., duplicate IDs) and resolve
      if (chrome.runtime.lastError) { /* expected during rebuild */ }
      resolve();
    });
  });
}

// Create all context menus
async function createMenus() {
  if (Object.keys(PAYLOADS).length === 0) {
    return;
  }

  // Clear lookup map before rebuilding
  payloadLookup.clear();

  await new Promise(resolve => chrome.contextMenus.removeAll(resolve));

  // Root menu
  await createMenuItem({
    id: 'testdata-root',
    title: 'Buglin',
    contexts: ['editable']
  });

  // Recently used section (if any)
  if (recentPayloads.length > 0) {
    await createMenuItem({
      id: 'recent-menu',
      parentId: 'testdata-root',
      title: 'Recently used',
      contexts: ['editable']
    });

    for (let i = 0; i < recentPayloads.length; i++) {
      const recent = recentPayloads[i];
      const menuId = `recent-${i}`;
      await createMenuItem({
        id: menuId,
        parentId: 'recent-menu',
        title: truncate(recent.value),
        contexts: ['editable']
      });
      // Store lookup for recent items
      payloadLookup.set(menuId, {
        category: recent.category,
        index: recent.index,
        value: recent.value
      });
    }

    await createMenuItem({
      id: 'separator-recent',
      parentId: 'testdata-root',
      type: 'separator',
      contexts: ['editable']
    });
  }

  // Payload categories
  for (const [categoryId, items] of Object.entries(PAYLOADS)) {
    await createMenuItem({
      id: `category-${categoryId}`,
      parentId: 'testdata-root',
      title: categoryId,
      contexts: ['editable']
    });

    for (let i = 0; i < items.length; i++) {
      const menuId = `payload-${categoryId}-${i}`;
      await createMenuItem({
        id: menuId,
        parentId: `category-${categoryId}`,
        title: getItemTitle(items[i]),
        contexts: ['editable']
      });
      // Store lookup for payload items
      payloadLookup.set(menuId, {
        category: categoryId,
        index: i,
        value: getItemValue(items[i])
      });
    }
  }

  // Separator
  await createMenuItem({
    id: 'separator-mode',
    parentId: 'testdata-root',
    type: 'separator',
    contexts: ['editable']
  });

  // Operational mode submenu
  await createMenuItem({
    id: 'mode-menu',
    parentId: 'testdata-root',
    title: 'Operational mode',
    contexts: ['editable']
  });

  // Mode options (radio buttons)
  for (const mode of MODES) {
    await createMenuItem({
      id: `mode-${mode.id}`,
      parentId: 'mode-menu',
      title: mode.title,
      type: 'radio',
      checked: mode.id === currentMode,
      contexts: ['editable']
    });
  }
}

// Promisify chrome.contextMenus.remove
function removeMenuItem(id) {
  return new Promise((resolve) => {
    chrome.contextMenus.remove(id, () => {
      // Ignore errors (item may not exist)
      if (chrome.runtime.lastError) { /* expected */ }
      resolve();
    });
  });
}

// Update only the recent items section (avoids full menu rebuild)
async function updateRecentMenuItems() {
  // Remove existing recent items from lookup
  for (let i = 0; i < MAX_RECENT; i++) {
    payloadLookup.delete(`recent-${i}`);
  }

  // Remove old recent menu items
  const removePromises = [];
  for (let i = 0; i < MAX_RECENT; i++) {
    removePromises.push(removeMenuItem(`recent-${i}`));
  }

  // Also try to remove the separator and menu if they exist
  removePromises.push(
    removeMenuItem('separator-recent'),
    removeMenuItem('recent-menu')
  );

  await Promise.all(removePromises);

  if (recentPayloads.length === 0) return;

  // Recreate recent menu section
  await createMenuItem({
    id: 'recent-menu',
    parentId: 'testdata-root',
    title: 'Recently used',
    contexts: ['editable']
  });

  for (let i = 0; i < recentPayloads.length; i++) {
    const recent = recentPayloads[i];
    const menuId = `recent-${i}`;
    await createMenuItem({
      id: menuId,
      parentId: 'recent-menu',
      title: truncate(recent.value),
      contexts: ['editable']
    });
    payloadLookup.set(menuId, {
      category: recent.category,
      index: recent.index,
      value: recent.value
    });
  }

  await createMenuItem({
    id: 'separator-recent',
    parentId: 'testdata-root',
    type: 'separator',
    contexts: ['editable']
  });
}

// Add to recent payloads (uses pure function from utils.js)
function addToRecent(category, index, value) {
  recentPayloads = addToRecentList(recentPayloads, category, index, value);

  // Persist and update only recent section
  chrome.storage.local.set({ recentPayloads });
  updateRecentMenuItems();
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Ensure payloads are loaded (handles service worker wake-up)
  await ensureInitialized();

  // Mode selection
  if (info.menuItemId.startsWith('mode-')) {
    currentMode = info.menuItemId.replace('mode-', '');
    chrome.storage.local.set({ operationalMode: currentMode });
    return;
  }

  // Look up payload data from map (works for both recent and regular payloads)
  const payloadData = payloadLookup.get(info.menuItemId);
  if (!payloadData) {
    // This can happen if service worker just woke up and menus are stale
    console.warn('Payload not found for menu item:', info.menuItemId);
    chrome.tabs.sendMessage(tab.id, {
      action: 'showNotification',
      message: 'Extension reloading, please try again',
      isError: true
    }, { frameId: info.frameId }, () => {
      // Ignore errors if frame navigated away
      if (chrome.runtime.lastError) { /* expected */ }
    });
    return;
  }

  const { category, index, value: payload } = payloadData;

  // Add to recent
  addToRecent(category, index, payload);

  // Send to content script
  const mode = MODES.find(m => m.id === currentMode);
  chrome.tabs.sendMessage(tab.id, {
    action: mode.action,
    value: payload
  }, { frameId: info.frameId }, (response) => {
    // Handle potential errors (e.g., frame navigated away)
    if (chrome.runtime.lastError) {
      console.warn('Failed to send message to frame:', chrome.runtime.lastError.message);
    }
  });
});

// Track word scanner count per tab for badge priority
const wordScannerCounts = new Map();

// Badge update handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateBadge') {
    const { stats } = message;
    const total = (stats?.high || 0) + (stats?.medium || 0) + (stats?.low || 0);

    const text = total > 0 ? String(total) : '';
    chrome.action.setBadgeText({
      text,
      tabId: sender.tab?.id
    });

    // Use shared getBadgeColor from utils.js
    const color = getBadgeColor(stats);

    chrome.action.setBadgeBackgroundColor({
      color,
      tabId: sender.tab?.id
    });

    sendResponse({ success: true });
  } else if (message.action === 'updateWordScannerBadge') {
    const tabId = sender.tab?.id;
    const { count } = message;
    wordScannerCounts.set(tabId, count || 0);

    const text = count > 0 ? String(count) : '';
    chrome.action.setBadgeText({ text, tabId });

    if (count > 0) {
      chrome.action.setBadgeBackgroundColor({ color: '#a855f7', tabId });
    }

    sendResponse({ success: true });
  }
  return true;
});

// Clear badge when tab is updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: '', tabId });
    wordScannerCounts.delete(tabId);
  }
});
