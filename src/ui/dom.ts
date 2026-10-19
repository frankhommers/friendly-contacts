/**
 * Obsidian only treats a DocumentFragment as markup when it belongs to the window of the element it lands in
 * (`instanceof` per window). A fragment made with the plugin's global `document` shows as "[object DocumentFragment]"
 * when the settings or a notice live in another window, so build it in the target's own document.
 */
export function fragmentFor(target: Node | null | undefined): DocumentFragment {
  return (target?.ownerDocument ?? document).createDocumentFragment();
}

/** A fragment for a Notice: notices appear in the window that has focus. */
export function noticeFragment(): DocumentFragment {
  const active = (globalThis as { activeDocument?: Document }).activeDocument;
  return (active ?? document).createDocumentFragment();
}
