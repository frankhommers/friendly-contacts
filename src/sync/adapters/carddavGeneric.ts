import { authorizationHeader } from "src/settings/carddavCredentials";
import { Source } from "src/settings/settings";
import { PushOptions, VCardMeta, VCardRaw } from "src/sync/adapters/adapter";
import { AdapterInterface } from "src/sync/adapters/adapterInterface";
import { AppHttpResponse, PlatformHttpClient } from "src/util/platformHttpClient";
import { cleanUid, fnOutOfString, nOutOfString, uidOutOfString } from "src/util/vcard";


const escapeXml = (text: string): string =>
  text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

/** The part of a source the adapter needs; every request goes to this address book with these credentials. */
export type AdapterSource = Pick<Source, 'addressBookUrl' | 'authType' | 'authKey'>;

export function carddavAdapter(source: AdapterSource): AdapterInterface {

  // Copied, so later edits of the caller's object cannot change where this adapter talks to.
  const { addressBookUrl, authType, authKey } = source;
  const getAuthHeader = () => authorizationHeader({ authType, authKey });

  const checkConnectivity = async (): Promise<AppHttpResponse> =>  {
    return await PlatformHttpClient.request({
        url: addressBookUrl,
        method: 'OPTIONS',
        headers: { Authorization: getAuthHeader() },
      });
  }

  const isVcfNode = (response: Element): boolean => {
    const href = response.querySelector('href')?.textContent;
    const successPropstat = Array.from(response.querySelectorAll('propstat')).find(
      propstat => propstat.querySelector('status')?.textContent?.includes('200 OK')
    );

    if (!successPropstat || !href || !href.endsWith('.vcf')) {
      return false;
    }

    return true;
  };


  const metaOf = (response: Element): VCardMeta | undefined => {
    if (!isVcfNode(response)) {
      return;
    }

    const href = response.querySelector('href')?.textContent;
    const etag = response.querySelector('getetag')?.textContent;
    const lastModified = response.querySelector('getlastmodified')?.textContent;
    const adressData = response.querySelector('address-data')?.textContent || '';

    if (!href) {
      return;
    }

    return {
      href,
      etag: etag?.replace(/"/g, '') || '', // Remove quotes from etag
      lastModified: lastModified ? new Date(lastModified) : new Date(),
      uid: uidOutOfString(adressData),
      fn: fnOutOfString(adressData),
      n: nOutOfString(adressData)
    };
  };

  const getMetaByUid = async (uid: string): Promise<VCardMeta | AppHttpResponse | undefined> => {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag />
    <D:getlastmodified />
    <D:resourcetype />
    <C:address-data>
      <C:prop name="UID"/>
      <C:prop name="FN"/>
      <C:prop name="N"/>
    </C:address-data>
  </D:prop>
  <C:filter>
    <C:prop-filter name="UID">
      <C:text-match match-type="contains">${escapeXml(cleanUid(uid))}</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>`;

    const res = await PlatformHttpClient.request({
      url: addressBookUrl,
      method: 'REPORT',
      headers: {
        'Authorization': getAuthHeader(),
        'Content-Type': 'application/xml',
        'Depth': '1'
      },
      body
    });

    if(res.errorMessage) {
      return res;
    }

    const parser = new DOMParser();
    const xml = parser.parseFromString(res.data, 'application/xml');
    // The filter is "contains": other cards whose UID contains this one match too. Only an exact UID is this card.
    const wanted = cleanUid(uid);
    return Array.from(xml.querySelectorAll('response'))
      .map(metaOf)
      .find(meta => meta !== undefined && meta.uid === wanted);
  }


  const getMetaList = async (): Promise<VCardMeta[] | AppHttpResponse> => {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag />
    <D:getlastmodified />
    <D:resourcetype />
    <C:address-data>
      <C:prop name="UID"/>
      <C:prop name="FN"/>
      <C:prop name="N"/>
    </C:address-data>
  </D:prop>
</C:addressbook-query>`;

    const res = await PlatformHttpClient.request({
      url: addressBookUrl,
      method: 'REPORT',
      headers: {
        'Authorization': getAuthHeader(),
        'Content-Type': 'application/xml',
        'Depth': '1'
      },
      body
    });

    if(res.errorMessage) {
      return res;
    }

    const parser = new DOMParser();
    const xml = parser.parseFromString(res.data, 'application/xml');

    const responses = xml.querySelectorAll('response');
    const vcardMetas: VCardMeta[] = [];

    responses.forEach(response => {
      const meta = metaOf(response);
      if (meta) {
        vcardMetas.push(meta);
      }
    });

    return vcardMetas;
  }


  const pull = async (href: string): Promise<VCardRaw | AppHttpResponse> => {
    const vcfUrl = new URL(href, addressBookUrl).toString();
    const res = await PlatformHttpClient.request({
      url: vcfUrl,
      method: 'GET',
      headers: {
        Authorization: getAuthHeader(),
        ['Accept']: 'text/vcard; version=4.0; charset=utf-8;'
      }
    });

    if(res.errorMessage) {
      return res;
    }

    return {
      uid: uidOutOfString(res.data),
      raw: res.data,
      etag: res.headers?.etag?.replace(/"/g, ''),
      href,
    }
  }

  /**
   * The new ETag of a pushed card is in `res.headers.etag` (still quoted, as sent by the server).
   * Not every server returns it on PUT; callers then need a follow-up pull/getMetaByUid.
   */
  const push = async (vcard: VCardRaw, opts?: PushOptions): Promise<AppHttpResponse> => {
    const vcfUrl = opts?.href
      ? new URL(opts.href, addressBookUrl).toString()
      : addressBookUrl + `/${encodeURIComponent(vcard.uid ?? '')}.vcf`;
    const headers: Record<string, string> = {
      ['Authorization']: getAuthHeader(),
      ['Content-Type']: 'text/vcard; version=4.0; charset=utf-8;'
    };
    if (opts?.ifMatch) {
      headers['If-Match'] = `"${opts.ifMatch}"`;
    } else if (opts?.ifNoneMatch) {
      headers['If-None-Match'] = '*';
    }
    return await PlatformHttpClient.request({
      url: vcfUrl,
      method: 'PUT',
      body: vcard.raw,
      headers
    });
  }

  const deleteContact = async (href: string, ifMatch?: string): Promise<AppHttpResponse> => {
    const vcfUrl = new URL(href, addressBookUrl).toString();
    const headers: Record<string, string> = { Authorization: getAuthHeader() };
    if (ifMatch) {
      headers['If-Match'] = `"${ifMatch}"`;
    }
    return await PlatformHttpClient.request({
      url: vcfUrl,
      method: 'DELETE',
      headers
    });
  }

  return {
    checkConnectivity,
    getMetaByUid,
    getMetaList,
    pull,
    push,
    delete: deleteContact
  };

}
