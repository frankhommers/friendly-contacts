import { getSettings } from "src/context/sharedSettingsContext";
import { authorizationHeader, StoredCredentials } from "src/settings/carddavCredentials";
import { ContactsPluginSettings } from "src/settings/settings";
import { PushOptions, VCardMeta, VCardRaw } from "src/sync/adapters/adapter";
import { AdapterInterface } from "src/sync/adapters/adapterInterface";
import { AppHttpResponse, PlatformHttpClient } from "src/util/platformHttpClient";
import { cleanUid, fnOutOfString, nOutOfString, uidOutOfString } from "src/util/vcard";


const escapeXml = (text: string): string =>
  text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export function carddavGenericAdapter(): AdapterInterface {

  const getAuthHeader = (settings:ContactsPluginSettings) => authorizationHeader(settings.CardDAV);

  const checkConnectivity = async (addressBookUrl: string, credentials: StoredCredentials): Promise<AppHttpResponse> =>  {
    return await PlatformHttpClient.request({
        url: addressBookUrl,
        method: 'OPTIONS',
        headers: { Authorization: authorizationHeader(credentials) },
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
    const settings = getSettings();
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
      url: settings.CardDAV.addressBookUrl,
      method: 'REPORT',
      headers: {
        'Authorization': getAuthHeader(settings),
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
    const settings = getSettings();
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
      url: settings.CardDAV.addressBookUrl ,
      method: 'REPORT',
      headers: {
        'Authorization': getAuthHeader(settings),
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
    const settings = getSettings();
    const vcfUrl = new URL(href, settings.CardDAV.addressBookUrl).toString();
    const res = await PlatformHttpClient.request({
      url: vcfUrl,
      method: 'GET',
      headers: {
        Authorization: getAuthHeader(settings),
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
    const settings = getSettings();
    const vcfUrl = opts?.href
      ? new URL(opts.href, settings.CardDAV.addressBookUrl).toString()
      : settings.CardDAV.addressBookUrl + `/${encodeURIComponent(vcard.uid ?? '')}.vcf`;
    const headers: Record<string, string> = {
      ['Authorization']: getAuthHeader(settings),
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

  const deleteContact = async (href: string): Promise<AppHttpResponse> => {
    const settings = getSettings();
    const vcfUrl = new URL(href, settings.CardDAV.addressBookUrl).toString();
    return await PlatformHttpClient.request({
      url: vcfUrl,
      method: 'DELETE',
      headers: {
        Authorization: getAuthHeader(settings),
      }
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
