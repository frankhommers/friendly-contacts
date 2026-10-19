// @vitest-environment jsdom
import { JSDOM } from 'jsdom';
import { fragmentFor } from 'src/ui/dom';
import { describe, expect, it } from 'vitest';

describe('fragmentFor', () => {
  it('makes the fragment in the document of the element it goes into', () => {
    // A second window, like an Obsidian pop-out: its DocumentFragment is another class.
    const other = new JSDOM('<!doctype html><div id="c"></div>').window;
    const container = other.document.getElementById('c')!;
    const fragment = fragmentFor(container);
    expect(fragment instanceof other.DocumentFragment).toBe(true);
    expect(fragment instanceof DocumentFragment).toBe(false);
  });

  it('falls back to the global document', () => {
    expect(fragmentFor(undefined) instanceof DocumentFragment).toBe(true);
  });
});
