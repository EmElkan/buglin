const {
  SAFE_AUTOCOMPLETE_VALUES,
  SKIP_INPUT_TYPES,
  INJECTABLE_INPUT_TYPES,
  analyzeFieldAttributes,
  escapeHtml,
  isInjectableElement
} = require('./analysis');

describe('analyzeFieldAttributes', () => {
  describe('skipped fields', () => {
    test.each(SKIP_INPUT_TYPES)('returns null for type="%s"', (type) => {
      const result = analyzeFieldAttributes({ tagName: 'input', type });
      expect(result).toBeNull();
    });

    test('returns null for select elements', () => {
      const result = analyzeFieldAttributes({ tagName: 'select', type: 'text' });
      expect(result).toBeNull();
    });
  });

  describe('HIGH risk - autocomplete triggers', () => {
    test.each(['on', 'email', 'name', 'cc-number', 'street-address', 'tel'])(
      'autocomplete="%s" is HIGH risk',
      (autocomplete) => {
        const result = analyzeFieldAttributes({
          tagName: 'input',
          type: 'text',
          autocomplete
        });
        expect(result.riskLevel).toBe('high');
        expect(result.risks.some(r => r.type === 'error')).toBe(true);
      }
    );
  });

  describe('HIGH risk - input types', () => {
    test.each(['email', 'tel', 'url'])('type="%s" is HIGH risk', (type) => {
      const result = analyzeFieldAttributes({
        tagName: 'input',
        type,
        autocomplete: 'off' // Prevent other risks
      });
      expect(result.riskLevel).toBe('high');
      expect(result.risks.some(r => r.message.includes('triggers autofill'))).toBe(true);
    });
  });

  describe('MEDIUM risk - password type', () => {
    test('type="password" is MEDIUM risk', () => {
      const result = analyzeFieldAttributes({
        tagName: 'input',
        type: 'password',
        autocomplete: 'off'
      });
      expect(result.riskLevel).toBe('medium');
      expect(result.risks.some(r => r.message.includes('password manager'))).toBe(true);
    });

    test('type="password" does not downgrade HIGH to MEDIUM', () => {
      const result = analyzeFieldAttributes({
        tagName: 'input',
        type: 'password',
        autocomplete: 'current-password' // HIGH risk autocomplete
      });
      expect(result.riskLevel).toBe('high');
    });
  });

  describe('MEDIUM risk - missing autocomplete', () => {
    test('no autocomplete attribute is MEDIUM risk', () => {
      const result = analyzeFieldAttributes({
        tagName: 'input',
        type: 'text'
        // no autocomplete
      });
      expect(result.riskLevel).toBe('medium');
      expect(result.risks.some(r => r.message.includes('form history'))).toBe(true);
    });
  });

  describe('MEDIUM risk - name attribute keywords', () => {
    test.each(['email', 'user_email', 'firstName', 'phone_number', 'streetAddress'])(
      'name="%s" triggers MEDIUM risk',
      (name) => {
        const result = analyzeFieldAttributes({
          tagName: 'input',
          type: 'text',
          name,
          autocomplete: 'off'
        });
        expect(result.riskLevel).toBe('medium');
        expect(result.risks.some(r => r.message.includes('name='))).toBe(true);
      }
    );
  });

  describe('MEDIUM risk - id attribute keywords', () => {
    test.each(['emailInput', 'user-phone', 'address_field'])(
      'id="%s" triggers MEDIUM risk',
      (id) => {
        const result = analyzeFieldAttributes({
          tagName: 'input',
          type: 'text',
          id,
          autocomplete: 'off'
        });
        expect(result.riskLevel).toBe('medium');
        expect(result.risks.some(r => r.message.includes('id='))).toBe(true);
      }
    );
  });

  describe('MEDIUM risk - name with unsafe autocomplete', () => {
    test('name attribute with missing autocomplete shows single warning', () => {
      const result = analyzeFieldAttributes({
        tagName: 'input',
        type: 'text',
        name: 'xyz' // generic name without keywords
        // no autocomplete
      });
      expect(result.riskLevel).toBe('medium');
      // Should warn about missing autocomplete, NOT about form history (to avoid duplicate warnings)
      expect(result.risks.some(r => r.message.includes('No autocomplete attribute'))).toBe(true);
      // Only one form history warning (from missing autocomplete), not two
      expect(result.risks.filter(r => r.message.includes('form history')).length).toBe(1);
    });

    test('name attribute with non-safe autocomplete warns about form history', () => {
      const result = analyzeFieldAttributes({
        tagName: 'input',
        type: 'text',
        name: 'someRandomField',
        autocomplete: 'on' // exists but not safe
      });
      expect(result.riskLevel).toBe('high'); // 'on' triggers HIGH
      expect(result.risks.some(r => r.message.includes('Chrome saves form history'))).toBe(true);
    });
  });

  describe('LOW risk - safe configurations', () => {
    test.each(SAFE_AUTOCOMPLETE_VALUES)(
      'autocomplete="%s" keeps LOW risk',
      (autocomplete) => {
        const result = analyzeFieldAttributes({
          tagName: 'input',
          type: 'text',
          autocomplete
        });
        expect(result.riskLevel).toBe('low');
        expect(result.risks.some(r => r.message.includes('prevent autofill'))).toBe(true);
      }
    );

    test('textarea with autocomplete="off" is LOW risk', () => {
      const result = analyzeFieldAttributes({
        tagName: 'textarea',
        type: 'text',
        autocomplete: 'off'
      });
      expect(result.riskLevel).toBe('low');
    });
  });

  describe('INFO risks - placeholder and label keywords', () => {
    test('placeholder with keyword adds INFO risk', () => {
      const result = analyzeFieldAttributes({
        tagName: 'input',
        type: 'text',
        autocomplete: 'off',
        placeholder: 'Enter your email address'
      });
      expect(result.risks.some(r => r.type === 'info' && r.message.includes('Placeholder'))).toBe(true);
    });

    test('label with keyword adds INFO risk', () => {
      const result = analyzeFieldAttributes({
        tagName: 'input',
        type: 'text',
        autocomplete: 'off',
        labelText: 'Phone Number'
      });
      expect(result.risks.some(r => r.type === 'info' && r.message.includes('Label'))).toBe(true);
    });

    test('INFO risks do not escalate risk level', () => {
      const result = analyzeFieldAttributes({
        tagName: 'input',
        type: 'text',
        autocomplete: 'off',
        placeholder: 'Your email',
        labelText: 'Email Address'
      });
      expect(result.riskLevel).toBe('low');
    });
  });

  describe('risk level priority', () => {
    test('HIGH takes precedence over MEDIUM', () => {
      const result = analyzeFieldAttributes({
        tagName: 'input',
        type: 'email', // HIGH
        name: 'user_email' // would be MEDIUM
        // no autocomplete (would be MEDIUM)
      });
      expect(result.riskLevel).toBe('high');
    });

    test('multiple HIGH risks still result in HIGH', () => {
      const result = analyzeFieldAttributes({
        tagName: 'input',
        type: 'email', // HIGH
        autocomplete: 'email' // also HIGH
      });
      expect(result.riskLevel).toBe('high');
      expect(result.risks.filter(r => r.type === 'error').length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('attribute normalization', () => {
    test('handles uppercase attributes', () => {
      const result = analyzeFieldAttributes({
        tagName: 'INPUT',
        type: 'EMAIL',
        autocomplete: 'OFF'
      });
      // EMAIL type should still trigger HIGH risk
      expect(result.riskLevel).toBe('high');
    });

    test('handles missing attributes gracefully', () => {
      const result = analyzeFieldAttributes({
        tagName: 'input'
        // all other attributes undefined
      });
      expect(result).not.toBeNull();
      expect(result.riskLevel).toBe('medium'); // no autocomplete = medium
    });

  });
});

describe('escapeHtml', () => {
  test('escapes ampersand', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  test('escapes less than', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  test('escapes greater than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  test('escapes double quotes', () => {
    expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  test('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  test('returns empty string for falsy input', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml('')).toBe('');
  });

  test('handles non-string input', () => {
    expect(escapeHtml(123)).toBe('123');
  });
});

describe('isInjectableElement', () => {
  test('returns false for null/undefined', () => {
    expect(isInjectableElement(null)).toBe(false);
    expect(isInjectableElement(undefined)).toBe(false);
  });

  test('returns true for contentEditable elements', () => {
    expect(isInjectableElement({ isContentEditable: true })).toBe(true);
  });

  test('returns true for textarea', () => {
    expect(isInjectableElement({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isInjectableElement({ tagName: 'textarea' })).toBe(true);
  });

  test.each(INJECTABLE_INPUT_TYPES)(
    'returns true for input type="%s"',
    (type) => {
      expect(isInjectableElement({ tagName: 'INPUT', type })).toBe(true);
    }
  );

  test('returns true for input with no type (defaults to text)', () => {
    expect(isInjectableElement({ tagName: 'INPUT' })).toBe(true);
    expect(isInjectableElement({ tagName: 'INPUT', type: null })).toBe(true);
  });

  test('returns false for non-injectable input types', () => {
    expect(isInjectableElement({ tagName: 'INPUT', type: 'hidden' })).toBe(false);
    expect(isInjectableElement({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isInjectableElement({ tagName: 'INPUT', type: 'radio' })).toBe(false);
    expect(isInjectableElement({ tagName: 'INPUT', type: 'file' })).toBe(false);
    expect(isInjectableElement({ tagName: 'INPUT', type: 'submit' })).toBe(false);
    expect(isInjectableElement({ tagName: 'INPUT', type: 'button' })).toBe(false);
  });

  test('returns false for other elements', () => {
    expect(isInjectableElement({ tagName: 'DIV' })).toBe(false);
    expect(isInjectableElement({ tagName: 'SPAN' })).toBe(false);
    expect(isInjectableElement({ tagName: 'SELECT' })).toBe(false);
  });

  test('handles uppercase input type', () => {
    expect(isInjectableElement({ tagName: 'INPUT', type: 'TEXT' })).toBe(true);
    expect(isInjectableElement({ tagName: 'INPUT', type: 'EMAIL' })).toBe(true);
  });
});
