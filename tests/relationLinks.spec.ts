import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutSettings } from "src/contacts/layout";
import type { Source } from "src/settings/settings";

/** A small in-memory vault with just enough of the metadata cache: links resolve by path or by unique base name. */
const h = vi.hoisted(() => {
  class TAbstractFile {
    parent: TFolder | null = null;
    constructor(public path: string) {}
    get name(): string {
      return this.path.slice(this.path.lastIndexOf("/") + 1);
    }
  }
  class TFolder extends TAbstractFile {
    children: TAbstractFile[] = [];
    isRoot(): boolean {
      return this.path === "";
    }
  }
  class TFile extends TAbstractFile {
    content = "";
    frontmatter: Record<string, unknown> | undefined;
    get basename(): string {
      return this.name.replace(/\.md$/, "");
    }
    get extension(): string {
      return "md";
    }
  }
  return { TAbstractFile, TFolder, TFile, settings: {} as Record<string, unknown>, remote: [] as unknown[], app: {} as unknown };
});

vi.mock("obsidian", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    Notice: class {},
    TAbstractFile: h.TAbstractFile,
    TFolder: h.TFolder,
    TFile: h.TFile,
    normalizePath: (p: string) => p,
    Vault: {
      recurseChildren(folder: InstanceType<typeof h.TFolder>, callback: (node: InstanceType<typeof h.TAbstractFile>) => void) {
        const walk = (node: InstanceType<typeof h.TAbstractFile>) => {
          callback(node);
          if (node instanceof h.TFolder) node.children.forEach(walk);
        };
        walk(folder);
      },
    },
  };
});

vi.mock("src/ui/modals/fileExistsModal", () => ({ FileExistsModal: class {} }));
vi.mock("src/sync/adapters", () => ({
  activeSources: () => [{ id: "s1", name: "Work", addressBookUrl: "http://x/", authType: "apikey", authKey: "k", enabled: true }],
  adapterFor: () => ({ getMetaList: async () => h.remote }),
}));
vi.mock("src/context/sharedAppContext", () => ({ getApp: () => h.app, getPluginDir: () => "plugin" }));
vi.mock("src/context/sharedSettingsContext", () => ({
  getSettings: () => h.settings,
  updateSetting: async () => {},
}));

import { DEFAULT_SETTINGS } from "src/settings/setting";
import { linkWithAlias } from "src/contacts/friendly/relations";
import { importRemoteCard, obsidianMirrorEnv, ObsidianRelationContext, relinkAfterImport, relinkImported } from "src/contacts/obsidianNotes";
import { resetLayoutWarning } from "src/contacts/layoutNotes";
import { resultProps } from "src/sync/review";
import { applySync, NoteIO, prepareSync, SyncDeps } from "src/sync/syncContact";
import type { SyncStateEntry } from "src/sync/syncState";

type File = InstanceType<typeof h.TFile>;
type Node = InstanceType<typeof h.TAbstractFile>;

const noteLayout: LayoutSettings = { layout: "note", noteName: "{{name}}", location: "inside" };
const indexLayout: LayoutSettings = { layout: "folder", noteName: "index", location: "inside" };
const nameLayout: LayoutSettings = { layout: "folder", noteName: "{{name}}", location: "inside" };

function useLayout(layout: LayoutSettings) {
  h.settings = { ...DEFAULT_SETTINGS, contactsFolder: "Contacts", layout };
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function fakeApp() {
  const nodes = new Map<string, Node>();
  const root = new h.TFolder("");
  nodes.set("", root);
  const attach = (node: Node) => {
    const parent = nodes.get(dirname(node.path));
    if (!(parent instanceof h.TFolder)) throw new Error(`no folder for ${node.path}`);
    node.parent = parent;
    parent.children.push(node);
    nodes.set(node.path, node);
  };
  const folder = (path: string) => {
    if (nodes.has(path)) return;
    if (dirname(path) !== "") folder(dirname(path));
    attach(new h.TFolder(path));
  };
  const note = (path: string, frontmatter: Record<string, unknown> | null): File => {
    folder(dirname(path));
    const file = new h.TFile(path);
    file.frontmatter = frontmatter ?? undefined;
    attach(file);
    return file;
  };
  const files = () => [...nodes.values()].filter((n): n is File => n instanceof h.TFile);
  const stem = (f: File) => f.path.replace(/\.md$/, "");
  const processed: string[] = [];
  const other = new Map<string, string>();
  /** Paths the vault has not picked up yet (written through the adapter a moment ago). */
  const unseen = new Set<string>();

  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => (unseen.has(p) ? null : (nodes.get(p === "/" ? "" : p) ?? null)),
      createFolder: async (p: string) => folder(p),
      adapter: {
        exists: async (p: string) => nodes.has(p) || other.has(p),
        read: async (p: string) => (nodes.get(p) as File | undefined)?.content ?? other.get(p) ?? "",
        mkdir: async (p: string) => {
          other.set(p, "");
        },
        write: async (p: string, data: string) => {
          // Plugin data (the sync state) is not part of the vault tree here.
          if (!p.endsWith(".md")) {
            other.set(p, data);
            return;
          }
          const existing = nodes.get(p);
          const file = existing instanceof h.TFile ? existing : note(p, null);
          file.content = data;
          // What the metadata cache makes of the note: the properties of the YAML block (flat `key: value` lines).
          const fm: Record<string, unknown> = {};
          for (const m of data.split("---")[1]?.matchAll(/^([\w-]+): (.*)$/gm) ?? []) fm[m[1]] = m[2];
          file.frontmatter = fm;
        },
      },
    },
    fileManager: {
      processFrontMatter: async (file: File, fn: (fm: Record<string, unknown>) => void) => {
        processed.push(file.path);
        file.frontmatter ??= {};
        fn(file.frontmatter);
      },
    },
    metadataCache: {
      getFileCache: (file: File) => (file.frontmatter ? { frontmatter: file.frontmatter } : null),
      getFirstLinkpathDest: (link: string) =>
        files().find((f) => stem(f) === link || f.path === link) ?? files().find((f) => f.basename === link) ?? null,
      fileToLinktext: (file: File) => (files().filter((f) => f.basename === file.basename).length === 1 ? file.basename : stem(file)),
    },
    workspace: { getActiveFile: () => null },
  };
  return { app: app as never, note, folder, files, processed, unseen };
}

const source: Source = { id: "s1", name: "Work", addressBookUrl: "http://x/", authType: "apikey", authKey: "k", enabled: true };
const SEM_CARD = "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:sem-uid\r\nFN:Sem de Vries\r\nN:de Vries;Sem;;;\r\nEND:VCARD\r\n";
const meta = (uid: string, fn: string) => ({ uid, fn, n: undefined, href: `/${uid}.vcf`, etag: `e-${uid}`, lastModified: new Date() });

beforeEach(() => {
  h.app = {};
  useLayout(noteLayout);
  resetLayoutWarning();
  h.remote = [meta("sem-uid", "Sem de Vries")];
});

describe("link text with an alias", () => {
  it("alias when the note name differs", () => {
    expect(linkWithAlias("Contacts/Jan de Vries/index", "Jan de Vries")).toBe("Contacts/Jan de Vries/index|Jan de Vries");
    expect(linkWithAlias("index", "Jan")).toBe("index|Jan");
    // characters that would break the link stay out of the alias
    expect(linkWithAlias("Contacts/J/index", "Jan [the] | man")).toBe("Contacts/J/index|Jan the man");
    expect(linkWithAlias("Contacts/J/index", "[]")).toBe("Contacts/J/index");
  });

  it("no alias when equal", () => {
    expect(linkWithAlias("Contacts/Jan de Vries/Jan de Vries", "Jan de Vries")).toBe("Contacts/Jan de Vries/Jan de Vries");
    expect(linkWithAlias("Jan de Vries", "Jan de Vries")).toBe("Jan de Vries");
  });

  it("a fixed note name gets the contact name as alias, in the context and in mirrored links", () => {
    useLayout(indexLayout);
    const v = fakeApp();
    v.folder("Contacts");
    const jan = v.note("Contacts/Jan de Vries/index.md", { name: "Jan de Vries", uid: "jan-uid" });
    const sem = v.note("Contacts/Sem/index.md", { uid: "sem-uid" });
    const ctx = new ObsidianRelationContext(v.app, "Contacts/Piet/index.md", [{ file: jan as never, uid: "jan-uid" }, { file: sem as never, uid: "sem-uid" }], []);
    expect(ctx.uidToName("jan-uid")).toBe("Contacts/Jan de Vries/index|Jan de Vries");
    // no `name` property: the folder's name
    expect(ctx.uidToName("sem-uid")).toBe("Contacts/Sem/index|Sem");
    // the name written on cards is the display name, never the path or the alias syntax
    expect(ctx.displayName("jan-uid")).toBe("Jan de Vries");
    expect(ctx.displayName("sem-uid")).toBe("Sem");
    expect(obsidianMirrorEnv(v.app).linkTo("Contacts/Jan de Vries/index.md", "Contacts/Piet/index.md")).toBe(
      "[[Contacts/Jan de Vries/index|Jan de Vries]]",
    );
    // the alias does not change what the link points to
    expect(ctx.resolveLink("Contacts/Jan de Vries/index")).toEqual({ uid: "jan-uid" });
  });

  it("links to notes named for the contact stay as they were", () => {
    for (const layout of [noteLayout, nameLayout]) {
      useLayout(layout);
      const v = fakeApp();
      v.folder("Contacts");
      const jan = v.note("Contacts/Jan de Vries/Jan de Vries.md", { name: "Jan", uid: "jan-uid" });
      const ctx = new ObsidianRelationContext(v.app, "Contacts/Piet.md", [{ file: jan as never, uid: "jan-uid" }], []);
      expect(ctx.uidToName("jan-uid")).toBe("Jan de Vries");
      // the `name` property wins over the file name
      expect(ctx.displayName("jan-uid")).toBe("Jan");
      expect(obsidianMirrorEnv(v.app).linkTo("Contacts/Jan de Vries/Jan de Vries.md", "Contacts/Piet.md")).toBe("[[Jan de Vries]]");
    }
  });
});

describe("relinking after an import", () => {
  const relations = { friends: ["[[Sem de Vries]]", "[[Piet]]"], spouse: "[[Sem de Vries|Sem]]", title: "[[Sem de Vries]]", name: "Jan" };

  it("import relinks unresolved relationships", async () => {
    useLayout(indexLayout);
    const v = fakeApp();
    v.folder("Contacts");
    const jan = v.note("Contacts/Jan/index.md", { ...relations, uid: "jan-uid" });
    expect(await importRemoteCard(v.app, { uid: "sem-uid", raw: SEM_CARD, etag: "e", href: "/sem-uid.vcf" }, { href: "/sem-uid.vcf" }, source)).toBe("imported");
    expect(v.files().some((f) => f.path === "Contacts/Sem de Vries/index.md")).toBe(true);
    expect(jan.frontmatter?.friends).toEqual(["[[Contacts/Sem de Vries/index|Sem de Vries]]", "[[Piet]]"]);
    // an alias the user wrote stays
    expect(jan.frontmatter?.spouse).toBe("[[Contacts/Sem de Vries/index|Sem]]");
    // only relationship properties
    expect(jan.frontmatter?.title).toBe("[[Sem de Vries]]");
  });

  it("relink leaves other links alone", async () => {
    useLayout(indexLayout);
    const v = fakeApp();
    v.folder("Contacts");
    const other = v.note("Contacts/Sem de Vries (neighbour)/index.md", { name: "Sem de Vries (neighbour)", uid: "other-uid" });
    // resolves to a note: left as it is; names of other contacts: left; the new contact's own note: skipped
    const resolved = v.note("Contacts/Anna/index.md", { uid: "a", friends: ["[[Sem de Vries (neighbour)]]", "[[Piet]]"], spouse: "[[Contacts/Sem de Vries (neighbour)/index|Sem]]" });
    const sem = v.note("Contacts/Sem de Vries/index.md", { uid: "sem-uid", friends: ["[[Sem de Vries]]"] });
    expect(other).toBeDefined();
    expect(await relinkAfterImport(v.app, "sem-uid", sem as never)).toBe(0);
    expect(resolved.frontmatter?.friends).toEqual(["[[Sem de Vries (neighbour)]]", "[[Piet]]"]);
    expect(sem.frontmatter?.friends).toEqual(["[[Sem de Vries]]"]);
    expect(v.processed).toEqual([]);
  });

  it("a name that two different contacts have is not linked", async () => {
    useLayout(indexLayout);
    h.remote = [meta("sem-uid", "Sem de Vries"), meta("sem-2", "Sem de Vries")];
    const v = fakeApp();
    v.folder("Contacts");
    const jan = v.note("Contacts/Jan/index.md", { uid: "jan-uid", friends: ["[[Sem de Vries]]"] });
    const sem = v.note("Contacts/Sem de Vries/index.md", { uid: "sem-uid" });
    expect(await relinkAfterImport(v.app, "sem-uid", sem as never)).toBe(0);
    expect(jan.frontmatter?.friends).toEqual(["[[Sem de Vries]]"]);
  });

  it("no relinking when the note is named for the contact", async () => {
    useLayout(nameLayout);
    const v = fakeApp();
    v.folder("Contacts");
    const jan = v.note("Contacts/Jan/Jan.md", { uid: "jan-uid", friends: ["[[Sem de Vries]]"] });
    expect(await importRemoteCard(v.app, { uid: "sem-uid", raw: SEM_CARD, etag: "e", href: "/sem-uid.vcf" }, { href: "/sem-uid.vcf" }, source)).toBe("imported");
    expect(jan.frontmatter?.friends).toEqual(["[[Sem de Vries]]"]);
    expect(v.processed).toEqual([]);
  });
});

describe("links to a fixed note name are never short", () => {
  it("a single index contact still gets the full path", () => {
    useLayout(indexLayout);
    const v = fakeApp();
    v.folder("Contacts");
    const jan = v.note("Contacts/Jan de Vries/index.md", { name: "Jan de Vries", uid: "jan-uid" });
    const ctx = new ObsidianRelationContext(v.app, "Contacts/Piet.md", [{ file: jan as never, uid: "jan-uid" }], []);
    expect(ctx.uidToName("jan-uid")).toBe("Contacts/Jan de Vries/index|Jan de Vries");
    expect(obsidianMirrorEnv(v.app).linkTo("Contacts/Jan de Vries/index.md", "Contacts/Piet.md")).toBe(
      "[[Contacts/Jan de Vries/index|Jan de Vries]]",
    );
  });

  it("a one-note contact in a fixed-name layout gets its full path too", () => {
    useLayout(indexLayout);
    const v = fakeApp();
    v.folder("Contacts");
    const anna = v.note("Contacts/Anna.md", { name: "Anna", uid: "a" });
    const ctx = new ObsidianRelationContext(v.app, "Contacts/Piet.md", [{ file: anna as never, uid: "a" }], []);
    expect(ctx.uidToName("a")).toBe("Contacts/Anna");
  });

  it("a contact left in a folder with a fixed note name gets the full path in any layout", () => {
    for (const layout of [noteLayout, nameLayout]) {
      useLayout(layout);
      const v = fakeApp();
      v.folder("Contacts");
      const jan = v.note("Contacts/Jan de Vries/index.md", { name: "Jan de Vries", uid: "jan-uid" });
      const ctx = new ObsidianRelationContext(v.app, "Contacts/Piet.md", [{ file: jan as never, uid: "jan-uid" }], []);
      expect(ctx.uidToName("jan-uid")).toBe("Contacts/Jan de Vries/index|Jan de Vries");
      expect(obsidianMirrorEnv(v.app).linkTo("Contacts/Jan de Vries/index.md", "Contacts/Piet.md")).toBe(
        "[[Contacts/Jan de Vries/index|Jan de Vries]]",
      );
    }
  });
});

describe("relinking after a bulk import", () => {
  const pulled = { uid: "sem-uid", raw: SEM_CARD, etag: "e", href: "/sem-uid.vcf" };

  it("Import All relinks once at the end, over every contact it imported", async () => {
    useLayout(indexLayout);
    const v = fakeApp();
    v.folder("Contacts");
    const jan = v.note("Contacts/Jan/index.md", { name: "Jan", uid: "jan-uid", friends: ["[[Sem de Vries]]"] });
    const later: { uid: string; path: string }[] = [];
    expect(await importRemoteCard(v.app, pulled, { href: "/sem-uid.vcf" }, source, { relinkLater: later })).toBe("imported");
    // nothing relinked yet
    expect(jan.frontmatter?.friends).toEqual(["[[Sem de Vries]]"]);
    expect(later).toEqual([{ uid: "sem-uid", path: "Contacts/Sem de Vries/index.md" }]);
    expect(await relinkImported(v.app, later)).toBe(1);
    expect(jan.frontmatter?.friends).toEqual(["[[Contacts/Sem de Vries/index|Sem de Vries]]"]);
  });

  it("nothing is collected when the note is named for the contact", async () => {
    useLayout(nameLayout);
    const v = fakeApp();
    v.folder("Contacts");
    const later: { uid: string; path: string }[] = [];
    expect(await importRemoteCard(v.app, pulled, { href: "/sem-uid.vcf" }, source, { relinkLater: later })).toBe("imported");
    expect(later).toEqual([]);
  });

  it("a note the vault does not show within the wait is skipped with a warning", async () => {
    useLayout(indexLayout);
    const v = fakeApp();
    v.folder("Contacts");
    v.unseen.add("Contacts/Sem de Vries/index.md");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const done = importRemoteCard(v.app, pulled, { href: "/sem-uid.vcf" }, source);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await done).toBe("imported");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Contacts/Sem de Vries/index.md"));
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
  });
});

describe("a link Obsidian cannot resolve finds the contact note by its name", () => {
  const SEM_LINK = "Contacts/Sem de Vries/index|Sem de Vries";

  function vault() {
    useLayout(indexLayout);
    const v = fakeApp();
    v.folder("Contacts");
    const sem = v.note("Contacts/Sem de Vries/index.md", { uid: "sem-uid" });
    const anna = v.note("Contacts/Anna/index.md", { name: "Anna Smit" });
    const contacts = [{ file: sem as never, uid: "sem-uid" as string | undefined }, { file: anna as never, uid: undefined as string | undefined }];
    return { v, contacts };
  }

  it("one contact note with that display name: its UID, in both contexts; no address book listing needed", () => {
    const { v, contacts } = vault();
    for (const readOnly of [true, false]) {
      const ctx = new ObsidianRelationContext(v.app, "Contacts/Jan/index.md", contacts, [], readOnly);
      // `index` does not resolve by name: the folder's name is the display name
      expect(ctx.resolveLink("Sem de Vries")).toEqual({ uid: "sem-uid" });
      // case-insensitive, trimmed
      expect(ctx.resolveLink(" sem DE vries ")).toEqual({ uid: "sem-uid" });
    }
    expect(v.processed).toEqual([]);
  });

  it("a link Obsidian resolves to another note is not taken for the contact with that name", () => {
    const { v, contacts } = vault();
    v.note("Projects/Sem de Vries.md", { status: "open" });
    const listed = [{ uid: "listed-uid", fileName: "Sem de Vries", sourceId: "s1", href: "", etag: "" }];
    for (const readOnly of [true, false]) {
      for (const link of ["Projects/Sem de Vries", "Sem de Vries"]) {
        // as before: the address book listing, else text
        expect(new ObsidianRelationContext(v.app, "Contacts/Jan/index.md", contacts, [], readOnly).resolveLink(link)).toEqual({ text: link });
        const ctx = new ObsidianRelationContext(v.app, "Contacts/Jan/index.md", contacts, listed, readOnly);
        expect(ctx.resolveLink(link)).toEqual(link === "Sem de Vries" ? { uid: "listed-uid" } : { text: link });
      }
    }
    expect(v.processed).toEqual([]);
  });

  it("a contact note without a UID: the address book listing (else text) when read-only, a new UID otherwise", async () => {
    const { v, contacts } = vault();
    h.app = v.app;
    const readOnly = new ObsidianRelationContext(v.app, "Contacts/Jan/index.md", contacts, [], true);
    expect(readOnly.resolveLink("Anna Smit")).toEqual({ text: "Anna Smit" });
    const listed = [{ uid: "anna-remote", fileName: "Anna Smit", sourceId: "s1", href: "", etag: "" }];
    const readOnlyListed = new ObsidianRelationContext(v.app, "Contacts/Jan/index.md", contacts, listed, true);
    expect(readOnlyListed.resolveLink("Anna Smit")).toEqual({ uid: "anna-remote" });
    await readOnlyListed.settle();
    expect(v.processed).toEqual([]);
    expect(contacts[1].uid).toBeUndefined();
    const writing = new ObsidianRelationContext(v.app, "Contacts/Jan/index.md", contacts, []);
    const resolved = writing.resolveLink("anna smit");
    expect(resolved).toEqual({ uid: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    await writing.settle();
    expect(v.processed).toEqual(["Contacts/Anna/index.md"]);
    expect(contacts[1].uid).toBe(`urn:uuid:${(resolved as { uid: string }).uid}`);
  });

  it("several contact notes with that name are ambiguous; none falls back to the address book listing", () => {
    const { v, contacts } = vault();
    const other = v.note("Contacts/Sem 2/index.md", { name: "Sem de Vries", uid: "other-uid" });
    const all = [...contacts, { file: other as never, uid: "other-uid" }];
    const remote = [{ uid: "piet-uid", fileName: "Piet", sourceId: "s1", href: "", etag: "" }];
    const ctx = new ObsidianRelationContext(v.app, "Contacts/Jan/index.md", all, remote, true);
    expect(ctx.resolveLink("Sem de Vries")).toEqual({ ambiguous: true });
    expect(ctx.resolveLink("Piet")).toEqual({ uid: "piet-uid" });
    expect(ctx.resolveLink("Nobody")).toEqual({ text: "Nobody" });
  });

  describe("Sync of a contact whose relationship a phone rewrote without the hint", () => {
    const HREF = "/jan.vcf";
    const card = (relation: string, title = "Baker") =>
      ["BEGIN:VCARD", "VERSION:3.0", "UID:jan-uid", "FN:Jan", "N:;Jan;;;", `TITLE:${title}`, relation, "item1.X-ABLabel:_$!<Child>!$_", "END:VCARD", ""].join("\r\n");
    const HINTED = card("item1.X-ABRELATEDNAMES;X-FRIENDLY-UID=sem-uid:Sem de Vries");
    const DROPPED = card("item1.X-ABRELATEDNAMES:Sem de Vries");

    function syncSetup(server: string) {
      const { v, contacts } = vault();
      const cards = new Map([[HREF, { raw: server, etag: "e1" }]]);
      const pushes: string[] = [];
      const adapter = {
        getMetaByUid: async () => ({ href: HREF, etag: cards.get(HREF)!.etag, lastModified: new Date(), uid: "jan-uid", fn: undefined, n: undefined }),
        pull: async () => ({ uid: "jan-uid", raw: cards.get(HREF)!.raw, etag: cards.get(HREF)!.etag, href: HREF }),
        push: async (vcard: { raw: string }) => {
          pushes.push(vcard.raw);
          cards.set(HREF, { raw: vcard.raw, etag: "e2" });
          return { status: 204, data: "", headers: { etag: '"e2"' }, errorMessage: "" };
        },
      };
      const entries = new Map<string, SyncStateEntry>([["jan-uid", { raw: HINTED, etag: "old", href: HREF, reader: 2 }]]);
      const state = {
        get: async (uid: string) => entries.get(uid),
        set: async (uid: string, entry: SyncStateEntry) => void entries.set(uid, entry),
        remove: async (uid: string) => void entries.delete(uid),
      };
      const frontmatter: Record<string, unknown> = { name: "Jan", firstname: "Jan", uid: "jan-uid", title: "Baker", children: [`[[${SEM_LINK}]]`] };
      const writes: Record<string, unknown>[] = [];
      const io: NoteIO = {
        readFrontmatter: async () => ({ ...frontmatter }),
        writeProps: async (set, remove) => {
          writes.push(set);
          for (const key of remove) delete frontmatter[key];
          Object.assign(frontmatter, set);
        },
        rename: async () => "renamed",
      };
      // Sem is in no address book listing (remote is empty): only his note knows him.
      const deps: SyncDeps = {
        adapter: adapter as never,
        state: state as never,
        rows: DEFAULT_SETTINGS.friendly.mapping,
        ctx: new ObsidianRelationContext(v.app, "Contacts/Jan/index.md", contacts, []),
        readOnlyCtx: new ObsidianRelationContext(v.app, "Contacts/Jan/index.md", contacts, [], true),
        notify: () => {},
      };
      const prepare = () => prepareSync(io, deps, { sourceId: "s1" });
      return { v, io, deps, frontmatter, writes, pushes, prepare };
    }

    it("is up to date: no review, nothing written", async () => {
      const t = syncSetup(DROPPED);
      expect(await t.prepare()).toEqual({ kind: "upToDate" });
      expect(t.writes).toEqual([]);
      expect(t.pushes).toEqual([]);
      expect(t.v.processed).toEqual([]);
    });

    it("with another change from the phone, Apply keeps the link (no dead [[Sem de Vries]]) and the next Sync is up to date", async () => {
      const t = syncSetup(card("item1.X-ABRELATEDNAMES:Sem de Vries", "Master baker"));
      const prepared = await t.prepare();
      if (prepared.kind !== "review") throw new Error(`expected a review, got ${prepared.kind}`);
      expect(prepared.prepared.rows.filter((r) => r.changed).map((r) => r.property)).toEqual(["title"]);
      const R = resultProps(prepared.prepared.rows, new Map(), prepared.prepared.server?.friendly.props ?? {});
      expect(await applySync(prepared.prepared, R, t.io, t.deps, { sourceName: "Work" })).toEqual({ kind: "done", outcome: "pulled" });
      expect(t.frontmatter.children).toEqual([`[[${SEM_LINK}]]`]);
      expect(t.writes.map((w) => Object.keys(w))).toEqual([["title", "source"]]);
      expect(await t.prepare()).toEqual({ kind: "upToDate" });
    });
  });
});
