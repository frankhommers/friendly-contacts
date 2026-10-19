import { parseCard, serializeCard, serializeLine, VCardLine } from 'src/contacts/friendly/lines';
import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { needsLegacyRewrite } from 'src/contacts/friendly/patch';
import { RelationContext } from 'src/contacts/friendly/relations';
import { FriendlyValue, newCard, patch, toFriendly } from 'src/contacts/friendly/translate';
import { readVcfFixture } from 'tests/fixtures/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ctx: RelationContext = {
  uidToName: (uid) => (uid === 'sem-uid' ? 'Sem' : undefined),
  displayName: (uid) => (uid === 'sem-uid' ? 'Sem' : undefined),
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
    expect(texts(lines.slice(-6))).toEqual([
      'item3.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem',
      'item3.X-ABLabel:_$!<Child>!$_',
      'item4.X-ABRELATEDNAMES:Opa',
      'item4.X-ABLabel:_$!<Child>!$_',
      'item5.X-ABRELATEDNAMES:Jan',
      'item5.X-ABLabel:_$!<Child>!$_',
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
    expect(texts(result.lines)).toEqual(['VERSION:3.0', 'item1.RELATED;TYPE=spouse;VALUE=text;X-FRIENDLY-UID=sem-uid:Sem']);
    const added = run({ spouse: '[[Opa]]', 'spouse-2': '[[B]]', 'spouse-3': '[[C]]' }, lines);
    expect(texts(added.lines).slice(1)).toEqual([
      'item1.RELATED;TYPE=spouse;VALUE=text:Opa',
      'RELATED;TYPE=spouse;VALUE=text:B',
      'item2.X-ABRELATEDNAMES:C',
      'item2.X-ABLabel:_$!<Spouse>!$_',
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
    expect(texts(lines)).toEqual(['VERSION:3.0', 'FN:X', 'item1.X-ABRELATEDNAMES:Opa', 'item1.X-ABLabel:_$!<Spouse>!$_']);
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

  it('new 3.0 card uses the 3.0 forms', () => {
    const DATA = 'data:image/jpeg;base64,/9j/AAAA';
    const people: RelationContext = { ...ctx, displayName: (uid) => (uid === 'sem-uid' ? 'Sem de Vries' : undefined) };
    const props = { name: 'Anna', uid: 'anna', photo: DATA, birthday: '--03-15', anniversary: '2012-06-21', spouse: '[[Sem]]', friends: ['[[Opa]]'] };
    const { lines, warnings } = newCard(props, DEFAULT_MAPPING, people, '3.0');
    expect(texts(lines)).toEqual([
      'VERSION:3.0',
      'FN:Anna',
      'BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-15',
      'item1.X-ABDATE:2012-06-21',
      'item1.X-ABLabel:_$!<Anniversary>!$_',
      'PHOTO;ENCODING=b;TYPE=JPEG:/9j/AAAA',
      'UID:anna',
      'item2.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem de Vries',
      'item2.X-ABLabel:_$!<Spouse>!$_',
      'item3.X-ABRELATEDNAMES:Opa',
      'item3.X-ABLabel:_$!<Friend>!$_',
    ]);
    expect(warnings).toEqual([]);
    // Read back as the same note.
    const back = toFriendly(parseCard(serializeCard(lines)), DEFAULT_MAPPING, people).props;
    expect(back).toMatchObject({ birthday: '--03-15', anniversary: '2012-06-21', spouse: '[[Sem]]', friends: ['[[Opa]]'] });
  });

  it('a new card is vCard 4.0 unless asked otherwise', () => {
    expect(texts(newCard({ name: 'Anna', uid: 'a' }, DEFAULT_MAPPING, ctx).lines)[0]).toBe('VERSION:4.0');
    expect(texts(newCard({ name: 'Anna', uid: 'a' }, DEFAULT_MAPPING, ctx, '4.0').lines)[0]).toBe('VERSION:4.0');
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

describe('relationships and anniversaries in the card\'s own form', () => {
  const ODD = 'odd:uid;x,y';
  const people: RelationContext = {
    uidToName: (uid) => ({ 'sem-uid': 'Sem', [ODD]: 'Odd' } as Record<string, string>)[uid],
    displayName: (uid) => ({ 'sem-uid': 'Sem de Vries', [ODD]: 'Odd, Jr' } as Record<string, string>)[uid],
    resolveLink: (name) => {
      if (name === 'Sem' || name === 'People/Sem') return { uid: 'sem-uid' };
      if (name === 'Semmy') return { uid: 'urn:uuid:sem-uid' };
      if (name === 'Odd') return { uid: ODD };
      if (name === 'Jan') return { ambiguous: true };
      return { text: name };
    },
  };
  const read = (lines: VCardLine[]) => toFriendly(lines, DEFAULT_MAPPING, people);
  const go = (lines: VCardLine[], after: Record<string, FriendlyValue>, rewriteLegacyRelations = false) =>
    patch(lines, read(lines), after, DEFAULT_MAPPING, people, { rewriteLegacyRelations });
  const reparsed = (lines: VCardLine[]) => read(parseCard(serializeCard(lines))).props;
  const davx5 = parseCard(readVcfFixture('davx5V3.vcf'));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 17, 8, 5, 3)));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('3.0: a new relationship is X-ABRELATEDNAMES with its label, the display name and the hint', () => {
    const lines = card('FN:X', 'item1.X-FOO:1', 'item1.X-ABLabel:a');
    const result = go(lines, { name: 'X', children: ['[[People/Sem]]', '[[Opa]]'], neighbours: ['[[Odd]]'] });
    expect(texts(result.lines)).toEqual([
      'VERSION:3.0',
      'FN:X',
      'item1.X-FOO:1',
      'item1.X-ABLabel:a',
      'item2.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem de Vries',
      'item2.X-ABLabel:_$!<Child>!$_',
      'item3.X-ABRELATEDNAMES:Opa',
      'item3.X-ABLabel:_$!<Child>!$_',
      'item4.X-ABRELATEDNAMES;X-FRIENDLY-UID="odd:uid;x,y":Odd\\, Jr',
      'item4.X-ABLabel:Neighbor',
    ]);
    lines.forEach((line, i) => expect(result.lines[i]).toBe(line));
    expect(result.warnings).toEqual([]);
    // Read back, as parsed from the server and as the patched lines are (syncContact reads them unparsed).
    const expected = { name: 'X', children: ['[[Sem]]', '[[Opa]]'], neighbours: ['[[Odd]]'] };
    expect(reparsed(result.lines)).toEqual(expected);
    expect(read(result.lines).props).toEqual(expected);
  });

  it('the hint holds the clean UID', () => {
    const result = go(card('FN:X'), { name: 'X', spouse: '[[Semmy]]' });
    expect(texts(result.lines).slice(2)).toEqual([
      'item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem de Vries',
      'item1.X-ABLabel:_$!<Spouse>!$_',
    ]);
  });

  it('3.0: an ambiguous target is written as a name without a hint, with a warning', () => {
    const result = go(card('FN:X'), { name: 'X', friends: ['[[Jan]]'] });
    expect(texts(result.lines).slice(2)).toEqual(['item1.X-ABRELATEDNAMES:Jan', 'item1.X-ABLabel:_$!<Friend>!$_']);
    expect(result.warnings).toEqual([expect.stringContaining('"Jan" matches more than one contact')]);
  });

  it('new item numbers never collide with existing groups, whatever their case', () => {
    const lines = card('FN:X', 'Item1.TEL:1', 'ITEM4.EMAIL:a@b', 'item4.X-ABLabel:x', 'home.URL:u', 'item2.NOTE:n');
    const result = go(lines, { ...read(lines).props, friends: ['[[Opa]]'], anniversary: '2012-06-21' });
    expect(texts(result.lines).slice(lines.length)).toEqual([
      'item5.X-ABDATE:2012-06-21',
      'item5.X-ABLabel:_$!<Anniversary>!$_',
      'item6.X-ABRELATEDNAMES:Opa',
      'item6.X-ABLabel:_$!<Friend>!$_',
    ]);
  });

  it('4.0: a new relationship is RELATED with VALUE=text, the hint and the display name', () => {
    const lines = card4('FN:X');
    const result = go(lines, { name: 'X', children: ['[[Sem]]', '[[Jan]]'], colleagues: ['[[Odd]]'] });
    expect(texts(result.lines).slice(2)).toEqual([
      'RELATED;TYPE=child;VALUE=text;X-FRIENDLY-UID=sem-uid:Sem de Vries',
      'RELATED;TYPE=child;VALUE=text:Jan',
      'RELATED;TYPE=colleague;VALUE=text;X-FRIENDLY-UID="odd:uid;x,y":Odd\\, Jr',
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(reparsed(result.lines)).toEqual({ name: 'X', children: ['[[Sem]]', '[[Jan]]'], colleagues: ['[[Odd]]'] });
  });

  it('removing one relationship from a 3.0 card removes its line and its label only (review focus 3)', () => {
    const before = read(davx5);
    expect(before.props.parents).toEqual(['[[Ger Verhallen]]', '[[Truus Verhallen]]']);
    const result = go(davx5, { ...before.props, parents: ['[[Truus Verhallen]]'], children: [] });
    const gone = ['item1.X-ABRELATEDNAMES:Ger Verhallen', 'item1.X-ABLabel:_$!<Father>!$_'];
    const goneChild = ['item4.X-ABRELATEDNAMES:Lotte Hommers', 'item4.X-ABLabel:_$!<Child>!$_'];
    expect(texts(result.lines)).toEqual(
      texts(davx5)
        .filter((l) => !gone.includes(l) && !goneChild.includes(l))
        .map((l) => (l.startsWith('REV:') ? 'REV:20261017T080503Z' : l)),
    );
    for (const line of result.lines) if (line.name !== 'REV') expect(davx5).toContain(line);
  });

  it('replacing a 3.0 spouse writes into its own X-ABRELATEDNAMES line, keeping group and label', () => {
    const at = davx5.findIndex((l) => l.group === 'item3' && l.name === 'X-ABRELATEDNAMES');
    const props = read(davx5).props;
    expect(props.spouse).toBe('[[Sanne Hommers]]');

    const linked = go(davx5, { ...props, spouse: '[[Sem]]' });
    expect(serializeLine(linked.lines[at])).toBe('item3.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem de Vries');
    expect(linked.lines[at + 1]).toBe(davx5[at + 1]);
    expect(linked.lines).toHaveLength(davx5.length);
    expect(texts(linked.lines).join('\n')).not.toContain('urn:uuid');
    expect(reparsed(linked.lines).spouse).toBe('[[Sem]]');

    const named = go(davx5, { ...props, spouse: '[[Kim, de Wit]]' });
    expect(serializeLine(named.lines[at])).toBe('item3.X-ABRELATEDNAMES:Kim\\, de Wit');

    // A hinted line replaced by a name loses the hint.
    const hinted = card('FN:X', 'item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem de Vries', 'item1.X-ABLabel:_$!<Spouse>!$_');
    expect(read(hinted).props.spouse).toBe('[[Sem]]');
    const unhinted = go(hinted, { name: 'X', spouse: '[[Opa]]' });
    expect(texts(unhinted.lines)).toEqual(['VERSION:3.0', 'FN:X', 'item1.X-ABRELATEDNAMES:Opa', 'item1.X-ABLabel:_$!<Spouse>!$_']);
  });

  it('4.0: replacing a spouse edits its RELATED line in the text form', () => {
    const lines = card4('FN:X', 'item1.RELATED;TYPE=spouse;VALUE=text:Opa');
    const result = go(lines, { name: 'X', spouse: '[[Sem]]' });
    expect(texts(result.lines)).toEqual(['VERSION:4.0', 'FN:X', 'item1.RELATED;TYPE=spouse;VALUE=text;X-FRIENDLY-UID=sem-uid:Sem de Vries']);
    const back = go(result.lines, { name: 'X', spouse: '[[Opa]]' });
    expect(texts(back.lines)).toEqual(['VERSION:4.0', 'FN:X', 'item1.RELATED;TYPE=spouse;VALUE=text:Opa']);
  });

  it('removing a 3.0 spouse removes its line and label', () => {
    const result = go(davx5, { ...read(davx5).props, spouse: '' });
    expect(texts(result.lines).filter((l) => l.startsWith('item3.'))).toEqual([]);
    expect(result.lines).toHaveLength(davx5.length - 2);
  });

  it('3.0: a new anniversary is X-ABDATE with the Anniversary label; year-less in the Apple form', () => {
    const full = go(card('FN:X'), { name: 'X', anniversary: '2012-06-21' });
    expect(texts(full.lines).slice(2)).toEqual(['item1.X-ABDATE:2012-06-21', 'item1.X-ABLabel:_$!<Anniversary>!$_']);
    expect(reparsed(full.lines).anniversary).toBe('2012-06-21');
    expect(read(full.lines).props.anniversary).toBe('2012-06-21');
    const yearLess = go(card('FN:X'), { name: 'X', anniversary: '--06-21' });
    expect(texts(yearLess.lines).slice(2)).toEqual([
      'item1.X-ABDATE;X-APPLE-OMIT-YEAR=1604:1604-06-21',
      'item1.X-ABLabel:_$!<Anniversary>!$_',
    ]);
    expect(reparsed(yearLess.lines).anniversary).toBe('--06-21');
  });

  it('4.0: a new anniversary is ANNIVERSARY', () => {
    const result = go(card4('FN:X'), { name: 'X', anniversary: '2012-06-21' });
    expect(texts(result.lines).slice(2)).toEqual(['ANNIVERSARY:20120621']);
  });

  it('an X-ABDATE anniversary in 1604 without the apple param is year-less and stays as it is', () => {
    const lines = card('FN:X', 'item1.X-ABDATE:1604-06-21', 'item1.X-ABLabel:_$!<Anniversary>!$_');
    expect(read(lines).props.anniversary).toBe('--06-21');
    expect(go(lines, read(lines).props).lines).toEqual(lines);
    expect(go(lines, { ...read(lines).props, anniversary: '1604-06-21' }).lines).toEqual(lines);
    expect(texts(go(lines, { ...read(lines).props, anniversary: '--07-01' }).lines)[2]).toBe(
      'item1.X-ABDATE;X-APPLE-OMIT-YEAR=1604:1604-07-01',
    );
  });

  it('existing anniversary lines are edited in place, whatever their form', () => {
    const own = card('FN:X', 'ANNIVERSARY:2012-06-21');
    expect(texts(go(own, { name: 'X', anniversary: '2013-01-02' }).lines)).toEqual(['VERSION:3.0', 'FN:X', 'ANNIVERSARY:2013-01-02']);

    const props = read(davx5).props;
    expect(props.anniversary).toBe('2012-06-21');
    const at = davx5.findIndex((l) => l.name === 'X-ABDATE');
    const edited = go(davx5, { ...props, anniversary: '2013-06-21' });
    expect(serializeLine(edited.lines[at])).toBe('item8.X-ABDATE:2013-06-21');
    expect(edited.lines[at + 1]).toBe(davx5[at + 1]);

    const removed = go(davx5, { ...props, anniversary: '' });
    expect(texts(removed.lines).filter((l) => l.startsWith('item8.'))).toEqual([]);
  });

  describe('legacy rewrite', () => {
    const legacy = card(
      'FN:X',
      'item1.TEL:1',
      'item1.X-ABLabel:a',
      'RELATED;TYPE=child:urn:uuid:sem-uid',
      'RELATED;TYPE=friend;VALUE=text:Opa',
      'NOTE:n',
      'REV:old',
    );

    const needs = (lines: VCardLine[]) => needsLegacyRewrite(lines, DEFAULT_MAPPING, people);

    it('needsLegacyRewrite: a 3.0 card with RELATED lines the plugin wrote', () => {
      expect(needs(legacy)).toBe(true);
      expect(needs(parseCard('BEGIN:VCARD\r\nRELATED;TYPE=child:urn:uuid:sem-uid\r\nEND:VCARD'))).toBe(true);
      expect(needs(card4('FN:X', 'RELATED;TYPE=child:urn:uuid:sem-uid'))).toBe(false);
      expect(needs(davx5)).toBe(false);
      expect(needs(card('FN:X'))).toBe(false);
    });

    it('needsLegacyRewrite: only lines that can be rewritten count', () => {
      const stuck = card('FN:X', 'RELATED;TYPE=child:urn:uuid:nobody', 'RELATED;TYPE=agent;VALUE=text:Bond');
      expect(needs(stuck)).toBe(false);
    });

    it('a name that is a urn:uuid gets the contact\'s name and the hint, in the line\'s own form (3.0)', () => {
      const lines = card('FN:X', 'item1.X-ABRELATEDNAMES:urn:uuid:sem-uid', 'item1.X-ABLabel:_$!<Spouse>!$_', 'REV:old');
      expect(needs(lines)).toBe(true);
      const before = read(lines).props;
      expect(before).toEqual({ name: 'X', spouse: '[[Sem]]' });
      const result = go(lines, before, true);
      expect(texts(result.lines)).toEqual([
        'VERSION:3.0',
        'FN:X',
        'item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem de Vries',
        'item1.X-ABLabel:_$!<Spouse>!$_',
        'REV:20261017T080503Z',
      ]);
      expect(result.lines[3]).toBe(lines[3]);
      expect(reparsed(result.lines)).toEqual(before);
      expect(needs(parseCard(serializeCard(result.lines)))).toBe(false);
    });

    it('a name that is a urn:uuid gets the contact\'s name and the hint, in the line\'s own form (4.0)', () => {
      const lines = card4('FN:X', 'RELATED;TYPE=spouse;VALUE=text:urn:uuid:sem-uid');
      expect(needs(lines)).toBe(true);
      const result = go(lines, read(lines).props, true);
      expect(texts(result.lines)).toEqual(['VERSION:4.0', 'FN:X', 'RELATED;TYPE=spouse;VALUE=text;X-FRIENDLY-UID=sem-uid:Sem de Vries']);
      expect(reparsed(result.lines)).toEqual({ name: 'X', spouse: '[[Sem]]' });
      expect(needs(parseCard(serializeCard(result.lines)))).toBe(false);
    });

    it('a 3.0 RELATED text line holding a urn:uuid becomes the 3.0 form', () => {
      const lines = card('FN:X', 'RELATED;TYPE=child;VALUE=text:urn:uuid:sem-uid');
      expect(needs(lines)).toBe(true);
      expect(texts(go(lines, read(lines).props, true).lines).slice(2)).toEqual([
        'item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem de Vries',
        'item1.X-ABLabel:_$!<Child>!$_',
      ]);
    });

    it('a urn:uuid name nobody has stays as it is', () => {
      for (const lines of [
        card('FN:X', 'item1.X-ABRELATEDNAMES:urn:uuid:nobody', 'item1.X-ABLabel:_$!<Spouse>!$_'),
        card4('FN:X', 'RELATED;TYPE=spouse;VALUE=text:urn:uuid:nobody'),
      ]) {
        expect(needs(lines)).toBe(false);
        expect(go(lines, read(lines).props, true).lines).toEqual(lines);
      }
    });

    it('a hinted name the contact no longer has is refreshed (a renamed contact), on 3.0 and 4.0', () => {
      const v3 = card('FN:X', 'item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem', 'item1.X-ABLabel:_$!<Child>!$_');
      expect(needs(v3)).toBe(true);
      expect(texts(go(v3, read(v3).props, true).lines).slice(2)).toEqual([
        'item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem de Vries',
        'item1.X-ABLabel:_$!<Child>!$_',
      ]);
      const v4 = card4('FN:X', 'RELATED;TYPE=child;VALUE=text;X-FRIENDLY-UID=sem-uid:Sem');
      expect(needs(v4)).toBe(true);
      expect(texts(go(v4, read(v4).props, true).lines).slice(2)).toEqual([
        'RELATED;TYPE=child;VALUE=text;X-FRIENDLY-UID=sem-uid:Sem de Vries',
      ]);
      // The current name, or a hint nobody knows: nothing to do.
      expect(needs(card('FN:X', 'item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem de Vries', 'item1.X-ABLabel:_$!<Child>!$_'))).toBe(false);
      expect(needs(card4('FN:X', 'RELATED;TYPE=child;VALUE=text;X-FRIENDLY-UID=gone:Sem'))).toBe(false);
    });

    it('an old line pointed at an ambiguous name in this Apply still gets the 3.0 form', () => {
      const lines = card('FN:X', 'RELATED;TYPE=spouse:urn:uuid:sem-uid');
      const result = go(lines, { name: 'X', spouse: '[[Jan]]' }, true);
      expect(texts(result.lines).slice(2)).toEqual(['item1.X-ABRELATEDNAMES:Jan', 'item1.X-ABLabel:_$!<Spouse>!$_']);
    });

    it('lines another app wrote stay on a 3.0 card: plain text names, names without a URI scheme, several types', () => {
      const lines = card(
        'FN:X',
        'RELATED;TYPE=friend;VALUE=text:Opa',
        'RELATED;TYPE=spouse:Anna',
        'RELATED;TYPE=friend,colleague:urn:uuid:sem-uid',
        'RELATED;TYPE=friend,colleague;VALUE=text:urn:uuid:sem-uid',
      );
      expect(needs(lines)).toBe(false);
      expect(go(lines, read(lines).props, true).lines).toEqual(lines);
    });

    it('turns the plugin\'s RELATED lines on a 3.0 card into the 3.0 form for the same row and person (review focus 5)', () => {
      const before = read(legacy);
      const result = go(legacy, before.props, true);
      expect(texts(result.lines)).toEqual([
        'VERSION:3.0',
        'FN:X',
        'item1.TEL:1',
        'item1.X-ABLabel:a',
        'item2.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem de Vries',
        'item2.X-ABLabel:_$!<Child>!$_',
        // Another app's text name stays as it is.
        'RELATED;TYPE=friend;VALUE=text:Opa',
        'NOTE:n',
        'REV:20261017T080503Z',
      ]);
      for (const i of [0, 1, 2, 3, 5, 6]) expect(result.lines.indexOf(legacy[i])).toBeGreaterThanOrEqual(0);
      expect(reparsed(result.lines)).toEqual(before.props);
      expect(read(result.lines).props).toEqual(before.props);
      expect(needs(parseCard(serializeCard(result.lines)))).toBe(false);
    });

    it('without the option the RELATED lines stay', () => {
      const result = go(legacy, read(legacy).props);
      expect(result.lines).toEqual(legacy);
    });

    it('a 4.0 card is not rewritten', () => {
      const lines = card4('FN:X', 'RELATED;TYPE=child:urn:uuid:sem-uid');
      expect(go(lines, read(lines).props, true).lines).toEqual(lines);
    });

    it('keeps the hint, drops the old group and its label, and rewrites edited lines with their new person', () => {
      const lines = card(
        'FN:X',
        'item1.RELATED;TYPE=spouse:urn:uuid:sem-uid',
        'item1.X-ABLabel:old',
        'RELATED;TYPE=friend;VALUE=text;X-FRIENDLY-UID=gone-uid:Piet',
        'RELATED;TYPE=child;VALUE=text:Opa',
      );
      const before = read(lines).props;
      expect(before).toEqual({ name: 'X', spouse: '[[Sem]]', friends: ['[[Piet]]'], children: ['[[Opa]]'] });
      const result = go(lines, { ...before, spouse: '[[Odd]]', children: [] }, true);
      expect(texts(result.lines)).toEqual([
        'VERSION:3.0',
        'FN:X',
        'item2.X-ABRELATEDNAMES;X-FRIENDLY-UID="odd:uid;x,y":Odd\\, Jr',
        'item2.X-ABLabel:_$!<Spouse>!$_',
        'item3.X-ABRELATEDNAMES;X-FRIENDLY-UID=gone-uid:Piet',
        'item3.X-ABLabel:_$!<Friend>!$_',
      ]);
      expect(reparsed(result.lines)).toEqual({ name: 'X', spouse: '[[Odd]]', friends: ['[[Piet]]'] });
    });

    it('a text RELATED line with a hint that names a contact is written with the contact\'s current name', () => {
      const lines = card('FN:X', 'RELATED;TYPE=child;VALUE=text;X-FRIENDLY-UID=sem-uid:Old Name');
      const result = go(lines, read(lines).props, true);
      expect(texts(result.lines)).toContain('item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem de Vries');
      // A hint nobody knows keeps the text.
      const gone = card('FN:X', 'RELATED;TYPE=child;VALUE=text;X-FRIENDLY-UID=gone-uid:Old Name');
      expect(texts(go(gone, read(gone).props, true).lines)).toContain('item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=gone-uid:Old Name');
    });

    it('leaves RELATED lines it cannot name or map', () => {
      const lines = card('FN:X', 'RELATED;TYPE=child:urn:uuid:nobody', 'RELATED;TYPE=agent;VALUE=text:Bond');
      expect(go(lines, read(lines).props, true).lines).toEqual(lines);
    });
  });
});
