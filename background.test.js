/**
 * @jest-environment node
 */

// Tests for background.js service worker logic
// Shared utilities are imported from utils.js to avoid code duplication

const {
  MAX_RECENT,
  DEFAULT_FORBIDDEN_WORDS,
  truncate,
  getItemTitle,
  getItemValue,
  addToRecentList,
  validatePayloads,
  getBadgeColor
} = require('./utils.js');

describe('DEFAULT_FORBIDDEN_WORDS', () => {
  test('contains expected default words', () => {
    expect(DEFAULT_FORBIDDEN_WORDS).toContain('todo');
    expect(DEFAULT_FORBIDDEN_WORDS).toContain('lorem');
    expect(DEFAULT_FORBIDDEN_WORDS).toContain('example.com');
  });
});

describe('background.js utility functions', () => {
  describe('truncate', () => {
    test('returns (empty) for null/undefined', () => {
      expect(truncate(null)).toBe('(empty)');
      expect(truncate(undefined)).toBe('(empty)');
      expect(truncate('')).toBe('(empty)');
    });

    test('returns string unchanged if within limit', () => {
      expect(truncate('hello')).toBe('hello');
      expect(truncate('a'.repeat(35))).toBe('a'.repeat(35));
    });

    test('truncates long strings with ellipsis', () => {
      const long = 'a'.repeat(40);
      expect(truncate(long)).toBe('a'.repeat(35) + '…');
    });

    test('replaces control characters with dots', () => {
      expect(truncate('hello\x00world')).toBe('hello·world');
      expect(truncate('hello\nworld')).toBe('hello·world');
      expect(truncate('hello\tworld')).toBe('hello·world');
    });

    test('replaces zero-width characters with dots', () => {
      expect(truncate('hello\u200Bworld')).toBe('hello·world');
      expect(truncate('hello\uFEFFworld')).toBe('hello·world');
    });

    test('sanitizes string of only control chars to dots', () => {
      // Control chars are replaced with dots, result is non-empty
      expect(truncate('\x00\x01\x02')).toBe('···');
    });
  });

  describe('getItemTitle', () => {
    test('returns name property for object with name', () => {
      expect(getItemTitle({ name: 'Test Name', value: 'test value' })).toBe('Test Name');
    });

    test('returns truncated value for string', () => {
      expect(getItemTitle('simple string')).toBe('simple string');
    });

    test('truncates long string payloads', () => {
      // String payloads get truncated
      const longPayload = 'a'.repeat(50);
      expect(getItemTitle(longPayload)).toBe('a'.repeat(35) + '…');
    });
  });

  describe('getItemValue', () => {
    test('returns value property for object with value', () => {
      expect(getItemValue({ name: 'Test', value: 'the value' })).toBe('the value');
    });

    test('returns string as-is', () => {
      expect(getItemValue('simple string')).toBe('simple string');
    });

    test('handles empty string value', () => {
      expect(getItemValue({ name: 'Test', value: '' })).toBe('');
    });
  });
});

describe('addToRecentList logic', () => {
  test('adds new payload to front', () => {
    const recent = [];
    const result = addToRecentList(recent, 'Emails', 0, 'test@example.com');
    expect(result).toEqual([{ category: 'Emails', index: 0, value: 'test@example.com' }]);
  });

  test('moves existing payload to front (deduplication)', () => {
    const recent = [
      { category: 'Emails', index: 0, value: 'first@example.com' },
      { category: 'Emails', index: 1, value: 'second@example.com' }
    ];
    const result = addToRecentList(recent, 'Emails', 1, 'second@example.com');

    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ category: 'Emails', index: 1, value: 'second@example.com' });
    expect(result[1]).toEqual({ category: 'Emails', index: 0, value: 'first@example.com' });
  });

  test('limits to MAX_RECENT items', () => {
    let recent = [];
    for (let i = 0; i < 7; i++) {
      recent = addToRecentList(recent, 'Emails', i, `email${i}@example.com`);
    }

    expect(recent.length).toBe(MAX_RECENT);
    // Most recent should be at front
    expect(recent[0].value).toBe('email6@example.com');
    // Oldest beyond limit should be gone
    expect(recent.find(r => r.value === 'email0@example.com')).toBeUndefined();
    expect(recent.find(r => r.value === 'email1@example.com')).toBeUndefined();
  });

  test('handles different categories', () => {
    let recent = [];
    recent = addToRecentList(recent, 'Emails', 0, 'test@example.com');
    recent = addToRecentList(recent, 'XSS', 0, '<script>alert(1)</script>');
    recent = addToRecentList(recent, 'SQL', 0, "' OR 1=1 --");

    expect(recent.length).toBe(3);
    expect(recent[0].category).toBe('SQL');
    expect(recent[1].category).toBe('XSS');
    expect(recent[2].category).toBe('Emails');
  });
});

describe('validatePayloads', () => {
  // Uses actual validatePayloads imported from utils.js

  test('accepts valid payloads structure', () => {
    const validPayloads = {
      'Emails': ['test@example.com', 'foo@bar.com'],
      'SQL': ["' OR 1=1 --", '" OR ""="']
    };
    expect(() => validatePayloads(validPayloads)).not.toThrow();
  });

  test('rejects null', () => {
    expect(() => validatePayloads(null)).toThrow('must be a non-null object');
  });

  test('rejects non-object', () => {
    expect(() => validatePayloads('string')).toThrow('must be a non-null object');
    expect(() => validatePayloads(123)).toThrow('must be a non-null object');
  });

  test('rejects empty object', () => {
    expect(() => validatePayloads({})).toThrow('must have at least one category');
  });

  test('rejects non-array category', () => {
    const invalid = { 'Emails': 'not an array' };
    expect(() => validatePayloads(invalid)).toThrow('Category "Emails" must be an array');
  });

  test('accepts empty array category', () => {
    const valid = { 'Empty': [] };
    expect(() => validatePayloads(valid)).not.toThrow();
  });
});

describe('badge color logic', () => {
  // Uses actual getBadgeColor imported from utils.js

  test('returns red for high risk fields', () => {
    expect(getBadgeColor({ high: 1, medium: 0, low: 0 })).toBe('#ef4444');
    expect(getBadgeColor({ high: 5, medium: 3, low: 2 })).toBe('#ef4444');
  });

  test('returns orange for medium risk fields (no high)', () => {
    expect(getBadgeColor({ high: 0, medium: 1, low: 0 })).toBe('#f59e0b');
    expect(getBadgeColor({ high: 0, medium: 5, low: 10 })).toBe('#f59e0b');
  });

  test('returns green for low risk only', () => {
    expect(getBadgeColor({ high: 0, medium: 0, low: 5 })).toBe('#22c55e');
    expect(getBadgeColor({ high: 0, medium: 0, low: 0 })).toBe('#22c55e');
  });

  test('handles null/undefined stats', () => {
    expect(getBadgeColor(null)).toBe('#22c55e');
    expect(getBadgeColor(undefined)).toBe('#22c55e');
    expect(getBadgeColor({})).toBe('#22c55e');
  });
});

