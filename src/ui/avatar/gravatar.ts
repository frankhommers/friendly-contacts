/**
 * Gravatar on the contact cards: shown only, never written to a note or card. A contact's own photo wins; without
 * one, the Gravatar of its first email address is shown. Gravatar sees a SHA-256 hash of that address, so it is off
 * unless switched on.
 */

/** What a card shows when the contact has no Gravatar: our own initials, or an image Gravatar makes. */
export const GRAVATAR_FALLBACKS = ["initials", "mp", "identicon", "monsterid", "wavatar", "retro", "robohash", "blank"] as const;
export type GravatarFallback = (typeof GRAVATAR_FALLBACKS)[number];

export const GRAVATAR_FALLBACK_LABELS: Record<GravatarFallback, string> = {
  initials: "Initials",
  mp: "Silhouette",
  identicon: "Identicon (pattern)",
  monsterid: "Monster",
  wavatar: "Wavatar (face)",
  retro: "Retro (pixels)",
  robohash: "Robot",
  blank: "Empty",
};

export interface GravatarSettings {
  enabled: boolean;
  fallback: GravatarFallback;
}

export const DEFAULT_GRAVATAR: GravatarSettings = { enabled: false, fallback: "initials" };

/** The stored Gravatar settings, with defaults for anything missing or unknown. */
export function normalizeGravatar(loaded: unknown): GravatarSettings {
  const value = (loaded ?? {}) as Partial<Record<keyof GravatarSettings, unknown>>;
  return {
    enabled: value.enabled === true,
    fallback: GRAVATAR_FALLBACKS.includes(value.fallback as GravatarFallback)
      ? (value.fallback as GravatarFallback)
      : DEFAULT_GRAVATAR.fallback,
  };
}

/** The first email address of a contact (`EMAIL…` keys, in note order); undefined when it has none. */
export function firstEmail(data: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("EMAIL") || typeof value !== "string") continue;
    const email = value.trim();
    if (email.includes("@")) return email;
  }
  return undefined;
}

/** Hex SHA-256 of the address as Gravatar wants it: trimmed and in lower case. */
export async function gravatarHash(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The image URL for a hash. With the `initials` fallback Gravatar answers 404 when there is no Gravatar, and the
 * card shows our own initials. Rating G (Gravatar's default).
 */
export function gravatarUrl(hash: string, size: number, fallback: GravatarFallback): string {
  const d = fallback === "initials" ? "404" : fallback;
  return `https://gravatar.com/avatar/${hash}?s=${size}&d=${d}&r=g`;
}
