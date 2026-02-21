# Buglin

A Chrome extension to support the exploratory testing of web forms.

1. **Autofill Detection** - Highlights form fields at risk of triggering browser autofill
2. **Test Data Injection** - Right-click context menu to fill fields with test payloads
3. **Word Scanner** - Scans page content for forbidden words and highlights them

https://github.com/user-attachments/assets/85985732-6db1-4510-9c19-8e308aaa1dcd

## Installation

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this folder

## Autofill Detection

Scans pages for form fields and highlights them based on autofill risk:

| Risk | Color | Meaning |
|------|-------|---------|
| **High** | Red | Will trigger autofill (email/tel types, autocomplete attributes) |
| **Medium** | Orange | May trigger form history (name attribute without autocomplete="off") |
| **Low** | Green | Minimal risk |

Hover over the badge for detailed analysis. To prevent autofill, add `autocomplete="off"` or `autocomplete="one-time-code"` to the field.

## Test Data Injection

Right-click any text input to access test payloads by category (Emails, SQL, XSS, Unicode, Addresses, etc.). Modes:

- **Inject** - Replace field value (default)
- **Append** - Add to existing value
- **Copy** - Copy to clipboard

Last 5 used payloads appear at the top for quick access.

## Word Scanner

Scans page text for forbidden words and highlights matches. Pre-configured with: `todo`, `fixme`, `lorem`, `ipsum`, `placeholder`, `tbd`, `example.com`. Customize the word list via the extension popup.

Matches whole words only (case-insensitive) and rescans when page content changes dynamically.

## Acknowledgements

- Inspired by [BugMagnet](https://github.com/gojko/bugmagnet)
- Built with [Claude Code](https://claude.ai/claude-code)
