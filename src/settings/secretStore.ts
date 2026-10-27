/**
 * Passwords and API keys of address books live in Obsidian's keychain (`app.secretStorage`), never in data.json.
 * The keychain belongs to this vault on this device: it is encrypted by the system and kept outside the vault, so
 * file sync, git and backups of the vault do not carry it. A password typed on one device is not on another one.
 *
 * data.json always holds an empty `authKey`. A key found there (written by an earlier version) is not used and is
 * gone with the next save.
 */

/** The part of Obsidian's SecretStorage used here. */
export interface SecretStore {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
  listSecrets?(): string[];
  deleteSecret?(id: string): boolean;
}

export const SECRET_PREFIX = "friendly-contacts-";

let current: SecretStore | undefined;

/** The keychain of this vault; undefined when Obsidian has none. */
export const secretStore = (): SecretStore | undefined => current;

export function setSecretStore(store: SecretStore | undefined): void {
  current = store;
}

/** Obsidian's keychain, when this Obsidian has one. */
export function keychainOf(app: unknown): SecretStore | undefined {
  const store = (app as { secretStorage?: Partial<SecretStore> } | undefined)?.secretStorage;
  return typeof store?.getSecret === "function" && typeof store.setSecret === "function" ? (store as SecretStore) : undefined;
}

/** The id of an address book's secret: lowercase letters, digits and dashes, at most 64 characters. */
export function secretIdFor(sourceId: string): string {
  const clean = sourceId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${SECRET_PREFIX}${clean || "source"}`.slice(0, 64);
}

type Loose = Record<string, unknown>;

const sourcesOf = (data: unknown): Loose[] | undefined => {
  const sources = (data as Loose | undefined)?.sources;
  return Array.isArray(sources) ? (sources as Loose[]) : undefined;
};

function read(store: SecretStore | undefined, id: string): string {
  if (!store) return "";
  try {
    return store.getSecret(id) ?? "";
  } catch {
    return "";
  }
}

/** True when data.json holds a password or API key (also in the CardDAV block of old versions). */
export function hasKeysInData(loaded: unknown): boolean {
  const legacy = (loaded as Loose | undefined)?.CardDAV as Loose | undefined;
  if (typeof legacy?.authKey === "string" && legacy.authKey !== "") return true;
  return (sourcesOf(loaded) ?? []).some((source) => typeof source.authKey === "string" && source.authKey !== "");
}

/** data.json as loaded, with each address book's key from the keychain; keys in data.json itself are not used. */
export function withKeysFromStore(loaded: unknown, store: SecretStore | undefined): unknown {
  if (loaded === null || typeof loaded !== "object") return loaded;
  const data = { ...(loaded as Loose) };
  const legacy = data.CardDAV as Loose | undefined;
  if (legacy && typeof legacy === "object") data.CardDAV = { ...legacy, authKey: "" };
  const sources = sourcesOf(loaded);
  if (sources) {
    data.sources = sources.map((source) => ({ ...source, authKey: read(store, secretIdFor(String(source.id ?? ""))) }));
  }
  return data;
}

/**
 * The settings as data.json gets them, without keys: each key goes to the keychain. The names of the address
 * books whose key the keychain did not take are in `failed` (the key is then not saved anywhere). Secrets of
 * address books that are gone are deleted. The settings given are not changed.
 */
export function withKeysInStore<T>(data: T, store: SecretStore | undefined): { data: T; failed: string[] } {
  const sources = sourcesOf(data);
  if (!sources) return { data, failed: [] };
  const failed: string[] = [];
  for (const source of sources) {
    const key = typeof source.authKey === "string" ? source.authKey : "";
    const id = secretIdFor(String(source.id ?? ""));
    if (read(store, id) === key) continue;
    try {
      if (!store) throw new Error("no keychain");
      if (key === "") remove(store, id);
      else store.setSecret(id, key);
      if (read(store, id) !== key) throw new Error("not kept");
    } catch {
      failed.push(String(source.name ?? source.id ?? ""));
    }
  }
  if (store) forgetRemoved(store, new Set(sources.map((source) => secretIdFor(String(source.id ?? "")))));
  return { data: { ...(data as Loose), sources: sources.map((source) => ({ ...source, authKey: "" })) } as T, failed };
}

function remove(store: SecretStore, id: string): void {
  if (typeof store.deleteSecret === "function") store.deleteSecret(id);
  else store.setSecret(id, "");
}

function forgetRemoved(store: SecretStore, kept: Set<string>): void {
  let ids: string[];
  try {
    ids = store.listSecrets?.() ?? [];
  } catch {
    return;
  }
  for (const id of ids) {
    if (!id.startsWith(SECRET_PREFIX) || kept.has(id)) continue;
    try {
      remove(store, id);
    } catch {
      // Left as it is; nothing reads it.
    }
  }
}
