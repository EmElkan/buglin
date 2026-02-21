// Shared utility functions for background.js, content scripts, popup, and tests

const MAX_RECENT = 5;
const DEFAULT_FORBIDDEN_WORDS = ['todo', 'fixme', 'lorem', 'ipsum', 'placeholder', 'tbd', 'example.com'];

/**
 * Sanitize and truncate string for menu display
 * @param {string} str - String to truncate
 * @param {number} len - Maximum length (default 35)
 * @returns {string} Sanitized and truncated string
 */
function truncate(str, len = 35) {
  if (!str) return '(empty)';
  const sanitized = str
    .replace(/[\x00-\x1F\x7F]/g, '·')
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '·');
  if (sanitized.length <= len) return sanitized || '(special chars)';
  return sanitized.substring(0, len) + '…';
}

/**
 * Get display title for a payload item (string or {name, value} object)
 * @param {string|Object} item - Payload item
 * @returns {string} Display title
 */
function getItemTitle(item) {
  if (typeof item === 'object' && item.name) {
    return item.name;
  }
  return truncate(item);
}

/**
 * Get actual value from a payload item
 * @param {string|Object} item - Payload item
 * @returns {string} Payload value
 */
function getItemValue(item) {
  if (typeof item === 'object' && item.value !== undefined) {
    return item.value;
  }
  return item;
}

/**
 * Add payload to recent list (pure function for testability)
 * @param {Array} recentPayloads - Current recent payloads array
 * @param {string} category - Payload category
 * @param {number} index - Payload index within category
 * @param {string} value - Payload value
 * @returns {Array} New recent payloads array
 */
function addToRecentList(recentPayloads, category, index, value) {
  // Remove if already exists
  let result = recentPayloads.filter(r =>
    !(r.category === category && r.index === index)
  );

  // Add to front
  result.unshift({ category, index, value });

  // Limit size
  if (result.length > MAX_RECENT) {
    result = result.slice(0, MAX_RECENT);
  }

  return result;
}

/**
 * Validate payloads.json structure
 * @param {any} data - Parsed JSON data
 * @throws {Error} If structure is invalid
 */
function validatePayloads(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('payloads.json must be a non-null object');
  }
  if (Object.keys(data).length === 0) {
    throw new Error('payloads.json must have at least one category');
  }
  for (const [category, items] of Object.entries(data)) {
    if (!Array.isArray(items)) {
      throw new Error(`Category "${category}" must be an array`);
    }
  }
}

/**
 * Get badge background color based on risk stats
 * @param {Object} stats - Object with high, medium, low counts
 * @returns {string} Hex color code
 */
function getBadgeColor(stats) {
  if (stats?.high > 0) {
    return '#ef4444'; // red
  } else if (stats?.medium > 0) {
    return '#f59e0b'; // orange
  }
  return '#22c55e'; // green
}

// Export for Node.js (tests) and browser (service worker)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAX_RECENT,
    DEFAULT_FORBIDDEN_WORDS,
    truncate,
    getItemTitle,
    getItemValue,
    addToRecentList,
    validatePayloads,
    getBadgeColor
  };
}
