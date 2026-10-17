import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { coerceNoteProps, mergeFriendly, renderConflictCallout } from 'src/contacts/friendly/merge';
import { describe, expect, it } from 'vitest';

describe('mergeFriendly', () => {
  it('server-only change wins', () => {
    const r = mergeFriendly({ mobile: '1' }, { mobile: '2' }, { mobile: '1' });
    expect(r.merged).toEqual({ mobile: '2' });
    expect(r.conflicts).toEqual([]);
  });

  it('local-only change wins', () => {
    const r = mergeFriendly({ mobile: '1' }, { mobile: '1' }, { mobile: '3' });
    expect(r.merged).toEqual({ mobile: '3' });
    expect(r.conflicts).toEqual([]);
  });

  it('server deletion', () => {
    const r = mergeFriendly({ email: 'a' }, {}, { email: 'a' });
    expect(r.merged).not.toHaveProperty('email');
    expect(r.conflicts).toEqual([]);
  });

  it('local deletion', () => {
    const r = mergeFriendly({ email: 'a' }, { email: 'a' }, {});
    expect(r.merged).not.toHaveProperty('email');
    expect(r.conflicts).toEqual([]);
  });

  it('conflict keeps server', () => {
    const r = mergeFriendly({ mobile: '1' }, { mobile: '2' }, { mobile: '3' });
    expect(r.merged).toEqual({ mobile: '2' });
    expect(r.conflicts).toEqual([{ property: 'mobile', local: '3', server: '2' }]);
  });

  it('both sides made the same change: no conflict', () => {
    const r = mergeFriendly({ mobile: '1' }, { mobile: '2' }, { mobile: ' 2 ' });
    expect(r.merged).toEqual({ mobile: '2' });
    expect(r.conflicts).toEqual([]);
  });

  it('no base', () => {
    const r = mergeFriendly(undefined, { mobile: '2', email: 'x' }, { mobile: '3', company: 'C' });
    expect(r.merged).toEqual({ mobile: '2', email: 'x', company: 'C' });
    expect(r.conflicts).toEqual([{ property: 'mobile', local: '3', server: '2' }]);
  });

  it('relation lists compare as sets', () => {
    const r = mergeFriendly(
      { children: ['[[A]]', '[[B]]'] },
      { children: ['[[A]]', '[[B]]'] },
      { children: ['[[B]]', '[[A|Aa]]'] },
    );
    expect(r.merged).toEqual({ children: ['[[A]]', '[[B]]'] });
    expect(r.conflicts).toEqual([]);
  });

  it('absent, empty text and empty list are the same', () => {
    const r = mergeFriendly({ note: 'x', friends: ['[[A]]'] }, { note: 'x', friends: ['[[A]]'] }, { note: 'x', friends: ['[[A]]'], nickname: '', family: [] });
    expect(r.merged).toEqual({ note: 'x', friends: ['[[A]]'] });
    expect(r.conflicts).toEqual([]);
  });

  it('conflict where the server deleted the value keeps the deletion', () => {
    const r = mergeFriendly({ email: 'a' }, {}, { email: 'b' });
    expect(r.merged).not.toHaveProperty('email');
    expect(r.conflicts).toEqual([{ property: 'email', local: 'b', server: '' }]);
  });
});

describe('coerceNoteProps', () => {
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
});

describe('renderConflictCallout', () => {
  it('formats a warning callout with local time', () => {
    const when = new Date(2026, 9, 17, 14, 3);
    expect(
      renderConflictCallout(
        [
          { property: 'mobile', local: '06-1111', server: '06-2222' },
          { property: 'children', local: ['[[A]]', '[[B]]'], server: [] },
        ],
        when,
      ),
    ).toBe(
      [
        '> [!warning] Sync conflict 2026-10-17 14:03',
        '> The server value was kept. Your value was:',
        '> - mobile: 06-1111',
        '> - children: [[A]], [[B]]',
      ].join('\n'),
    );
  });
});
