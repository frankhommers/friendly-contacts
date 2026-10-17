import { createSyncState, FileStore } from 'src/sync/syncState';
import { cleanUid, generateUUID, uidOutOfString } from 'src/util/vcard';
import { describe, expect, it } from 'vitest';

describe('cleanUid', () => {
  it('strips only a leading urn:uuid:', () => {
    expect(cleanUid('urn:uuid:abc')).toBe('abc');
    expect(cleanUid('URN:UUID:abc')).toBe('abc');
    expect(cleanUid('  urn:uuid:abc ')).toBe('abc');
    expect(cleanUid('XXXX:ABPerson')).toBe('XXXX:ABPerson');
    expect(cleanUid('YYYY:ABPerson')).toBe('YYYY:ABPerson');
    expect(cleanUid('abc')).toBe('abc');
    expect(cleanUid(undefined)).toBe('');
  });
});

describe('uidOutOfString', () => {
  it('reads the UID value of a card', () => {
    expect(uidOutOfString('BEGIN:VCARD\r\nUID:urn:uuid:abc\r\nEND:VCARD')).toBe('abc');
    expect(uidOutOfString('BEGIN:VCARD\r\nUID:XXXX:ABPerson\r\nEND:VCARD')).toBe('XXXX:ABPerson');
    expect(uidOutOfString('BEGIN:VCARD\nuid;VALUE=text:abc-1\nEND:VCARD')).toBe('abc-1');
    expect(uidOutOfString('BEGIN:VCARD\nFN:x\nEND:VCARD')).toBeUndefined();
  });
});

describe('sync state of legacy macOS UIDs', () => {
  it('keeps cards whose UIDs share the text after the last colon apart', async () => {
    const files = new Map<string, string>();
    const store: FileStore = {
      read: async (path) => files.get(path),
      write: async (path, data) => void files.set(path, data),
      remove: async (path) => void files.delete(path),
    };
    const state = createSyncState(store, 'sync');
    const entry = (raw: string) => ({ raw, etag: 'e', href: '/x.vcf' });
    await state.set('XXXX:ABPerson', entry('one'));
    await state.set('YYYY:ABPerson', entry('two'));
    await state.set('XXXX_ABPerson', entry('three'));
    expect((await state.get('XXXX:ABPerson'))?.raw).toBe('one');
    expect((await state.get('YYYY:ABPerson'))?.raw).toBe('two');
    expect((await state.get('XXXX_ABPerson'))?.raw).toBe('three');
    expect(await state.get('ABPerson')).toBeUndefined();
    expect([...files.keys()].filter((p) => p.endsWith('.vcf'))).toHaveLength(3);
  });
});

describe('generateUUID', () => {
  it('returns a well-formed version 4 UUID', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateUUID()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
