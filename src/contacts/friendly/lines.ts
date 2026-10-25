/**
 * Lossless vCard line model.
 *
 * A card is parsed into a flat list of lines. Names and parameter names are
 * normalised to upper case; parameter values and the value are kept exactly as
 * on the wire (still escaped, quotes included), so a line that was not touched
 * can be written back unchanged.
 */

export interface VCardLine {
  group?: string;
  name: string;
  params: [string, string][];
  value: string;
  /** Original unfolded line as parsed; serializeLine emits it verbatim. Edited/new lines must omit it. */
  raw?: string;
}

const MAX_OCTETS = 75;

/** Splits `s` at every `sep` that is outside double quotes. */
function splitOutsideQuotes(s: string, sep: string, limit = Infinity): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < s.length && parts.length < limit - 1; i++) {
    const c = s[i];
    if (c === '"') quoted = !quoted;
    else if (c === sep && !quoted) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

function parseLine(text: string): VCardLine | undefined {
  const [head, ...rest] = splitOutsideQuotes(text, ':', 2);
  if (rest.length === 0) return undefined;
  const [nameWithGroup, ...rawParams] = splitOutsideQuotes(head, ';');
  const dot = nameWithGroup.indexOf('.');
  const group = dot > 0 ? nameWithGroup.slice(0, dot) : undefined;
  const name = (dot > 0 ? nameWithGroup.slice(dot + 1) : nameWithGroup).toUpperCase();
  const params = rawParams
    .filter((p) => p !== '')
    .map((p): [string, string] => {
      const eq = p.indexOf('=');
      if (eq < 0) return ['TYPE', p];
      return [p.slice(0, eq).toUpperCase(), p.slice(eq + 1)];
    });
  const line: VCardLine = { name, params, value: rest[0], raw: text };
  if (group !== undefined) line.group = group;
  return line;
}

/**
 * Parses one card; unfolds, drops BEGIN/END, keeps everything else in order. A line without ':' becomes
 * `{ name: '', params: [], value: '', raw }` (no mapping row matches the empty name).
 */
export function parseCard(raw: string): VCardLine[] {
  const unfolded = raw.replace(/(\r\n|\n|\r)[ \t]/g, '');
  const lines: VCardLine[] = [];
  for (const text of unfolded.split(/\r\n|\n|\r/)) {
    if (text === '') continue;
    // A line without ':' (e.g. a vCard 2.1 quoted-printable continuation) is kept as is, so a PUT writes it back.
    const line = parseLine(text) ?? { name: '', params: [], value: '', raw: text };
    if (!line.group && (line.name === 'BEGIN' || line.name === 'END')) continue;
    lines.push(line);
  }
  return lines;
}

/** One unfolded content line (no line terminator); `raw` wins when present. */
export function serializeLine(line: VCardLine): string {
  if (line.raw !== undefined) return line.raw;
  const params = line.params.map(([k, v]) => `;${k}=${v}`).join('');
  return `${line.group ? `${line.group}.` : ''}${line.name}${params}:${line.value}`;
}

/** Folds at 75 octets, never inside a UTF-8 sequence. Continuations start with one space. */
function fold(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of text) {
    const bytes = Buffer.byteLength(ch, 'utf8');
    if (size + bytes > MAX_OCTETS) {
      out.push(current);
      current = ' ';
      size = 1;
    }
    current += ch;
    size += bytes;
  }
  out.push(current);
  return out;
}

export function serializeCard(lines: VCardLine[]): string {
  const physical = ['BEGIN:VCARD'];
  for (const line of lines) physical.push(...fold(serializeLine(line)));
  physical.push('END:VCARD');
  return physical.join('\r\n') + '\r\n';
}

export function getParam(line: VCardLine, name: string): string | undefined {
  const upper = name.toUpperCase();
  return line.params.find(([k]) => k === upper)?.[1];
}

/** All TYPE values (repeated params and comma lists), upper-case. */
export function typesOf(line: VCardLine): string[] {
  const types: string[] = [];
  for (const [k, v] of line.params) {
    if (k !== 'TYPE') continue;
    for (const t of v.split(',')) {
      const clean = t.trim().replace(/^"|"$/g, '').toUpperCase();
      if (clean) types.push(clean);
    }
  }
  return types;
}

const NON_MATCHING_TYPES = new Set(['INTERNET', 'PREF', 'VOICE']);

/** TYPEs that identify what a value is (label-ish), sorted. */
export function matchTypes(line: VCardLine): string[] {
  return typesOf(line)
    .filter((t) => !NON_MATCHING_TYPES.has(t))
    .sort();
}

export function unescapeText(v: string): string {
  return v.replace(/\\([\\,;nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

export function escapeText(v: string): string {
  return v.replace(/\r\n|\r|\n|[\\,;]/g, (c) => {
    if (c === '\\' || c === ',' || c === ';') return `\\${c}`;
    return '\\n';
  });
}

/** Splits on unescaped `;`; components stay escaped. */
export function splitStructured(v: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === '\\' && i + 1 < v.length) {
      current += c + v[++i];
    } else if (c === ';') {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  parts.push(current);
  return parts;
}

/** Fields the vCard format defines as made of parts that every server knows, with their part count. */
export const COMPONENT_COUNT: Record<string, number> = { ADR: 7, N: 5, ORG: 2 };

/**
 * The parts of a field made of parts; parts stay escaped. `ADR`, `N` and `ORG` are split on unescaped `;` only. A
 * server that does not know a field (Radicale with `GENDER` or `X-GENDER`) stores `O;non-binary` as
 * `O\;non-binary`, so for any other field a value with no unescaped `;` but an escaped one is read as such a
 * flattened value, its escaped `;` separating the parts. Known limit: a part that itself holds a `;` cannot be told
 * apart there (an identity `a;b` comes back as identity `a`).
 */
export function splitParts(name: string, v: string): string[] {
  const parts = splitStructured(v);
  const field = name.slice(name.indexOf('.') + 1).toUpperCase();
  if (field in COMPONENT_COUNT || parts.length > 1 || !v.includes('\\;')) return parts;
  const flattened: string[] = [];
  let current = '';
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === '\\' && v[i + 1] === ';') {
      flattened.push(current);
      current = '';
      i++;
    } else if (c === '\\' && i + 1 < v.length) {
      current += c + v[++i];
    } else {
      current += c;
    }
  }
  flattened.push(current);
  return flattened;
}

export function joinStructured(parts: string[]): string {
  return parts.join(';');
}

/** Group (lower-case) -> its raw `X-ABLabel` value; the first label of a group counts. */
export function groupLabels(lines: VCardLine[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const line of lines) {
    const group = line.group?.toLowerCase();
    // Upper-case when parsed; a patched card read before it is serialized spells it `X-ABLabel`.
    if (line.name.toUpperCase() === 'X-ABLABEL' && group !== undefined && !labels.has(group)) {
      labels.set(group, unescapeText(line.value));
    }
  }
  return labels;
}
