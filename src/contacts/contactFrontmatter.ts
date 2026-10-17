import { TFile } from "obsidian";
import { friendlyKey, hasVCardValues, isContactFrontmatter, legacyRecord } from "src/contacts/friendlyNotes";
import { getApp } from "src/context/sharedAppContext";
import { getSettings } from "src/context/sharedSettingsContext";

export type Contact = {
	data: Record<string, any>;
	file: TFile;
}

/** Contact notes among `files`; `data` is the legacy (`TEL[CELL]`-style) record of each. */
export async function getFrontmatterFromFiles(files: TFile[]) {
	const { metadataCache } = getApp();
  const rows = getSettings().friendly.mapping;
  const contactsData: Contact[] = [];
  for (const file of files) {
		const frontMatter = metadataCache.getFileCache(file)?.frontmatter
		if (frontMatter && isContactFrontmatter(frontMatter)) {
			contactsData.push({
				file,
				data: legacyRecord(frontMatter, rows),
			});
		}
  }
  return contactsData;
}

function currentFile(file: TFile): TFile {
  // The file object can be a cloned object and therefor we ask obsidian to fetch again.
  const myFile = getApp().vault.getAbstractFileByPath(file.path);
  if (!myFile || !(myFile instanceof TFile)) {
    throw new Error("while updating the frontmatter file should always exist even if the TFile is cloned");
  }
  return myFile;
}

/** Sets every key of `record` in the note's frontmatter; other keys and the body stay as they are. */
export async function updateFrontMatter(file: TFile, record: Record<string, any>) {
  await getApp().fileManager.processFrontMatter(currentFile(file), (frontmatter: Record<string, unknown>) => {
    Object.assign(frontmatter, record);
  });
}

/**
 * Sets one value given by its vCard key (`UID`, `PHOTO`, `FN`). Friendly notes get the friendly
 * property (`uid`, `photo`, `name`); notes that still hold vCard keys keep the vCard key.
 */
export async function updateFrontMatterValue(file: TFile, key: string, value: string) {
  const rows = getSettings().friendly.mapping;
  await getApp().fileManager.processFrontMatter(currentFile(file), (frontmatter: Record<string, unknown>) => {
    frontmatter[hasVCardValues(frontmatter) ? key : friendlyKey(key, rows)] = value;
  });
}
