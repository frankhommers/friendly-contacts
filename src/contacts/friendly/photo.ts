/** PHOTO values: data URIs, URLs and bare base64 (vCard 3.0). No obsidian / src/context imports. */

const DATA_URI = /^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]*)$/i;
const URL_VALUE = /^https?:\/\//i;

/** The image data as compared by the merge: a data URI and the bare base64 of the same image are equal. */
export function photoKey(value: string): string {
  const m = DATA_URI.exec(value.trim());
  return (m ? m[2] : value).replace(/\s+/g, '');
}

/**
 * Params and value of a PHOTO line for `value` on a card of `version` ('3.0', '4.0', ...).
 * Undefined for a value that is not a data URI, URL or bare base64 (the caller then keeps its default).
 */
export function photoLine(value: string, version: string): { params: [string, string][]; value: string } | undefined {
  const v3 = /^[23]\./.test(version.trim());
  const text = value.trim();
  let mime: string;
  let data: string;
  const m = DATA_URI.exec(text);
  if (m) {
    mime = m[1].toLowerCase();
    data = m[2].replace(/\s+/g, '');
  } else if (URL_VALUE.test(text)) {
    return v3 ? { params: [['VALUE', 'uri']], value: text } : { params: [], value: text };
  } else if (/^[A-Za-z0-9+/=\s]+$/.test(text)) {
    // Bare base64, as a vCard 3.0 card carries it; such photos are JPEG in practice.
    mime = 'image/jpeg';
    data = text.replace(/\s+/g, '');
  } else {
    return undefined;
  }
  if (!v3) return { params: [], value: `data:${mime};base64,${data}` };
  const subtype = (mime.split('/')[1] ?? 'jpeg').toUpperCase();
  return { params: [['ENCODING', 'b'], ['TYPE', subtype]], value: data };
}
