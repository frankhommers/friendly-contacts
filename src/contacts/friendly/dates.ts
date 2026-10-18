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

/**
 * The note value as `line` reads it: a full date in the year of the line's X-APPLE-OMIT-YEAR is that line's
 * year-less date (`1604-03-12` -> `--03-12`, as notes showed Apple birthdays before year-less dates were read).
 */
export function noteDateFor(note: string, line: VCardLine | undefined): string {
  const text = normalizeNoteDate(note);
  const full = parseFull(text);
  if (!full || !line || getParam(line, APPLE_PARAM) !== full[0]) return text;
  return `--${full[1]}-${full[2]}`;
}

/** vCard 4.0 reduced-precision dates (`1985`, `1985-04`, `---15`, `--04`) and date-times with a date part. */
const PARTIAL_4 = /^(?:\d{4}(?:-?\d{2})?|---\d{2}|--\d{2})$/;
const DATE_TIME = /^(?:\d{4}(?:-?\d{2}(?:-?\d{2})?)?|--\d{2}(?:-?\d{2})?|---\d{2})T\d{2}[\d:.,]*(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;

const without = (params: [string, string][], ...names: string[]): [string, string][] =>
  params.filter(([k]) => !names.includes(k));

/** Value and params for an edited line (`line` given) or a new line (params are then only what the form adds). */
export function writeDate(
  note: string,
  line: VCardLine | undefined,
  version: string,
): { value: string; params: [string, string][] } {
  const text = noteDateFor(note, line);
  const is4 = version.trim() === '4.0';
  const own = line?.params ?? [];
  // A date is never VALUE=text, and VALUE=date-time on a line that now holds a date would be wrong.
  const dateParams = without(own, 'VALUE');

  const yearLess = YEAR_LESS.exec(text);
  if (yearLess) {
    const [, month, day] = yearLess;
    const apple = line ? getParam(line, APPLE_PARAM) : undefined;
    if (apple === undefined && is4) return { value: `--${month}${day}`, params: dateParams };
    const year = apple !== undefined && /^\d{4}$/.test(apple) ? apple : DEFAULT_APPLE_YEAR;
    const basic = line !== undefined && apple !== undefined && /^\d{8}$/.test(line.value.trim());
    return {
      value: basic ? `${year}${month}${day}` : `${year}-${month}-${day}`,
      params: [...without(dateParams, APPLE_PARAM), [APPLE_PARAM, year]],
    };
  }

  const full = parseFull(text);
  if (full) {
    const [year, month, day] = full;
    // `--0315` is basic style too, so adding a year to it gives `19800315`.
    const basic = line ? /^(?:\d{8}|--\d{4})$/.test(line.value.trim()) : is4;
    return {
      value: basic ? `${year}${month}${day}` : `${year}-${month}-${day}`,
      params: without(dateParams, APPLE_PARAM),
    };
  }

  if (is4 && (PARTIAL_4.test(text) || DATE_TIME.test(text))) {
    return { value: text, params: without(dateParams, APPLE_PARAM) };
  }

  const params = without(own, APPLE_PARAM);
  if (!is4) return { value: escapeText(text), params };
  return { value: escapeText(text), params: [...without(params, 'VALUE'), ['VALUE', 'text']] };
}
