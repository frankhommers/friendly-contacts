import {App, normalizePath, Notice, Platform, TFile, TFolder, Vault, Workspace} from "obsidian";
import {contactsInFolder, ensureFolder, newContactLocation} from "src/contacts/layoutNotes";
import {getSettings} from "src/context/sharedSettingsContext";
import {FileExistsModal} from "src/ui/modals/fileExistsModal";
import {createNameSlug} from "src/util/nameUtils";

import {Deferred} from "../util/deferred";
import {detectVCardEncoding} from "./encodingDetection";

export async function openFile(file: TFile, workspace: Workspace) {
  const leaf = workspace.getLeaf()
  await leaf.openFile(file, {active: true});
}

export function findContactFiles(contactsFolder: TFolder) {
  const contactFiles: TFile[] = [];
  Vault.recurseChildren(contactsFolder, async (contactNote) => {
    if (contactNote instanceof TFile) {
      contactFiles.push(contactNote);
    }
  });
  return contactFiles;
}

async function openCreatedFile(app: App, filePath: string) {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (file instanceof TFile) {
    await openFile(file, app.workspace);
  }
}

/**
 * Writes the file; when it exists, or `clash` says why it should not simply be written (a contact's folder that
 * already holds another contact), waits for the user to pick Replace or Skip, so callers see the real outcome.
 * `folder` (a contact's own folder) is created right before the note is written, so a Skip leaves nothing behind;
 * an existing folder is used as it is.
 */
async function handleFileCreation(app: App, filePath: string, content: string, folder?: string, clash?: string): Promise<void> {
  const fileExists = await app.vault.adapter.exists(filePath);

  if (!fileExists && clash === undefined) {
    if (folder !== undefined) await ensureFolder(app, folder);
    await app.vault.adapter.write(filePath, content);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    new FileExistsModal(app, filePath, async (action: "replace" | "skip") => {
      try {
        if (action === "skip") {
          new Notice("File creation skipped.");
          return;
        }
        if (folder !== undefined) await ensureFolder(app, folder);
        await app.vault.adapter.write(filePath, content);
        await openCreatedFile(app, filePath);
        new Notice(fileExists ? `File overwritten.` : `File created.`);
      } catch (error) {
        reject(error);
        return;
      } finally {
        resolve();
      }
    }, fileExists ? undefined : clash).open();
  });
}

/**
 * Creates a contact note named `filename` (with `.md`) in the contact layout: next to the active note when that is
 * inside `folderPath` (the contacts folder), else in `folderPath`; in folder layout with its own folder, never
 * inside another contact's folder. Returns the note's path, or undefined when the contacts folder is missing.
 */
export async function createContactFile(
  app: App,
  folderPath: string,
  content: string,
  filename: string
): Promise<string | undefined> {
  const folder = app.vault.getAbstractFileByPath(folderPath !== '' ? folderPath : '/');
  if (!folder) {
    new Notice(`Can not find path: '${folderPath}'. Please update "Contacts" plugin settings`);
    return;
  }
  const name = filename.replace(/\.md$/i, "");
  const location = newContactLocation(app, name, folderPath);
  const filePath = normalizePath(location.note);
  // The contact's folder exists and holds another contact (e.g. `index.md` from before a pattern change): ask first.
  const others = location.folder === undefined ? [] : contactsInFolder(app, location.folder).filter((f) => f.path !== filePath);
  const clash = others.length > 0
    ? `The folder "${location.folder}" already holds a contact (${others.map((f) => f.basename).join(", ")}). Create "${filePath}" there anyway?`
    : undefined;
  await handleFileCreation(app, filePath, content, location.folder, clash);
  return filePath;
}

export function fileId(file: TFile): string {
  let hash = 0;
  for (let i = 0; i < file.path.length; i++) {
    hash = (hash << 5) - hash + file.path.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(); // Ensure it's positive
}

export function fileJoin(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
}

export async function openFilePicker(type: string): Promise<string | Blob> {
  const deferred = new Deferred<string | Blob>();
  const input = document.createElement("input");
  input.type = "file";
  input.accept = type;
  input.style.display = "none";
  input.addEventListener("change", async () => {
    if (input?.files && input.files.length > 0) {
      const file = input.files[0];

      const isImage = type === "image/*" || type.startsWith("image/");
      if (isImage) {
        deferred.resolve(file); // Return the File for image use
      } else {
        const parsed = await parseTextFile(file);
        deferred.resolve(parsed);
      }
    } else {
      deferred.resolve("");
    }
  });

  document.body.appendChild(input);
  input.click();
  document.body.removeChild(input);

  return deferred.promise;
}

export async function parseTextFile(file: Blob): Promise<string> {
  try {
    // Prefer raw bytes so we can detect encoding
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const encoding = detectVCardEncoding(bytes);
    const decoder = new TextDecoder(encoding as any, {fatal: false});
    let text = decoder.decode(bytes);

    // Optionally strip leading BOM char if present after decoding
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }

    return text;
  } catch (e) {
    // Fallback to UTF-8 text if anything goes wrong
    const reader = new FileReader();
    const deferred = new Deferred<string>();

    reader.onload = function (event) {
      const rawData = event?.target?.result || "";
      if (typeof rawData === "string") {
        deferred.resolve(rawData);
      } else {
        deferred.resolve(new TextDecoder("utf-8").decode(rawData as ArrayBuffer));
      }
    };

    reader.readAsText(file, "UTF-8");

    return await deferred.promise;
  }
}

export function saveVcardFilePicker(data: string, obsidianFile?: TFile) {
  try {
    const file = new Blob([data], {type: "text/vcard"});
    const filename = obsidianFile ? obsidianFile.basename.replace(/ /g, '-') + '.vcf' : "shared-contacts.vcf";
    const fileObject = new File([file], filename, {type: "text/vcard"});

    /**
     * Warning we are hooking into obsidian implementation (capacitor)
     * This dependency can change at any point but there is no alternative
     * found that can actually share without extra user click on IOS and Android
     **/
    // @ts-ignore
    if (Platform.isMobileApp && window.Capacitor && typeof window.Capacitor.Plugins.Filesystem.open === 'function') {
      (async () => {
        try {
          // @ts-ignore
          await window.Capacitor.Plugins.Filesystem.writeFile({
            path: filename,
            data,
            directory: 'DOCUMENTS',
            encoding: 'utf8'
          });
          if (Platform.isAndroidApp) {
            new Notice(`Saved to /Documents on device:\n${filename}\nOpen the Files app to share with other applications`);
          } else {
            new Notice(`\`Saved to your device's Files app under this app:\n${filename}\nOpen the Files app to share with other applications`);
          }
        } catch (e) {
          console.log(e);
        }
      })();

    } else {
      // desktopApp
      const element = document.createElement("a");
      element.href = URL.createObjectURL(fileObject);
      element.download = filename;
      element.click();
    }
  } catch (err) {
    console.log("Failed to share or save VCard", err);
  }
}

export function createFileName(records: Record<string, string>) {
  const nameSlug = createNameSlug(records);
  return nameSlug + '.md';
}


export function isFileInFolder(file: TFile) {
  const settings = getSettings()
  return file.path.startsWith(settings.contactsFolder);
}
