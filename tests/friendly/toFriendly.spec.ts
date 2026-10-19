import { parseCard, serializeCard } from 'src/contacts/friendly/lines';
import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { linkTarget, RelationContext, toLink } from 'src/contacts/friendly/relations';
import { patch, toFriendly } from 'src/contacts/friendly/translate';
import { readVcfFixture } from 'tests/fixtures/fixtures';
import { describe, expect, it } from 'vitest';

const ctx: RelationContext = {
  uidToName: (uid) => (uid === 'anna-uid' ? 'Anna de Vries' : undefined),
  displayName: (uid) => (uid === 'anna-uid' ? 'Anna de Vries' : undefined),
  resolveLink: () => ({ text: '' }),
};
const lines = parseCard(readVcfFixture('appleV3.vcf'));
const translate = (text: string) => toFriendly(parseCard(text), DEFAULT_MAPPING, ctx);
const card = (...body: string[]) => ['BEGIN:VCARD', 'VERSION:3.0', ...body, 'END:VCARD'].join('\r\n');

describe('toFriendly', () => {
  it('maps the apple fixture', () => {
    const photo = lines.find((l) => l.name === 'PHOTO')!.value;
    expect(toFriendly(lines, DEFAULT_MAPPING, ctx).props).toEqual({
      name: 'Jan de Vries',
      firstname: 'Jan',
      lastname: 'de Vries',
      company: 'Bakker, Zonen',
      title: 'Baker',
      mobile: '06-12345678',
      'work-phone': '030-1234567',
      email: 'jan@example.nl',
      'email-2': 'jan2@example.nl',
      'work-email': 'jan@bakker.nl',
      website: 'https://jan.example.nl',
      street: 'Dorpsstraat 1',
      city: 'Utrecht',
      postcode: '1234 AB',
      country: 'Nederland',
      'work-street': 'Industrieweg 9;unit 3',
      'work-city': 'Utrecht',
      'work-postcode': '3542 AA',
      note: 'Met at the market\nlikes rye',
      birthday: '--03-12',
      uid: '1234ABCD-0000-4000-8000-000000000001',
      photo,
    });
  });

  it('reads year-less birthdays as --MM-DD', () => {
    expect(translate(card('BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-12')).props.birthday).toBe('--03-12');
    expect(translate(card('BDAY:--0312')).props.birthday).toBe('--03-12');
    expect(translate(card('BDAY:19840312')).props.birthday).toBe('1984-03-12');
  });

  it('splits categories on unescaped commas', () => {
    expect(translate(card('CATEGORIES:family,old\\, friends,work')).props.categories).toEqual([
      'family',
      'old, friends',
      'work',
    ]);
  });

  it('numbers extra values and skips empty ones', () => {
    const f = translate(card('TEL;TYPE=CELL:1', 'TEL;TYPE=CELL:', 'TEL;TYPE=CELL:3', 'NOTE:'));
    expect(f.props).toEqual({ mobile: '1', 'mobile-2': '3' });
  });

  it('feeds component rows from the first matching line only', () => {
    const f = translate(card('ADR;TYPE=HOME:;;A 1;X;;;', 'ADR;TYPE=HOME:;;B 2;Y;;;'));
    expect(f.props).toEqual({ street: 'A 1', city: 'X' });
  });

  describe('relations', () => {
    it('maps spouse, children and drops unknown uids', () => {
      const f = translate(
        card(
          'RELATED;TYPE=spouse:urn:uuid:anna-uid',
          'RELATED;TYPE=child;VALUE=text:Sem',
          'RELATED;TYPE=child;VALUE=text:Lotte',
          'RELATED;TYPE=friend:urn:uuid:nobody',
        ),
      );
      expect(f.props).toEqual({ spouse: '[[Anna de Vries]]', children: ['[[Sem]]', '[[Lotte]]'] });
      expect(f.source.children).toHaveLength(2);
    });

    it('strips urn:uuid case-insensitively and lists single items', () => {
      expect(translate(card('RELATED;TYPE=friend:URN:UUID:anna-uid')).props.friends).toEqual([
        '[[Anna de Vries]]',
      ]);
    });

    it('turns a second spouse into spouse-2', () => {
      const f = translate(card('RELATED;TYPE=spouse;VALUE=text:A', 'RELATED;TYPE=spouse;VALUE=text:B'));
      expect(f.props).toEqual({ spouse: '[[A]]', 'spouse-2': '[[B]]' });
    });
  });

  it('records provenance', () => {
    const f = toFriendly(lines, DEFAULT_MAPPING, ctx);
    expect(f.source.mobile).toEqual({ line: lines.findIndex((l) => l.group === 'item1' && l.name === 'TEL') });
    expect(f.source.city).toEqual({
      line: lines.findIndex((l) => l.name === 'ADR' && l.params.some(([, v]) => v === 'HOME')),
      component: 3,
    });
  });

  it('records one provenance per relation item', () => {
    const f = translate(card('FN:X', 'RELATED;TYPE=child;VALUE=text:Sem', 'RELATED;TYPE=child;VALUE=text:Lotte'));
    expect(f.source.children).toEqual([{ line: 2 }, { line: 3 }]);
  });
});

describe('relation links', () => {
  it('builds and parses links', () => {
    expect(toLink('Anna')).toBe('[[Anna]]');
    expect(linkTarget('[[Anna de Vries|Anna]]')).toBe('Anna de Vries');
    expect(linkTarget('[[Anna#Heading]]')).toBe('Anna');
    expect(linkTarget('Anna')).toBe('Anna');
  });
});

describe('reading every form', () => {
  const davx5 = readVcfFixture('davx5V3.vcf');
  const davx5Lines = parseCard(davx5);
  const at = (group: string, name: string) => davx5Lines.findIndex((l) => l.group === group && l.name === name);

  it('reads a DAVx5 vCard 3.0 card', () => {
    const f = toFriendly(davx5Lines, DEFAULT_MAPPING, ctx);
    expect(f.props).toEqual({
      uid: '5f0c3a1e-8b2d-4c47-9e61-7a2b9d4c1e08',
      name: 'Frank Hommers',
      firstname: 'Frank',
      lastname: 'Hommers',
      mobile: '+31 6 12345678',
      email: 'frank@example.nl',
      parents: ['[[Ger Verhallen]]', '[[Truus Verhallen]]'],
      spouse: '[[Sanne Hommers]]',
      children: ['[[Lotte Hommers]]'],
      colleagues: ['[[Pieter Jansen]]', '[[Marieke Bos]]'],
      anniversary: '2012-06-21',
      birthday: '1975-03-12',
    });
  });

  it('points provenance at the value line, not at its label', () => {
    const f = toFriendly(davx5Lines, DEFAULT_MAPPING, ctx);
    expect(f.source.parents).toEqual([{ line: at('item1', 'X-ABRELATEDNAMES') }, { line: at('item2', 'X-ABRELATEDNAMES') }]);
    expect(f.source.spouse).toEqual({ line: at('item3', 'X-ABRELATEDNAMES') });
    expect(f.source.anniversary).toEqual({ line: at('item8', 'X-ABDATE') });
  });

  it('an untouched DAVx5 card is written back byte-identical', () => {
    const f = toFriendly(davx5Lines, DEFAULT_MAPPING, ctx);
    const result = patch(davx5Lines, f, { ...f.props }, DEFAULT_MAPPING, ctx);
    expect(serializeCard(result.lines)).toBe(davx5);
  });

  it('reads X-ABRELATEDNAMES with its Apple label (Review Focus 1)', () => {
    const text = card('FN:Frank', 'item3.X-ABRELATEDNAMES:Ger Verhallen', 'item3.X-ABLabel:_$!<Father>!$_');
    const cardLines = parseCard(text);
    const f = toFriendly(cardLines, DEFAULT_MAPPING, ctx);
    expect(f.props).toEqual({ name: 'Frank', parents: ['[[Ger Verhallen]]'] });
    expect(f.source.parents).toEqual([{ line: 2 }]); // VERSION, FN, then the value line (not its label)
    const result = patch(cardLines, f, { ...f.props }, DEFAULT_MAPPING, ctx);
    expect(serializeCard(result.lines)).toBe(text + '\r\n');
  });

  it('finds the label wherever it is in the card, and only in its own group', () => {
    expect(translate(card('ITEM2.X-ABLABEL:_$!<Father>!$_', 'item2.X-ABRELATEDNAMES:Ger')).props).toEqual({
      parents: ['[[Ger]]'],
    });
    expect(translate(card('item1.X-ABLabel:_$!<Father>!$_', 'item2.X-ABRELATEDNAMES:Ger')).props).toEqual({});
  });

  it('a hint picks the right one of two people with the same name (Review Focus 2)', () => {
    const twoJans: RelationContext = {
      uidToName: (uid) =>
        ({ 'jan-work': 'Contacts/Work/Jan Jansen', 'jan-family': 'Contacts/Family/Jan Jansen' })[uid],
      displayName: (uid) => (uid === 'jan-work' || uid === 'jan-family' ? 'Jan Jansen' : undefined),
      resolveLink: () => ({ ambiguous: true }),
    };
    const read = (...body: string[]) => toFriendly(parseCard(card(...body)), DEFAULT_MAPPING, twoJans).props;
    expect(read('item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=jan-family:Jan Jansen', 'item1.X-ABLabel:_$!<Friend>!$_')).toEqual({
      friends: ['[[Contacts/Family/Jan Jansen]]'],
    });
    expect(read('RELATED;TYPE=friend;VALUE=text;X-FRIENDLY-UID=jan-work:Jan Jansen')).toEqual({
      friends: ['[[Contacts/Work/Jan Jansen]]'],
    });
    // Without a hint the name is ambiguous: it stays the name the card holds.
    expect(read('item1.X-ABRELATEDNAMES:Jan Jansen', 'item1.X-ABLabel:_$!<Friend>!$_')).toEqual({
      friends: ['[[Jan Jansen]]'],
    });
    expect(read('RELATED;TYPE=friend;VALUE=text:Jan Jansen')).toEqual({ friends: ['[[Jan Jansen]]'] });
  });

  it('a hint that does not resolve falls back to the value', () => {
    expect(translate(card('RELATED;TYPE=spouse;VALUE=text;X-FRIENDLY-UID=gone:Anna')).props).toEqual({
      spouse: '[[Anna]]',
    });
    expect(translate(card('RELATED;TYPE=spouse;X-FRIENDLY-UID=gone:urn:uuid:anna-uid')).props).toEqual({
      spouse: '[[Anna de Vries]]',
    });
    expect(
      translate(card('item1.X-ABRELATEDNAMES;X-FRIENDLY-UID="gone":Sem', 'item1.X-ABLabel:_$!<Child>!$_')).props,
    ).toEqual({ children: ['[[Sem]]'] });
    expect(
      translate(card('item1.X-ABRELATEDNAMES;X-FRIENDLY-UID="anna-uid":Anna', 'item1.X-ABLabel:_$!<Spouse>!$_')).props,
    ).toEqual({ spouse: '[[Anna de Vries]]' });
  });

  it('reads vCard 4.0 RELATED text values with and without a hint', () => {
    expect(translate(card('RELATED;TYPE=sweetheart;VALUE=text:Sanne')).props).toEqual({ partner: '[[Sanne]]' });
    expect(translate(card('RELATED;TYPE=child;VALUE=text;X-FRIENDLY-UID=anna-uid:Anna')).props).toEqual({
      children: ['[[Anna de Vries]]'],
    });
  });

  it('a name that is a urn:uuid (a phone kept the plugin\'s old link as the name) links that contact', () => {
    // alpha.6 wrote `RELATED;TYPE=spouse:urn:uuid:anna-uid`; DAVx5 stored it as a name, on 3.0 and on 4.0.
    expect(translate(card('item1.X-ABRELATEDNAMES:urn:uuid:anna-uid', 'item1.X-ABLabel:_$!<Spouse>!$_')).props).toEqual({
      spouse: '[[Anna de Vries]]',
    });
    expect(translate(card('RELATED;TYPE=spouse;VALUE=text:urn:uuid:anna-uid')).props).toEqual({ spouse: '[[Anna de Vries]]' });
    expect(translate(card('RELATED;TYPE=spouse;VALUE=text:URN:UUID:anna-uid')).props).toEqual({ spouse: '[[Anna de Vries]]' });
    // Like a urn:uuid value: nobody with that UID, no link (never a link named "urn:uuid:…").
    expect(translate(card('item1.X-ABRELATEDNAMES:urn:uuid:nobody', 'item1.X-ABLabel:_$!<Spouse>!$_')).props).toEqual({});
    expect(translate(card('RELATED;TYPE=friend;VALUE=text:urn:uuid:nobody')).props).toEqual({});
  });

  it('RELATED without VALUE=text and without a URI scheme is a name', () => {
    expect(translate(card('RELATED;TYPE=spouse:Anna')).props).toEqual({ spouse: '[[Anna]]' });
    expect(translate(card('RELATED;TYPE=friend:Jan de Vries\\, Jr')).props).toEqual({ friends: ['[[Jan de Vries, Jr]]'] });
    expect(translate(card('RELATED;TYPE=friend:urn:uuid:anna-uid')).props).toEqual({ friends: ['[[Anna de Vries]]'] });
    expect(translate(card('RELATED;TYPE=friend:http://example.com/anna')).props).toEqual({});
  });

  // The label table of the spec (Part 6, "Reading"), written out so a change to the defaults shows here.
  const LABEL_TABLE: [string, string[]][] = [
    ['spouse', ['Spouse']],
    ['partner', ['Partner']],
    ['children', ['Child']],
    ['parents', ['Parent', 'Mother', 'Father']],
    ['siblings', ['Sibling', 'Brother', 'Sister']],
    ['family', ['Kin', 'Relative']],
    ['friends', ['Friend']],
    ['colleagues', ['Colleague', 'Co-worker', 'Assistant', 'Manager']],
    ['neighbours', ['Neighbor']],
    ['housemates', ['Co-resident']],
    ['acquaintances', ['Acquaintance']],
    ['met', ['Met']],
    ['emergency', ['Emergency']],
  ];
  const SINGLE = ['spouse', 'partner'];

  it.each(LABEL_TABLE)('reads every label of %s, Apple and plain, in any case', (property, labels) => {
    for (const label of labels) {
      for (const raw of [`_$!<${label}>!$_`, label, label.toUpperCase(), label.toLowerCase()]) {
        const props = translate(card('item1.X-ABRELATEDNAMES:Kim', `item1.X-ABLabel:${raw}`)).props;
        expect(props, raw).toEqual({ [property]: SINGLE.includes(property) ? '[[Kim]]' : ['[[Kim]]'] });
      }
    }
  });

  it('a comma-separated label matches when any part matches', () => {
    expect(translate(card('item1.X-ABRELATEDNAMES:Sanne', 'item1.X-ABLabel:Domestic-partner, Spouse')).props).toEqual({
      spouse: '[[Sanne]]',
    });
    expect(translate(card('item1.X-ABRELATEDNAMES:Sanne', 'item1.X-ABLabel:Domestic-partner\\, Spouse')).props).toEqual({
      spouse: '[[Sanne]]',
    });
  });

  it('leaves unlabeled and unknown labels unmapped', () => {
    expect(translate(card('X-ABRELATEDNAMES;TYPE=other:Oom Kees')).props).toEqual({});
    expect(translate(card('item1.X-ABRELATEDNAMES:Klaas', 'item1.X-ABLabel:Godfather')).props).toEqual({});
    expect(translate(card('item1.X-ABRELATEDNAMES:Klaas', 'item1.X-ABLabel:_$!<Other>!$_')).props).toEqual({});
    expect(translate(card('item1.X-ABRELATEDNAMES:Klaas', 'item1.X-ABLabel:')).props).toEqual({});
    expect(translate(card('item1.X-ABRELATEDNAMES:', 'item1.X-ABLabel:_$!<Friend>!$_')).props).toEqual({});
  });

  it('reads the anniversary from X-ABDATE with its label', () => {
    const date = (...body: string[]) => translate(card(...body)).props.anniversary;
    expect(date('item1.X-ABDATE:2012-06-21', 'item1.X-ABLabel:_$!<Anniversary>!$_')).toBe('2012-06-21');
    expect(date('item1.X-ABDATE:20120621', 'item1.X-ABLabel:anniversary')).toBe('2012-06-21');
    expect(date('item1.X-ABDATE;X-APPLE-OMIT-YEAR=1604:1604-06-21', 'item1.X-ABLabel:_$!<Anniversary>!$_')).toBe(
      '--06-21',
    );
    expect(date('item1.X-ABDATE:--0621', 'item1.X-ABLabel:Anniversary')).toBe('--06-21');
    expect(date('ANNIVERSARY:20120621')).toBe('2012-06-21');
  });

  it('reader 1 ignores X-ABRELATEDNAMES and X-ABDATE', () => {
    const f = toFriendly(davx5Lines, DEFAULT_MAPPING, ctx, { reader: 1 });
    expect(f.props).toEqual({
      uid: '5f0c3a1e-8b2d-4c47-9e61-7a2b9d4c1e08',
      name: 'Frank Hommers',
      firstname: 'Frank',
      lastname: 'Hommers',
      mobile: '+31 6 12345678',
      email: 'frank@example.nl',
      birthday: '1975-03-12',
    });
    // As before Part 6: RELATED is read, without the hint and untrimmed.
    const v1 = (...body: string[]) => toFriendly(parseCard(card(...body)), DEFAULT_MAPPING, ctx, { reader: 1 }).props;
    expect(v1('RELATED;TYPE=spouse;VALUE=text;X-FRIENDLY-UID=anna-uid:Anna')).toEqual({ spouse: '[[Anna]]' });
    expect(v1('RELATED;TYPE=friend:urn:uuid:anna-uid')).toEqual({ friends: ['[[Anna de Vries]]'] });
    expect(v1('ANNIVERSARY:20120621')).toEqual({ anniversary: '2012-06-21' });
  });

  it('reads the same person in RELATED and X-ABRELATEDNAMES as two entries, and writes the card back unchanged', () => {
    const text = card(
      'FN:Frank',
      'RELATED;TYPE=friend;VALUE=text:Kim',
      'item1.X-ABRELATEDNAMES:Kim',
      'item1.X-ABLabel:_$!<Friend>!$_',
    );
    const cardLines = parseCard(text);
    const f = toFriendly(cardLines, DEFAULT_MAPPING, ctx);
    expect(f.props.friends).toEqual(['[[Kim]]', '[[Kim]]']);
    expect(f.source.friends).toEqual([{ line: 2 }, { line: 3 }]);
    expect(serializeCard(patch(cardLines, f, { ...f.props }, DEFAULT_MAPPING, ctx).lines)).toBe(text + '\r\n');
  });

  it('a hint does not map an X-ABRELATEDNAMES line with an unknown label', () => {
    expect(
      translate(card('item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=anna-uid:Anna', 'item1.X-ABLabel:Godmother')).props,
    ).toEqual({});
  });

  it('leaves other X-ABDATE lines unmapped', () => {
    expect(translate(card('item1.X-ABDATE:2012-06-21', 'item1.X-ABLabel:_$!<Other>!$_')).props).toEqual({});
    expect(translate(card('X-ABDATE:2012-06-21')).props).toEqual({});
    expect(translate(card('item1.X-ABDATE:2012-06-21', 'item1.X-ABLabel:Wedding')).props).toEqual({});
  });
});
