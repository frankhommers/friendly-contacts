import { MappingRow } from "src/contacts/friendly/mapping";

/** The groups of the property list in the settings, in the order they are shown. */
export const PROPERTY_GROUPS = ["Name", "Phone, email and web", "Work", "Address", "Dates", "Relationships", "Other"] as const;
export type PropertyGroup = (typeof PROPERTY_GROUPS)[number];

/** The group of a card field, by its key without parameters or group prefix. */
const GROUP_OF_KEY: Record<string, PropertyGroup> = {
  FN: "Name",
  N: "Name",
  NICKNAME: "Name",
  TEL: "Phone, email and web",
  EMAIL: "Phone, email and web",
  URL: "Phone, email and web",
  IMPP: "Phone, email and web",
  ORG: "Work",
  TITLE: "Work",
  ROLE: "Work",
  ADR: "Address",
  BDAY: "Dates",
  ANNIVERSARY: "Dates",
};

/** The card field key a row writes: `TEL;TYPE=CELL` and `item1.TEL` give `TEL`. */
const writeKey = (row: MappingRow): string => (row.write.split(/[;:]/)[0].split(".").pop() ?? "").trim().toUpperCase();

/**
 * The group a row is listed under: relationships by their kind, dates by their format, anything else by the card
 * field it writes. A row with a field of its own (`NOTE`, `X-SOMETHING`) goes under Other.
 */
export function propertyGroup(row: MappingRow): PropertyGroup {
  if (row.kind === "relation") return "Relationships";
  if (row.kind === "field" && row.format === "date") return "Dates";
  return GROUP_OF_KEY[writeKey(row)] ?? "Other";
}

/** The rows' indexes per group, in group order; empty groups are left out, and rows keep their order. */
export function groupRows(rows: MappingRow[], include: (row: MappingRow) => boolean): { group: PropertyGroup; indexes: number[] }[] {
  return PROPERTY_GROUPS.map((group) => ({
    group,
    indexes: rows.flatMap((row, i) => (include(row) && propertyGroup(row) === group ? [i] : [])),
  })).filter(({ indexes }) => indexes.length > 0);
}
