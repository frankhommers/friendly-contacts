import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { convertFrontmatter, renameInFrontmatter } from 'src/contacts/convertNotes';
import { describe, expect, it } from 'vitest';

describe('convertFrontmatter', () => {
  it('turns vCard keys into friendly properties and leaves other keys alone', () => {
    const fm = { FN: 'Jan', 'N.GN': 'Jan', 'N.FN': 'de Vries', 'TEL[CELL]': '06', 'met-via': '[[Piet]]' };
    const result = convertFrontmatter(fm, DEFAULT_MAPPING);
    expect(result.set).toEqual({ name: 'Jan', firstname: 'Jan', lastname: 'de Vries', mobile: '06' });
    expect(result.remove).toEqual(expect.arrayContaining(['FN', 'N.GN', 'N.FN', 'TEL[CELL]']));
    expect(result.remove).not.toContain('met-via');
    expect(result.kept).toEqual([]);
  });

  it('is idempotent on an already friendly note', () => {
    const fm = { name: 'Jan', firstname: 'Jan', mobile: '06', uid: 'urn:uuid:1', children: ['[[Sem]]'] };
    expect(convertFrontmatter(fm, DEFAULT_MAPPING)).toEqual({ set: {}, remove: [], kept: [] });
  });

  it('converts the UID and numbers extra values', () => {
    const fm = { FN: 'Jan', UID: 'urn:uuid:1', TEL: '1', 'TEL[HOME]': '2' };
    const { set } = convertFrontmatter(fm, DEFAULT_MAPPING);
    expect(set).toMatchObject({ uid: 'urn:uuid:1', phone: '1', 'phone-2': '2' });
  });

  it('keeps an existing different friendly value, removes the vCard key and reports the conflict', () => {
    const fm = { FN: 'Jan de Vries', name: 'Johan', 'TEL[CELL]': '06' };
    const result = convertFrontmatter(fm, DEFAULT_MAPPING);
    expect(result.set).toEqual({ mobile: '06' });
    expect(result.remove).toContain('FN');
    expect(result.kept).toEqual(['name']);
  });

  it('does not set a friendly value the note already has', () => {
    const result = convertFrontmatter({ FN: 'Jan', name: 'Jan' }, DEFAULT_MAPPING);
    expect(result).toEqual({ set: {}, remove: ['FN'], kept: [] });
  });

  it('does not remove a vCard key whose data has no friendly property', () => {
    const result = convertFrontmatter({ FN: 'Jan', 'X-CUSTOM': 'keep me' }, DEFAULT_MAPPING);
    expect(result.set).toEqual({ name: 'Jan' });
    expect(result.remove).toEqual(['FN']);
  });

  it('ignores empty vCard keys', () => {
    expect(convertFrontmatter({ FN: '', name: 'Jan' }, DEFAULT_MAPPING)).toEqual({ set: {}, remove: [], kept: [] });
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

  it('skips a note where the new name already has a value', () => {
    expect(renameInFrontmatter({ mobile: '06', cell: '07' }, 'mobile', 'cell')).toEqual({ skipped: true });
  });

  it('does nothing for a note without the property', () => {
    expect(renameInFrontmatter({ name: 'Jan' }, 'mobile', 'cell')).toEqual({ set: {}, remove: [] });
  });
});
