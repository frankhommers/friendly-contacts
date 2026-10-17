import { mirrorRelationsKey, readMirrorRelations, writeMirrorRelations } from 'src/settings/deviceSettings';
import { describe, expect, it } from 'vitest';

function memoryStore() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe('mirror relationships per device', () => {
  it('defaults to on for desktop and off for mobile', () => {
    const store = memoryStore();
    expect(readMirrorRelations(store, 'Vault', false)).toBe(true);
    expect(readMirrorRelations(store, 'Vault', true)).toBe(false);
  });

  it('keeps the choice per vault under friendly-contacts:mirror-relations:<vault>', () => {
    const store = memoryStore();
    writeMirrorRelations(store, 'Vault', false);
    expect(store.items.get('friendly-contacts:mirror-relations:Vault')).toBe('false');
    expect(mirrorRelationsKey('Other')).toBe('friendly-contacts:mirror-relations:Other');
    expect(readMirrorRelations(store, 'Vault', false)).toBe(false);
    expect(readMirrorRelations(store, 'Other', false)).toBe(true);
    writeMirrorRelations(store, 'Other', true);
    expect(readMirrorRelations(store, 'Other', true)).toBe(true);
  });
});
