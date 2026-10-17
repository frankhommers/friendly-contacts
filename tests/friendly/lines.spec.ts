import {
  escapeText,
  getParam,
  matchTypes,
  parseCard,
  serializeCard,
  serializeLine,
  splitStructured,
  joinStructured,
  typesOf,
  unescapeText,
} from 'src/contacts/friendly/lines';
import { readVcfFixture } from 'tests/fixtures/fixtures';
import { describe, expect, it } from 'vitest';

const fixture = readVcfFixture('appleV3.vcf');

describe('friendly lines', () => {
  it('parses groups, repeated types and params', () => {
    const lines = parseCard(fixture);
    const tel = lines.find((l) => l.name === 'TEL')!;
    expect(tel.group).toBe('item1');
    expect(tel.name).toBe('TEL');
    expect(typesOf(tel)).toEqual(['CELL', 'VOICE', 'PREF']);
    expect(matchTypes(tel)).toEqual(['CELL']);
    expect(getParam(tel, 'type')).toBe('CELL');
    expect(getParam(tel, 'nope')).toBeUndefined();
  });

  it('keeps unknown properties', () => {
    const names = parseCard(fixture).map((l) => l.name);
    expect(names).toEqual(expect.arrayContaining(['PRODID', 'X-CREATED', 'X-ABLABEL', 'REV']));
    expect(names).not.toContain('BEGIN');
    expect(names).not.toContain('END');
  });

  it('unfolds folded lines', () => {
    const photo = parseCard(fixture).find((l) => l.name === 'PHOTO')!;
    expect(photo.value).not.toMatch(/[\r\n]/);
    expect(photo.value.startsWith('/9j/')).toBe(true);
    expect(photo.value.endsWith('aG9w')).toBe(true);
  });

  it('round trips', () => {
    const parsed = parseCard(fixture);
    expect(parseCard(serializeCard(parsed))).toEqual(parsed);
    const unfolded = fixture.replace(/\r?\n[ \t]/g, '');
    // names and param names are normalised to upper case, so compare case-insensitively
    for (const line of parsed) expect(unfolded.toUpperCase()).toContain(serializeLine(line).toUpperCase());
  });

  it('unescapes and escapes text', () => {
    expect(unescapeText('Bakker\\, Zonen')).toBe('Bakker, Zonen');
    expect(unescapeText('a\\nb\\Nc\\;d\\\\e')).toBe('a\nb\nc;d\\e');
    expect(escapeText('a,b;c\nd\\')).toBe('a\\,b\\;c\\nd\\\\');
    expect(splitStructured(';;Industrieweg 9\\;unit 3;Utrecht;;3542 AA;')[2]).toBe('Industrieweg 9\\;unit 3');
    expect(joinStructured(['a', 'b\\;c', ''])).toBe('a;b\\;c;');
  });

  it('bare 2.1 params become TYPE', () => {
    expect(parseCard('BEGIN:VCARD\nTEL;CELL:1\nEND:VCARD')[0].params).toEqual([['TYPE', 'CELL']]);
  });

  it('quoted colon in param', () => {
    const [line] = parseCard('BEGIN:VCARD\nX-FOO;LABEL="a:b":val\nEND:VCARD');
    expect(line.value).toBe('val');
    expect(line.params).toEqual([['LABEL', '"a:b"']]);
  });

  it('folds long lines at 75 octets', () => {
    const value = 'é'.repeat(100);
    const out = serializeCard([{ name: 'NOTE', params: [], value }]);
    const physical = out.split('\r\n').filter((l) => l !== '');
    for (const p of physical) expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(75);
    expect(physical.length).toBeGreaterThan(3);
    expect(parseCard(out)[0].value).toBe(value);
    expect(out.startsWith('BEGIN:VCARD\r\n')).toBe(true);
    expect(out.endsWith('END:VCARD\r\n')).toBe(true);
  });
});
