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
  touchBases: vi.fn(),
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
  labelled.touchBases.mockResolvedValue({ touched: 0, failed: [] });
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

  describe('the sync bases the add considered', () => {
    const withBase = { path: 'a.md', frontmatter: {}, base: { raw: DATED, reader: 2 }, baseOf: { source: 'radicale', uid: 'a' } };

    it('are touched with the time the row was saved, after the notes were filled', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(4242);
      await render(DEFAULT_MAPPING);
      labelled.notesWithBases.mockResolvedValue([withBase]);
      labelled.fillNotes.mockResolvedValue({ filled: 1, failed: [] });
      await addDate('Verkering', 'dating');
      expect(labelled.touchBases).toHaveBeenCalledTimes(1);
      expect(labelled.touchBases).toHaveBeenCalledWith(app, [withBase], 4242);
      expect(labelled.touchBases.mock.invocationCallOrder[0]).toBeGreaterThan(labelled.fillNotes.mock.invocationCallOrder[0]);
      expect(notices).toEqual(['Added dating to 1 contact notes.']);
    });

    it('are touched when there was nothing to fill, too', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(4242);
      await render(DEFAULT_MAPPING);
      labelled.notesWithBases.mockResolvedValue([{ ...withBase, base: { raw: 'BEGIN:VCARD\r\nEND:VCARD', reader: 2 } }]);
      await addDate('Verkering', 'dating');
      expect(labelled.fillNotes).not.toHaveBeenCalled();
      expect(labelled.touchBases).toHaveBeenCalledWith(app, expect.any(Array), 4242);
      expect(getSettings().friendly.mapping).toContainEqual(expect.objectContaining({ property: 'dating', since: 4242 }));
    });

    it('are not touched when the notes could not be filled (the row is not saved)', async () => {
      await render(DEFAULT_MAPPING);
      labelled.notesWithBases.mockResolvedValue([withBase]);
      labelled.fillNotes.mockResolvedValue({ filled: 0, failed: ['a.md'] });
      await addDate('Verkering', 'dating');
      expect(labelled.touchBases).not.toHaveBeenCalled();
      expect(saves).toEqual([]);
    });

    it('a base that could not be updated is a notice, and the add stays', async () => {
      await render(DEFAULT_MAPPING);
      labelled.notesWithBases.mockResolvedValue([withBase]);
      labelled.fillNotes.mockResolvedValue({ filled: 1, failed: [] });
      labelled.touchBases.mockResolvedValue({ touched: 0, failed: ['a.md'] });
      await addDate('Verkering', 'dating');
      expect(notices).toContain('Some sync bases could not be updated; see console.');
      expect(notices).not.toContainEqual(expect.stringContaining('Could not add'));
      expect(getSettings().friendly.mapping).toContainEqual(expect.objectContaining({ property: 'dating' }));
    });

    it('touchBases rejecting is the same notice, and the add stays', async () => {
      await render(DEFAULT_MAPPING);
      labelled.notesWithBases.mockResolvedValue([withBase]);
      labelled.fillNotes.mockResolvedValue({ filled: 1, failed: [] });
      labelled.touchBases.mockRejectedValue(new Error('disk full'));
      await addDate('Verkering', 'dating');
      expect(notices).toContain('Some sync bases could not be updated; see console.');
      expect(notices).not.toContainEqual(expect.stringContaining('Could not add'));
      expect(console.error).toHaveBeenCalled();
      expect(getSettings().friendly.mapping).toContainEqual(expect.objectContaining({ property: 'dating' }));
    });
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

describe('the table', () => {
  // The first table is the property names table; the date labels table follows it.
  const propertyTable = () => container.querySelector('.vcf-mapping-table')!;
  const rowOf = (property: string) =>
    [...propertyTable().querySelectorAll('tbody tr')].find((tr) => {
      const name = tr.querySelector('td');
      return name?.textContent === property || name?.querySelector<HTMLInputElement>('input')?.value === property;
    }) as HTMLTableRowElement;
  const cell = (property: string, column: number) => rowOf(property).querySelectorAll('td')[column];
  const input = (property: string, label: string) =>
    rowOf(property).querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  const commitText = (element: HTMLInputElement, text: string) => {
    type(element, text);
    act(() => {
      element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
  };
  const stored = (property: string) => getSettings().friendly.mapping.find((r) => r.property === property);

  it('has exactly these headers', async () => {
    await render(DEFAULT_MAPPING);
    expect([...propertyTable().querySelectorAll('th')].map((th) => th.textContent)).toEqual([
      'Name', 'Read from', 'Part', 'Write as (vCard 4.0)', 'Write as (vCard 3.0)',
    ]);
  });

  it('shows the part of a component row as a number from 1', async () => {
    await render(DEFAULT_MAPPING);
    expect(input('department', 'Part for department').value).toBe('2');
    expect(input('company', 'Part for company').value).toBe('1');
  });

  it('a field row has no Part input', async () => {
    await render(DEFAULT_MAPPING);
    expect(cell('nickname', 2).querySelector('input')).toBeNull();
    expect(cell('nickname', 2).textContent).toBe('');
  });

  it('committing a part saves the 0-based index', async () => {
    await render(DEFAULT_MAPPING);
    await act(async () => commitText(input('department', 'Part for department'), ' 3 '));
    expect(container.querySelector('.vcf-mapping-errors')).toBeNull();
    expect(stored('department')).toMatchObject({ index: 2 });
  });

  it.each(['0', 'abc', '1.5', ''])('committing part %j shows the invalid part error and saves nothing', async (text) => {
    await render(DEFAULT_MAPPING);
    await act(async () => commitText(input('department', 'Part for department'), text));
    expect(container.querySelector('.vcf-mapping-errors')?.textContent).toContain('Property "department" has an invalid part.');
    expect(saves).toEqual([]);
    expect(stored('department')).toMatchObject({ index: 1 });
  });

  it('commits and removes a vCard 3.0 write key', async () => {
    await render(DEFAULT_MAPPING);
    const key = () => input('company', 'vCard 3.0 write key for company');
    expect(key().placeholder).toBe('same as 4.0');
    expect(key().value).toBe('');
    await act(async () => commitText(key(), ' X-ORG '));
    expect(stored('company')).toMatchObject({ writeV3: 'X-ORG' });
    await act(async () => commitText(key(), ''));
    expect(stored('company')).not.toHaveProperty('writeV3');
  });

  it('a field row has a vCard 3.0 input too', async () => {
    await render(DEFAULT_MAPPING);
    await act(async () => commitText(input('nickname', 'vCard 3.0 write key for nickname'), 'X-NICK'));
    expect(stored('nickname')).toMatchObject({ writeV3: 'X-NICK' });
  });

  it('shows the vCard 3.0 key a row has', async () => {
    await render(DEFAULT_MAPPING);
    expect(input('gender', 'vCard 3.0 write key for gender').value).toBe('X-GENDER');
  });

  it('shows what a relation row writes, as text', async () => {
    await render(DEFAULT_MAPPING);
    expect(cell('spouse', 2).textContent).toBe('');
    expect(cell('spouse', 3).textContent).toBe('RELATED;TYPE=spouse');
    expect(cell('spouse', 3).querySelector('input')).toBeNull();
    expect(cell('spouse', 4).textContent).toBe('X-ABRELATEDNAMES · label Spouse');
    expect(cell('spouse', 4).querySelector('input')).toBeNull();
  });

  it('a relation row without a label writes the same as 4.0', async () => {
    const mapping = DEFAULT_MAPPING.map((r) => (r.kind === 'relation' && r.property === 'spouse' ? { ...r, labels: [' '] } : r));
    await render(mapping);
    expect(cell('spouse', 4).textContent).toBe('same as 4.0');
  });

  it('the anniversary row shows its vCard 3.0 date as text', async () => {
    await render(DEFAULT_MAPPING);
    expect(cell('anniversary', 3).querySelector('input')?.value).toBe('ANNIVERSARY');
    expect(cell('anniversary', 4).textContent).toBe('X-ABDATE · label Anniversary');
    expect(cell('anniversary', 4).querySelector('input')).toBeNull();
  });
});
