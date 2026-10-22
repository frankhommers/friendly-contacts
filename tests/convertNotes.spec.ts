import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { blockedNotes, convertFrontmatter, renameAllInFrontmatter, renameInFrontmatter } from 'src/contacts/convertNotes';
import { hasVCardValues } from 'src/contacts/friendlyNotes';
import { describe, expect, it } from 'vitest';

describe('convertFrontmatter', () => {
  it('turns vCard keys into friendly properties and leaves other keys alone', () => {
    const fm = { FN: 'Jan', 'N.GN': 'Jan', 'N.FN': 'de Vries', 'TEL[CELL]': '06', 'met-via': '[[Piet]]' };
    const result = convertFrontmatter(fm, DEFAULT_MAPPING);
    expect(result.set).toEqual({ name: 'Jan', firstname: 'Jan', lastname: 'de Vries', mobile: '06' });
    expect(result.remove).toEqual(expect.arrayContaining(['FN', 'N.GN', 'N.FN', 'TEL[CELL]']));
    expect(result.remove).not.toContain('met-via');
    expect(result.moved).toEqual([]);
  });

  it('is idempotent on an already friendly note', () => {
    const fm = { name: 'Jan', firstname: 'Jan', mobile: '06', uid: 'urn:uuid:1', children: ['[[Sem]]'] };
    expect(convertFrontmatter(fm, DEFAULT_MAPPING)).toEqual({ set: {}, remove: [], moved: [] });
  });

  it('converts the UID and numbers extra values', () => {
    const fm = { FN: 'Jan', UID: 'urn:uuid:1', TEL: '1', 'TEL[HOME]': '2' };
    const { set } = convertFrontmatter(fm, DEFAULT_MAPPING);
    expect(set).toMatchObject({ uid: 'urn:uuid:1', phone: '1', 'phone-2': '2' });
  });

  it('keeps an existing different text value and moves the vCard value to the next free slot', () => {
    const fm = { FN: 'Jan de Vries', name: 'Johan', 'name-2': 'J.', 'TEL[CELL]': '06' };
    const result = convertFrontmatter(fm, DEFAULT_MAPPING);
    expect(result.set).toEqual({ mobile: '06', 'name-3': 'Jan de Vries' });
    expect(result.remove).toContain('FN');
    expect(result.moved).toEqual(['name -> name-3']);
  });

  it('numbers around values the vCard itself brings along', () => {
    const fm = { phone: 'A', TEL: '1', 'TEL[HOME]': '2' };
    expect(convertFrontmatter(fm, DEFAULT_MAPPING).set).toEqual({ 'phone-2': '1', 'phone-3': '2' });
  });

  it('merges list values without duplicates', () => {
    const fm = { CATEGORIES: 'family,work', categories: ['work', 'club'] };
    const result = convertFrontmatter(fm, DEFAULT_MAPPING);
    expect(result.set).toEqual({ categories: ['work', 'club', 'family'] });
    expect(result.moved).toEqual(['categories (merged)']);
    expect(result.remove).toEqual(['CATEGORIES']);
  });

  it('adds nothing when the slots already hold the vCard value', () => {
    const result = convertFrontmatter({ FN: 'Jan', name: 'Johan', 'name-2': 'Jan' }, DEFAULT_MAPPING);
    expect(result).toEqual({ set: {}, remove: ['FN'], moved: [] });
  });

  it('does not set a friendly value the note already has', () => {
    const result = convertFrontmatter({ FN: 'Jan', name: 'Jan' }, DEFAULT_MAPPING);
    expect(result).toEqual({ set: {}, remove: ['FN'], moved: [] });
  });

  it('does not remove a vCard key whose data has no friendly property', () => {
    const result = convertFrontmatter({ FN: 'Jan', 'X-CUSTOM': 'keep me' }, DEFAULT_MAPPING);
    expect(result.set).toEqual({ name: 'Jan' });
    expect(result.remove).toEqual(['FN']);
  });

  it('leaves a note that Sync no longer refuses', () => {
    const fm: Record<string, unknown> = { FN: 'Jan', UID: 'urn:uuid:1', 'TEL[CELL]': '06', 'X-CUSTOM': '2019' };
    const { set, remove } = convertFrontmatter(fm, DEFAULT_MAPPING);
    Object.assign(fm, set);
    remove.forEach((key) => delete fm[key]);
    expect(fm['X-CUSTOM']).toBe('2019');
    expect(hasVCardValues(fm, DEFAULT_MAPPING)).toBe(false);
  });

  it('ignores empty vCard keys', () => {
    expect(convertFrontmatter({ FN: '', name: 'Jan' }, DEFAULT_MAPPING)).toEqual({ set: {}, remove: [], moved: [] });
  });
});

describe('convertFrontmatter technical keys', () => {
  it('removes vCard noise and empty name prefix/suffix, keeps other unmapped keys', () => {
    const fm = {
      FN: 'Jan',
      VERSION: '3.0',
      PRODID: '-//Apple Inc.//iPhone OS 17.0//EN',
      REV: '2024-01-01T00:00:00Z',
      'X-CREATED': '2019-04-02T10:11:12Z',
      'X-ABLABEL': '_$!<Mobile>!$_',
      'X-ABLABEL[1:]': 'werk',
      'X-ABSHOWAS': 'COMPANY',
      'N.PREFIX': '',
      'N.SUFFIX': null,
      'X-CUSTOM': 'keep me',
      'TEL[WORK,FAX]': '030',
      'met-via': 'x',
    };
    const result = convertFrontmatter(fm, DEFAULT_MAPPING);
    expect(result.set).toEqual({ name: 'Jan' });
    expect([...result.remove].sort()).toEqual(
      ['FN', 'VERSION', 'PRODID', 'REV', 'X-CREATED', 'X-ABLABEL', 'X-ABLABEL[1:]', 'X-ABSHOWAS', 'N.PREFIX', 'N.SUFFIX'].sort(),
    );
  });

  it('moves a name prefix or suffix that has a value to its friendly property', () => {
    const result = convertFrontmatter({ FN: 'Jan', 'N.PREFIX': 'Dr.', 'N.SUFFIX': 'jr' }, DEFAULT_MAPPING);
    expect(result.set).toEqual({ name: 'Jan', 'name-prefix': 'Dr.', 'name-suffix': 'jr' });
    expect(result.remove).toEqual(['FN', 'N.PREFIX', 'N.SUFFIX']);
  });

  it('converts an old-style GENDER and N.PREFIX to their friendly properties', () => {
    const result = convertFrontmatter({ FN: 'Jan', GENDER: 'M', 'N.PREFIX': 'Dr' }, DEFAULT_MAPPING);
    expect(result.set).toMatchObject({ gender: 'M', 'name-prefix': 'Dr' });
    expect(result.remove).toEqual(expect.arrayContaining(['GENDER', 'N.PREFIX']));
  });

  it('cleans technical keys from an otherwise friendly note', () => {
    expect(convertFrontmatter({ name: 'Jan', 'X-CREATED': '2019', VERSION: '3.0' }, DEFAULT_MAPPING)).toEqual({
      set: {},
      remove: ['X-CREATED', 'VERSION'],
      moved: [],
    });
  });
});

describe('renameInFrontmatter', () => {
  it('moves the value to the new name', () => {
    expect(renameInFrontmatter({ mobile: '06', name: 'Jan' }, 'mobile', 'cell')).toEqual({
      set: { cell: '06' },
      remove: ['mobile'],
    });
  });

  it('moves extra values too', () => {
    expect(renameInFrontmatter({ phone: '1', 'phone-2': '2' }, 'phone', 'tel')).toEqual({
      set: { tel: '1', 'tel-2': '2' },
      remove: ['phone', 'phone-2'],
    });
  });

  it('blocks a note where the new name already has a value', () => {
    expect(renameInFrontmatter({ mobile: '06', cell: '07' }, 'mobile', 'cell')).toEqual({ blocked: ['cell'] });
  });

  it('does nothing for a note without the property', () => {
    expect(renameInFrontmatter({ name: 'Jan' }, 'mobile', 'cell')).toEqual({ set: {}, remove: [] });
  });
});

describe('renameAllInFrontmatter', () => {
  it('applies several renames at once, so swapped and chained names do not collide', () => {
    const fm = { cell: '06', mobile: '030', 'mobile-2': '010', name: 'Jan' };
    expect(renameAllInFrontmatter(fm, [{ from: 'cell', to: 'mobile' }, { from: 'mobile', to: 'phone' }])).toEqual({
      set: { mobile: '06', phone: '030', 'phone-2': '010' },
      remove: ['cell', 'mobile-2'],
    });
  });

  it('reports the target names that hold a value that stays', () => {
    expect(renameAllInFrontmatter({ mobile: '06', cell: '07' }, [{ from: 'mobile', to: 'cell' }])).toEqual({ blocked: ['cell'] });
  });
});

describe('blockedNotes', () => {
  const notes = [
    { path: 'a.md', fm: { mobile: '06' } },
    { path: 'b.md', fm: { mobile: '07', cell: '08' } },
    { path: 'c.md', fm: { mobile: '09', cell: '' } },
    { path: 'd.md', fm: { cell: '01', mobile: '02' } },
  ];

  it('rename with an existing target is refused for all notes', () => {
    expect(blockedNotes(notes, [{ from: 'mobile', to: 'cell' }])).toEqual([
      { path: 'b.md', targets: ['cell'] },
      { path: 'd.md', targets: ['cell'] },
    ]);
  });

  it('refuses nothing when every target is free or moves away too', () => {
    expect(blockedNotes(notes, [{ from: 'mobile', to: 'phone' }])).toEqual([]);
    expect(blockedNotes(notes, [{ from: 'mobile', to: 'cell' }, { from: 'cell', to: 'phone' }])).toEqual([]);
  });
});
