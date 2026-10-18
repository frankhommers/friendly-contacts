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
}

export interface SyncState {
  get(uid: string): Promise<SyncStateEntry | undefined>;
  set(uid: string, entry: SyncStateEntry): Promise<void>;
  remove(uid: string): Promise<void>;
}

type SyncIndex = Record<string, { etag: string; href: string }>;

/** A safe file name per UID, one-to-one: other characters (and `_` itself) become `_<hex>_`. */
const fileNameOf = (uid: string) =>
  cleanUid(uid).replace(/[^A-Za-z0-9.-]/g, (c) => `_${c.codePointAt(0)!.toString(16)}_`);

/**
 * Stores the card as it was at the last successful sync ("base"), per UID:
 * `<dir>/<name>.vcf` holds the raw vCard, `<dir>/index.json` holds etag and href.
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
      return { raw, etag: meta.etag, href: meta.href };
    },
    set(uid, entry) {
      return serialized(async () => {
        await store.write(rawPath(uid), entry.raw);
        const index = await readIndex();
        index[cleanUid(uid)] = { etag: entry.etag, href: entry.href };
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

/**
 * Moves the sync state of the single-server days (files directly in `root`) into `root/<sourceId>/`.
 * Returns the number of files moved. Does nothing once `root/<sourceId>/index.json` exists.
 * `index.json` moves last, so a move that was cut short is finished by the next run.
 */
export async function migrateSyncStateDir(store: FileStore, root: string, sourceId: string): Promise<number> {
  const target = `${root}/${sourceId}`;
  if ((await store.read(`${target}/index.json`)) !== undefined) {
    return 0;
  }
  const files = await store.list(root);
  const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
  const moving = files
    .filter((path) => nameOf(path) === 'index.json' || nameOf(path).endsWith('.vcf'))
    .sort((a, b) => Number(nameOf(a) === 'index.json') - Number(nameOf(b) === 'index.json'));
  for (const path of moving) {
    await store.rename(path, `${target}/${nameOf(path)}`);
  }
  return moving.length;
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
