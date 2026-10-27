import { describe, expect, it } from 'vitest';
import { insertLabelledDateRow, labelledDateRow } from 'src/contacts/friendly/dateLabels';
import { DEFAULT_MAPPING, renameRow, rowForLine } from 'src/contacts/friendly/mapping';
import { isRemovableRow, ownRow, suggestedPropertyName } from 'src/contacts/friendly/ownRows';
import { parseCard, serializeLine, VCardLine } from 'src/contacts/friendly/lines';
import { newCard, patch, toFriendly } from 'src/contacts/friendly/translate';

describe('rows of your own', () => {
  it('suggests a property name from the card field', () => {
    expect(suggestedPropertyName('X-BANAAN')).toBe('banaan');
    expect(suggestedPropertyName('TEL[FAX]')).toBe('tel-fax');
    expect(suggestedPropertyName('x-skype-name')).toBe('skype-name');
  });

  it('reads and writes the card field, from now on', () => {
    expect(ownRow('x-banaan', '', DEFAULT_MAPPING, 5)).toEqual({
      row: { kind: 'field', property: 'banaan', read: ['X-BANAAN'], write: 'X-BANAAN', syncSince: 5 },
    });
    expect(ownRow('TEL[FAX]', ' fax ', DEFAULT_MAPPING, 5)).toEqual({
      row: { kind: 'field', property: 'fax', read: ['TEL[FAX]'], write: 'TEL;TYPE=FAX', syncSince: 5 },
    });
  });

  it('the row reads the lines of its field', () => {
    const made = ownRow('X-BANAAN', '', DEFAULT_MAPPING, 5);
    if (!('row' in made)) throw new Error('no row');
    const rows = [...DEFAULT_MAPPING, made.row];
    expect(rowForLine({ name: 'X-BANAAN', params: [], value: 'geel' }, rows).map((r) => r.property)).toEqual(['banaan']);
  });

  it('refuses what is no card field, a part, and a field another row reads', () => {
    expect(ownRow('', '', DEFAULT_MAPPING, 5)).toHaveProperty('error');
    expect(ownRow('banaan', '', DEFAULT_MAPPING, 5)).toHaveProperty('error');
    expect(ownRow('ADR[WORK].STREET', '', DEFAULT_MAPPING, 5)).toHaveProperty('error');
    expect(ownRow('TEL[CELL]', '', DEFAULT_MAPPING, 5)).toEqual({ error: 'TEL[CELL] is already read by mobile.' });
  });

  it('only rows of your own and dates with a label can be removed', () => {
    const made = ownRow('X-BANAAN', '', DEFAULT_MAPPING, 5);
    if (!('row' in made)) throw new Error('no row');
    expect(isRemovableRow(made.row)).toBe(true);
    expect(isRemovableRow(labelledDateRow('Verkering', 'dating'))).toBe(true);
    const renamed = renameRow(DEFAULT_MAPPING, 'mobile', 'gsm');
    expect(renamed.filter(isRemovableRow)).toEqual([]);
    expect(insertLabelledDateRow(DEFAULT_MAPPING, labelledDateRow('Verkering', 'dating')).filter(isRemovableRow)).toHaveLength(1);
  });
});

describe('a row of your own on the card', () => {
  const ctx = { uidToName: () => undefined, displayName: () => undefined, resolveLink: (name: string) => ({ text: name }) };
  const made = ownRow('X-BANAAN', '', DEFAULT_MAPPING, 5);
  if (!('row' in made)) throw new Error('no row');
  const rows = [...DEFAULT_MAPPING, made.row];
  const card = (...body: string[]) => parseCard(['BEGIN:VCARD', 'VERSION:3.0', 'UID:a', 'FN:Dora', ...body, 'END:VCARD'].join('\r\n'));

  it('reads the field into the note', () => {
    expect(toFriendly(card('X-BANAAN:geel'), rows, ctx).props.banaan).toBe('geel');
  });

  it('writes the note value to the card, new and changed', () => {
    const lines = (cardLines: VCardLine[], value: string) =>
      patch(cardLines, toFriendly(cardLines, rows, ctx), { ...toFriendly(cardLines, rows, ctx).props, banaan: value }, rows, ctx).lines.map(serializeLine);
    expect(lines(card(), 'geel')).toContain('X-BANAAN:geel');
    expect(lines(card('X-BANAAN:groen'), 'geel')).toContain('X-BANAAN:geel');
    expect(newCard({ name: 'Dora', banaan: 'geel' }, rows, ctx).lines.map(serializeLine)).toContain('X-BANAAN:geel');
  });
});
