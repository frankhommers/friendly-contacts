import {
  escapeText,
  getParam,
  matchTypes,
  parseCard,
  serializeCard,
  serializeLine,
  splitParts,
  splitStructured,
  joinStructured,
  typesOf,
  unescapeText,
} from 'src/contacts/friendly/lines';
import { DEFAULT_MAPPING, rowForLine } from 'src/contacts/friendly/mapping';
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
    for (const line of parsed) expect(unfolded).toContain(serializeLine(line));
  });

  it('keeps lines without a colon (2.1 quoted-printable continuations) in place', () => {
    const card = [
      'BEGIN:VCARD',
      'VERSION:2.1',
      'NOTE;ENCODING=QUOTED-PRINTABLE:first line=0D=0A=',
      'second line',
      'FN:Jan',
      'END:VCARD',
      '',
    ].join('\r\n');
    const lines = parseCard(card);
    expect(lines[2]).toEqual({ name: '', params: [], value: '', raw: 'second line' });
    expect(lines.map(serializeLine)).toEqual(['VERSION:2.1', 'NOTE;ENCODING=QUOTED-PRINTABLE:first line=0D=0A=', 'second line', 'FN:Jan']);
    expect(serializeCard(lines)).toBe(card);
    expect(rowForLine(lines[2], DEFAULT_MAPPING)).toEqual([]);
  });

  it('serialises lines without raw from their parts', () => {
    expect(serializeLine({ group: 'item1', name: 'TEL', params: [['TYPE', 'CELL']], value: '06' })).toBe(
      'item1.TEL;TYPE=CELL:06',
    );
    const parsed = parseCard('BEGIN:VCARD\nitem1.tel;type=cell:06\nEND:VCARD')[0];
    expect(serializeLine(parsed)).toBe('item1.tel;type=cell:06');
    const { raw: _raw, ...edited } = parsed;
    expect(serializeLine(edited)).toBe('item1.TEL;TYPE=cell:06');
  });

  it('unescapes and escapes text', () => {
    expect(unescapeText('Bakker\\, Zonen')).toBe('Bakker, Zonen');
    expect(unescapeText('a\\nb\\Nc\\;d\\\\e')).toBe('a\nb\nc;d\\e');
    expect(escapeText('a,b;c\nd\\')).toBe('a\\,b\\;c\\nd\\\\');
    expect(splitStructured(';;Industrieweg 9\\;unit 3;Utrecht;;3542 AA;')[2]).toBe('Industrieweg 9\\;unit 3');
    expect(joinStructured(['a', 'b\\;c', ''])).toBe('a;b\\;c;');
  });

  it('splitParts reads a value a server flattened: escaped ; separate the parts when there is no unescaped ;', () => {
    const raw = String.raw;
    expect(splitParts(raw`O\;non-binair`)).toEqual(['O', 'non-binair']);
    expect(splitParts('O;non-binair')).toEqual(['O', 'non-binair']);
    expect(splitParts(raw`A\;B;Sales`)).toEqual([raw`A\;B`, 'Sales']);
    expect(splitParts('M')).toEqual(['M']);
    expect(splitParts(raw`a\,b\\c\;d`)).toEqual([raw`a\,b\\c`, 'd']);
    expect(splitParts(raw`a\\`)).toEqual([raw`a\\`]);
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
