/** PHOTO values: data URIs, URLs and bare base64 (vCard 3.0). No obsidian / src/context imports. */

const DATA_URI = /^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]*)$/i;
const URL_VALUE = /^https?:\/\//i;
/** A data URI without its data: no comma (`data:image/png\;base64`), or nothing after it. */
const EMPTY_DATA_URI = /^data:[^,]*(,\s*)?$/i;

/**
 * A photo value a server damaged: a data URI that lost its data. Radicale does this to every `data:` URI it
 * stores (its vCard parser escapes the `;` and cuts the value at the comma), so a vCard 4.0 photo comes back as
 * `data:image/png\;base64`. Such a value holds no image; Sync treats it as saying nothing about the photo.
 */
export function isDamagedPhoto(value: unknown): boolean {
  return typeof value === 'string' && EMPTY_DATA_URI.test(value.trim());
}

/** `isDamagedPhoto` for a friendly property: only `photo`, `photo-2`, ... can hold one. */
export const isDamagedPhotoProperty = (property: string, value: unknown): boolean =>
  /^photo(-\d+)?$/.test(property) && isDamagedPhoto(value);

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

/**
 * What an image element can show for a `photo` value: a data URI or http(s) URL as it is, bare base64 as a JPEG data
 * URI. Undefined for anything else.
 */
export function photoImageSrc(value: string): string | undefined {
  const text = value.trim();
  if (DATA_URI.test(text) || URL_VALUE.test(text)) return text;
  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.replace(/\s+/g, '') !== '') {
    return `data:image/jpeg;base64,${text.replace(/\s+/g, '')}`;
  }
  return undefined;
}
