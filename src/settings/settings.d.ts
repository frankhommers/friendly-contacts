import type { MappingRow } from "src/contacts/friendly/mapping";
import type { NoteLinksSettings } from "src/contacts/friendly/noteLinks";
import type { LayoutSettings } from "src/contacts/layout";
import type { GravatarSettings } from "src/ui/avatar/gravatar";

export type AuthType = "basic" | "apikey";

export interface ContactsPluginSettings {
  contactsFolder: string;
  defaultHashtag: string;
  processors: ProcessorsSettings
  groupInsights: boolean;
  /** Address books (CardDAV). */
  sources: Source[];
  /** Id of the source new contacts go to; '' when there is none. */
  defaultSource: string;
  createFieldsKeys: string[]
  friendly: FriendlySettings;
  /** Whether a contact is one note or a folder with a folder note. */
  layout: LayoutSettings;
  /** UID (cleaned) of the contact that is the vault owner ("This is me"); '' when none is chosen. */
  meUid: string;
  /** Links to Obsidian notes on cards (see `noteLinks.ts`). */
  noteLinks: NoteLinksSettings;
  /** Gravatar on the contact cards (shown only, see `gravatar.ts`). */
  gravatar: GravatarSettings;
}

export interface FriendlySettings {
  mapping: MappingRow[];
  /** The set of default rows the stored mapping has had added (`DEFAULT_ROWS_SET`); absent: 0. */
  defaultRowsSeen?: number;
}


export interface Source {
  id: string;
  name: string;
  addressBookUrl: string;
  authType: AuthType;
  authKey: string;
  enabled: boolean;
  /** vCard version of contacts created here; 'auto' (also when absent) follows most cards in the book. */
  newCardVersion?: 'auto' | '3.0' | '4.0';
}

interface ProcessorsSettings {
  [key: string]: string|boolean;
}


