/**
 * Minimal YAML frontmatter writer for flat text and text-list values.
 *
 * Anything YAML could read as something other than the same text (numbers, booleans, null, dates)
 * or that holds YAML syntax is double-quoted, so `0612345678` stays a string and `[[Sem]]` stays a link.
 */

export type FrontmatterValue = string | string[];

const RESERVED = /^(true|false|yes|no|on|off|y|n|null|~|[-+]?\.(inf|nan))$/i;
/** Numbers, dates, times, hex and the like all start with a digit, optionally after a sign or dot. */
const NUMERIC_START = /^[-+.]?\d/;
/** YAML indicators that change meaning at the start of a plain scalar. */
const INDICATOR_START = /^[-?,&*!|>%@`{}]/;
const SPECIAL = /[:#[\]{}"'\\\u0000-\u001f\u007f]/;

function needsQuotes(value: string): boolean {
  return (
    value === '' ||
    value !== value.trim() ||
    RESERVED.test(value) ||
    NUMERIC_START.test(value) ||
    INDICATOR_START.test(value) ||
    SPECIAL.test(value)
  );
}

function quote(value: string): string {
  const escaped = value.replace(/[\\"\u0000-\u001f\u007f]/g, (c) => {
    switch (c) {
      case '\\':
        return '\\\\';
      case '"':
        return '\\"';
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      default:
        return `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`;
    }
  });
  return `"${escaped}"`;
}

export function yamlScalar(value: string): string {
  return needsQuotes(value) ? quote(value) : value;
}

/** `---` block with one `key: value` per entry; lists as `  - item` lines. */
export function renderFrontmatter(entries: [string, FrontmatterValue][]): string {
  const lines: string[] = ['---'];
  for (const [key, value] of entries) {
    const name = yamlScalar(key);
    if (!Array.isArray(value)) lines.push(`${name}: ${yamlScalar(value)}`);
    else if (value.length === 0) lines.push(`${name}: []`);
    else lines.push(`${name}:`, ...value.map((item) => `  - ${yamlScalar(item)}`));
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}
