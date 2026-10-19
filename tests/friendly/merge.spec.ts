import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { parseCard } from 'src/contacts/friendly/lines';
import { alignNoteDates, coerceNoteProps, sameValue } from 'src/contacts/friendly/merge';
import { toFriendly } from 'src/contacts/friendly/translate';
import { describe, expect, it } from 'vitest';

describe('sameValue', () => {
  it('text is trimmed', () => {
    expect(sameValue('2', ' 2 ')).toBe(true);
    expect(sameValue('2', '3')).toBe(false);
  });

  it('relation lists compare as sets of link targets', () => {
    expect(sameValue(['[[A]]', '[[B]]'], ['[[B]]', '[[A|Aa]]'])).toBe(true);
    expect(sameValue(['[[A]]'], ['[[A]]', '[[C]]'])).toBe(false);
  });

  it('absent, empty text and empty list are the same', () => {
    expect(sameValue(undefined, '')).toBe(true);
    expect(sameValue(undefined, [])).toBe(true);
    expect(sameValue(undefined, 'x')).toBe(false);
  });

  it('a photo data URI and the bare base64 of the same image are equal', () => {
    expect(sameValue('/9j/AABB', 'data:image/jpeg;base64,/9j/AA BB', 'photo')).toBe(true);
    expect(sameValue('/9j/AA\n BB', '/9j/AABB', 'photo')).toBe(true);
    expect(sameValue('/9j/AABB', 'data:image/png;base64,iVBOR', 'photo')).toBe(false);
  });
});

describe('coerceNoteProps', () => {
  it('coerces dates from the note', () => {
    const r = coerceNoteProps({ birthday: '--0315', anniversary: new Date('1975-03-12') }, DEFAULT_MAPPING);
    expect(r.props).toEqual({ birthday: '--03-15', anniversary: '1975-03-12' });
  });

  it('coerces yaml values from the note', () => {
    const r = coerceNoteProps(
      { mobile: 612345678, birthday: new Date('1975-03-12'), email: ['a', 'b'], spouse: null, 'met-via': 'x' },
      DEFAULT_MAPPING,
    );
    expect(r.props).toEqual({ mobile: '612345678', birthday: '1975-03-12', email: 'a' });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('email');
  });

  it('turns text in a list property into a one-item list', () => {
    const r = coerceNoteProps({ categories: 'friends', children: '[[A]]', 'children-2': '' }, DEFAULT_MAPPING);
    expect(r.props).toEqual({ categories: ['friends'], children: ['[[A]]'] });
    expect(r.warnings).toEqual([]);
  });

  it('keeps lists, stringifies items and drops blanks', () => {
    const r = coerceNoteProps({ categories: ['a', 5, '', null], note: true, nickname: '  ', work: undefined }, DEFAULT_MAPPING);
    expect(r.props).toEqual({ categories: ['a', '5'], note: 'true' });
  });

  it('recovers unquoted wikilinks', () => {
    const r = coerceNoteProps({ spouse: [['Anna']], children: [[['Sem']], [['Lotte']]] }, DEFAULT_MAPPING);
    expect(r.props).toEqual({ spouse: '[[Anna]]', children: ['[[Sem]]', '[[Lotte]]'] });
    expect(r.warnings).toEqual([]);
  });
});

describe('alignNoteDates', () => {
  const ctx = { uidToName: () => undefined, displayName: () => undefined, resolveLink: (name: string) => ({ text: name }) };
  const cardOf = (...body: string[]) => {
    const lines = parseCard(['BEGIN:VCARD', 'VERSION:3.0', ...body, 'END:VCARD'].join('\r\n'));
    return { lines, friendly: toFriendly(lines, DEFAULT_MAPPING, ctx) };
  };

  it('reads a legacy apple placeholder date as the year-less date of the first card that has it', () => {
    const apple = cardOf('BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-12', 'ANNIVERSARY:2001-09-22');
    const local = { birthday: '1604-03-12', anniversary: '2001-09-22', title: '1604-03-12' };
    expect(alignNoteDates(local, DEFAULT_MAPPING, [undefined, apple])).toEqual({
      birthday: '--03-12',
      anniversary: '2001-09-22',
      title: '1604-03-12',
    });
    expect(local.birthday).toBe('1604-03-12');
  });

  it('leaves dates alone when no card line has the apple year', () => {
    const plain = cardOf('BDAY:1604-03-12');
    expect(alignNoteDates({ birthday: '1604-03-12' }, DEFAULT_MAPPING, [plain])).toEqual({ birthday: '1604-03-12' });
    expect(alignNoteDates({ birthday: '1604-03-12' }, DEFAULT_MAPPING, [cardOf('NOTE:x')])).toEqual({ birthday: '1604-03-12' });
  });
});
