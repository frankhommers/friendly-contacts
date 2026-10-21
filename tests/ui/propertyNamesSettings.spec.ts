// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertLabelledDateRow, labelledDateRow } from 'src/contacts/friendly/dateLabels';
import { DEFAULT_MAPPING, MappingRow, renameRow } from 'src/contacts/friendly/mapping';
import { getSettings, initSettings } from 'src/context/sharedSettingsContext';
import { PropertyNamesSettings } from 'src/ui/settings/components/propertyNamesSettings';

const notices: string[] = [];
const labelled = vi.hoisted(() => ({
  notesWithBases: vi.fn(),
  fillNotes: vi.fn(),
  notesWithRowProperties: vi.fn(),
  removeRowProperties: vi.fn(),
  findDateLabels: vi.fn(),
}));

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Notice: class {
    constructor(message: string) {
      notices.push(message);
    }
  },
}));
vi.mock('src/contacts/labelledDates', () => labelled);
vi.mock('src/settings/deviceSettings', () => ({ mirrorRelationsOnThisDevice: () => false, setMirrorRelationsOnThisDevice: () => {} }));
// The confirmation is answered with its confirm button right away.
vi.mock('src/ui/modals/confirmModal', () => ({
  ConfirmModal: class {
    constructor(_app: unknown, _title: string, _label: string, private onConfirm: () => void) {}
    open() {
      this.onConfirm();
    }
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const app = { vault: { getName: () => 'vault' } } as never;
const DATED = ['BEGIN:VCARD', 'VERSION:3.0', 'UID:a', 'FN:Dora', 'item1.X-ABDATE:2012-05-01', 'item1.X-ABLabel:Verkering', 'END:VCARD'].join('\r\n');

let container: HTMLDivElement;
let root: Root;
let saves: unknown[];

async function render(mapping: MappingRow[]) {
  saves = [];
  await initSettings(async () => ({ friendly: { mapping } }), async (data) => void saves.push(data));
  saves = [];
  act(() => root.render(React.createElement(PropertyNamesSettings, { app })));
}

const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;

function type(element: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(element, text);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function addDate(label: string, property: string) {
  type(container.querySelector<HTMLInputElement>('input[aria-label="Label"]')!, label);
  type(container.querySelector<HTMLInputElement>('input[aria-label="Property"]')!, property);
  await act(async () => {
    button('Add').click();
  });
}

beforeEach(() => {
  notices.length = 0;
  Object.values(labelled).forEach((fn) => fn.mockReset());
  vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('Reset to defaults', () => {
  it('saves nothing and shows the errors when a date with a label holds a default name', async () => {
    // birthday was renamed and a date with a label took the name: the defaults bring birthday back.
    const mapping = insertLabelledDateRow(renameRow(DEFAULT_MAPPING, 'birthday', 'born'), labelledDateRow('Verkering', 'birthday'));
    await render(mapping);
    await act(async () => {
      button('Reset to defaults').click();
    });
    expect(container.querySelector('.vcf-mapping-errors')?.textContent).toContain('Duplicate property name: birthday');
    expect(saves).toEqual([]);
    expect(getSettings().friendly.mapping).toEqual(mapping);
  });

  it('saves the defaults with the dates with a label when they fit', async () => {
    // A changed read pattern goes back without renaming anything in the notes.
    const dating = labelledDateRow('Verkering', 'dating', 1000);
    const edited = DEFAULT_MAPPING.map((r) => (r.property === 'email' && r.kind === 'field' ? { ...r, read: ['EMAIL[*]'] } : r));
    await render(insertLabelledDateRow(edited, dating));
    await act(async () => {
      button('Reset to defaults').click();
    });
    expect(container.querySelector('.vcf-mapping-errors')).toBeNull();
    expect(saves).toHaveLength(1);
    expect(getSettings().friendly.mapping).toEqual(insertLabelledDateRow(DEFAULT_MAPPING, dating));
  });
});

describe('adding a date with a label', () => {
  it('saves the row with the time it was added', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(4242);
    await render(DEFAULT_MAPPING);
    labelled.notesWithBases.mockResolvedValue([]);
    await addDate('Verkering', 'dating');
    expect(getSettings().friendly.mapping).toEqual(insertLabelledDateRow(DEFAULT_MAPPING, labelledDateRow('Verkering', 'dating', 4242)));
  });

  it('a failure reading the notes is a notice', async () => {
    await render(DEFAULT_MAPPING);
    labelled.notesWithBases.mockRejectedValue(new Error('vault gone'));
    await addDate('Verkering', 'dating');
    expect(notices).toEqual(['Could not add dating: vault gone']);
    expect(console.error).toHaveBeenCalledWith('Friendly Contacts: could not add dating', expect.any(Error));
    expect(saves).toEqual([]);
  });

  it('a failure filling the notes after the confirmation is a notice', async () => {
    await render(DEFAULT_MAPPING);
    labelled.notesWithBases.mockResolvedValue([{ path: 'a.md', frontmatter: {}, base: { raw: DATED, reader: 2 } }]);
    labelled.fillNotes.mockRejectedValue(new Error('disk full'));
    await addDate('Verkering', 'dating');
    expect(notices).toEqual(['Could not add dating: disk full']);
    expect(saves).toEqual([]);
  });
});

describe('removing a date with a label', () => {
  const mapping = insertLabelledDateRow(DEFAULT_MAPPING, labelledDateRow('Verkering', 'dating'));

  it('a failure finding the notes is a notice', async () => {
    await render(mapping);
    labelled.notesWithRowProperties.mockImplementation(() => {
      throw new Error('cache gone');
    });
    await act(async () => {
      button('Remove').click();
    });
    expect(notices).toEqual(['Could not remove dating: cache gone']);
    expect(console.error).toHaveBeenCalledWith('Friendly Contacts: could not remove dating', expect.any(Error));
  });

  it('a failure removing the properties after the confirmation is a notice', async () => {
    await render(mapping);
    labelled.notesWithRowProperties.mockReturnValue([{}]);
    labelled.removeRowProperties.mockRejectedValue(new Error('disk full'));
    await act(async () => {
      button('Remove').click();
    });
    expect(notices).toEqual(['Could not remove dating: disk full']);
  });
});
