import { importCandidates } from 'src/sync/sources';
import { describe, expect, it } from 'vitest';

const remote = (uid: string, fileName: string, sourceId = 's1') => ({
  uid, fileName, sourceId, href: `/${uid}.vcf`, etag: 'e',
});

describe('importCandidates', () => {
  it('offers only cards without a note', () => {
    const list = [remote('a', 'Anna'), remote('b', 'Bob'), remote('c', 'Cleo')];
    expect(importCandidates(list, ['b']).map((r) => r.uid)).toEqual(['a', 'c']);
  });

  it('offers a uid in two sources twice', () => {
    const list = [remote('a', 'Anna', 's1'), remote('a', 'Anna', 's2')];
    expect(importCandidates(list, []).map((r) => r.sourceId)).toEqual(['s1', 's2']);
    expect(importCandidates(list, ['a'])).toEqual([]);
  });

  it('sorts by name', () => {
    const list = [remote('c', 'Cleo'), remote('a', 'anna'), remote('b', 'Bob')];
    expect(importCandidates(list, []).map((r) => r.fileName)).toEqual(['anna', 'Bob', 'Cleo']);
  });

  it('keeps the input untouched', () => {
    const list = [remote('b', 'Bob'), remote('a', 'Anna')];
    importCandidates(list, []);
    expect(list.map((r) => r.uid)).toEqual(['b', 'a']);
  });
});
