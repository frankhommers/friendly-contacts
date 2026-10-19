import { parseCard } from 'src/contacts/friendly/lines';
import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { RelationContext } from 'src/contacts/friendly/relations';
import { toFriendly } from 'src/contacts/friendly/translate';
import {
  contactFileName,
  friendlyKey,
  isContactFrontmatter,
  isContactNote,
  hasVCardValues,
  legacyRecord,
  recordToFriendly,
  renderFriendlyNote,
  splitCards,
} from 'src/contacts/friendlyNotes';
import { renderFrontmatter } from 'src/contacts/frontmatterYaml';
import { readVcfFixture } from 'tests/fixtures/fixtures';
import { describe, expect, it } from 'vitest';

const ctx: RelationContext = {
  uidToName: () => undefined,
  resolveLink: (name) => ({ text: name }),
};

describe('legacyRecord', () => {
  it('legacy record from friendly note', () => {
    const record = legacyRecord(
      { name: 'Jan de Vries', firstname: 'Jan', lastname: 'de Vries', mobile: '06', city: 'Utrecht' },
      DEFAULT_MAPPING,
    );
    expect(record['FN']).toBe('Jan de Vries');
    expect(record['N.GN']).toBe('Jan');
    expect(record['N.FN']).toBe('de Vries');
    expect(record['TEL[CELL]']).toBe('06');
    expect(record['ADR[HOME].LOCALITY']).toBe('Utrecht');
  });

  it('old-style note passes through', () => {
    expect(legacyRecord({ FN: 'X', 'TEL[CELL]': '1' }, DEFAULT_MAPPING)).toEqual({ FN: 'X', 'TEL[CELL]': '1' });
  });

  it('old-style note drops keys that are not vCard keys', () => {
    expect(legacyRecord({ FN: 'X', tags: ['a'], aliases: 'b' }, DEFAULT_MAPPING)).toEqual({ FN: 'X' });
  });

  it('legacy record of a note without uid has no UID', () => {
    expect(legacyRecord({ name: 'Jan' }, DEFAULT_MAPPING)).not.toHaveProperty('UID');
    expect(legacyRecord({ name: 'Jan', uid: 'urn:uuid:abc' }, DEFAULT_MAPPING)['UID']).toBe('urn:uuid:abc');
  });

  it('unescapes text values and keeps list values', () => {
    const record = legacyRecord(
      { name: 'Jan', company: 'Bakker, Zonen', categories: ['Family', 'Work'], note: 'a\nb' },
      DEFAULT_MAPPING,
    );
    expect(record['ORG']).toBe('Bakker, Zonen');
    expect(record['CATEGORIES']).toBe('Family,Work');
    expect(record['NOTE']).toBe('a\nb');
  });

  it('shows a bare base64 photo (vCard 3 ENCODING=b) as a data URI', () => {
    expect(legacyRecord({ name: 'Jan', photo: '/9j/4AAQ' }, DEFAULT_MAPPING)['PHOTO']).toBe(
      'data:image/jpeg;base64,/9j/4AAQ',
    );
    expect(legacyRecord({ name: 'Jan', photo: 'https://x.nl/a.jpg' }, DEFAULT_MAPPING)['PHOTO']).toBe(
      'https://x.nl/a.jpg',
    );
  });

  it('keeps vCard keys next to friendly ones', () => {
    const record = legacyRecord({ name: 'Jan', 'X-FOO': 'bar' }, DEFAULT_MAPPING);
    expect(record['FN']).toBe('Jan');
    expect(record['X-FOO']).toBe('bar');
  });
});

describe('recordToFriendly', () => {
  it('turns an old-style record into friendly properties', () => {
    expect(
      recordToFriendly(
        { FN: 'Jan', 'N.GN': 'Jan', 'N.FN': 'de Vries', 'TEL[CELL]': '06', 'ADR[HOME].LOCALITY': 'Utrecht' },
        DEFAULT_MAPPING,
      ),
    ).toEqual({ name: 'Jan', firstname: 'Jan', lastname: 'de Vries', mobile: '06', city: 'Utrecht' });
  });
});

describe('isContactFrontmatter', () => {
  it.each([
    [{ name: 'Jan' }, true],
    [{ firstname: 'Jan' }, true],
    [{ lastname: 'de Vries' }, true],
    [{ FN: 'Jan' }, true],
    [{ 'N.GN': 'Jan', 'N.FN': 'de Vries' }, true],
    [{ 'N.GN': 'Jan' }, false],
    [{ title: 'Baker' }, false],
    [undefined, false],
  ])('%o -> %s', (fm, expected) => {
    expect(isContactFrontmatter(fm as Record<string, unknown> | undefined)).toBe(expected);
  });
});

describe('hasVCardValues', () => {
  it('is true for any vCard key with a value, also next to friendly ones', () => {
    expect(hasVCardValues({ FN: 'Jan', UID: 'urn:uuid:x', mobile: '06' })).toBe(true);
    expect(hasVCardValues({ FN: 'X', tags: [] })).toBe(true);
    expect(hasVCardValues({ name: 'Jan', 'TEL[CELL]': '06' })).toBe(true);
    expect(hasVCardValues({ name: 'Jan', 'ADR[HOME].STREET': 'Dorpsstraat 1' })).toBe(true);
  });

  it('ignores vCard keys without a friendly property: they stay local-only', () => {
    expect(hasVCardValues({ name: 'Jan', 'X-CREATED': '2019' })).toBe(false);
    expect(hasVCardValues({ name: 'Jan', 'X-ABLABEL': 'x', 'TEL[WORK,FAX]': '1', 'N.PREFIX': 'Dr.' })).toBe(false);
    expect(hasVCardValues({ 'TEL[CELL]': '06', name: 'Jan' })).toBe(true);
  });

  it('follows the mapping it is given', () => {
    const rows = DEFAULT_MAPPING.filter((row) => row.property !== 'mobile');
    expect(hasVCardValues({ name: 'Jan', 'TEL[CELL]': '06' }, rows)).toBe(false);
    expect(hasVCardValues({ name: 'Jan', UID: 'urn:uuid:x' }, rows)).toBe(true);
  });

  it('is false for friendly notes and empty vCard keys', () => {
    expect(hasVCardValues({ name: 'Jan', mobile: '06' })).toBe(false);
    expect(hasVCardValues({ FN: '', name: 'Jan', mobile: '06' })).toBe(false);
    expect(hasVCardValues({ FN: '  ', UID: null, CATEGORIES: [], name: 'Jan' })).toBe(false);
  });
});

describe('friendlyKey', () => {
  it.each([
    ['UID', 'uid'],
    ['PHOTO', 'photo'],
    ['FN', 'name'],
    ['TEL[CELL]', 'mobile'],
    ['N.GN', 'firstname'],
    ['ADR[HOME].LOCALITY', 'city'],
    ['ORG', 'company'],
    ['X-FOO', 'X-FOO'],
    ['mobile', 'mobile'],
  ])('%s -> %s', (key, expected) => {
    expect(friendlyKey(key, DEFAULT_MAPPING)).toBe(expected);
  });
});

describe('renderFriendlyNote', () => {
  it('renders friendly note', () => {
    const props = toFriendly(parseCard(readVcfFixture('appleV3.vcf')), DEFAULT_MAPPING, ctx).props;
    const md = renderFriendlyNote(props, '#Contact', DEFAULT_MAPPING);
    expect(md.startsWith('---\nname: Jan de Vries\n')).toBe(true);
    expect(md).toMatch(/\nuid: "1234ABCD-0000-4000-8000-000000000001"\n---\n/);
    expect(md).toContain('#Contact');
    expect(md).not.toContain('#### Notes');
    expect(md).toContain('company: Bakker, Zonen\n');
  });

  it('puts properties in mapping order, then other keys, then uid', () => {
    const md = renderFriendlyNote(
      { uid: 'u1', 'email-2': 'b@x.nl', mobile: '06', email: 'a@x.nl', name: 'Jan' },
      '',
      DEFAULT_MAPPING,
    );
    const keys = md.split('\n').filter((l) => /^[a-z-0-9]+:/.test(l)).map((l) => l.split(':')[0]);
    expect(keys).toEqual(['name', 'mobile', 'email', 'email-2', 'uid']);
  });

  it('body is an empty line plus hashtags', () => {
    expect(renderFriendlyNote({ name: 'Jan' }, '#people', DEFAULT_MAPPING)).toBe('---\nname: Jan\n---\n\n#people\n');
    expect(renderFriendlyNote({ name: 'Jan' }, '', DEFAULT_MAPPING)).toBe('---\nname: Jan\n---\n\n');
  });
});

describe('renderFrontmatter', () => {
  it('phone numbers stay strings', () => {
    expect(renderFrontmatter([['mobile', '0612345678']])).toBe('---\nmobile: "0612345678"\n---\n');
  });

  it.each([
    ['+31612345678'],
    ['1986-03-17'],
    ['true'],
    ['No'],
    ['null'],
    ['~'],
    ['1e3'],
    ['.5'],
    [' padded'],
    ['trailing '],
    ['a: b'],
    ['https://x.nl'],
    ['tag #x'],
    ['[x]'],
    ['say "hi"'],
    ["it's"],
    ['- dash'],
    ['@handle'],
    ['*star'],
    ['&anchor'],
    ['!tag'],
    ['%pct'],
    ['|pipe'],
    ['>gt'],
    ['{brace}'],
    ['?q'],
    [''],
  ])('quotes %j', (value) => {
    expect(renderFrontmatter([['k', value]])).toMatch(/^---\nk: ".*"\n---\n$/);
  });

  it.each([['Jan de Vries'], ['Utrecht'], ['Bakker Zonen'], ['jan.example']])('leaves %j plain', (value) => {
    expect(renderFrontmatter([['k', value]])).toBe(`---\nk: ${value}\n---\n`);
  });

  it('quotes wikilinks in a list', () => {
    expect(renderFrontmatter([['children', ['[[Sem]]', '[[People/Lot|Lot]]']]])).toBe(
      '---\nchildren:\n  - "[[Sem]]"\n  - "[[People/Lot|Lot]]"\n---\n',
    );
  });

  it('writes a single wikilink quoted', () => {
    expect(renderFrontmatter([['spouse', '[[Anna]]']])).toBe('---\nspouse: "[[Anna]]"\n---\n');
  });

  it('escapes a multi-line note', () => {
    expect(renderFrontmatter([['note', 'Met at the market\nlikes "rye" \\ bread\ttab']])).toBe(
      '---\nnote: "Met at the market\\nlikes \\"rye\\" \\\\ bread\\ttab"\n---\n',
    );
  });

  it('writes an empty list', () => {
    expect(renderFrontmatter([['categories', []]])).toBe('---\ncategories: []\n---\n');
  });
});

describe('contactFileName', () => {
  it('uses the N parts, then FN', () => {
    expect(contactFileName('de Vries;Jan;;;', 'Jan de Vries')).toBe('Jan de Vries');
    expect(contactFileName('Smit;Anna;B.;Dr.;jr', undefined)).toBe('Dr. Anna B. Smit jr');
    expect(contactFileName(';;;;', 'Bakker BV')).toBe('Bakker BV');
    expect(contactFileName(undefined, 'Bakker BV')).toBe('Bakker BV');
    expect(contactFileName('Bakker\\, Zonen;;;;', undefined)).toBe('Bakker, Zonen');
  });

  it('is undefined without any name', () => {
    expect(contactFileName(undefined, undefined)).toBeUndefined();
    expect(contactFileName(';;;;', '')).toBeUndefined();
  });

  it('sanitises the name for a file', () => {
    expect(contactFileName(undefined, 'A/B: C')).toBe('A B C');
  });
});

describe('splitCards', () => {
  it('splits a multi-card file on BEGIN:VCARD', () => {
    const cards = splitCards(readVcfFixture('hasMultipleCards.vcf'));
    expect(cards.length).toBeGreaterThan(1);
    for (const card of cards) {
      expect(card).toMatch(/^BEGIN:VCARD/);
      expect(card).toMatch(/END:VCARD\s*$/);
    }
  });

  it('ignores text before the first card', () => {
    expect(splitCards('junk\nBEGIN:VCARD\nFN:A\nEND:VCARD\nbegin:vcard\nFN:B\nEND:VCARD\n')).toEqual([
      'BEGIN:VCARD\nFN:A\nEND:VCARD\n',
      'begin:vcard\nFN:B\nEND:VCARD\n',
    ]);
  });
});

describe('isContactNote', () => {
  const note = { extension: 'md', path: 'Contacts/Jan.md' };
  const jan = { name: 'Jan' };

  it('accepts a Markdown note in the contacts folder with a contact name', () => {
    expect(isContactNote(note, jan, 'Contacts')).toBe(true);
  });

  it('accepts any folder when the contacts folder is empty', () => {
    expect(isContactNote({ extension: 'md', path: 'Elsewhere/Jan.md' }, jan, '')).toBe(true);
  });

  it('refuses a note outside the contacts folder', () => {
    expect(isContactNote({ extension: 'md', path: 'Elsewhere/Jan.md' }, jan, 'Contacts')).toBe(false);
  });

  it('refuses a file that is not Markdown', () => {
    expect(isContactNote({ extension: 'png', path: 'Contacts/Jan.png' }, jan, 'Contacts')).toBe(false);
  });

  it('refuses a note without a contact name, or without frontmatter', () => {
    expect(isContactNote(note, { company: 'ACME' }, 'Contacts')).toBe(false);
    expect(isContactNote(note, undefined, 'Contacts')).toBe(false);
    expect(isContactNote(note, null, 'Contacts')).toBe(false);
  });

  it('refuses when there is no file', () => {
    expect(isContactNote(null, jan, 'Contacts')).toBe(false);
    expect(isContactNote(undefined, jan, 'Contacts')).toBe(false);
  });
});
