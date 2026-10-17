import { TFile } from "obsidian";
import { friendlyKey, hasVCardValues } from "src/contacts/friendlyNotes";
import { getApp } from "src/context/sharedAppContext";
import { getSettings } from "src/context/sharedSettingsContext";

import { VCardForObsidianRecord } from "./shared/vcard";

/**
 * The note's frontmatter plus every missing default field (empty), as friendly properties.
 * A note that still holds vCard keys is returned unchanged.
 */
export async function addDefaultFields(file: TFile):Promise<VCardForObsidianRecord> {
  const { createFieldsKeys, friendly } = getSettings();
  const { metadataCache } = getApp();

  const frontMatter = metadataCache.getFileCache(file)?.frontmatter;
  if (!frontMatter) {
    throw new Error('No frontmatter found.');
  }
  const record: Record<string, any> = { ...frontMatter };
  // Friendly fields next to vCard keys would make a half-converted note; such notes are converted first.
  if (hasVCardValues(frontMatter)) {
    return record;
  }
  for (const key of createFieldsKeys) {
    const property = friendlyKey(key, friendly.mapping);
    if (!(property in record)) {
      record[property] = "";
    }
  }

  return  record;

}
