import { JSDOM } from "jsdom";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let baseUrl = '';

vi.mock("src/context/sharedSettingsContext", () => ({
  getSettings: vi.fn(() => ({
    CardDAV: { addressBookUrl: baseUrl + 'frank/contacts/', authType: 'apikey', authKey: 'k', syncInterval: 900 },
  })),
}));

import { carddavGenericAdapter } from "src/sync/adapters/carddavGeneric";

type Received = { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string };
let server: http.Server;
let last: Received | undefined;
let reportBody = '';

beforeAll(async () => {
  // Tests run in node; Obsidian (Chromium) provides DOMParser.
  vi.stubGlobal('DOMParser', new JSDOM().window.DOMParser);
  server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      last = { method: req.method, url: req.url, headers: req.headers, body };
      if (req.method === 'REPORT') {
        res.writeHead(207, { 'Content-Type': 'application/xml' });
        res.end(reportBody);
      } else if (req.method === 'GET') {
        res.writeHead(200, { ETag: '"e2"', 'Content-Type': 'text/vcard' });
        res.end('BEGIN:VCARD\r\nUID:urn:uuid:abc\r\nEND:VCARD\r\n');
      } else {
        res.writeHead(204, { ETag: '"e3"' });
        res.end();
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise(resolve => server.close(resolve));
});

describe('carddav adapter', () => {
  it('push uses href and If-Match', async () => {
    const adapter = carddavGenericAdapter();
    const res = await adapter.push({ uid: 'abc', raw: 'RAW' }, { href: '/frank/contacts/ABC.vcf', ifMatch: 'e1' });
    expect(last?.method).toBe('PUT');
    expect(last?.url).toBe('/frank/contacts/ABC.vcf');
    expect(last?.headers['if-match']).toBe('"e1"');
    expect(last?.headers['if-none-match']).toBeUndefined();
    expect(last?.body).toBe('RAW');
    expect(res.status).toBe(204);
    expect(res.headers?.etag).toBe('"e3"');
  });

  it('push resolves a relative href against the address book', async () => {
    await carddavGenericAdapter().push({ uid: 'abc', raw: 'RAW' }, { href: 'ABC.vcf' });
    expect(last?.url).toBe('/frank/contacts/ABC.vcf');
  });

  it('push sends If-None-Match: * for new cards', async () => {
    await carddavGenericAdapter().push({ uid: 'abc', raw: 'RAW' }, { href: '/frank/contacts/abc.vcf', ifNoneMatch: true });
    expect(last?.headers['if-none-match']).toBe('*');
    expect(last?.headers['if-match']).toBeUndefined();
  });

  it('push without opts keeps the <uid>.vcf url and sends no precondition', async () => {
    await carddavGenericAdapter().push({ uid: 'abc', raw: 'RAW' });
    expect(last?.url).toMatch(/\/frank\/contacts\/+abc\.vcf$/);
    expect(last?.headers['if-match']).toBeUndefined();
    expect(last?.headers['if-none-match']).toBeUndefined();
  });

  it('pull returns etag and href', async () => {
    const res = await carddavGenericAdapter().pull('/frank/contacts/abc.vcf');
    expect(res).toMatchObject({ uid: 'abc', etag: 'e2', href: '/frank/contacts/abc.vcf' });
  });

  it('getMetaByUid picks the exact uid among several matches', async () => {
    const card = (href: string, uid: string, etag: string) => `
  <response>
    <href>${href}</href>
    <propstat>
      <prop>
        <getetag>"${etag}"</getetag>
        <address-data xmlns="urn:ietf:params:xml:ns:carddav">BEGIN:VCARD\r\nUID:${uid}\r\nFN:Jan\r\nEND:VCARD\r\n</address-data>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>`;
    reportBody = `<?xml version="1.0" encoding="utf-8"?>
<multistatus xmlns="DAV:">${card('/frank/contacts/longer.vcf', 'urn:uuid:abc-1', 'e7')}${card('/frank/contacts/ABC.vcf', 'urn:uuid:abc', 'e8')}
</multistatus>`;
    const meta = await carddavGenericAdapter().getMetaByUid('abc');
    expect(last?.method).toBe('REPORT');
    expect(meta).toMatchObject({ href: '/frank/contacts/ABC.vcf', etag: 'e8', uid: 'abc' });

    reportBody = `<?xml version="1.0" encoding="utf-8"?>
<multistatus xmlns="DAV:">${card('/frank/contacts/longer.vcf', 'urn:uuid:abc-1', 'e7')}
</multistatus>`;
    expect(await carddavGenericAdapter().getMetaByUid('abc')).toBeUndefined();
  });
});
