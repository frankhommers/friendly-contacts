/**
 * Friendly note properties -> vCard lines. Starts from the server's lines and
 * changes only what the user changed; every other line stays the same object.
 * No obsidian / src/context imports.
 */

import { generateUUID } from '../../util/vcard';
import { normalizeNoteDate, writeDate } from './dates';
import { escapeText, joinStructured, serializeLine, splitStructured, VCardLine } from './lines';
import { photoKey, photoLine } from './photo';
import { ComponentRow, FieldRow, MappingRow, RelationRow, rowForLine, rowForProperty } from './mapping';
import { linkTarget, RelationContext } from './relations';
import type { Friendly, FriendlyValue, Provenance } from './translate';

export interface PatchResult {
  lines: VCardLine[];
  warnings: string[];
}

/** Component count of structured values we may have to create from scratch. */
const COMPONENT_COUNT: Record<string, number> = { ADR: 7, N: 5, ORG: 2 };

/** Shared bookkeeping; line indexes refer to `base`, deletions apply at the end. */
interface State {
  base: VCardLine[];
  lines: VCardLine[];
  removed: Set<number>;
  added: VCardLine[];
  /** Escaped components of existing structured lines being edited. */
  parts: Map<number, string[]>;
  /** New structured lines (already in `added`) per write key, with their escaped components. */
  newParts: Map<string, { line: VCardLine; parts: string[] }>;
  warnings: string[];
  changed: boolean;
}

/** Frontmatter may hold numbers, nulls or lists where text is expected. */
function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(text).filter((s) => s !== '').join(', ');
  return String(value).trim();
}

function list(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map(text).filter((s) => s !== '');
}

function sameSet(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

/** `TEL;TYPE=CELL` -> name + params. */
function parseWriteKey(write: string): { name: string; params: [string, string][] } {
  const [name, ...params] = write.split(';');
  return {
    name: name.trim().toUpperCase(),
    params: params
      .filter((p) => p !== '')
      .map((p): [string, string] => {
        const eq = p.indexOf('=');
        return eq < 0 ? ['TYPE', p] : [p.slice(0, eq).toUpperCase(), p.slice(eq + 1)];
      }),
  };
}

/** Copy of `line` with a new value (and optionally params), without `raw`. */
function withValue(line: VCardLine, value: string, params = line.params): VCardLine {
  const { raw: _raw, ...rest } = line;
  return { ...rest, params: params.map(([k, v]): [string, string] => [k, v]), value };
}

function single(prov: Provenance | Provenance[] | undefined): Provenance | undefined {
  return Array.isArray(prov) ? undefined : prov;
}

function setLine(s: State, index: number, line: VCardLine): void {
  s.lines[index] = line;
  s.changed = true;
}

/** Deletes a line and the Apple label sharing its group. */
function removeLine(s: State, index: number): void {
  s.removed.add(index);
  s.changed = true;
  const group = s.base[index].group?.toLowerCase();
  if (group === undefined) return;
  s.base.forEach((line, i) => {
    if (line.name === 'X-ABLABEL' && line.group?.toLowerCase() === group) s.removed.add(i);
  });
}

function addLine(s: State, write: string, value: string, extraParams: [string, string][] = []): VCardLine {
  const key = parseWriteKey(write);
  const line: VCardLine = { name: key.name, params: [...key.params, ...extraParams], value };
  s.added.push(line);
  s.changed = true;
  return line;
}

function setPart(parts: string[], index: number, value: string): void {
  while (parts.length <= index) parts.push('');
  parts[index] = value;
}

/** `firstname lastname`, trimmed; empty when both are empty. */
function derivedName(props: Record<string, FriendlyValue>): string {
  return [props.firstname, props.lastname]
    .map(text)
    .filter((s) => s !== '')
    .join(' ');
}

/** A date in the form the card's version and the line's own style expect; a same-date edit leaves the line alone. */
function patchDate(s: State, row: FieldRow, prov: Provenance | undefined, before: string, after: string): void {
  if (normalizeNoteDate(before) === normalizeNoteDate(after)) return;
  if (normalizeNoteDate(after) === '') {
    if (prov) removeLine(s, prov.line);
    return;
  }
  const line = prov ? s.base[prov.line] : undefined;
  const written = writeDate(after, line, cardVersion(s));
  if (!line) {
    addLine(s, row.write, written.value, written.params);
    return;
  }
  const next = withValue(line, written.value, written.params);
  if (serializeLine(next) !== serializeLine(line)) setLine(s, prov!.line, next);
}

function patchField(
  s: State,
  row: FieldRow,
  prov: Provenance | undefined,
  before: unknown,
  after: unknown,
  props: Record<string, FriendlyValue>,
): void {
  if (row.format === 'date') return patchDate(s, row, prov, text(before), text(after));
  const isList = row.format === 'list';
  if (isList ? sameSet(list(before), list(after)) : text(before) === text(after)) return;
  if (row.property === 'photo') return patchPhoto(s, row, prov, text(before), text(after));
  let value: string;
  if (isList) value = list(after).map(escapeText).join(',');
  else if (row.property === 'photo') value = text(after);
  else value = escapeText(text(after));

  // The UID and FN lines are never deleted: an emptied FN falls back to the name parts, else stays as it is.
  if (prov && value === '' && row.property === 'name') value = escapeText(derivedName(props));
  if (prov && value === '' && (row.property === 'uid' || row.property === 'name')) return;

  if (prov) {
    if (value === '') removeLine(s, prov.line);
    else if (value !== s.base[prov.line].value) setLine(s, prov.line, withValue(s.base[prov.line], value));
  } else if (value !== '') {
    addLine(s, row.write, value);
  }
}

/** VERSION of the card being patched (newCard starts at 4.0); 3.0 when absent, as Apple writes. */
function cardVersion(s: State): string {
  return s.base.find((line) => !line.group && line.name === 'VERSION')?.value ?? '3.0';
}

/** PHOTO in the form the card's version expects; an edit keeps the group and drops the other params. */
function patchPhoto(s: State, row: FieldRow, prov: Provenance | undefined, before: string, after: string): void {
  if (after !== '' && photoKey(before) === photoKey(after)) return;
  if (after === '') {
    if (prov) removeLine(s, prov.line);
    return;
  }
  const photo = photoLine(after, cardVersion(s));
  if (!prov) {
    if (photo) {
      s.added.push({ name: 'PHOTO', params: photo.params, value: photo.value });
      s.changed = true;
    } else addLine(s, row.write, after);
    return;
  }
  const line = s.base[prov.line];
  const next = photo ? withValue(line, photo.value, photo.params) : withValue(line, after);
  if (serializeLine(next) !== serializeLine(line)) setLine(s, prov.line, next);
}

function patchComponent(
  s: State,
  row: ComponentRow,
  prov: Provenance | undefined,
  before: unknown,
  after: unknown,
  rows: MappingRow[],
): void {
  if (text(before) === text(after)) return;
  const value = escapeText(text(after));
  // An empty component has no provenance; its line is the first one feeding this row (as in toFriendly).
  const index = prov?.line ?? s.base.findIndex((line) => rowForLine(line, rows).includes(row));
  if (index >= 0) {
    const parts = s.parts.get(index) ?? splitStructured(s.base[index].value);
    setPart(parts, row.index, value);
    s.parts.set(index, parts);
    return;
  }
  if (value === '') return;
  let pending = s.newParts.get(row.write);
  if (!pending) {
    const parts: string[] = Array(COMPONENT_COUNT[parseWriteKey(row.write).name] ?? 0).fill('');
    pending = { line: addLine(s, row.write, ''), parts };
    s.newParts.set(row.write, pending);
  }
  setPart(pending.parts, row.index, value);
}

function finishComponents(s: State): void {
  for (const [index, parts] of s.parts) {
    const line = s.base[index];
    const value = joinStructured(parts);
    if (value === line.value) continue;
    if (line.name !== 'N' && parts.every((p) => p === '')) removeLine(s, index);
    else setLine(s, index, withValue(line, value));
  }
  for (const { line, parts } of s.newParts.values()) line.value = joinStructured(parts);
}

/** RELATED value for a link target: a contact uid, or plain text. */
function relatedValue(s: State, name: string, ctx: RelationContext): { value: string; text: boolean } {
  const resolved = ctx.resolveLink(name);
  if ('uid' in resolved) return { value: `urn:uuid:${resolved.uid}`, text: false };
  if ('text' in resolved) return { value: escapeText(resolved.text !== '' ? resolved.text : name), text: true };
  s.warnings.push(`"${name}" matches more than one contact; saved as text.`);
  return { value: escapeText(name), text: true };
}

const target = (value: string): string => linkTarget(value).trim();

function addRelated(s: State, row: RelationRow, name: string, ctx: RelationContext): void {
  const related = relatedValue(s, name, ctx);
  addLine(s, row.write, related.value, related.text ? [['VALUE', 'text']] : []);
}

function patchRelation(
  s: State,
  row: RelationRow,
  key: string,
  prov: Provenance | Provenance[] | undefined,
  before: unknown,
  after: unknown,
  ctx: RelationContext,
): void {
  if (row.single) {
    if (Array.isArray(after) && after.length > 1) {
      s.warnings.push(`"${key}" holds a list; only its first item is used.`);
    }
    const name = target(text(Array.isArray(after) ? after[0] : after));
    if (target(text(before)) === name) return;
    const p = single(prov);
    if (name === '') {
      if (p) removeLine(s, p.line);
    } else if (p) {
      const related = relatedValue(s, name, ctx);
      const line = s.base[p.line];
      const params = line.params.filter(([k]) => k !== 'VALUE');
      if (related.text) params.push(['VALUE', 'text']);
      setLine(s, p.line, withValue(line, related.value, params));
    } else {
      addRelated(s, row, name, ctx);
    }
    return;
  }

  const beforeNames = list(before).map(target);
  const afterNames = list(after).map(target).filter((n) => n !== '');
  if (sameSet(beforeNames, afterNames)) return;
  const provs = Array.isArray(prov) ? prov : [];
  beforeNames.forEach((name, i) => {
    if (!afterNames.includes(name) && provs[i]) removeLine(s, provs[i].line);
  });
  for (const name of new Set(afterNames)) {
    if (!beforeNames.includes(name)) addRelated(s, row, name, ctx);
  }
}

/** Current UTC time as `YYYYMMDDTHHMMSSZ`. */
function revStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}/, '').replace(/[-:]/g, '');
}

/** Mapped properties of both sides, in mapping-table order. */
function mappedKeys(
  before: Record<string, FriendlyValue>,
  after: Record<string, FriendlyValue>,
  rows: MappingRow[],
): { key: string; row: MappingRow; ordinal: number }[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .flatMap((key) => {
      const found = rowForProperty(key, rows);
      return found ? [{ key, ...found }] : [];
    })
    .sort((a, b) => rows.indexOf(a.row) - rows.indexOf(b.row) || a.ordinal - b.ordinal);
}

export function patch(
  base: VCardLine[],
  before: Friendly,
  after: Record<string, FriendlyValue>,
  rows: MappingRow[],
  ctx: RelationContext,
): PatchResult {
  const s: State = {
    base,
    lines: base.slice(),
    removed: new Set(),
    added: [],
    parts: new Map(),
    newParts: new Map(),
    warnings: [],
    changed: false,
  };

  for (const { key, row, ordinal } of mappedKeys(before.props, after, rows)) {
    const prov = before.source[key];
    const was = before.props[key];
    const now = after[key];
    if (row.kind === 'field') patchField(s, row, single(prov), was, now, after);
    // toFriendly never numbers component rows or list relations; such keys have no line to map to.
    else if (ordinal > 1 && !(row.kind === 'relation' && row.single)) continue;
    else if (row.kind === 'component') patchComponent(s, row, single(prov), was, now, rows);
    else patchRelation(s, row, key, prov, was, now, ctx);
  }
  finishComponents(s);

  if (s.changed) {
    const rev = base.findIndex((line, i) => line.name === 'REV' && !s.removed.has(i));
    if (rev >= 0) setLine(s, rev, withValue(base[rev], revStamp()));
  }

  return { lines: [...s.lines.filter((_, i) => !s.removed.has(i)), ...s.added], warnings: s.warnings };
}

/** A fresh vCard 4.0 from friendly properties. */
export function newCard(
  props: Record<string, FriendlyValue>,
  rows: MappingRow[],
  ctx: RelationContext,
): PatchResult {
  const base: VCardLine[] = [{ name: 'VERSION', params: [], value: '4.0' }];
  if (text(props.uid) === '') base.push({ name: 'UID', params: [], value: `urn:uuid:${generateUUID()}` });
  if (text(props.name) === '') {
    const fn = derivedName(props);
    if (fn !== '') base.push({ name: 'FN', params: [], value: escapeText(fn) });
  }
  return patch(base, { props: {}, source: {} }, props, rows, ctx);
}
