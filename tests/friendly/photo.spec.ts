import { parseCard, serializeLine } from 'src/contacts/friendly/lines';
import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import { isDamagedPhoto, isPhotoProperty, notePhotoLines, repairDamagedPhotos } from 'src/contacts/friendly/photo';
import { RelationContext } from 'src/contacts/friendly/relations';
import { toFriendly } from 'src/contacts/friendly/translate';
import { describe, expect, it } from 'vitest';

const ctx: RelationContext = { uidToName: () => undefined, displayName: () => undefined, resolveLink: (name) => ({ text: name }) };
const v4 = (...body: string[]) => parseCard(['BEGIN:VCARD', 'VERSION:4.0', 'UID:x', 'FN:Jan', ...body, 'END:VCARD'].join('\r\n'));
const texts = (lines: ReturnType<typeof parseCard>) => lines.map(serializeLine);
const photos = (lines: ReturnType<typeof parseCard>) => texts(lines).filter((l) => /^(\w+\.)?PHOTO[;:]/.test(l));

const A = 'data:image/png;base64,AAAA';
const B = 'data:image/png;base64,BBBB';
const DAMAGED = 'PHOTO:data:image/png\\;base64';

describe('isDamagedPhoto', () => {
  it('a data URI that lost its data is damaged (as Radicale returns a vCard 4.0 photo)', () => {
    expect(isDamagedPhoto('data:image/png\\;base64')).toBe(true);
    expect(isDamagedPhoto('data:image/jpeg;base64')).toBe(true);
    expect(isDamagedPhoto('data:image/jpeg;base64,')).toBe(true);
    expect(isDamagedPhoto(' DATA:image/png\\;base64 ')).toBe(true);
  });

  it('a photo with data, a URL or bare base64 is not damaged', () => {
    for (const value of [A, 'https://example.org/a.jpg', '/9j/AABB', '', undefined, [A]]) expect(isDamagedPhoto(value)).toBe(false);
  });
});

describe('isPhotoProperty', () => {
  it('photo and photo-N only', () => {
    expect(['photo', 'photo-2', 'photo-12'].every(isPhotoProperty)).toBe(true);
    expect(['photos', 'photo-', 'myphoto', 'title', undefined].some(isPhotoProperty)).toBe(false);
  });
});

describe('notePhotoLines', () => {
  it("the note's photos in order, in the form of the card's version", () => {
    expect(texts(notePhotoLines({ 'photo-2': B, photo: A, title: 'x' }, v4()))).toEqual([`PHOTO:${A}`, `PHOTO:${B}`]);
    const v3 = parseCard('BEGIN:VCARD\r\nVERSION:3.0\r\nEND:VCARD');
    expect(texts(notePhotoLines({ photo: A }, v3))).toEqual(['PHOTO;ENCODING=b;TYPE=PNG:AAAA']);
    expect(notePhotoLines({ title: 'x' }, v4())).toEqual([]);
  });
});

describe('repairDamagedPhotos', () => {
  it('a card without a damaged photo is returned as it is', () => {
    const lines = v4(`PHOTO:${A}`, 'TITLE:Baker');
    expect(repairDamagedPhotos(lines, v4(`PHOTO:${B}`))).toEqual({ lines, repaired: false });
  });

  it('a damaged photo becomes the photo of the fallback, in place; every other line stays', () => {
    const { lines, repaired } = repairDamagedPhotos(v4(DAMAGED, 'TITLE:Phone edit'), v4(`PHOTO:${A}`, 'TITLE:Baker'));
    expect(repaired).toBe(true);
    expect(texts(lines)).toEqual(['VERSION:4.0', 'UID:x', 'FN:Jan', `PHOTO:${A}`, 'TITLE:Phone edit']);
  });

  it('without a usable fallback the damaged photo is left out', () => {
    expect(photos(repairDamagedPhotos(v4(DAMAGED), []).lines)).toEqual([]);
    expect(photos(repairDamagedPhotos(v4(DAMAGED), v4(DAMAGED)).lines)).toEqual([]);
  });

  it('two photos, only the first damaged: the intact one stays and is not used twice', () => {
    const card = v4(DAMAGED, `PHOTO:${B}`);
    expect(photos(repairDamagedPhotos(card, v4(`PHOTO:${A}`, `PHOTO:${B}`)).lines)).toEqual([`PHOTO:${A}`, `PHOTO:${B}`]);
    // No fallback for the first: the intact one becomes the note's `photo`, not `photo-2` without `photo`.
    const alone = repairDamagedPhotos(card, v4(`PHOTO:${B}`)).lines;
    expect(photos(alone)).toEqual([`PHOTO:${B}`]);
    expect(toFriendly(alone, DEFAULT_MAPPING, ctx).props).toMatchObject({ photo: B });
    expect(toFriendly(alone, DEFAULT_MAPPING, ctx).props).not.toHaveProperty('photo-2');
  });

  it('the same image in base and note is used once', () => {
    const fallback = [...v4(`PHOTO:${A}`), ...notePhotoLines({ photo: A }, v4())];
    expect(photos(repairDamagedPhotos(v4(DAMAGED, DAMAGED), fallback).lines)).toEqual([`PHOTO:${A}`]);
  });

  it('a grouped damaged line keeps its group', () => {
    const { lines } = repairDamagedPhotos(v4('item2.PHOTO:data:image/png\\;base64'), v4(`PHOTO:${A}`));
    expect(photos(lines)).toEqual([`item2.PHOTO:${A}`]);
  });
});
