import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { canApply, Choice, isUpToDate, resultProps, reviewRows } from 'src/sync/review';
import { describe, expect, it } from 'vitest';

const rows = DEFAULT_MAPPING;
const none = new Map<string, Choice>();
const review = (base: Record<string, string | string[]> | undefined, server: Record<string, string | string[]>, local: Record<string, string | string[]>, newCard = false) =>
  reviewRows(base, server, local, rows, { newCard });
const changed = (r: ReturnType<typeof review>) => r.filter((x) => x.changed);

describe('reviewRows', () => {
  it('only differing rows', () => {
    const r = changed(review({ mobile: '1', email: 'a' }, { mobile: '2', email: 'a' }, { mobile: '1', email: 'a' }));
    expect(r.map((x) => x.property)).toEqual(['mobile']);
    expect(r[0]).toMatchObject({ server: '2', local: '1', kind: 'text', changed: true });
  });

  it('server-only change preselects Radicale', () => {
    const r = review({ mobile: '1' }, { mobile: '2' }, { mobile: '1' });
    expect(r[0].preselect).toBe('server');
  });

  it('note-only change preselects Obsidian', () => {
    const r = review({ mobile: '1' }, { mobile: '1' }, { mobile: '3' });
    expect(r[0].preselect).toBe('local');
  });

  it('both changed is a conflict', () => {
    const r = review({ mobile: '1' }, { mobile: '2' }, { mobile: '3' });
    expect(r[0].preselect).toBeUndefined();
  });

  it('no base makes every difference a conflict', () => {
    const r = changed(review(undefined, { mobile: '2' }, { email: 'x' }));
    expect(r.map((x) => [x.property, x.preselect])).toEqual(expect.arrayContaining([['mobile', undefined], ['email', undefined]]));
    expect(r).toHaveLength(2);
  });

  it('new card preselects Obsidian everywhere', () => {
    const r = changed(review(undefined, { mobile: '2' }, { mobile: '3', email: 'x' }, true));
    expect(r.every((x) => x.preselect === 'local')).toBe(true);
    expect(canApply(r, none)).toBe(true);
  });

  it('list conflict is chosen as a whole', () => {
    const rs = review({ categories: ['a'] }, { categories: ['a', 'b'] }, { categories: ['a', 'c'] });
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ kind: 'list', preselect: undefined });
    expect(resultProps(rs, new Map([['categories', 'local']]), { categories: ['a', 'b'] })).toEqual({ categories: ['a', 'c'] });
    expect(() => resultProps(rs, new Map([['categories', { custom: 'x' }]]), {})).toThrow();
  });

  it('relation rows have their own kind', () => {
    const rs = review({}, { children: ['[[A]]'] }, { children: ['[[B]]'] });
    expect(rs[0].kind).toBe('relation');
  });

  it('custom text equal to a side is that side', () => {
    const rs = review({ mobile: '1' }, { mobile: '2' }, { mobile: '3' });
    expect(resultProps(rs, new Map([['mobile', { custom: ' 3 ' }]]), { mobile: '2' })).toEqual({ mobile: '3' });
    expect(resultProps(rs, new Map([['mobile', { custom: '2' }]]), { mobile: '2' })).toEqual({ mobile: '2' });
    expect(resultProps(rs, new Map([['mobile', { custom: ' 9 ' }]]), { mobile: '2' })).toEqual({ mobile: '9' });
  });

  it('empty custom text removes', () => {
    const rs = review({ mobile: '1' }, { mobile: '2' }, { mobile: '3' });
    expect(resultProps(rs, new Map([['mobile', { custom: '  ' }]]), { mobile: '2' })).toEqual({});
  });

  it('local choice removes a value the note does not have', () => {
    const rs = review({ mobile: '1' }, { mobile: '1' }, {});
    expect(resultProps(rs, new Map([['mobile', 'local']]), { mobile: '1' })).toEqual({});
    expect(resultProps(rs, none, { mobile: '1' })).toEqual({});
  });

  it('cannot apply with an undecided conflict', () => {
    const rs = review({ mobile: '1' }, { mobile: '2' }, { mobile: '3' });
    expect(canApply(rs, none)).toBe(false);
    expect(canApply(rs, new Map([['mobile', 'server']]))).toBe(true);
  });

  it('show-all rows are unchanged and ignored by resultProps', () => {
    const rs = review({ mobile: '1', email: 'a' }, { mobile: '2', email: 'a' }, { mobile: '1', email: 'a' });
    const same = rs.filter((x) => !x.changed);
    expect(same.map((x) => x.property)).toEqual(['email']);
    expect(same[0].preselect).toBe('server');
    expect(isUpToDate(rs)).toBe(false);
    expect(isUpToDate(same)).toBe(true);
    expect(canApply(same, none)).toBe(true);
    expect(resultProps(rs, new Map([['email', 'local']]), { mobile: '2', email: 'a' })).toEqual({ mobile: '2', email: 'a' });
  });

  it('sorts in mapping order with ordinals', () => {
    const order = rows.map((r) => r.property);
    const rs = review({}, { 'mobile-2': 'b', email: 'e', mobile: 'a' }, {});
    const names = rs.map((x) => x.property);
    expect(names).toEqual(['mobile', 'mobile-2', 'email'].sort((a, b) => order.indexOf(a.replace(/-2$/, '')) - order.indexOf(b.replace(/-2$/, '')) || a.localeCompare(b)));
  });

  it('photo data uri equals bare base64 of the same image', () => {
    const rs = review({ photo: 'QUJD' }, { photo: 'QUJD' }, { photo: 'data:image/jpeg;base64,QUJD' });
    expect(changed(rs)).toEqual([]);
    expect(rs.find((x) => x.property === 'photo')?.kind).toBe('photo');
  });
});
