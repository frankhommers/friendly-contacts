import { parseCard } from 'src/contacts/friendly/lines';
import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { linkTarget, RelationContext, toLink } from 'src/contacts/friendly/relations';
import { toFriendly } from 'src/contacts/friendly/translate';
import { readVcfFixture } from 'tests/fixtures/fixtures';
import { describe, expect, it } from 'vitest';

const ctx: RelationContext = {
  uidToName: (uid) => (uid === 'anna-uid' ? 'Anna de Vries' : undefined),
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
      birthday: '1604-03-12',
      uid: '1234ABCD-0000-4000-8000-000000000001',
      photo,
    });
  });

  it('keeps apple year-less birthday', () => {
    expect(translate(card('BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-12')).props.birthday).toBe('1604-03-12');
    expect(translate(card('BDAY:--0312')).props.birthday).toBe('--0312');
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
