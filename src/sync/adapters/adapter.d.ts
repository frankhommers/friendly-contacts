export interface VCardRaw {
  uid: string | undefined;
  raw: string; // The raw VCF data
  etag?: string; // ETag without quotes, set by pull
  href?: string; // The href the card was pulled from
}

export interface PushOptions {
  href?: string; // Real href of the card; absolute or relative to the address book URL
  ifMatch?: string; // ETag (without quotes) the card must still have on the server
  ifNoneMatch?: boolean; // Only create, fail if the card already exists
}

export interface VCardMeta {
  href: string;
  etag: string;
  lastModified: Date;
  uid: string | undefined;
  fn: string | undefined;
  n: string | undefined;
  org?: string; // First ORG component, unescaped
}
