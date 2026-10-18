import {
  CardLocation,
  findSourceByName,
  migrateSources,
  noteSourceId,
  patchSource,
  planSync,
  removalBlocker,
  sourceNameFromUrl,
  uidAlreadyImported,
  uniqueSourceName,
  validateSourceName,
  withoutSource,
  withSource,
} from 'src/sync/sources';
import type { Source } from 'src/settings/settings.d';
import { describe, expect, it } from 'vitest';

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
    expect(migrateSources(legacy(true))).toEqual({
      sources: [{
        id: 'carddav', name: 'contacts', addressBookUrl: 'https://pim.example/frank/contacts/',
        authType: 'basic', authKey: 'k', enabled: true,
      }],
      defaultSource: 'carddav',
      migratedFrom: 'carddav',
    });
  });

  it('migration keeps sync off when it was off', () => {
    expect(migrateSources(legacy(false)).sources[0].enabled).toBe(false);
  });

  it('migration is idempotent', () => {
    const input = { sources: [source('a', 'A'), source('b', 'B')], defaultSource: 'b', ...legacy(true) };
    const result = migrateSources(input);
    expect(result).toEqual({ sources: input.sources, defaultSource: 'b' });
    expect('migratedFrom' in result).toBe(false);
  });

  it('falls back to the first source as default', () => {
    expect(migrateSources({ sources: [source('a', 'A')] }).defaultSource).toBe('a');
  });

  it('no CardDAV url gives no sources', () => {
    expect(migrateSources({ CardDAV: { addressBookUrl: '' } })).toEqual({ sources: [], defaultSource: '' });
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

describe('noteSourceId', () => {
  const sources = [source('p', 'Private'), source('f', 'Family'), { ...source('w', 'Work'), enabled: false }];

  it('unknown or disabled source refuses', () => {
    expect(noteSourceId('Office', sources, ['p'], 'p')).toEqual({ error: "Unknown address book 'Office'" });
    expect(noteSourceId('work', sources, ['p'], 'p')).toEqual({ error: "Address book 'Work' is not enabled" });
    // Never a fallback to the base or the default.
    expect(noteSourceId(' family ', sources, ['p'], 'p')).toEqual({ id: 'f' });
  });

  it('no source uses the source holding the base', () => {
    expect(noteSourceId(undefined, sources, ['f', 'p'], 'p')).toEqual({ id: 'f' });
  });

  it('no source with the base only in a disabled source refuses', () => {
    // The card may still be there: never create a second copy in the default.
    expect(noteSourceId(undefined, sources, ['w'], 'p')).toEqual({ error: "Address book 'Work' is not enabled" });
  });

  it('no source and no base uses the default', () => {
    expect(noteSourceId(undefined, sources, [], 'f')).toEqual({ id: 'f' });
    expect(noteSourceId(undefined, sources, [], '')).toEqual({ error: 'No address book is set up' });
    expect(noteSourceId(undefined, sources, [], 'gone')).toEqual({ error: 'No address book is set up' });
    expect(noteSourceId(undefined, sources, [], 'w')).toEqual({ error: "Address book 'Work' is not enabled" });
  });
});

describe('planSync', () => {
  const names: Record<string, string> = { p: 'Private', f: 'Family', w: 'Work' };
  const name = (id: string) => names[id] ?? id;
  const at = (sourceId: string): CardLocation => ({ sourceId, href: `/${sourceId}/jan.vcf`, etag: `e-${sourceId}` });

  it('card in own source syncs', () => {
    expect(planSync({ id: 'p', explicit: true }, [at('p')], name)).toEqual({ kind: 'sync', sourceId: 'p' });
    expect(planSync({ id: 'p', explicit: false }, [at('f'), at('p'), at('w')], name)).toEqual({ kind: 'sync', sourceId: 'p' });
  });

  it('card nowhere creates in own source', () => {
    expect(planSync({ id: 'f', explicit: true }, [], name)).toEqual({ kind: 'sync', sourceId: 'f' });
    expect(planSync({ id: 'f', explicit: false }, [], name)).toEqual({ kind: 'sync', sourceId: 'f' });
  });

  it('card only elsewhere is adopted without source', () => {
    expect(planSync({ id: 'p', explicit: false }, [at('f')], name)).toEqual({ kind: 'adopt', sourceId: 'f' });
  });

  it('card only elsewhere is moved with explicit source', () => {
    expect(planSync({ id: 'p', explicit: true }, [at('f')], name)).toEqual({ kind: 'move', from: at('f'), to: 'p' });
  });

  it('explicit source with the card nowhere refuses when another book holds a base', () => {
    const disabled = planSync({ id: 'p', explicit: true }, [], name, [{ id: 'f', active: false }]);
    expect(disabled).toEqual({
      kind: 'refuse',
      message: expect.stringMatching(/^The card was last synced with Family, which is disabled; /),
    });
    const gone = planSync({ id: 'p', explicit: true }, [], name, [{ id: 'f', active: true }]);
    expect(gone).toEqual({
      kind: 'refuse',
      message: expect.stringMatching(/^The card was last synced with Family, where the card is gone; /),
    });
  });

  it('a base in the target itself, or no explicit source, still syncs when the card is nowhere', () => {
    expect(planSync({ id: 'p', explicit: true }, [], name, [{ id: 'p', active: true }])).toEqual({ kind: 'sync', sourceId: 'p' });
    expect(planSync({ id: 'p', explicit: false }, [], name, [{ id: 'f', active: true }])).toEqual({ kind: 'sync', sourceId: 'p' });
    // The card was found elsewhere: that is a move, whatever bases exist.
    expect(planSync({ id: 'p', explicit: true }, [at('w')], name, [{ id: 'f', active: false }]))
      .toEqual({ kind: 'move', from: at('w'), to: 'p' });
  });

  it('card in two other sources refuses and names them', () => {
    for (const explicit of [true, false]) {
      const plan = planSync({ id: 'p', explicit }, [at('f'), at('w')], name);
      expect(plan.kind).toBe('refuse');
      expect(plan.kind === 'refuse' && plan.message).toMatch(/^The card is in Family and Work; /);
    }
  });
});

describe('address book list helpers', () => {
  it('names a new address book uniquely', () => {
    expect(uniqueSourceName([])).toBe('Address book');
    expect(uniqueSourceName([source('a', 'address book'), source('b', 'Address book 2')])).toBe('Address book 3');
  });

  it('adds the first source as default and keeps the default afterwards', () => {
    const first = withSource({ sources: [] as Source[], defaultSource: '' }, source('a', 'A'));
    expect(first).toEqual({ sources: [source('a', 'A')], defaultSource: 'a' });
    const second = withSource(first, source('b', 'B'));
    expect(second.defaultSource).toBe('a');
    expect(second.sources.map((s) => s.id)).toEqual(['a', 'b']);
    expect(withSource(second, { ...source('b', 'B2') }).sources.map((s) => s.name)).toEqual(['A', 'B2']);
  });

  it('removes a source', () => {
    const list = { sources: [source('a', 'A'), source('b', 'B')], defaultSource: 'a' };
    expect(withoutSource(list, 'b')).toEqual({ sources: [source('a', 'A')], defaultSource: 'a' });
  });

  it('refuses removing the default or a source in use', () => {
    const a = source('a', 'A');
    expect(removalBlocker(a, 'a', 0)).toBe('Make another address book the default first.');
    expect(removalBlocker(a, 'b', 3)).toBe('3 contacts use A.');
    expect(removalBlocker(a, 'b', 0)).toBeUndefined();
  });
});

describe('patchSource', () => {
  it('a stale patch does not revert a newer rename', () => {
    const current = { sources: [{ ...source('a', 'New'), enabled: false }], defaultSource: 'a' };
    const next = patchSource(current, 'a', { enabled: true });
    expect(next?.sources[0]).toMatchObject({ id: 'a', name: 'New', enabled: true });
    expect(patchSource(current, 'gone', { enabled: true })).toBeUndefined();
    expect(patchSource(current, 'a', { id: 'x', authKey: 'z' } as never)?.sources[0].id).toBe('a');
  });
});

describe('uidAlreadyImported', () => {
  it('knows a UID that has a note, ignoring the urn:uuid: prefix', () => {
    expect(uidAlreadyImported('abc', ['x', 'abc'], new Set())).toBe(true);
    expect(uidAlreadyImported('urn:uuid:abc', ['abc'], new Set())).toBe(true);
    expect(uidAlreadyImported('abc', ['urn:uuid:abc'], new Set())).toBe(true);
    expect(uidAlreadyImported('abc', ['x', undefined], new Set())).toBe(false);
  });

  it('knows a UID imported earlier in the same run', () => {
    expect(uidAlreadyImported('abc', [], new Set(['abc']))).toBe(true);
    expect(uidAlreadyImported('def', [], new Set(['abc']))).toBe(false);
  });

  it('a card without a UID is never known', () => {
    expect(uidAlreadyImported(undefined, [undefined, ''], new Set(['']))).toBe(false);
    expect(uidAlreadyImported('', [''], new Set(['']))).toBe(false);
  });
});
