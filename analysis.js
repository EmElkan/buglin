// Autofill Risk Analysis - Pure logic module (testable without DOM)

const AUTOFILL_KEYWORDS = [
  // Contact info
  'email', 'e-mail', 'mail', 'phone', 'tel', 'mobile', 'cell', 'fax',
  // Names
  'name', 'fname', 'lname', 'firstname', 'lastname', 'first-name', 'last-name',
  'fullname', 'full-name', 'nickname', 'username', 'user',
  // Address
  'address', 'street', 'city', 'state', 'province', 'zip', 'postal', 'postcode',
  'country', 'region', 'apt', 'suite', 'building',
  // Payment
  'card', 'credit', 'ccnum', 'ccname', 'cvv', 'cvc', 'expiry', 'expiration',
  // Organization
  'company', 'organization', 'org', 'employer', 'business',
  // Other PII
  'title', 'prefix', 'suffix', 'birthday', 'bday', 'age', 'gender', 'sex',
  'ssn', 'social', 'passport', 'license'
  // NOTE: Removed generic terms (id, number, num, search, query, input, field,
  // value, text, code, reference, ref) to reduce false positives
];

const AUTOCOMPLETE_VALUES_THAT_TRIGGER = [
  'on', 'name', 'email', 'username', 'new-password', 'current-password',
  'organization', 'organization-title', 'street-address', 'address-line1',
  'address-line2', 'address-line3', 'address-level1', 'address-level2',
  'address-level3', 'address-level4', 'country', 'country-name', 'postal-code',
  'cc-name', 'cc-given-name', 'cc-additional-name', 'cc-family-name', 'cc-number',
  'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-type', 'transaction-currency',
  'transaction-amount', 'language', 'bday', 'bday-day', 'bday-month', 'bday-year',
  'sex', 'tel', 'tel-country-code', 'tel-national', 'tel-area-code', 'tel-local',
  'tel-extension', 'impp', 'url', 'photo', 'given-name', 'additional-name', 'family-name',
  'honorific-prefix', 'honorific-suffix', 'nickname'
];

const SAFE_AUTOCOMPLETE_VALUES = ['off', 'one-time-code', 'nope', 'false', 'disabled'];

// Input types that should be skipped (not analyzable for autofill risk)
const SKIP_INPUT_TYPES = ['hidden', 'submit', 'button', 'reset', 'image', 'file', 'checkbox', 'radio'];

// Input types that can receive text input (for injection validation)
const INJECTABLE_INPUT_TYPES = ['text', 'email', 'password', 'search', 'tel', 'url', 'number'];

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (!str) return '';
  const escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return String(str).replace(/[&<>"']/g, c => escapeMap[c]);
}

/**
 * Check if an element can receive text input (pure logic version)
 * @param {Object} elementInfo - Element information
 * @param {string} elementInfo.tagName - Tag name
 * @param {string} elementInfo.type - Input type (for input elements)
 * @param {boolean} elementInfo.isContentEditable - Whether element is contentEditable
 * @returns {boolean} Whether the element can receive text input
 */
function isInjectableElement(elementInfo) {
  if (!elementInfo) return false;

  const { tagName, type, isContentEditable } = elementInfo;

  if (isContentEditable) return true;

  const normalizedTagName = (tagName || '').toUpperCase();
  if (normalizedTagName === 'TEXTAREA') return true;

  if (normalizedTagName === 'INPUT') {
    const normalizedType = (type || 'text').toLowerCase();
    return INJECTABLE_INPUT_TYPES.includes(normalizedType);
  }

  return false;
}

/**
 * Analyze field attributes for autofill risk.
 * Pure function - no DOM dependencies.
 *
 * @param {Object} attrs - Field attributes
 * @param {string} attrs.tagName - Tag name (input, textarea, select)
 * @param {string} attrs.type - Input type (text, email, etc.)
 * @param {string} attrs.name - Name attribute
 * @param {string} attrs.id - ID attribute
 * @param {string} attrs.autocomplete - Autocomplete attribute
 * @param {string} attrs.placeholder - Placeholder attribute
 * @param {string} attrs.labelText - Associated label text
 * @returns {Object|null} Analysis result with riskLevel and risks array, or null if skipped
 */
function analyzeFieldAttributes(attrs) {
  const {
    tagName = '',
    type = 'text',
    name = '',
    id = '',
    autocomplete = '',
    placeholder = '',
    labelText = ''
  } = attrs;

  const normalizedTagName = tagName.toLowerCase();
  const normalizedType = type.toLowerCase();
  const normalizedName = name.toLowerCase();
  const normalizedId = id.toLowerCase();
  const normalizedAutocomplete = autocomplete.toLowerCase();
  const normalizedPlaceholder = placeholder.toLowerCase();
  const normalizedLabelText = labelText.toLowerCase();

  // Skip non-analyzable input types
  if (SKIP_INPUT_TYPES.includes(normalizedType)) {
    return null;
  }

  // Skip select elements - they don't accept typed input so can't trigger autofill
  if (normalizedTagName === 'select') {
    return null;
  }

  const risks = [];
  let riskLevel = 'low';

  // Check autocomplete attribute
  if (!normalizedAutocomplete) {
    risks.push({
      type: 'warning',
      message: 'No autocomplete attribute - Chrome may use form history'
    });
    riskLevel = 'medium';
  } else if (SAFE_AUTOCOMPLETE_VALUES.includes(normalizedAutocomplete)) {
    risks.push({
      type: 'info',
      message: `autocomplete="${autocomplete}" - Should prevent autofill`
    });
  } else if (AUTOCOMPLETE_VALUES_THAT_TRIGGER.includes(normalizedAutocomplete)) {
    risks.push({
      type: 'error',
      message: `autocomplete="${autocomplete}" - WILL trigger autofill`
    });
    riskLevel = 'high';
  }

  // Check input type
  if (['email', 'tel', 'url'].includes(normalizedType)) {
    risks.push({
      type: 'error',
      message: `type="${type}" - This input type triggers autofill`
    });
    riskLevel = 'high';
  } else if (normalizedType === 'password') {
    risks.push({
      type: 'warning',
      message: 'type="password" - May trigger password manager'
    });
    if (riskLevel !== 'high') riskLevel = 'medium';
  }

  // Check name attribute for keywords
  for (const keyword of AUTOFILL_KEYWORDS) {
    if (normalizedName.includes(keyword)) {
      risks.push({
        type: 'warning',
        message: `name="${name}" contains "${keyword}" - May trigger form history`
      });
      if (riskLevel === 'low') riskLevel = 'medium';
      break;
    }
  }

  // Check id attribute for keywords
  for (const keyword of AUTOFILL_KEYWORDS) {
    if (normalizedId.includes(keyword)) {
      risks.push({
        type: 'warning',
        message: `id="${id}" contains "${keyword}" - May trigger form history`
      });
      if (riskLevel === 'low') riskLevel = 'medium';
      break;
    }
  }

  // Check placeholder for keywords
  for (const keyword of AUTOFILL_KEYWORDS) {
    if (normalizedPlaceholder.includes(keyword)) {
      risks.push({
        type: 'info',
        message: `Placeholder contains "${keyword}" - Minor autofill signal`
      });
      break;
    }
  }

  // Check label text for keywords
  for (const keyword of AUTOFILL_KEYWORDS) {
    if (normalizedLabelText.includes(keyword)) {
      risks.push({
        type: 'info',
        message: `Label contains "${keyword}" - Chrome may use this as context`
      });
      break;
    }
  }

  // Fields with an unsafe autocomplete value that have a name are susceptible to form history
  // (Only warn when autocomplete EXISTS but isn't safe - missing autocomplete is already caught above)
  if (normalizedName && normalizedAutocomplete && !SAFE_AUTOCOMPLETE_VALUES.includes(normalizedAutocomplete)) {
    risks.push({
      type: 'warning',
      message: 'Has name attribute without autocomplete="off" - Chrome saves form history for this field'
    });
    if (riskLevel === 'low') riskLevel = 'medium';
  }

  return {
    riskLevel,
    risks,
    attributes: {
      tagName: normalizedTagName,
      type: normalizedType,
      name,
      id,
      autocomplete,
      placeholder
    }
  };
}

// Export for Node.js (tests) and browser (content script)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AUTOFILL_KEYWORDS,
    AUTOCOMPLETE_VALUES_THAT_TRIGGER,
    SAFE_AUTOCOMPLETE_VALUES,
    SKIP_INPUT_TYPES,
    INJECTABLE_INPUT_TYPES,
    analyzeFieldAttributes,
    escapeHtml,
    isInjectableElement
  };
}
