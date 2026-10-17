import { JSDOM } from 'jsdom';

const TYPE_SELECTOR = /^[A-Za-z][\w-]*$/;

/**
 * jsdom's DOMParser, with querySelector(All) for a lone type selector behaving like Chromium on XML documents:
 * `response` matches every element with local name `response` in any namespace, prefixed (`d:response`,
 * `CR:address-data`) or not. Plain jsdom only matches unprefixed elements, Obsidian (Chromium) matches both,
 * and real CardDAV servers such as Radicale answer with prefixed elements.
 */
export function chromiumLikeDomParser(): typeof DOMParser {
  const { window } = new JSDOM('');
  for (const proto of [window.Document.prototype, window.Element.prototype]) {
    const all = proto.querySelectorAll;
    const one = proto.querySelector;
    Object.assign(proto, {
      querySelectorAll(this: Document | Element, selector: string) {
        return TYPE_SELECTOR.test(selector)
          ? Array.from(this.getElementsByTagNameNS('*', selector))
          : all.call(this, selector);
      },
      querySelector(this: Document | Element, selector: string) {
        return TYPE_SELECTOR.test(selector)
          ? (this.getElementsByTagNameNS('*', selector)[0] ?? null)
          : one.call(this, selector);
      },
    });
  }
  return window.DOMParser as unknown as typeof DOMParser;
}
