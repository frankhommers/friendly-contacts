/** Pure logic of the Import panel: what a row says, the search, and the grouping per address book. */

/** What a queued "available for import" card carries (a subset of the remote card's metadata). */
export interface ImportData {
  uid?: string;
  fn?: string;
  /** vCard N value: family;given;additional;prefix;suffix */
  n?: string;
  org?: string;
  sourceId: string;
}

export interface ImportGroup<T> {
  sourceId: string;
  name: string;
  items: T[];
}

const UNKNOWN_BOOK = 'Unknown address book';
const NO_NAME = '(no name)';

/** Lowercase, accents removed and trimmed: "René" and "rene" fold to the same text. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** The name to show: FN, else "given family" from N, else a placeholder. */
export function importName(data: ImportData): string {
  const fn = data.fn?.trim();
  if (fn) return fn;
  if (data.n) {
    const [family = '', given = ''] = data.n.split(';').map((part) => part.trim());
    const built = [given, family].filter((part) => part !== '').join(' ');
    if (built !== '') return built;
  }
  return NO_NAME;
}

/** "Name" or "Name · Organisation". */
export function importRowText(data: ImportData): string {
  const org = data.org?.trim();
  return org ? `${importName(data)} · ${org}` : importName(data);
}

/** True when every word of the query is found in the name or the organisation, ignoring case and accents. */
export function matchesImportQuery(data: ImportData, query: string): boolean {
  const words = foldText(query).split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return true;
  const haystack = foldText(`${importName(data)} ${data.org ?? ''}`);
  return words.every((word) => haystack.includes(word));
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

/**
 * The matching items per address book: books sorted by name, contacts by name (then uid, so the order is stable).
 * A book without a match is left out; `sourceName` gives the book's name, undefined for a book that is gone.
 */
export function groupImportItems<T extends { data: ImportData }>(
  items: T[],
  sourceName: (sourceId: string) => string | undefined,
  query: string,
): ImportGroup<T>[] {
  const bySource = new Map<string, T[]>();
  for (const item of items) {
    if (!matchesImportQuery(item.data, query)) continue;
    const list = bySource.get(item.data.sourceId);
    if (list) list.push(item);
    else bySource.set(item.data.sourceId, [item]);
  }
  const compare = (a: T, b: T) =>
    collator.compare(importName(a.data), importName(b.data)) || (a.data.uid ?? '').localeCompare(b.data.uid ?? '');
  return Array.from(bySource, ([sourceId, list]) => ({
    sourceId,
    name: sourceName(sourceId) ?? UNKNOWN_BOOK,
    items: [...list].sort(compare),
  })).sort((a, b) => collator.compare(a.name, b.name) || a.sourceId.localeCompare(b.sourceId));
}

/** The question before "Import all" for everything visible. */
export function importAllQuestion(contacts: number, books: number): string {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return `Import ${plural(contacts, 'contact')} from ${plural(books, 'address book')}?`;
}
