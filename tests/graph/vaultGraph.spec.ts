import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MAPPING } from "src/contacts/friendly/mapping";

type Fm = Record<string, unknown>;
const vault = vi.hoisted(() => ({ notes: [] as { path: string; uid?: string; fm: Record<string, unknown> }[] }));

vi.mock("src/contacts/obsidianNotes", () => ({
  contactNotes: () => vault.notes.map((n) => ({ file: { path: n.path }, uid: n.uid })),
}));
vi.mock("src/contacts/layoutNotes", () => ({
  contactDisplayName: (_app: unknown, file: { path: string }) => {
    const name = vault.notes.find((n) => n.path === file.path)?.fm.name;
    return typeof name === "string" ? name : file.path.replace(/^.*\//, "").replace(/\.md$/, "");
  },
}));

import { contactNameByUid, graphCentre, graphContacts, meCandidates } from "src/graph/vaultGraph";
import { photoImageSrc } from "src/contacts/friendly/photo";

/** `others` are non-contact notes that links can resolve to. */
function setup(notes: { path: string; uid?: string; fm?: Fm }[], others: string[] = []) {
  vault.notes = notes.map((n) => ({ path: n.path, uid: n.uid, fm: n.fm ?? {} }));
  const byBasename = new Map([...notes.map((n) => n.path), ...others].map((p) => [p.replace(/^.*\//, "").replace(/\.md$/, ""), p]));
  return {
    metadataCache: {
      getFileCache: (f: { path: string }) => ({ frontmatter: vault.notes.find((n) => n.path === f.path)?.fm }),
      getFirstLinkpathDest: (linkpath: string) => {
        const path = byBasename.get(linkpath.replace(/^.*\//, "").replace(/\.md$/, ""));
        return path ? { path } : null;
      },
    },
  } as never;
}

describe("graphContacts", () => {
  it("collects names, photos and resolved links", () => {
    const app = setup(
      [
        { path: "Contacts/Sem.md", fm: { name: "Sem" } },
        { path: "Contacts/Jan.md", fm: { name: "Jan de Vries", photo: "AAAA", children: "[[Sem]]", friends: ["[[Ghost]]", "[[Note]]"] } },
        { path: "Contacts/Piet.md", fm: { photo: "https://x/p.jpg", spouse: [["Jan"]] } },
        { path: "Contacts/Kees.md", fm: { photo: "data:image/png;base64,QQ==" } },
        { path: "Contacts/Lot.md", fm: { photo: "not a photo!" } },
      ],
      ["Other/Note.md"],
    );
    const contacts = graphContacts(app, DEFAULT_MAPPING);
    expect(contacts.map((c) => c.id)).toEqual([
      "Contacts/Jan.md",
      "Contacts/Kees.md",
      "Contacts/Lot.md",
      "Contacts/Piet.md",
      "Contacts/Sem.md",
    ]);
    const by = Object.fromEntries(contacts.map((c) => [c.id, c]));
    expect(by["Contacts/Jan.md"].name).toBe("Jan de Vries");
    expect(by["Contacts/Jan.md"].photo).toBe("data:image/jpeg;base64,AAAA");
    expect(by["Contacts/Jan.md"].snapshot.children).toEqual(["Contacts/Sem.md"]);
    // A link that does not resolve to a contact note stays link text, also when it resolves to another note.
    expect(by["Contacts/Jan.md"].snapshot.friends).toEqual(["Ghost", "Note"]);
    expect(by["Contacts/Piet.md"].name).toBe("Piet");
    expect(by["Contacts/Piet.md"].photo).toBe("https://x/p.jpg");
    // Unquoted [[Jan]] parsed as a nested list is recovered.
    expect(by["Contacts/Piet.md"].snapshot.spouse).toEqual(["Contacts/Jan.md"]);
    expect(by["Contacts/Kees.md"].photo).toBe("data:image/png;base64,QQ==");
    expect(by["Contacts/Lot.md"].photo).toBeUndefined();
    expect("photo" in by["Contacts/Lot.md"]).toBe(false);
    expect(by["Contacts/Sem.md"].snapshot).toEqual({});
  });
});

describe("photoImageSrc", () => {
  it("keeps data URIs and URLs, completes bare base64 and drops anything else", () => {
    expect(photoImageSrc(" https://x/p.jpg ")).toBe("https://x/p.jpg");
    expect(photoImageSrc("data:image/png;base64,QQ==")).toBe("data:image/png;base64,QQ==");
    expect(photoImageSrc("QUJD\nREVG")).toBe("data:image/jpeg;base64,QUJDREVG");
    expect(photoImageSrc("")).toBeUndefined();
    expect(photoImageSrc("hello world!")).toBeUndefined();
  });
});

describe("graphCentre", () => {
  const notes = [
    { path: "Contacts/Me.md", uid: "urn:uuid:abc-1" },
    { path: "Contacts/Jan.md", uid: "u2" },
    { path: "Contacts/NoUid.md" },
  ];

  it("centre is me", () => {
    const app = setup(notes);
    expect(graphCentre(app, "abc-1", "Contacts/Jan.md")).toBe("Contacts/Me.md");
    expect(graphCentre(app, "URN:UUID:abc-1", undefined)).toBe("Contacts/Me.md");
  });

  it("centre falls back when me is missing", () => {
    const app = setup(notes);
    expect(graphCentre(app, "", "Contacts/Jan.md")).toBe("Contacts/Jan.md");
    expect(graphCentre(app, "gone", "Contacts/Jan.md")).toBe("Contacts/Jan.md");
    expect(graphCentre(app, "gone", "Elsewhere/Note.md")).toBeUndefined();
    expect(graphCentre(app, "gone", undefined)).toBeUndefined();
  });
});

describe("meCandidates", () => {
  it("lists contacts with a UID, by name, and finds a name by UID", () => {
    const app = setup([
      { path: "Contacts/b.md", uid: "urn:uuid:u2", fm: { name: "Zed" } },
      { path: "Contacts/a.md", uid: "u1", fm: { name: "Ann" } },
      { path: "Contacts/c.md", fm: { name: "NoUid" } },
    ]);
    expect(meCandidates(app)).toEqual([
      { uid: "u1", name: "Ann", path: "Contacts/a.md" },
      { uid: "u2", name: "Zed", path: "Contacts/b.md" },
    ]);
    expect(contactNameByUid(app, "U2")).toBe("Zed");
    expect(contactNameByUid(app, "gone")).toBeUndefined();
    expect(contactNameByUid(app, "")).toBeUndefined();
  });
});
