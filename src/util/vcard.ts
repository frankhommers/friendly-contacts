export function uidOutOfString(messyString: string):string|undefined {
  const unfolded = messyString.replace(/\r\n[ \t]/g, '');
  const match = /^uid(?:;[^:\r\n]*)?:(.*)$/im.exec(unfolded);
  return match ? cleanUid(match[1]) : undefined;
}

export function nOutOfString(messyString: string):string|undefined {
  const unfolded = messyString.replace(/\r\n[ \t]/g, '');
  const match = unfolded.match(/^n(?:;[^:\r\n]*)?:.*$/gim);
  if(!match) {
    return undefined;
  }
  const line = match[0];
  return line.slice(line.indexOf(':') + 1).trim();
}

/** The first ORG component (the company), unescaped; undefined when the card has none. */
export function orgOutOfString(messyString: string): string | undefined {
  const unfolded = messyString.replace(/\r\n[ \t]/g, '');
  const match = /^(?:[\w-]+\.)?org(?:;[^:\r\n]*)?:(.*)$/im.exec(unfolded);
  if (!match) return undefined;
  const first = /^((?:\\.|[^;\\])*)/.exec(match[1].replace(/\r$/, ''))?.[1] ?? '';
  const org = first.replace(/\\([\\,;nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c)).trim();
  return org === '' ? undefined : org;
}

/**
 * The UID as compared and stored: without a leading `urn:uuid:` and trimmed. Anything else is kept:
 * legacy macOS UIDs such as `XXXX:ABPerson` differ only before the colon.
 */
export function cleanUid(uid: string | undefined): string {
  if (!uid) {
    return '';
  }
  return uid.trim().replace(/^urn:uuid:/i, '').trim();
}

export function fnOutOfString(messyString: string):string|undefined {
  const unfolded = messyString.replace(/\r\n[ \t]/g, '');
  const match = unfolded.match(/^fn:.*$/gim);
  let fn;
  if(match) {
    const uidLine = match[0]
    const parts = uidLine.split(':');
    fn = parts.length > 1 ? parts.at(-1)!.trim() : '';
  }
  return fn
}


/** A random version 4 UUID (Web Crypto; available in Electron and Node 19+). */
export function generateUUID(): string {
  return globalThis.crypto.randomUUID();
}
