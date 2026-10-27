import { isLabelledDateRow } from 'src/contacts/friendly/dateLabels';
import { FieldRow, isDefaultRow, isFixedProperty, MappingRow } from 'src/contacts/friendly/mapping';
import { friendlyKey, isVCardKey } from 'src/contacts/friendlyNotes';

/** A whole card field as typed: `X-BANAAN`, `NOTE`, `TEL[FAX]`, `IMPP[SKYPE,HOME]`. */
const CARD_FIELD = /^([A-Z][A-Z0-9-]*)(?:\[([A-Z0-9-]+(?:,[A-Z0-9-]+)*)\])?$/;

/** A property name for a card field: `X-BANAAN` gives `banaan`, `TEL[FAX]` gives `tel-fax`. */
export function suggestedPropertyName(cardField: string): string {
  return cardField
    .trim()
    .toLowerCase()
    .replace(/^x-/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A row of your own for a whole card field, under `property` (a suggested name when empty). It reads and writes the
 * field as typed, and carries `syncSince: now`: a sync base stored before then is read without it, so the values
 * already on the cards come in as the card's own, never as removed in Obsidian. An error when the field cannot be
 * read or another row already reads it.
 */
export function ownRow(typed: string, property: string, rows: MappingRow[], now: number): { row: FieldRow } | { error: string } {
  const cardField = typed.trim().toUpperCase();
  if (cardField === '') return { error: 'Type a card field, such as X-BANAAN.' };
  const match = CARD_FIELD.exec(cardField);
  if (!match || !isVCardKey(cardField)) {
    return {
      error: `"${typed.trim()}" is not a card field. Use a field such as NOTE or TEL[FAX], or prefix custom fields with X-; for a part of a field, set Part in the details.`,
    };
  }
  const reader = friendlyKey(cardField, rows);
  if (reader !== cardField) return { error: `${cardField} is already read by ${reader}.` };
  const [, name, types] = match;
  const row: FieldRow = {
    kind: 'field',
    property: property.trim() === '' ? suggestedPropertyName(cardField) : property.trim(),
    read: [cardField],
    write: types ? `${name};TYPE=${types}` : name,
    syncSince: now,
  };
  return { row };
}

/** True when the settings may remove `row`: a date with a label, or a row of your own (not a default row). */
export function isRemovableRow(row: MappingRow): boolean {
  return !isFixedProperty(row.property) && (isLabelledDateRow(row) || !isDefaultRow(row));
}
