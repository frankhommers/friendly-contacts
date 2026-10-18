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
const card4 = (...body: string[]) => parseCard(['BEGIN:VCARD', 'VERSION:4.0', ...body, 'END:VCARD'].join('\r\n'));

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

  it('hand-typed basic form on an apple line is unchanged', () => {
    const { lines } = run({ ...before.props, birthday: '--0312' });
    expect(lines.find((l) => l.name === 'BDAY')).toBe(base.find((l) => l.name === 'BDAY'));
  });

  it('changing a year-less apple birthday keeps the apple form', () => {
    const { lines } = run({ ...before.props, birthday: '--04-01' });
    expect(texts(lines)).toContain('BDAY;X-APPLE-OMIT-YEAR=1604:1604-04-01');
  });

  it('adding a year drops the apple param', () => {
    const { lines } = run({ ...before.props, birthday: '1984-03-12' });
    expect(texts(lines)).toContain('BDAY:1984-03-12');
  });

  it('clearing a date removes the line', () => {
    const { lines } = run({ ...before.props, birthday: '' });
    expect(lines.some((l) => l.name === 'BDAY')).toBe(false);
    expect(run(without('birthday')).lines.some((l) => l.name === 'BDAY')).toBe(false);
  });

  it('a legacy apple placeholder date leaves the apple line identical', () => {
    const { lines } = run({ ...before.props, birthday: '1604-03-12' });
    expect(lines.find((l) => l.name === 'BDAY')).toBe(base.find((l) => l.name === 'BDAY'));
  });

  it('a same-date edit on a raw line with lowercase or quoted params keeps the identical line', () => {
    const lines = card('bday;x-foo="a b";x-apple-omit-year=1604:1604-03-12', 'item1.anniversary;x-bar=y:19800315');
    const friendly = toFriendly(lines, DEFAULT_MAPPING, ctx);
    expect(friendly.props).toEqual({ birthday: '--03-12', anniversary: '1980-03-15' });
    const result = run({ birthday: '1604-03-12', anniversary: '19800315' }, lines);
    expect(result.lines).toEqual(lines);
    expect(result.lines[1]).toBe(lines[1]);
    expect(result.lines[2]).toBe(lines[2]);
  });

  it('a 4.0 card edits an existing year-less line as --MMDD', () => {
    const lines = card4('BDAY:--0315');
    const { lines: out } = run({ birthday: '--04-01' }, lines);
    expect(texts(out)).toContain('BDAY:--0401');
  });

  it('a non-date on a 4.0 card gets a single VALUE=text', () => {
    const lines = card4('BDAY;VALUE=DATE-TIME:19890612T143000Z', 'ANNIVERSARY;VALUE=TEXT:once');
    const { lines: out } = run({ birthday: 'spring', anniversary: 'twice' }, lines);
    expect(texts(out)).toContain('BDAY;VALUE=text:spring');
    expect(texts(out)).toContain('ANNIVERSARY;VALUE=text:twice');
  });

  it('a date written over VALUE=DATE-TIME drops the VALUE param', () => {
    // As the date-time line of tests/fixtures/hasDifferentDates.vcf (a TYPE would keep it from the birthday row).
    const lines = card('BDAY;X-FOO=bar;VALUE=DATE-TIME:19890612T143000Z');
    expect(toFriendly(lines, DEFAULT_MAPPING, ctx).props.birthday).toBe('19890612T143000Z');
    const { lines: out } = run({ birthday: '1989-06-12' }, lines);
    expect(texts(out)).toContain('BDAY;X-FOO=bar:1989-06-12');
  });

  it('new card writes year-less as --MMDD', () => {
    const { lines } = newCard({ name: 'X', birthday: '--03-15' }, DEFAULT_MAPPING, ctx);
    expect(texts(lines)).toContain('BDAY:--0315');
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

  it('removing uid keeps the UID line', () => {
    const uid = base.find((l) => l.name === 'UID');
    const result = run(without('uid'));
    expect(result.lines.find((l) => l.name === 'UID')).toBe(uid);
    expect(result.lines).toEqual(base);
    expect(run({ ...before.props, uid: '' }).lines.find((l) => l.name === 'UID')).toBe(uid);
  });

  it('emptying name derives FN from first and last name', () => {
    const { lines } = run({ ...before.props, name: '', firstname: 'Johan' });
    expect(texts(lines.filter((l) => l.name === 'FN'))).toEqual(['FN:Johan de Vries']);
    expect(texts(run(without('name')).lines.filter((l) => l.name === 'FN'))).toEqual(['FN:Jan de Vries']);
  });

  it('emptying name without first/last keeps FN', () => {
    const lines = card('FN:Jan');
    const result = run({ name: ' ' }, lines);
    expect(result.lines).toEqual(lines);
    expect(result.lines[1]).toBe(lines[1]);
  });

  it('uses the first item of a list given for spouse', () => {
    const { lines, warnings } = run({ name: 'X', spouse: ['[[Opa]]', '[[Oma]]'] }, card('FN:X'));
    expect(texts(lines)).toEqual(['VERSION:3.0', 'FN:X', 'RELATED;TYPE=spouse;VALUE=text:Opa']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('spouse');
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
    const lines = texts(newCard({ firstname: 'Anna', lastname: 'Smit', mobile: '06' }, DEFAULT_MAPPING, ctx).lines);
    expect(lines[0]).toBe('VERSION:4.0');
    expect(lines.some((l) => /^UID:urn:uuid:[0-9a-f-]{36}$/.test(l))).toBe(true);
    expect(lines).toContain('FN:Anna Smit');
    expect(lines).toContain('N:Smit;Anna;;;');
    expect(lines).toContain('TEL;TYPE=CELL:06');
  });

  it('keeps a given uid and name', () => {
    const lines = texts(newCard({ uid: 'abc', name: 'Anna' }, DEFAULT_MAPPING, ctx).lines);
    expect(lines).toEqual(['VERSION:4.0', 'FN:Anna', 'UID:abc']);
  });

  it('returns relation warnings', () => {
    const { lines, warnings } = newCard({ name: 'Anna', children: ['[[Jan]]'] }, DEFAULT_MAPPING, ctx);
    expect(texts(lines)).toContain('RELATED;TYPE=child;VALUE=text:Jan');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Jan');
  });
});

describe('patch PHOTO values', () => {
  const B64 = 'AAAA BBBB\nCCCC';
  const DATA = `data:image/png;base64,${B64}`;
  const v4 = (...body: string[]) => parseCard(['BEGIN:VCARD', 'VERSION:4.0', ...body, 'END:VCARD'].join('\r\n'));
  const photoLines = (lines: VCardLine[]) => texts(lines).filter((l) => /^(\w+\.)?PHOTO[;:]/.test(l));
  const withPhoto = (lines: VCardLine[], photo: string) => ({ ...toFriendly(lines, DEFAULT_MAPPING, ctx).props, photo });

  it('a data URI on a 3.0 card becomes ENCODING=b with the subtype; group kept, other params dropped', () => {
    const lines = card('FN:Jan', 'item3.PHOTO;ENCODING=b;TYPE=JPEG;X-ABCROP-RECTANGLE=x:/9j/old');
    expect(photoLines(run(withPhoto(lines, DATA), lines).lines)).toEqual(['item3.PHOTO;ENCODING=b;TYPE=PNG:AAAABBBBCCCC']);
    const added = card('FN:Jan');
    expect(photoLines(run(withPhoto(added, DATA), added).lines)).toEqual(['PHOTO;ENCODING=b;TYPE=PNG:AAAABBBBCCCC']);
  });

  it('a data URI on a 4.0 card is written as a data URI', () => {
    const lines = v4('FN:Jan', 'PHOTO;MEDIATYPE=image/jpeg:http://old.example/a.jpg');
    expect(photoLines(run(withPhoto(lines, DATA), lines).lines)).toEqual(['PHOTO:data:image/png;base64,AAAABBBBCCCC']);
    expect(photoLines(newCard({ name: 'Jan', photo: DATA }, DEFAULT_MAPPING, ctx).lines)).toEqual([
      'PHOTO:data:image/png;base64,AAAABBBBCCCC',
    ]);
  });

  it('a URL on a 3.0 card is written with VALUE=uri', () => {
    const lines = card('FN:Jan', 'PHOTO;ENCODING=b;TYPE=JPEG:/9j/old');
    expect(photoLines(run(withPhoto(lines, 'https://x.example/p.jpg'), lines).lines)).toEqual([
      'PHOTO;VALUE=uri:https://x.example/p.jpg',
    ]);
  });

  it('a URL on a 4.0 card is written as is', () => {
    const lines = v4('FN:Jan', 'PHOTO;ENCODING=b;TYPE=JPEG:/9j/old');
    expect(photoLines(run(withPhoto(lines, 'http://x.example/p.jpg'), lines).lines)).toEqual(['PHOTO:http://x.example/p.jpg']);
    expect(photoLines(newCard({ name: 'Jan', photo: 'https://x.example/p.jpg' }, DEFAULT_MAPPING, ctx).lines)).toEqual([
      'PHOTO:https://x.example/p.jpg',
    ]);
  });
});
