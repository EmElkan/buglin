// Autofill Risk Detector - Content Script
// Uses analyzeFieldAttributes from analysis.js (loaded before this script)

let isEnabled = true;

// Track field counts for badge
let fieldStats = { high: 0, medium: 0, low: 0, total: 0 };

// Track analyzed fields to avoid re-analyzing unchanged fields
const analyzedFields = new WeakMap();

// WeakMaps for private element associations (avoids polluting DOM elements with custom properties)
const overlayMap = new WeakMap();      // field -> overlay element
const tooltipMap = new WeakMap();      // field -> tooltip element
const tooltipTimeoutMap = new WeakMap(); // badge -> tooltip timeout ID

// Store observer instance to prevent memory leaks
let domObserver = null;

// Periodic reconciliation interval (30 seconds)
let reconcileInterval = null;
const RECONCILE_INTERVAL_MS = 30000;

// Rescan timeout for debouncing DOM mutations
let rescanTimeout = null;

// Note: escapeHtml and isInjectableElement are provided by analysis.js (loaded before this script)

// Check stored state
chrome.storage.local.get(['autofillDetectorEnabled'], (result) => {
  if (chrome.runtime.lastError) {
    console.error('Failed to load autofill detector state:', chrome.runtime.lastError.message);
    return;
  }
  isEnabled = result.autofillDetectorEnabled !== false;
  if (isEnabled) {
    scanPage();
    observeDOM();
    startReconcileInterval();
    addScrollListeners();
  }
});

// Listen for storage changes to handle toggle in all frames (including iframes)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.autofillDetectorEnabled) return;

  const newEnabled = changes.autofillDetectorEnabled.newValue !== false;
  if (newEnabled === isEnabled) return;

  isEnabled = newEnabled;
  if (isEnabled) {
    scanPage();
    observeDOM();
    startReconcileInterval();
    addScrollListeners();
  } else {
    stopObserving();
    stopReconcileInterval();
    clearRepositionTimeout();
    clearRescanTimeout();
    removeScrollListeners();
    removeAllOverlays();
    fieldStats = { high: 0, medium: 0, low: 0, total: 0 };
    updateBadge();
  }
});

// Check if an element can receive text input (wrapper for DOM element)
function isInjectable(element) {
  if (!element) return false;

  // Use pure function from analysis.js with extracted element info
  return isInjectableElement({
    tagName: element.tagName,
    type: element.getAttribute ? element.getAttribute('type') : null,
    isContentEditable: element.isContentEditable
  });
}

// Show a brief notification to the user
function showNotification(message, isError = false) {
  const notification = document.createElement('div');
  notification.className = 'autofill-detector-notification';
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${isError ? '#ef4444' : '#22c55e'};
    color: white;
    border-radius: 6px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    animation: slideIn 0.2s ease-out;
  `;

  // Add animation keyframes if not already present
  if (!document.getElementById('autofill-notification-styles')) {
    const style = document.createElement('style');
    style.id = 'autofill-notification-styles';
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideIn 0.2s ease-out reverse';
    setTimeout(() => notification.remove(), 200);
  }, 2000);
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Note: toggle is handled by chrome.storage.onChanged listener (lines 31-50)
  // which properly manages reconcileInterval and works across all frames

  if (message.action === 'fillField') {
    // Replace field value with payload
    const activeElement = document.activeElement;

    if (!isInjectable(activeElement)) {
      showNotification('No text field focused', true);
      sendResponse({ success: false, error: 'No valid field focused' });
      return true;
    }

    if (activeElement.disabled || activeElement.readOnly) {
      showNotification('Field is disabled or read-only', true);
      sendResponse({ success: false, error: 'Field is disabled or read-only' });
      return true;
    }

    if (activeElement.isContentEditable) {
      activeElement.textContent = message.value;
    } else {
      activeElement.value = message.value;
    }
    activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    activeElement.dispatchEvent(new Event('change', { bubbles: true }));
    sendResponse({ success: true });
  } else if (message.action === 'appendField') {
    // Append payload to existing field value
    const activeElement = document.activeElement;

    if (!isInjectable(activeElement)) {
      showNotification('No text field focused', true);
      sendResponse({ success: false, error: 'No valid field focused' });
      return true;
    }

    if (activeElement.disabled || activeElement.readOnly) {
      showNotification('Field is disabled or read-only', true);
      sendResponse({ success: false, error: 'Field is disabled or read-only' });
      return true;
    }

    if (activeElement.isContentEditable) {
      activeElement.textContent += message.value;
    } else {
      activeElement.value += message.value;
    }
    activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    activeElement.dispatchEvent(new Event('change', { bubbles: true }));
    sendResponse({ success: true });
  } else if (message.action === 'copyToClipboard') {
    // Copy payload to clipboard
    navigator.clipboard.writeText(message.value).then(() => {
      showNotification('Copied to clipboard');
      sendResponse({ success: true });
    }).catch(() => {
      showNotification('Failed to copy to clipboard', true);
      sendResponse({ success: false, error: 'Clipboard access denied' });
    });
    return true; // Keep channel open for async response
  } else if (message.action === 'showNotification') {
    // Show a notification from background script
    showNotification(message.message, message.isError || false);
    sendResponse({ success: true });
  }
  return true;
});

function analyzeField(field) {
  // Skip elements that aren't visible or have no dimensions (DOM-specific check)
  const rect = field.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return null;
  }
  const style = window.getComputedStyle(field);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return null;
  }

  // Get associated label text (DOM-specific)
  let labelText = '';
  if (field.id) {
    // Use CSS.escape to prevent selector injection from malicious IDs
    const label = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
    if (label) labelText = label.textContent;
  }
  const parentLabel = field.closest('label');
  if (parentLabel) labelText += ' ' + parentLabel.textContent;

  // Use the pure analysis function from analysis.js
  const result = analyzeFieldAttributes({
    tagName: field.tagName,
    type: field.getAttribute('type') || 'text',
    name: field.getAttribute('name') || '',
    id: field.getAttribute('id') || '',
    autocomplete: field.getAttribute('autocomplete') || '',
    placeholder: field.getAttribute('placeholder') || '',
    labelText
  });

  if (!result) {
    return null;
  }

  // Add DOM element reference for overlay creation
  return {
    element: field,
    ...result
  };
}

function createOverlay(analysis) {
  const { element, riskLevel, risks, attributes } = analysis;

  // Remove existing overlay if any
  const existingOverlay = overlayMap.get(element);
  if (existingOverlay) {
    existingOverlay.remove();
  }

  const overlay = document.createElement('div');
  overlay.className = `autofill-detector-overlay autofill-risk-${riskLevel}`;

  // Position overlay using fixed positioning
  // This handles CSS transforms correctly since getBoundingClientRect()
  // returns viewport-relative coordinates that account for transforms
  const rect = element.getBoundingClientRect();
  overlay.style.position = 'fixed';
  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '999999';

  // Create badge
  const badge = document.createElement('div');
  badge.className = `autofill-detector-badge autofill-badge-${riskLevel}`;
  badge.textContent = riskLevel.toUpperCase();
  badge.style.position = 'absolute';
  badge.style.top = '-10px';
  badge.style.right = '-10px';
  badge.style.pointerEvents = 'auto';
  badge.style.cursor = 'pointer';

  // Create tooltip
  const tooltip = document.createElement('div');
  tooltip.className = 'autofill-detector-tooltip';
  tooltip.style.display = 'none';

  let tooltipContent = `<strong>Autofill Risk: ${escapeHtml(riskLevel.toUpperCase())}</strong><br><br>`;
  tooltipContent += `<strong>Attributes:</strong><br>`;
  tooltipContent += `• name: ${escapeHtml(attributes.name) || '(none)'}<br>`;
  tooltipContent += `• id: ${escapeHtml(attributes.id) || '(none)'}<br>`;
  tooltipContent += `• autocomplete: ${escapeHtml(attributes.autocomplete) || '(none)'}<br>`;
  tooltipContent += `• type: ${escapeHtml(attributes.type)}<br><br>`;
  tooltipContent += `<strong>Analysis:</strong><br>`;
  risks.forEach(risk => {
    const icon = risk.type === 'error' ? '🔴' : risk.type === 'warning' ? '🟡' : '🔵';
    tooltipContent += `${icon} ${escapeHtml(risk.message)}<br>`;
  });

  if (riskLevel !== 'low') {
    tooltipContent += `<br><strong>Recommended fix:</strong><br>`;
    tooltipContent += `Add autocomplete="off" or autocomplete="one-time-code"`;
  }

  tooltip.innerHTML = tooltipContent;

  // Helper to hide tooltip
  const hideTooltip = () => {
    tooltip.style.display = 'none';
    if (tooltip.parentNode) {
      tooltip.parentNode.removeChild(tooltip);
    }
  };

  // Show/hide tooltip on hover
  badge.addEventListener('mouseenter', () => {
    // Remove any other open tooltips first
    document.querySelectorAll('.autofill-detector-tooltip').forEach(el => el.remove());

    // Position tooltip relative to badge
    const badgeRect = badge.getBoundingClientRect();
    tooltip.style.position = 'fixed';
    tooltip.style.left = `${badgeRect.right - 300}px`;
    tooltip.style.top = `${badgeRect.bottom + 8}px`;

    document.body.appendChild(tooltip);
    tooltip.style.display = 'block';

    // Reposition if tooltip goes off-screen
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Check right edge
    if (tooltipRect.right > viewportWidth - 10) {
      tooltip.style.left = `${viewportWidth - tooltipRect.width - 10}px`;
    }
    // Check left edge
    if (tooltipRect.left < 10) {
      tooltip.style.left = '10px';
    }

    // Check bottom edge - flip to above
    if (tooltipRect.bottom > viewportHeight - 10) {
      tooltip.style.top = `${badgeRect.top - tooltipRect.height - 8}px`;
    }

    // Auto-hide after 5 seconds as fallback
    clearTimeout(tooltipTimeoutMap.get(badge));
    tooltipTimeoutMap.set(badge, setTimeout(hideTooltip, 5000));
  });
  badge.addEventListener('mouseleave', () => {
    clearTimeout(tooltipTimeoutMap.get(badge));
    hideTooltip();
  });

  overlay.appendChild(badge);
  tooltipMap.set(element, tooltip);
  document.body.appendChild(overlay);

  overlayMap.set(element, overlay);

  return overlay;
}

function scanPage() {
  if (!isEnabled) return;

  fieldStats = { high: 0, medium: 0, low: 0, total: 0 };

  const fields = document.querySelectorAll('input, textarea, select');

  fields.forEach(field => {
    const analysis = analyzeField(field);

    // Cache the analysis result (null for skipped fields)
    analyzedFields.set(field, analysis);

    if (analysis && analysis.risks.length > 0) {
      createOverlay(analysis);
      fieldStats[analysis.riskLevel]++;
      fieldStats.total++;
    }
  });

  // Update extension badge
  updateBadge();
}

// Send stats to background script to update badge
function updateBadge() {
  chrome.runtime.sendMessage({
    action: 'updateBadge',
    stats: fieldStats
  }).catch(() => {
    // Ignore errors (e.g., no background script in some contexts)
  });
}

// Reconcile fieldStats with actual overlays to prevent drift
function reconcileStats() {
  const actual = { high: 0, medium: 0, low: 0, total: 0 };
  document.querySelectorAll('.autofill-detector-overlay').forEach(overlay => {
    if (overlay.classList.contains('autofill-risk-high')) actual.high++;
    else if (overlay.classList.contains('autofill-risk-medium')) actual.medium++;
    else if (overlay.classList.contains('autofill-risk-low')) actual.low++;
    actual.total++;
  });

  // Only update if stats have drifted
  if (fieldStats.high !== actual.high ||
      fieldStats.medium !== actual.medium ||
      fieldStats.low !== actual.low ||
      fieldStats.total !== actual.total) {
    fieldStats = actual;
    updateBadge();
  }
}

// Start periodic stats reconciliation
function startReconcileInterval() {
  if (reconcileInterval) return; // Already running
  reconcileInterval = setInterval(reconcileStats, RECONCILE_INTERVAL_MS);
}

// Stop periodic stats reconciliation
function stopReconcileInterval() {
  if (reconcileInterval) {
    clearInterval(reconcileInterval);
    reconcileInterval = null;
  }
}

function removeAllOverlays() {
  // Clear tooltip timeouts before removing overlays to prevent orphaned references
  document.querySelectorAll('.autofill-detector-badge').forEach(badge => {
    const timeout = tooltipTimeoutMap.get(badge);
    if (timeout) {
      clearTimeout(timeout);
      tooltipTimeoutMap.delete(badge);
    }
  });
  document.querySelectorAll('.autofill-detector-overlay').forEach(el => el.remove());
  document.querySelectorAll('.autofill-detector-tooltip').forEach(el => el.remove());
  document.querySelectorAll('input, textarea, select').forEach(field => {
    analyzedFields.delete(field);
    overlayMap.delete(field);
    tooltipMap.delete(field);
  });
}

function stopObserving() {
  if (domObserver) {
    domObserver.disconnect();
    domObserver = null;
  }
}

function observeDOM() {
  // Prevent multiple observers
  if (domObserver) return;

  domObserver = new MutationObserver((mutations) => {
    if (!isEnabled) return;

    const newFields = [];
    const removedFields = [];

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        // Check for added form fields
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches && node.matches('input, textarea, select')) {
              newFields.push(node);
            } else if (node.querySelectorAll) {
              newFields.push(...node.querySelectorAll('input, textarea, select'));
            }
          }
        }

        // Check for removed form fields
        for (const node of mutation.removedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches && node.matches('input, textarea, select')) {
              removedFields.push(node);
            } else if (node.querySelectorAll) {
              removedFields.push(...node.querySelectorAll('input, textarea, select'));
            }
          }
        }
      }
    }

    // Clean up overlays for removed fields
    for (const field of removedFields) {
      const overlay = overlayMap.get(field);
      if (overlay) {
        // Clear tooltip timeout on badge to prevent orphaned references
        const badge = overlay.querySelector('.autofill-detector-badge');
        if (badge) {
          const timeout = tooltipTimeoutMap.get(badge);
          if (timeout) {
            clearTimeout(timeout);
            tooltipTimeoutMap.delete(badge);
          }
        }
        overlay.remove();
        overlayMap.delete(field);
      }
      const tooltip = tooltipMap.get(field);
      if (tooltip) {
        tooltip.remove();
        tooltipMap.delete(field);
      }
      // Remove from cache and update stats
      const cached = analyzedFields.get(field);
      if (cached) {
        fieldStats[cached.riskLevel]--;
        fieldStats.total--;
        analyzedFields.delete(field);
      }
    }

    // Analyze only new fields
    if (newFields.length > 0) {
      clearTimeout(rescanTimeout);
      rescanTimeout = setTimeout(() => {
        for (const field of newFields) {
          if (analyzedFields.has(field)) continue;

          const analysis = analyzeField(field);
          analyzedFields.set(field, analysis);

          if (analysis && analysis.risks.length > 0) {
            createOverlay(analysis);
            fieldStats[analysis.riskLevel]++;
            fieldStats.total++;
          }
        }
        updateBadge();
        // Reconcile stats after mutation batch to catch any drift
        reconcileStats();
      }, 100);
    } else if (removedFields.length > 0) {
      // Update badge if fields were removed
      updateBadge();
      // Reconcile stats after removals to catch any drift
      reconcileStats();
    }
  });

  domObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Handle scroll and resize to reposition overlays
let repositionTimeout = null;
function repositionOverlays() {
  clearTimeout(repositionTimeout);
  repositionTimeout = setTimeout(() => {
    // Update positions of existing overlays without recreating them
    document.querySelectorAll('input, textarea, select').forEach(field => {
      const overlay = overlayMap.get(field);
      if (!overlay) return;

      const rect = field.getBoundingClientRect();

      // Check if field is still visible
      if (rect.width === 0 || rect.height === 0) {
        overlay.style.display = 'none';
        return;
      }

      overlay.style.display = '';
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
    });
  }, 16); // ~60fps throttle
}

// Clear pending reposition timeout
function clearRepositionTimeout() {
  if (repositionTimeout) {
    clearTimeout(repositionTimeout);
    repositionTimeout = null;
  }
}

// Clear pending rescan timeout
function clearRescanTimeout() {
  if (rescanTimeout) {
    clearTimeout(rescanTimeout);
    rescanTimeout = null;
  }
}

// Hide tooltips and reposition overlays on scroll/resize
const handleScrollOrResize = () => {
  document.querySelectorAll('.autofill-detector-tooltip').forEach(el => el.remove());
  repositionOverlays();
};

// Track whether scroll listeners are attached
let scrollListenersAttached = false;

// Add scroll/resize listeners
function addScrollListeners() {
  if (scrollListenersAttached) return;
  window.addEventListener('scroll', handleScrollOrResize, { passive: true });
  window.addEventListener('resize', handleScrollOrResize, { passive: true });
  // Capture scroll events on nested scroll containers
  document.addEventListener('scroll', handleScrollOrResize, { passive: true, capture: true });
  scrollListenersAttached = true;
}

// Remove scroll/resize listeners
function removeScrollListeners() {
  if (!scrollListenersAttached) return;
  window.removeEventListener('scroll', handleScrollOrResize);
  window.removeEventListener('resize', handleScrollOrResize);
  document.removeEventListener('scroll', handleScrollOrResize, { capture: true });
  scrollListenersAttached = false;
}

// Note: Word Scanner feature is now in wordscanner.js (loaded separately)

// Export for testing (Node.js environment)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isInjectable,
    showNotification,
    analyzeField,
    createOverlay,
    scanPage,
    updateBadge,
    reconcileStats,
    removeAllOverlays,
    startReconcileInterval,
    stopReconcileInterval,
    stopObserving,
    observeDOM,
    repositionOverlays,
    clearRepositionTimeout,
    clearRescanTimeout,
    addScrollListeners,
    removeScrollListeners,
    // State getters/setters for testing
    getIsEnabled: () => isEnabled,
    setIsEnabled: (val) => { isEnabled = val; },
    getFieldStats: () => fieldStats,
    setFieldStats: (stats) => { fieldStats = stats; },
    getOverlayMap: () => overlayMap,
    getTooltipMap: () => tooltipMap,
    getTooltipTimeoutMap: () => tooltipTimeoutMap,
    getAnalyzedFields: () => analyzedFields,
    getScrollListenersAttached: () => scrollListenersAttached
  };
}
