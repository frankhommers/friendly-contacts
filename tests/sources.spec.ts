import { findSourceByName, migrateSources, sourceNameFromUrl, validateSourceName } from 'src/sync/sources';
import type { Source } from 'src/settings/settings.d';
import { describe, expect, it, vi } from 'vitest';

const legacy = (syncEnabled: boolean) => ({
  syncEnabled,
  syncSelected: 'CardDAV',
  CardDAV: { addressBookUrl: 'https://pim.example/frank/contacts/', authType: 'basic', authKey: 'k', syncInterval: 900 },
});

const source = (id: string, name: string): Source => ({
  id, name, addressBookUrl: `https://x/${id}/`, authType: 'basic', authKey: 'k', enabled: true,
});

describe('migrateSources', () => {
  it('migrates the single CardDAV block', () => {
    expect(migrateSources(legacy(true), () => 'id1')).toEqual({
      sources: [{
        id: 'id1', name: 'contacts', addressBookUrl: 'https://pim.example/frank/contacts/',
        authType: 'basic', authKey: 'k', enabled: true,
      }],
      defaultSource: 'id1',
      migratedFrom: 'id1',
    });
  });

  it('migration keeps sync off when it was off', () => {
    expect(migrateSources(legacy(false), () => 'id1').sources[0].enabled).toBe(false);
  });

  it('migration is idempotent', () => {
    const newId = vi.fn(() => 'other');
    const input = { sources: [source('a', 'A'), source('b', 'B')], defaultSource: 'b', ...legacy(true) };
    const result = migrateSources(input, newId);
    expect(result).toEqual({ sources: input.sources, defaultSource: 'b' });
    expect('migratedFrom' in result).toBe(false);
    expect(newId).not.toHaveBeenCalled();
  });

  it('falls back to the first source as default', () => {
    expect(migrateSources({ sources: [source('a', 'A')] }, () => 'x').defaultSource).toBe('a');
  });

  it('no CardDAV url gives no sources', () => {
    expect(migrateSources({ CardDAV: { addressBookUrl: '' } }, () => 'id1')).toEqual({ sources: [], defaultSource: '' });
  });
});

describe('sourceNameFromUrl', () => {
  it('names a source after the url', () => {
    expect(sourceNameFromUrl('https://x/a/Family%20Book/')).toBe('Family Book');
    expect(sourceNameFromUrl('https://x/')).toBe('Contacts');
  });
});

describe('validateSourceName', () => {
  const sources = [source('a', 'Family')];
  it('validates names', () => {
    expect(validateSourceName('', sources)).toBeTypeOf('string');
    expect(validateSourceName('  ', sources)).toBeTypeOf('string');
    expect(validateSourceName('family', sources)).toBeTypeOf('string');
    expect(validateSourceName('family', sources, 'a')).toBeUndefined();
    expect(validateSourceName('Work', sources)).toBeUndefined();
  });
});

describe('findSourceByName', () => {
  it('finds a source by name', () => {
    const sources = [source('a', 'Family')];
    expect(findSourceByName(sources, ' FAMILY ')).toBe(sources[0]);
    expect(findSourceByName(sources, 'Work')).toBeUndefined();
  });
});
