import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  Modal: class {
    title = "";
    titleEl = { setText: (text: string) => (this.title = text) };
    contentEl = {};
    close() {}
  },
}));
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: () => {}, unmount: () => {} }) }));

import { FileExistsModal } from "src/ui/modals/fileExistsModal";

function titleOf(modal: FileExistsModal): string {
  modal.onOpen();
  return (modal as unknown as { title: string }).title;
}

describe("FileExistsModal", () => {
  it("says the file exists when it does", () => {
    expect(titleOf(new FileExistsModal({} as never, "Contacts/Jan.md", () => {}))).toBe("File Exists");
  });

  it("a folder that holds another contact is not called an existing file", () => {
    const modal = new FileExistsModal({} as never, "Contacts/Jan/Jan.md", () => {}, 'The folder "Contacts/Jan" already holds a contact');
    expect(titleOf(modal)).toBe("Folder in use");
  });
});
