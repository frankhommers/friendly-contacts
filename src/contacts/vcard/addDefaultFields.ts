import { TFile } from "obsidian";
import { friendlyKey, isOldStyleNote } from "src/contacts/friendlyNotes";
import { getApp } from "src/context/sharedAppContext";
import { getSettings } from "src/context/sharedSettingsContext";

import { VCardForObsidianRecord } from "./shared/vcard";

/** The note's frontmatter plus every missing default field (empty), as friendly properties. */
export async function addDefaultFields(file: TFile):Promise<VCardForObsidianRecord> {
  const { createFieldsKeys, friendly } = getSettings();
  const { metadataCache } = getApp();

  const frontMatter = metadataCache.getFileCache(file)?.frontmatter;
  if (!frontMatter) {
    throw new Error('No frontmatter found.');
  }
  const oldStyle = isOldStyleNote(frontMatter, friendly.mapping);
  const record: Record<string, any> = { ...frontMatter };
  for (const key of createFieldsKeys) {
    const property = oldStyle ? key : friendlyKey(key, friendly.mapping);
    if (!(property in record)) {
      record[property] = "";
    }
  }

  return  record;

}
