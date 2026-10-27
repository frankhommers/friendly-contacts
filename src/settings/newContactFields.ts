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

/** The entries not created under one of `listed` (properties shown in the property list), in their order. */
export function otherNewContactKeys(keys: string[], rows: MappingRow[], listed: (row: MappingRow) => boolean): string[] {
  const shown = new Set(rows.filter(listed).map((row) => row.property));
  return keys.filter((key) => !shown.has(newContactProperty(key, rows)));
}

/**
 * What a person typed to add, as an entry: a property name as typed, a vCard key in capitals. An error when it is
 * empty, already there, or neither a property nor a supported vCard key (custom keys start with `X-`).
 */
export function parseNewContactKey(typed: string, keys: string[], rows: MappingRow[]): { key: string } | { error: string } {
  const text = typed.trim();
  if (text === "") return { error: "Type a property name or a card field." };
  if (isMappedProperty(text, rows)) {
    return inNewContacts(newContactProperty(text, rows), keys, rows) ? { error: `New contacts already get ${text}.` } : { key: text };
  }
  const key = text.toUpperCase();
  if (!isVCardKey(key)) {
    return { error: `"${text}" is not a property or a card field. Use a property name such as mobile or city, or prefix custom fields with X-.` };
  }
  if (keys.includes(key) || inNewContacts(newContactProperty(key, rows), keys, rows)) {
    return { error: `New contacts already get ${newContactProperty(key, rows)}.` };
  }
  return { key };
}
