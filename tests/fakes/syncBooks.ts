import { parseCard } from 'src/contacts/friendly/lines';
import type { Source } from 'src/settings/settings.d';
import { PushOptions, VCardMeta, VCardRaw } from 'src/sync/adapters/adapter';
import { AdapterInterface } from 'src/sync/adapters/adapterInterface';
import { SyncState, SyncStateEntry } from 'src/sync/syncState';
import { AppHttpResponse } from 'src/util/platformHttpClient';
import { cleanUid } from 'src/util/vcard';

export const UID = '1234ABCD-0000-4000-8000-000000000001';
export const card = (mobile = '06-1', extra: string[] = []) =>
  [
    'BEGIN:VCARD',
    'VERSION:4.0',
    `UID:${UID}`,
    'FN:Jan de Vries',
    'N:de Vries;Jan;;;',
    `TEL;TYPE=CELL:${mobile}`,
    ...extra,
    'END:VCARD',
    '',
  ].join('\r\n');
export const JAN = { name: 'Jan de Vries', firstname: 'Jan', lastname: 'de Vries', mobile: '06-1', uid: UID };

const ok = (status: number, headers: Record<string, string> = {}): AppHttpResponse => ({ status, data: '', headers, errorMessage: '' });

const unavailable = (): AppHttpResponse => ({ status: 503, data: '', headers: {}, errorMessage: 'HTTP 503' });

/** One in-memory CardDAV address book. */
export function fakeBook(id: string, name: string) {
  const prefix = `/${id}/`;
  const cards = new Map<string, { raw: string; etag: string }>();
  const pushes: { vcard: VCardRaw; opts?: PushOptions; status: number }[] = [];
  const deletes: string[] = [];
  /** How often each lookup was asked. */
  const calls = { getMetaByUid: 0, getMetaList: 0 };
  let counter = 0;
  const options = { failPut: undefined as number | undefined, searchFails: false, listFails: false };
  const uidOf = (raw: string) => parseCard(raw).find((l) => l.name === 'UID')?.value;
  const metaOf = (href: string, c: { raw: string; etag: string }): VCardMeta => ({
    href,
    etag: c.etag,
    lastModified: new Date(),
    uid: cleanUid(uidOf(c.raw)),
    fn: undefined,
    n: undefined,
  });
  const put = (href: string, raw: string) => {
    const etag = `${id}-${++counter}`;
    cards.set(href, { raw, etag });
    return etag;
  };
  const adapter: AdapterInterface = {
    async getMetaByUid(uid: string): Promise<VCardMeta | AppHttpResponse | undefined> {
      calls.getMetaByUid++;
      if (options.searchFails) return unavailable();
      const found = [...cards.entries()].find(([, c]) => cleanUid(uidOf(c.raw)) === cleanUid(uid));
      return found && metaOf(...found);
    },
    async pull(href: string): Promise<VCardRaw | AppHttpResponse | undefined> {
      const c = cards.get(href);
      if (!c) return { status: 404, data: '', headers: {}, errorMessage: '404 Not Found' };
      return { uid: uidOf(c.raw), raw: c.raw, etag: c.etag, href };
    },
    async push(vcard: VCardRaw, opts?: PushOptions): Promise<AppHttpResponse> {
      const href = opts?.href ?? `${prefix}${vcard.uid}.vcf`;
      const record = { vcard, opts, status: 0 };
      pushes.push(record);
      if (options.failPut !== undefined) {
        record.status = options.failPut;
        return { status: options.failPut, data: '', headers: {}, errorMessage: `HTTP ${options.failPut}` };
      }
      const current = cards.get(href);
      if ((opts?.ifMatch !== undefined && current?.etag !== opts.ifMatch) || (opts?.ifNoneMatch && current)) {
        record.status = 412;
        return ok(412);
      }
      const etag = put(href, vcard.raw);
      record.status = current ? 204 : 201;
      return ok(record.status, { etag: `"${etag}"` });
    },
    async delete(href: string, etag: string) {
      const current = cards.get(href);
      const status = !current ? 404 : current.etag !== etag ? 412 : 204;
      if (status === 204) {
        cards.delete(href);
        deletes.push(href);
      }
      return ok(status);
    },
    async getMetaList(): Promise<VCardMeta[] | AppHttpResponse> {
      calls.getMetaList++;
      if (options.listFails) return unavailable();
      return [...cards.entries()].map(([href, c]) => metaOf(href, c));
    },
    checkConnectivity: async () => ok(200),
  };
  const entries = new Map<string, SyncStateEntry>();
  const state: SyncState = {
    get: async (uid) => entries.get(cleanUid(uid)),
    set: async (uid, entry) => void entries.set(cleanUid(uid), entry),
    touch: async () => {},
    remove: async (uid) => void entries.delete(cleanUid(uid)),
  };
  const source: Source = { id, name, addressBookUrl: `https://dav.example${prefix}`, authType: 'basic', authKey: 'k', enabled: true };
  /** Puts a card with this UID on the server and (optionally) stores it as this book's base. */
  const seed = (raw: string, withBase = true, uid = UID) => {
    const href = `${prefix}${uid}.vcf`;
    const etag = put(href, raw);
    if (withBase) entries.set(uid, { raw, etag, href });
    return href;
  };
  return { id, source, adapter, state, entries, cards, pushes, deletes, calls, options, put, seed };
}

export type Book = ReturnType<typeof fakeBook>;
