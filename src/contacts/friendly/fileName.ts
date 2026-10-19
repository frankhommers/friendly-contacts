/** The file name a contact gets from its name lines. Pure; no obsidian / src/context imports. */

import { VCardForObsidianRecord } from 'src/contacts/vcard/shared/vcard.d';
import { createNameSlug } from 'src/util/nameUtils';
import { splitStructured, unescapeText } from './lines';

/**
 * File name (without `.md`) a card gets on import, from its N and FN values as on the wire:
 * the N parts for a person, else FN. Undefined when the card has no name.
 */
export function contactFileName(n: string | undefined, fn: string | undefined): string | undefined {
  const parts = n ? splitStructured(n).map(unescapeText) : [];
  const record: Record<string, string | undefined> = {
    'N.FN': parts[0],
    'N.GN': parts[1],
    'N.MN': parts[2],
    'N.PREFIX': parts[3],
    'N.SUFFIX': parts[4],
    FN: fn ? unescapeText(fn) : undefined,
  };
  try {
    return createNameSlug(record as VCardForObsidianRecord) || undefined;
  } catch {
    return undefined;
  }
}
