import { describe, expect, it } from 'vitest';
import {
  hasKeysInData,
  keychainOf,
  secretIdFor,
  SecretStore,
  withKeysFromStore,
  withKeysInStore,
} from 'src/settings/secretStore';

/** A keychain like Obsidian's: ids are checked, deleteSecret removes. */
function fakeKeychain(initial: Record<string, string> = {}): SecretStore & { secrets: Record<string, string> } {
  const secrets = { ...initial };
  return {
    secrets,
    getSecret: (id) => (id in secrets ? secrets[id] : null),
    setSecret: (id, secret) => {
      if (!/^[a-z0-9-]+$/.test(id) || id.length > 64) throw new Error('invalid id');
      secrets[id] = secret;
    },
    listSecrets: () => Object.keys(secrets),
    deleteSecret: (id) => delete secrets[id],
  };
}

const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';
const book = (id: string, authKey: string) => ({ id, name: `Book ${id}`, addressBookUrl: 'https://dav.example/', authType: 'basic', authKey, enabled: true });

describe('keychain for address book keys', () => {
  it('makes valid secret ids from source ids', () => {
    expect(secretIdFor(uuid)).toBe(`friendly-contacts-${uuid}`);
    expect(secretIdFor('carddav')).toBe('friendly-contacts-carddav');
    expect(secretIdFor('My Book!')).toBe('friendly-contacts-my-book');
    expect(secretIdFor('x'.repeat(80)).length).toBe(64);
  });

  it('finds the keychain of an Obsidian that has one', () => {
    const keychain = fakeKeychain();
    expect(keychainOf({ secretStorage: keychain })).toBe(keychain);
    expect(keychainOf({})).toBeUndefined();
  });

  it('saves the key in the keychain and an empty key in data.json', () => {
    const keychain = fakeKeychain();
    const settings = { contactsFolder: 'Contacts', sources: [book(uuid, 'c2VjcmV0')] };
    const { data, failed } = withKeysInStore(settings, keychain);
    expect(failed).toEqual([]);
    expect(data.sources[0].authKey).toBe('');
    expect(JSON.stringify(data)).not.toContain('c2VjcmV0');
    expect(keychain.secrets[`friendly-contacts-${uuid}`]).toBe('c2VjcmV0');
    expect(settings.sources[0].authKey).toBe('c2VjcmV0');
  });

  it('loads the key from the keychain', () => {
    const keychain = fakeKeychain({ [`friendly-contacts-${uuid}`]: 'c2VjcmV0' });
    const loaded = withKeysFromStore({ sources: [book(uuid, '')] }, keychain) as { sources: { authKey: string }[] };
    expect(loaded.sources[0].authKey).toBe('c2VjcmV0');
  });

  it('does not use a key that is in data.json', () => {
    const loaded = withKeysFromStore(
      { sources: [book(uuid, 'b2xk')], CardDAV: { addressBookUrl: 'https://dav.example/', authKey: 'b2xk' } },
      fakeKeychain(),
    ) as { sources: { authKey: string }[]; CardDAV: { authKey: string } };
    expect(loaded.sources[0].authKey).toBe('');
    expect(loaded.CardDAV.authKey).toBe('');
  });

  it('knows when data.json holds a key', () => {
    expect(hasKeysInData({ sources: [book(uuid, 'b2xk')] })).toBe(true);
    expect(hasKeysInData({ CardDAV: { authKey: 'b2xk' } })).toBe(true);
    expect(hasKeysInData({ sources: [book(uuid, '')] })).toBe(false);
    expect(hasKeysInData({})).toBe(false);
  });

  it('deletes a forgotten key and the key of a removed address book', () => {
    const other = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const keychain = fakeKeychain({
      [`friendly-contacts-${uuid}`]: 'a2V5',
      [`friendly-contacts-${other}`]: 'b3RoZXI=',
      'another-plugin-token': 'kept',
    });
    withKeysInStore({ sources: [book(uuid, '')] }, keychain);
    expect(keychain.secrets).toEqual({ 'another-plugin-token': 'kept' });
  });

  it('reports a key it could not keep, and never writes it to data.json', () => {
    const { data, failed } = withKeysInStore({ sources: [book(uuid, 'c2VjcmV0')] }, undefined);
    expect(failed).toEqual([`Book ${uuid}`]);
    expect(data.sources[0].authKey).toBe('');

    const broken = fakeKeychain();
    broken.setSecret = () => {
      throw new Error('Secure storage is not available.');
    };
    expect(withKeysInStore({ sources: [book(uuid, 'c2VjcmV0')] }, broken).failed).toEqual([`Book ${uuid}`]);
  });

  it('does not touch the keychain when nothing changed', () => {
    const keychain = fakeKeychain({ [`friendly-contacts-${uuid}`]: 'a2V5' });
    let writes = 0;
    const set = keychain.setSecret;
    keychain.setSecret = (id, secret) => {
      writes++;
      set(id, secret);
    };
    withKeysInStore({ sources: [book(uuid, 'a2V5'), book('carddav', '')] }, keychain);
    expect(writes).toBe(0);
  });
});
