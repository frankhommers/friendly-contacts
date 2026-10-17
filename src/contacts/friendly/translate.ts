/**
 * vCard lines -> friendly note properties, remembering which line (and
 * component) each property came from so a later patch can touch only that line.
 */

import { getParam, splitStructured, unescapeText, VCardLine } from './lines';
import { ComponentRow, FieldRow, MappingRow, RelationRow, rowForLine } from './mapping';
import { RelationContext, toLink } from './relations';

export type FriendlyValue = string | string[];
export type Provenance = { line: number; component?: number };

export interface Friendly {
  props: Record<string, FriendlyValue>;
  /** Array for list relations, one entry per item. */
  source: Record<string, Provenance | Provenance[]>;
}

const UUID_URN = /^urn:uuid:/i;

function formatDate(value: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : value;
}

/** Splits on unescaped commas and unescapes each item; empty items are dropped. */
function splitList(value: string): string[] {
  const items: string[] = [];
  let current = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '\\' && i + 1 < value.length) current += c + value[++i];
    else if (c === ',') {
      items.push(current);
      current = '';
    } else current += c;
  }
  items.push(current);
  return items.map((s) => unescapeText(s).trim()).filter((s) => s !== '');
}

function fieldValue(row: FieldRow, line: VCardLine): FriendlyValue | undefined {
  if (row.property === 'photo') return line.value === '' ? undefined : line.value;
  if (row.format === 'list') {
    const items = splitList(line.value);
    return items.length > 0 ? items : undefined;
  }
  const text = unescapeText(line.value);
  if (text === '') return undefined;
  return row.format === 'date' ? formatDate(text) : text;
}

function componentValue(row: ComponentRow, line: VCardLine): string | undefined {
  const part = splitStructured(line.value)[row.index];
  const text = part === undefined ? '' : unescapeText(part);
  return text === '' ? undefined : text;
}

function relationLink(line: VCardLine, ctx: RelationContext): string | undefined {
  if ((getParam(line, 'VALUE') ?? '').toLowerCase() === 'text') {
    const name = unescapeText(line.value);
    return name === '' ? undefined : toLink(name);
  }
  const name = ctx.uidToName(line.value.replace(UUID_URN, ''));
  return name === undefined || name === '' ? undefined : toLink(name);
}

export function toFriendly(lines: VCardLine[], rows: MappingRow[], ctx: RelationContext): Friendly {
  const props: Record<string, FriendlyValue> = {};
  const source: Record<string, Provenance | Provenance[]> = {};
  const counts = new Map<MappingRow, number>();
  const fedComponents = new Set<MappingRow>();

  const nameFor = (row: MappingRow): string => {
    const n = (counts.get(row) ?? 0) + 1;
    counts.set(row, n);
    return n === 1 ? row.property : `${row.property}-${n}`;
  };

  const addRelation = (row: RelationRow, link: string, index: number) => {
    if (row.single) {
      const name = nameFor(row);
      props[name] = link;
      source[name] = { line: index };
      return;
    }
    const list = (props[row.property] ??= []) as string[];
    list.push(link);
    const prov = (source[row.property] ??= []) as Provenance[];
    prov.push({ line: index });
  };

  lines.forEach((line, index) => {
    for (const row of rowForLine(line, rows)) {
      if (row.kind === 'relation') {
        const link = relationLink(line, ctx);
        if (link !== undefined) addRelation(row, link, index);
      } else if (row.kind === 'component') {
        if (fedComponents.has(row)) continue;
        fedComponents.add(row);
        const value = componentValue(row, line);
        if (value === undefined) continue;
        props[row.property] = value;
        source[row.property] = { line: index, component: row.index };
      } else {
        const value = fieldValue(row, line);
        if (value === undefined) continue;
        const name = nameFor(row);
        props[name] = value;
        source[name] = { line: index };
      }
    }
  });

  return { props, source };
}
