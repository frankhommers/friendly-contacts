import { parseCard, serializeLine, VCardLine } from 'src/contacts/friendly/lines';
import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { RelationContext } from 'src/contacts/friendly/relations';
import { FriendlyValue, newCard, patch, toFriendly } from 'src/contacts/friendly/translate';
import { readVcfFixture } from 'tests/fixtures/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ctx: RelationContext = {
  uidToName: (uid) => (uid === 'sem-uid' ? 'Sem' : undefined),
  resolveLink: (name) => {
    if (name === 'Sem') return { uid: 'sem-uid' };
    if (name === 'Jan') return { ambiguous: true };
    return { text: name };
  },
};
const base = parseCard(readVcfFixture('appleV3.vcf'));
const before = toFriendly(base, DEFAULT_MAPPING, ctx);
const card = (...body: string[]) => parseCard(['BEGIN:VCARD', 'VERSION:3.0', ...body, 'END:VCARD'].join('\r\n'));

const run = (after: Record<string, FriendlyValue>, lines: VCardLine[] = base) =>
  patch(lines, toFriendly(lines, DEFAULT_MAPPING, ctx), after, DEFAULT_MAPPING, ctx);
const texts = (lines: VCardLine[]) => lines.map(serializeLine);
const without = (key: string): Record<string, FriendlyValue> => {
  const props = { ...before.props };
  delete props[key];
  return props;
};

describe('patch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 17, 8, 5, 3)));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('no changes returns identical lines', () => {
    const result = patch(base, before, before.props, DEFAULT_MAPPING, ctx);
    expect(result.lines).toEqual(base);
    expect(result.warnings).toEqual([]);
  });

  it('treats reordered or re-spaced lists and trimmed text as unchanged', () => {
    const lines = card('CATEGORIES:a,b', 'RELATED;TYPE=child;VALUE=text:Opa', 'RELATED;TYPE=child;VALUE=text:Oma', 'REV:x');
    const result = run({ categories: [' b', 'a '], children: ['[[Oma]]', '[[Opa|grandpa]]'] }, lines);
    expect(result.lines).toEqual(lines);
  });

  it('untouched birthday line is identical', () => {
    const { lines } = run({ ...before.props, mobile: '06-99999999' });
    const bday = base.find((l) => l.name === 'BDAY');
    expect(lines.find((l) => l.name === 'BDAY')).toBe(bday);
    expect(lines.filter((l) => l.raw === undefined).map((l) => l.name).sort()).toEqual(['REV', 'TEL']);
  });

  it('edit keeps group and params', () => {
    const { lines } = run({ ...before.props, mobile: '06-99999999' });
    const tel = lines.find((l) => l.group === 'item1' && l.name === 'TEL')!;
    expect(tel.raw).toBeUndefined();
    expect(tel.params).toEqual([
      ['TYPE', 'CELL'],
      ['TYPE', 'VOICE'],
      ['TYPE', 'pref'],
    ]);
    // Param names are normalised to upper case by the line model (case-insensitive per RFC 6350).
    expect(serializeLine(tel)).toBe('item1.TEL;TYPE=CELL;TYPE=VOICE;TYPE=pref:06-99999999');
    const label = (ls: VCardLine[]) => ls.find((l) => l.group === 'item1' && l.name === 'X-ABLABEL');
    expect(label(lines)).toBe(label(base));
  });

  it('re-escapes edited values', () => {
    const { lines } = run({ ...before.props, company: 'Smit, Zn' });
    expect(lines.find((l) => l.name === 'ORG')!.value).toBe('Smit\\, Zn;');
  });

  it('delete removes line and its label', () => {
    const { lines } = run(without('website'));
    expect(lines.some((l) => l.group === 'item2' && l.name === 'URL')).toBe(false);
    expect(lines.some((l) => l.group === 'item2' && l.name === 'X-ABLABEL')).toBe(false);
    expect(lines.some((l) => l.group === 'item1' && l.name === 'X-ABLABEL')).toBe(true);
    expect(lines).toHaveLength(base.length - 2);
  });

  it('emptying a value deletes its line', () => {
    const { lines } = run({ ...before.props, title: '  ' });
    expect(lines.some((l) => l.name === 'TITLE')).toBe(false);
  });

  it('delete component', () => {
    const { lines } = run({ ...before.props, 'work-street': '' });
    const work = lines.find((l) => l.name === 'ADR' && l.params.some(([, v]) => v === 'WORK'))!;
    expect(work.value).toBe(';;;Utrecht;;3542 AA;');
    expect(serializeLine(work)).toBe('ADR;TYPE=WORK:;;;Utrecht;;3542 AA;');
  });

  it('deletes a structured line once all components are empty, except N', () => {
    const lines = card('N:Smit;Anna;;;', 'ADR;TYPE=WORK:;;Weg 1;Ede;;;');
    const result = run({ 'work-city': '' }, lines);
    expect(texts(result.lines)).toEqual(['VERSION:3.0', 'N:;;;;']);
  });

  it('add uses write key', () => {
    const { lines } = run({ ...before.props, 'mobile-2': '06-1' });
    expect(serializeLine(lines[lines.length - 1])).toBe('TEL;TYPE=CELL:06-1');
  });

  it('add address', () => {
    const noWork = base.filter((l) => !(l.name === 'ADR' && l.params.some(([, v]) => v === 'WORK')));
    const props = toFriendly(noWork, DEFAULT_MAPPING, ctx).props;
    const { lines } = run({ ...props, 'work-city': 'Amersfoort' }, noWork);
    expect(serializeLine(lines[lines.length - 1])).toBe('ADR;TYPE=WORK:;;;Amersfoort;;;');
  });

  it('adds several components of one row group to one new line', () => {
    const { lines } = run({ name: 'X', 'work-city': 'Ede', 'work-street': 'Weg 1' }, card('FN:X'));
    expect(texts(lines)).toEqual(['VERSION:3.0', 'FN:X', 'ADR;TYPE=WORK:;;Weg 1;Ede;;;']);
  });

  it('adds a component to the existing line when it was empty', () => {
    const lines = card('ADR;TYPE=HOME:;;Weg 1;;;;');
    const result = run({ street: 'Weg 1', city: 'Ede' }, lines);
    expect(texts(result.lines)).toEqual(['VERSION:3.0', 'ADR;TYPE=HOME:;;Weg 1;Ede;;;']);
  });

  it('rewrites categories', () => {
    const result = run({ categories: ['a, b', 'c'] }, card('CATEGORIES:x'));
    expect(texts(result.lines)).toEqual(['VERSION:3.0', 'CATEGORIES:a\\, b,c']);
  });

  it('relations add/remove', () => {
    const { lines, warnings } = run({ ...before.props, children: ['[[Sem]]', '[[Opa]]', '[[Jan]]'] });
    expect(texts(lines.slice(-3))).toEqual([
      'RELATED;TYPE=child:urn:uuid:sem-uid',
      'RELATED;TYPE=child;VALUE=text:Opa',
      'RELATED;TYPE=child;VALUE=text:Jan',
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Jan');

    const related = card('FN:X', 'RELATED;TYPE=child;VALUE=text:Opa', 'RELATED;TYPE=child:urn:uuid:sem-uid');
    const removed = run({ name: 'X', children: ['[[Sem]]'] }, related);
    expect(texts(removed.lines)).toEqual(['VERSION:3.0', 'FN:X', 'RELATED;TYPE=child:urn:uuid:sem-uid']);
  });

  it('spouse is single text and spouse-2 its own line', () => {
    const lines = card('item1.RELATED;TYPE=spouse;VALUE=text:Opa', 'RELATED;TYPE=spouse;VALUE=text:B');
    const result = run({ spouse: '[[Sem]]' }, lines);
    expect(texts(result.lines)).toEqual(['VERSION:3.0', 'item1.RELATED;TYPE=spouse:urn:uuid:sem-uid']);
    const added = run({ spouse: '[[Opa]]', 'spouse-2': '[[B]]', 'spouse-3': '[[C]]' }, lines);
    expect(texts(added.lines).slice(1)).toEqual([
      'item1.RELATED;TYPE=spouse;VALUE=text:Opa',
      'RELATED;TYPE=spouse;VALUE=text:B',
      'RELATED;TYPE=spouse;VALUE=text:C',
    ]);
  });

  it('local-only properties are ignored', () => {
    const { lines } = run({ ...before.props, 'met-via': '[[Piet]]' });
    expect(lines).toEqual(base);
  });

  it('bumps REV when something changed', () => {
    const { lines } = run({ ...before.props, title: 'Chef' });
    expect(serializeLine(lines.find((l) => l.name === 'REV')!)).toBe('REV:20261017T080503Z');
  });
});

describe('newCard', () => {
  it('builds a card from properties', () => {
    const lines = texts(newCard({ firstname: 'Anna', lastname: 'Smit', mobile: '06' }, DEFAULT_MAPPING, ctx));
    expect(lines[0]).toBe('VERSION:4.0');
    expect(lines.some((l) => /^UID:urn:uuid:[0-9a-f-]{36}$/.test(l))).toBe(true);
    expect(lines).toContain('FN:Anna Smit');
    expect(lines).toContain('N:Smit;Anna;;;');
    expect(lines).toContain('TEL;TYPE=CELL:06');
  });

  it('keeps a given uid and name', () => {
    const lines = texts(newCard({ uid: 'abc', name: 'Anna' }, DEFAULT_MAPPING, ctx));
    expect(lines).toEqual(['VERSION:4.0', 'FN:Anna', 'UID:abc']);
  });
});
