import type { MappingRow } from "src/contacts/friendly/mapping";
import type { LayoutSettings } from "src/contacts/layout";

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
}

export interface FriendlySettings {
  mapping: MappingRow[];
}


export interface Source {
  id: string;
  name: string;
  addressBookUrl: string;
  authType: AuthType;
  authKey: string;
  enabled: boolean;
}

interface ProcessorsSettings {
  [key: string]: string|boolean;
}


