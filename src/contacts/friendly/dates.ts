/**
 * Birthday / anniversary values: how a vCard date line reads in a note, and how a note date is written back
 * in the card's own form (Apple's X-APPLE-OMIT-YEAR trick on 3.0, `--MMDD` on 4.0). No obsidian / src/context imports.
 */

import { escapeText, getParam, unescapeText, VCardLine } from './lines';

const APPLE_PARAM = 'X-APPLE-OMIT-YEAR';
const DEFAULT_APPLE_YEAR = '1604';

const FULL = /^(\d{4})(?:-(\d{2})-(\d{2})|(\d{2})(\d{2}))$/;
const YEAR_LESS = /^--(\d{2})-?(\d{2})$/;

/** `[year, month, day]` of a full date in either style, else undefined. */
function parseFull(value: string): [string, string, string] | undefined {
  const m = FULL.exec(value);
  return m ? [m[1], m[2] ?? m[4], m[3] ?? m[5]] : undefined;
}

/** The note value for a date line; empty for an empty value. */
export function readDate(line: VCardLine): string {
  const value = line.value.trim();
  if ((getParam(line, 'VALUE') ?? '').toLowerCase() !== 'text') {
    const full = parseFull(value);
    if (full) {
      const [year, month, day] = full;
      return getParam(line, APPLE_PARAM) === year ? `--${month}-${day}` : `${year}-${month}-${day}`;
    }
    const yearLess = YEAR_LESS.exec(value);
    if (yearLess) return `--${yearLess[1]}-${yearLess[2]}`;
  }
  return unescapeText(line.value);
}

/** `--0315` -> `--03-15`; anything else trimmed and unchanged. */
export function normalizeNoteDate(value: string): string {
  const text = value.trim();
  const yearLess = YEAR_LESS.exec(text);
  return yearLess ? `--${yearLess[1]}-${yearLess[2]}` : text;
}

/** Value and params for an edited line (`line` given) or a new line (params are then only what the form adds). */
export function writeDate(
  note: string,
  line: VCardLine | undefined,
  version: string,
): { value: string; params: [string, string][] } {
  const text = normalizeNoteDate(note);
  const is4 = version.trim() === '4.0';
  const withoutValueText = (line?.params ?? []).filter(([k, v]) => !(k === 'VALUE' && v.toLowerCase() === 'text'));

  const yearLess = YEAR_LESS.exec(text);
  if (yearLess) {
    const [, month, day] = yearLess;
    const apple = line ? getParam(line, APPLE_PARAM) : undefined;
    if (apple === undefined && is4) return { value: `--${month}${day}`, params: withoutValueText };
    const year = apple !== undefined && /^\d{4}$/.test(apple) ? apple : DEFAULT_APPLE_YEAR;
    const params = withoutValueText.filter(([k]) => k !== APPLE_PARAM);
    params.push([APPLE_PARAM, year]);
    return { value: `${year}-${month}-${day}`, params };
  }

  const full = parseFull(text);
  if (full) {
    const [year, month, day] = full;
    const basic = line ? /^\d{8}$/.test(line.value.trim()) : is4;
    return {
      value: basic ? `${year}${month}${day}` : `${year}-${month}-${day}`,
      params: withoutValueText.filter(([k]) => k !== APPLE_PARAM),
    };
  }

  const params = (line?.params ?? []).slice();
  if (is4 && !params.some(([k, v]) => k === 'VALUE' && v.toLowerCase() === 'text')) params.push(['VALUE', 'text']);
  return { value: escapeText(text), params };
}
