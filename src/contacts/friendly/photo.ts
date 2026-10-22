/** PHOTO values: data URIs, URLs and bare base64 (vCard 3.0). No obsidian / src/context imports. */

import type { VCardLine } from './lines';

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

/**
 * `photo` -> 1, `photo-2` -> 2, ...; undefined for anything else. Numbering starts at `photo-2`, as for every
 * numbered property (`rowForProperty`): `photo-0` and `photo-1` are no photo.
 */
function photoOrdinal(property: string | undefined): number | undefined {
  if (property === 'photo') return 1;
  const m = property === undefined ? null : /^photo-(\d+)$/.exec(property);
  const ordinal = m ? Number(m[1]) : 0;
  return ordinal >= 2 ? ordinal : undefined;
}

/** `photo`, `photo-2`, ...: the friendly properties that hold a photo (the fixed name, see FIXED_PROPERTIES). */
export const isPhotoProperty = (property: string | undefined): boolean => photoOrdinal(property) !== undefined;

const isPhotoLine = (line: VCardLine): boolean => line.name === 'PHOTO';
const isDamagedLine = (line: VCardLine): boolean => isPhotoLine(line) && isDamagedPhoto(line.value);
const versionOf = (lines: VCardLine[]): string => lines.find((line) => !line.group && line.name === 'VERSION')?.value ?? '3.0';

/** PHOTO lines for the note's photos (`photo`, `photo-2`, ... in that order) in the form a card like `card` uses. */
export function notePhotoLines(props: Record<string, unknown>, card: VCardLine[]): VCardLine[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    const ordinal = photoOrdinal(key);
    if (ordinal !== undefined && typeof value === 'string') values[ordinal - 1] = value;
  }
  const version = versionOf(card);
  return values.flatMap((value) => {
    const line = value === undefined ? undefined : photoLine(value, version);
    return line ? [{ name: 'PHOTO', params: line.params, value: line.value }] : [];
  });
}

/**
 * The card's lines with every damaged photo (`isDamagedPhoto`) put back. Sync does this once, where it reads a
 * card, so the review, the result, the note and the stored base all see the same card and never a damaged photo.
 *
 * A damaged PHOTO line says nothing about the photo. Each one, in order, becomes the next PHOTO line of `fallback`
 * (the card as last synced, or the note's photos: `notePhotoLines`) that the card does not already hold intact, and
 * is left out when there is none. Every other line stays as it is. `repaired` is false, and `lines` the same array,
 * when the card holds no damaged photo.
 */
export function repairDamagedPhotos(lines: VCardLine[], fallback: VCardLine[]): { lines: VCardLine[]; repaired: boolean } {
  if (!lines.some(isDamagedLine)) return { lines, repaired: false };
  // Each image once: not one the card still holds intact, and not twice (the base and the note often agree).
  const seen = new Set(lines.filter((l) => isPhotoLine(l) && !isDamagedLine(l)).map((l) => photoKey(l.value)));
  const spare = fallback.filter((l) => {
    if (!isPhotoLine(l) || isDamagedLine(l) || seen.has(photoKey(l.value))) return false;
    seen.add(photoKey(l.value));
    return true;
  });
  const result: VCardLine[] = [];
  for (const line of lines) {
    if (!isDamagedLine(line)) result.push(line);
    else {
      const next = spare.shift();
      if (next) result.push(line.group === next.group ? next : { ...next, group: line.group, raw: undefined });
    }
  }
  return { lines: result, repaired: true };
}

/**
 * Whether the server's copy of the photo is damaged, from a card as the server sent it: true when it holds a damaged
 * photo, false when it holds only intact ones, and `previous` when it holds none (a phone that could not read the
 * damaged photo sends the card back without it).
 */
export function photoDamagedOn(lines: VCardLine[], previous: boolean): boolean {
  if (lines.some(isDamagedLine)) return true;
  return lines.some(isPhotoLine) ? false : previous;
}

/**
 * The card's lines with the intact photos of `fallback` (the card as last synced) added when the card holds no PHOTO
 * line at all. Sync does this while the server's copy of the photo is damaged (`photoDamagedOn`): a phone that could
 * not read it sends the card back without it, which is no removal. `repaired` is false, and `lines` the same array,
 * when the card holds a PHOTO line or `fallback` has no intact photo.
 */
export function restoreDroppedPhotos(lines: VCardLine[], fallback: VCardLine[]): { lines: VCardLine[]; repaired: boolean } {
  const photos = fallback.filter((l) => isPhotoLine(l) && !isDamagedLine(l));
  if (lines.some(isPhotoLine) || photos.length === 0) return { lines, repaired: false };
  // Without their group: the card's groups may mean something else by now.
  return { lines: [...lines, ...photos.map((l) => (l.group ? { name: l.name, params: l.params, value: l.value } : l))], repaired: true };
}

/**
 * The note's photos with every damaged one (`isDamagedPhoto`) put back, as `repairDamagedPhotos` does for a card. An
 * earlier version wrote a damaged photo from the server into the note; such a value says nothing about the photo
 * either. Each one, in order, becomes the next photo of `fallback` (the card as last synced) that the note does not
 * already hold, and is left out when there is none. The photos are then numbered again (`photo`, `photo-2`, ...).
 * `repaired` is false, and `props` the same object, when the note holds no damaged photo.
 */
export function repairNotePhotos<T>(props: Record<string, T>, fallback: VCardLine[]): { props: Record<string, T>; repaired: boolean } {
  const photos = Object.keys(props)
    .filter(isPhotoProperty)
    .sort((a, b) => (photoOrdinal(a) ?? 0) - (photoOrdinal(b) ?? 0));
  if (!photos.some((key) => isDamagedPhoto(props[key]))) return { props, repaired: false };
  const kept = photos.filter((key) => !isDamagedPhoto(props[key]));
  const seen = new Set(kept.map((key) => props[key]).filter((v) => typeof v === 'string').map((v) => photoKey(v as string)));
  const spare = fallback.filter((l) => {
    if (!isPhotoLine(l) || isDamagedLine(l) || seen.has(photoKey(l.value))) return false;
    seen.add(photoKey(l.value));
    return true;
  });
  const values: T[] = [];
  for (const key of photos) {
    if (!isDamagedPhoto(props[key])) values.push(props[key]);
    else {
      const next = spare.shift();
      if (next) values.push(next.value as T);
    }
  }
  const result: Record<string, T> = Object.fromEntries(Object.entries(props).filter(([key]) => !isPhotoProperty(key)));
  values.forEach((value, i) => (result[i === 0 ? 'photo' : `photo-${i + 1}`] = value));
  return { props: result, repaired: true };
}

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
