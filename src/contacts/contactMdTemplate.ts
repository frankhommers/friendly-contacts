import { DEFAULT_MAPPING, MappingRow } from "src/contacts/friendly/mapping";
import { recordToFriendly, renderFriendlyNote } from "src/contacts/friendlyNotes";

/** A contact note with friendly properties from an old-style (`TEL[CELL]`) record. */
export function mdRender(
  record: Record<string, any>,
  hashtags: string,
  rows: MappingRow[] = DEFAULT_MAPPING,
): string {
  return renderFriendlyNote(recordToFriendly(record, rows), hashtags, rows);
}
