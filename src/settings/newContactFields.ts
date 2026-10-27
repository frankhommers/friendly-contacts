import { isMappedProperty, MappingRow } from "src/contacts/friendly/mapping";
import { friendlyKey, isVCardKey } from "src/contacts/friendlyNotes";

/**
 * The fields a new contact gets (`createFieldsKeys`). An entry is a property name (`mobile`) or a vCard key
 * (`NOTE`, `TEL[CELL]`, `X-FOO`); a key with a property is created under that property, any other key as it is.
 */

/** The properties of the given and family name (parts of `N`), as the property names say; `firstname`/`lastname` when there is none. */
export function nameProperties(rows: MappingRow[]): { firstname: string; lastname: string } {
  const given = friendlyKey("N.GN", rows);
  const family = friendlyKey("N.FN", rows);
  return { firstname: given === "N.GN" ? "firstname" : given, lastname: family === "N.FN" ? "lastname" : family };
}

/** The property an entry is created under. */
export const newContactProperty = (key: string, rows: MappingRow[]): string => friendlyKey(key, rows);

/** True when a new contact gets `property`. */
export function inNewContacts(property: string, keys: string[], rows: MappingRow[]): boolean {
  return keys.some((key) => newContactProperty(key, rows) === property);
}

/** The entries with `property` added (at the end) or removed (every entry created under it). */
export function withNewContactProperty(keys: string[], property: string, on: boolean, rows: MappingRow[]): string[] {
  if (!on) return keys.filter((key) => newContactProperty(key, rows) !== property);
  return inNewContacts(property, keys, rows) ? keys : [...keys, property];
}

/**
 * The entries after properties were renamed: `mobile` and `mobile-2` follow `mobile` to `gsm`. Each entry is renamed
 * at most once, so swapping two names works.
 */
export function renameNewContactKeys(keys: string[], renames: { from: string; to: string }[]): string[] {
  if (renames.length === 0) return keys;
  return keys.map((key) => {
    for (const { from, to } of renames) {
      if (key === from) return to;
      if (key.startsWith(`${from}-`) && /^\d+$/.test(key.slice(from.length + 1))) return `${to}${key.slice(from.length)}`;
    }
    return key;
  });
}

/** The entries not created under a property in the list (a card field no row reads, `mobile-2`), in their order. */
export function otherNewContactKeys(keys: string[], rows: MappingRow[]): string[] {
  const shown = new Set(rows.map((row) => row.property));
  return keys.filter((key) => !shown.has(newContactProperty(key, rows)));
}

/**
 * What a person typed to give new contacts: a property (as typed), the property that reads a typed card field, or a
 * card field (in capitals) no property reads yet, which needs a row of its own. An error when it is empty, already
 * there, or neither a property nor a supported vCard key (custom keys start with `X-`).
 */
export function newContactAddition(
  typed: string,
  keys: string[],
  rows: MappingRow[],
): { property: string } | { cardField: string } | { error: string } {
  const text = typed.trim();
  if (text === "") return { error: "Type a property name or a card field." };
  const already = (property: string) => ({ error: `New contacts already get ${property}.` });
  if (isMappedProperty(text, rows)) return inNewContacts(text, keys, rows) ? already(text) : { property: text };
  const cardField = text.toUpperCase();
  if (!isVCardKey(cardField)) {
    return { error: `"${text}" is not a property or a card field. Use a property name such as mobile or city, or prefix custom fields with X-.` };
  }
  const property = newContactProperty(cardField, rows);
  if (property === cardField) return { cardField };
  return inNewContacts(property, keys, rows) ? already(property) : { property };
}
