import type { App } from "obsidian";
import { cleanUid } from "src/util/vcard";

export interface FileStore {
  read(path: string): Promise<string | undefined>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Paths of the files directly in `dir`; empty when `dir` does not exist. */
  list(dir: string): Promise<string[]>;
  rename(from: string, to: string): Promise<void>;
}

export interface SyncStateEntry {
  raw: string;
  etag: string;
  href: string;
  /** The card reader the base was stored with (see `Reader`); absent: stored before readers were recorded (1). */
  reader?: number;
  /** When the base was stored (ms since epoch); `set` records the time when absent. Absent: stored before it was recorded. */
  storedAt?: number;
}

export interface SyncState {
  get(uid: string): Promise<SyncStateEntry | undefined>;
  set(uid: string, entry: SyncStateEntry): Promise<void>;
  remove(uid: string): Promise<void>;
}

type SyncIndex = Record<string, { etag: string; href: string; reader?: number; storedAt?: number }>;

/** A safe file name per UID, one-to-one: other characters (and `_` itself) become `_<hex>_`. */
const fileNameOf = (uid: string) =>
  cleanUid(uid).replace(/[^A-Za-z0-9.-]/g, (c) => `_${c.codePointAt(0)!.toString(16)}_`);

/**
 * Stores the card as it was at the last successful sync ("base"), per UID:
 * `<dir>/<name>.vcf` holds the raw vCard, `<dir>/index.json` holds etag, href, reader and when it was stored.
 */
export function createSyncState(store: FileStore, dir: string): SyncState {
  const indexPath = `${dir}/index.json`;
  const rawPath = (uid: string) => `${dir}/${fileNameOf(uid)}.vcf`;

  const readIndex = async (): Promise<SyncIndex> => {
    const text = await store.read(indexPath);
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text) as SyncIndex;
    } catch {
      return {};
    }
  };

  const writeIndex = (index: SyncIndex) => store.write(indexPath, JSON.stringify(index, null, 2));

  // set/remove read-modify-write index.json; run them one at a time so concurrent calls cannot drop entries.
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = (job: () => Promise<void>): Promise<void> => {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    async get(uid) {
      const meta = (await readIndex())[cleanUid(uid)];
      const raw = await store.read(rawPath(uid));
      if (!meta || raw === undefined) {
        return undefined;
      }
      const entry: SyncStateEntry = { raw, etag: meta.etag, href: meta.href };
      if (typeof meta.reader === 'number') entry.reader = meta.reader;
      if (typeof meta.storedAt === 'number') entry.storedAt = meta.storedAt;
      return entry;
    },
    set(uid, entry) {
      return serialized(async () => {
        await store.write(rawPath(uid), entry.raw);
        const index = await readIndex();
        index[cleanUid(uid)] = {
          etag: entry.etag,
          href: entry.href,
          ...(entry.reader === undefined ? {} : { reader: entry.reader }),
          storedAt: entry.storedAt ?? Date.now(),
        };
        await writeIndex(index);
      });
    },
    remove(uid) {
      return serialized(async () => {
        await store.remove(rawPath(uid));
        const index = await readIndex();
        delete index[cleanUid(uid)];
        await writeIndex(index);
      });
    },
  };
}

const parseIndex = (text: string | undefined): SyncIndex => {
  if (!text) return {};
  try {
    return JSON.parse(text) as SyncIndex;
  } catch {
    return {};
  }
};

/**
 * Moves the sync state of the single-server days (files directly in `root`) into `root/<sourceId>/`.
 * Safe to run on every load and after an interrupted run: it merges, and the target always wins.
 * - A base the target already has (index entry and card) stays; the legacy copy is removed.
 * - Any other legacy base moves over; no target card with an index entry is ever overwritten.
 * - The root `index.json` goes last, once every legacy card is handled.
 * Returns the number of files that left `root` (moved, or dropped as a duplicate); 0 with nothing to do.
 */
export async function migrateSyncStateDir(store: FileStore, root: string, sourceId: string): Promise<number> {
  const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
  const rootFiles = await store.list(root);
  const rootIndexPath = rootFiles.find((path) => nameOf(path) === 'index.json');
  const rootCards = rootFiles.filter((path) => nameOf(path).endsWith('.vcf'));
  if (rootIndexPath === undefined && rootCards.length === 0) {
    return 0;
  }

  const target = `${root}/${sourceId}`;
  const legacy = parseIndex(rootIndexPath === undefined ? undefined : await store.read(rootIndexPath));
  const targetIndex = parseIndex(await store.read(`${target}/index.json`));
  const targetCards = new Set((await store.list(target)).map(nameOf));
  const uidOfCard = new Map(Object.keys(legacy).map((uid) => [`${fileNameOf(uid)}.vcf`, uid]));
  const merged: SyncIndex = { ...targetIndex };
  let changed = false;
  let handled = 0;

  const targetHas = (uid: string | undefined, card: string) =>
    targetCards.has(card) && (uid === undefined || targetIndex[uid] !== undefined);

  for (const path of rootCards) {
    const card = nameOf(path);
    const uid = uidOfCard.get(card);
    if (targetHas(uid, card)) {
      // The target's base wins (a stray card without an index entry only counts when the target has the file).
      await store.remove(path);
    } else {
      // A target card without an index entry is unusable (no etag, no href): the legacy one replaces it.
      if (targetCards.has(card)) {
        await store.remove(`${target}/${card}`);
      }
      await store.rename(path, `${target}/${card}`);
      targetCards.add(card);
      if (uid !== undefined) {
        merged[uid] = legacy[uid];
        changed = true;
      }
    }
    handled++;
  }

  // Cards moved by an interrupted run: the card is in the target, only its index entry is missing.
  const movedBefore = new Set(rootCards.map(nameOf));
  for (const [uid, entry] of Object.entries(legacy)) {
    const card = `${fileNameOf(uid)}.vcf`;
    if (!movedBefore.has(card) && targetCards.has(card) && targetIndex[uid] === undefined && merged[uid] === undefined) {
      merged[uid] = entry;
      changed = true;
    }
  }

  if (changed || (rootIndexPath !== undefined && !targetCards.has('index.json'))) {
    await store.write(`${target}/index.json`, JSON.stringify(merged, null, 2));
  }
  if (rootIndexPath !== undefined) {
    await store.remove(rootIndexPath);
    handled++;
  }
  return handled;
}

/** Thin wrapper over the vault adapter (hidden folders such as .obsidian are reachable). */
export function obsidianFileStore(app: App): FileStore {
  const adapter = app.vault.adapter;

  const ensureParent = async (path: string) => {
    const parts = path.split('/').slice(0, -1);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await adapter.exists(current))) {
        await adapter.mkdir(current);
      }
    }
  };

  return {
    async read(path) {
      return (await adapter.exists(path)) ? adapter.read(path) : undefined;
    },
    async write(path, data) {
      await ensureParent(path);
      await adapter.write(path, data);
    },
    async remove(path) {
      if (await adapter.exists(path)) {
        await adapter.remove(path);
      }
    },
    async list(dir) {
      return (await adapter.exists(dir)) ? (await adapter.list(dir)).files : [];
    },
    async rename(from, to) {
      await ensureParent(to);
      await adapter.rename(from, to);
    },
  };
}
