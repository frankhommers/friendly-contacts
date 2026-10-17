/** Relationship helpers shared by the translators. No obsidian / src/context imports. */

export interface RelationContext {
  /** Display name of the contact with this vCard UID, if known. */
  uidToName(uid: string): string | undefined;
  /** Resolves a link target (a name) to a contact UID, plain text, or "ambiguous". */
  resolveLink(name: string): { uid: string } | { text: string } | { ambiguous: true };
}

export function toLink(name: string): string {
  return `[[${name}]]`;
}

/** `[[Name|alias]]` / `[[Name#heading]]` -> `Name`; plain text passes through. */
export function linkTarget(value: string): string {
  const m = /^\[\[([\s\S]*)\]\]$/.exec(value);
  if (!m) return value;
  return m[1].split('|')[0].split('#')[0];
}
