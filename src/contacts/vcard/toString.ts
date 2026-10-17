import { TFile } from "obsidian";
import { coerceNoteProps } from "src/contacts/friendly/merge";
import { friendlyNoteCard } from "src/contacts/obsidianNotes";
import { recordToVCard } from "src/contacts/vcard/recordToVCard";
import { VCardToStringError, VCardToStringReply } from "src/contacts/vcard/shared/vcard";
import { getApp } from "src/context/sharedAppContext";
import { getSettings } from "src/context/sharedSettingsContext";

async function generateVCard(file: TFile): Promise<string> {
  const app = getApp();

  const frontMatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontMatter) {
    throw new Error('No frontmatter found.');
  }

  const rows = getSettings().friendly.mapping;
  const { props } = coerceNoteProps(frontMatter, rows);
  if (Object.keys(props).length === 0) {
    // Old-style note: vCard keys only.
    return recordToVCard(frontMatter, file.basename);
  }
  return (await friendlyNoteCard(app, file, props, rows)).replace(/\r\n$/, '');
}

export async function toString(contactFiles: TFile[]): Promise<VCardToStringReply> {
  const vCards: string[] = [];
  const vCardsErrors: VCardToStringError[] = [];

  for (const file of contactFiles) {
    try {
      vCards.push(await generateVCard(file));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vCardsErrors.push({"status": "error", "file": file.basename, "message": message})
    }
  }

  return {
    vcards: vCards.join('\n'),
    errors: vCardsErrors
  };
}
