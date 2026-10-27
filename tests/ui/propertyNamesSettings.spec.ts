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
// No notes hold a property, so a rename only saves the property names.
vi.mock('src/contacts/obsidianNotes', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  renameBlockers: () => [],
  notesToRename: () => [],
}));
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

async function render(mapping: MappingRow[], friendly: Record<string, unknown> = {}) {
  saves = [];
  await initSettings(async () => ({ friendly: { ...friendly, mapping } }), async (data) => void saves.push(data));
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

  it('turns a row with Sync off back on with syncSince, so a stale sync base is read without it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(9999);
    const mapping = DEFAULT_MAPPING.map((r) =>
      r.property === 'friends' ? { ...r, sync: false as const } : r.property === 'email' ? { ...r, syncSince: 1000 } : r,
    );
    await render(mapping);
    await act(async () => {
      button('Reset to defaults').click();
    });
    expect(saves).toHaveLength(1);
    const stored = (property: string) => getSettings().friendly.mapping.find((r) => r.property === property)!;
    expect(stored('friends')).toMatchObject({ syncSince: 9999 });
    expect('sync' in stored('friends')).toBe(false);
    expect(stored('email')).toMatchObject({ syncSince: 1000 });
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

it('the property shown stays shown when a date with a label is added before it', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(4242);
  await render(DEFAULT_MAPPING);
  act(() => {
    [...container.querySelectorAll<HTMLElement>('.vcf-props-item')].find((el) => el.textContent === 'friends')!.click();
  });
  labelled.notesWithBases.mockResolvedValue([]);
  await addDate('Verkering', 'dating');
  expect(container.querySelector('.vcf-props-detail-title')?.textContent).toBe('friends');
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

describe('the property list', () => {
  const item = (property: string) =>
    [...container.querySelectorAll<HTMLElement>('.vcf-props-item')].find(
      (el) => el.querySelector('.vcf-props-item-name')?.textContent === property,
    );
  const select = (property: string) => {
    act(() => {
      item(property)!.click();
    });
  };
  const detail = () => container.querySelector<HTMLElement>('.vcf-props-detail')!;
  /** The control of the detail field called `name`, for the property shown. */
  const control = (property: string, name: string) => {
    select(property);
    const field = [...detail().querySelectorAll('.setting-item')].find((el) => el.querySelector('.setting-item-name')?.textContent === name);
    return field?.querySelector<HTMLElement>('.setting-item-control');
  };
  const input = (property: string, label: string) => {
    select(property);
    return detail().querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  };
  const fieldNames = (property: string) => {
    select(property);
    return [...detail().querySelectorAll('.setting-item-name')].map((el) => el.textContent);
  };
  const commitText = async (element: HTMLInputElement, text: string) => {
    type(element, text);
    await act(async () => {
      element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
  };
  const stored = (property: string) => getSettings().friendly.mapping.find((r) => r.property === property);

  it('lists the properties in groups, in the order of the groups', async () => {
    await render(DEFAULT_MAPPING);
    expect([...container.querySelectorAll('.vcf-props-group')].map((el) => el.textContent)).toEqual([
      'Name', 'Phone, email and web', 'Work', 'Address', 'Dates', 'Relationships', 'Other',
    ]);
    const names = [...container.querySelectorAll('.vcf-props-item-name')].map((el) => el.textContent);
    expect(names.slice(0, 3)).toEqual(['name', 'name-prefix', 'firstname']);
    expect(names).toHaveLength(DEFAULT_MAPPING.length);
  });

  it('shows the first property until another is picked', async () => {
    await render(DEFAULT_MAPPING);
    expect(detail().querySelector('.vcf-props-detail-title')?.textContent).toBe('name');
    select('email');
    expect(detail().querySelector('.vcf-props-detail-title')?.textContent).toBe('email');
    expect(item('email')!.classList.contains('is-selected')).toBe(true);
    expect(item('name')!.classList.contains('is-selected')).toBe(false);
  });

  it('a part shows exactly these fields', async () => {
    await render(DEFAULT_MAPPING);
    expect(fieldNames('department')).toEqual(['Name in note', 'Read from', 'Part', 'Write as (vCard 4.0)', 'Write as (vCard 3.0)', 'Sync']);
  });

  it('renaming in the details renames the property', async () => {
    await render(DEFAULT_MAPPING);
    await commitText(input('nickname', 'Property name'), 'alias');
    expect(stored('alias')).toMatchObject({ write: 'NICKNAME' });
    expect(item('alias')).toBeDefined();
    expect(detail().querySelector('.vcf-props-detail-title')?.textContent).toBe('alias');
  });

  describe('Sync', () => {
    const box = (property: string) => container.querySelector<HTMLElement>(`[aria-label="Sync ${property}"]`)!;
    const on = (element: HTMLElement) => element.getAttribute('aria-checked') === 'true';
    const disabled = (element: HTMLElement) => element.getAttribute('aria-disabled') === 'true';
    const click = async (element: HTMLElement) => {
      await act(async () => {
        element.click();
      });
    };

    it('has a switch per property in the list, on unless Sync is off', async () => {
      await render(DEFAULT_MAPPING.map((r) => (r.property === 'friends' ? { ...r, sync: false as const } : r)));
      expect(box('friends').getAttribute('role')).toBe('switch');
      expect(on(box('friends'))).toBe(false);
      expect(on(box('email'))).toBe(true);
      expect(disabled(box('friends'))).toBe(false);
      expect(item('friends')!.classList.contains('is-off')).toBe(true);
    });

    it.each(['uid', 'name', 'photo'])('shows %s on and disabled', async (property) => {
      await render(DEFAULT_MAPPING);
      expect(on(box(property))).toBe(true);
      expect(disabled(box(property))).toBe(true);
      await click(box(property));
      expect(saves).toEqual([]);
    });

    it('switching off saves sync: false at once, without a confirmation, and nothing else changes', async () => {
      await render(DEFAULT_MAPPING);
      await click(box('friends'));
      expect(saves).toHaveLength(1);
      expect(stored('friends')).toMatchObject({ sync: false });
      expect(getSettings().friendly.mapping.filter((r) => r.property !== 'friends')).toEqual(
        DEFAULT_MAPPING.filter((r) => r.property !== 'friends'),
      );
      expect(getSettings().friendly.mapping.some((r) => r.skip)).toBe(false);
      expect(on(box('friends'))).toBe(false);
    });

    it('the switch in the list does not change which property is shown', async () => {
      await render(DEFAULT_MAPPING);
      select('email');
      await click(box('friends'));
      expect(detail().querySelector('.vcf-props-detail-title')?.textContent).toBe('email');
    });

    it('switching on again saves syncSince with the time and removes sync', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(7777);
      await render(DEFAULT_MAPPING);
      await click(box('friends'));
      await click(box('friends'));
      expect(saves).toHaveLength(2);
      expect(stored('friends')).toMatchObject({ syncSince: 7777 });
      expect('sync' in stored('friends')!).toBe(false);
      expect(on(box('friends'))).toBe(true);
    });

    it('the switch in the details does the same', async () => {
      await render(DEFAULT_MAPPING);
      select('friends');
      await click(detail().querySelector<HTMLElement>('[aria-label="Sync"]')!);
      expect(stored('friends')).toMatchObject({ sync: false });
      expect(on(box('friends'))).toBe(false);
    });

    it('stored rows never carry skip, also after a later edit', async () => {
      await render(DEFAULT_MAPPING.map((r) => (r.property === 'friends' ? { ...r, sync: false as const } : r)));
      await commitText(input('department', 'Part for department'), '3');
      expect(getSettings().friendly.mapping.some((r) => r.skip)).toBe(false);
      expect(stored('friends')).toMatchObject({ sync: false });
    });

    it('the details say what Sync off does', async () => {
      await render(DEFAULT_MAPPING);
      select('friends');
      expect(detail().textContent).toContain(
        'Sync off: the property stays in your notes, but Sync and Import no longer read it from cards or write it to them. Lines already on a card stay there; remove them yourself if you want them gone.',
      );
    });

    it('a labelled date is not in the list', async () => {
      await render(insertLabelledDateRow(DEFAULT_MAPPING, labelledDateRow('Verkering', 'dating', 1000)));
      expect(item('dating')).toBeUndefined();
      expect(container.querySelector('[aria-label="Sync dating"]')).toBeNull();
    });
  });

  it('shows the part of a component row as a number from 1', async () => {
    await render(DEFAULT_MAPPING);
    expect(input('department', 'Part for department').value).toBe('2');
    expect(input('company', 'Part for company').value).toBe('1');
  });

  it('a field row has no Part', async () => {
    await render(DEFAULT_MAPPING);
    expect(fieldNames('nickname')).not.toContain('Part');
  });

  it('committing a part saves the 0-based index', async () => {
    await render(DEFAULT_MAPPING);
    await commitText(input('department', 'Part for department'), ' 3 ');
    expect(container.querySelector('.vcf-mapping-errors')).toBeNull();
    expect(stored('department')).toMatchObject({ index: 2 });
  });

  it.each(['0', 'abc', '1.5', ''])('committing part %j shows the invalid part error and saves nothing', async (text) => {
    await render(DEFAULT_MAPPING);
    await commitText(input('department', 'Part for department'), text);
    expect(container.querySelector('.vcf-mapping-errors')?.textContent).toContain('Property "department" has an invalid part.');
    expect(saves).toEqual([]);
    expect(stored('department')).toMatchObject({ index: 1 });
  });

  it('after an invalid part the input shows what was typed', async () => {
    await render(DEFAULT_MAPPING);
    await commitText(input('department', 'Part for department'), 'abc');
    expect(container.querySelector('.vcf-mapping-errors')?.textContent).toContain('Property "department" has an invalid part.');
    expect(input('department', 'Part for department').value).toBe('abc');
  });

  it('a save keeps the record of the default rows added', async () => {
    await render(DEFAULT_MAPPING, { defaultRowsSeen: 1 });
    await commitText(input('department', 'Part for department'), '3');
    expect(saves).toHaveLength(1);
    expect(getSettings().friendly).toMatchObject({ defaultRowsSeen: 1 });
  });

  it('commits and removes a vCard 3.0 write key', async () => {
    await render(DEFAULT_MAPPING);
    const key = () => input('title', 'vCard 3.0 write key for title');
    expect(key().placeholder).toBe('same as 4.0');
    expect(key().value).toBe('');
    await commitText(key(), ' X-TITLE ');
    expect(stored('title')).toMatchObject({ writeV3: 'X-TITLE' });
    await commitText(key(), '');
    expect(stored('title')).not.toHaveProperty('writeV3');
  });

  it('the parts of one field share their vCard 3.0 write key', async () => {
    await render(DEFAULT_MAPPING);
    await commitText(input('department', 'vCard 3.0 write key for department'), 'X-ORG');
    expect(container.querySelector('.vcf-mapping-errors')?.textContent).toContain(
      'Properties "company" and "department" both write ORG; give them the same vCard 3.0 write key.',
    );
    expect(saves).toEqual([]);
    await commitText(input('company', 'vCard 3.0 write key for company'), 'X-ORG');
    expect(container.querySelector('.vcf-mapping-errors')).toBeNull();
    expect(stored('company')).toMatchObject({ writeV3: 'X-ORG' });
    expect(stored('department')).toMatchObject({ writeV3: 'X-ORG' });
  });

  it('a fixed row shows its name and vCard 3.0 key as text', async () => {
    await render(DEFAULT_MAPPING);
    expect(control('uid', 'Name in note')!.querySelector('input')).toBeNull();
    expect(control('uid', 'Write as (vCard 3.0)')!.querySelector('input')).toBeNull();
    expect(control('uid', 'Write as (vCard 3.0)')!.textContent).toBe('same as 4.0');
  });

  it('a fixed row with a vCard 3.0 write key shows it as text', async () => {
    await render(DEFAULT_MAPPING.map((r) => (r.property === 'name' ? { ...r, writeV3: 'X-FN' } : r)) as MappingRow[]);
    expect(control('name', 'Write as (vCard 3.0)')!.querySelector('input')).toBeNull();
    expect(control('name', 'Write as (vCard 3.0)')!.textContent).toBe('X-FN');
  });

  it('a field row has a vCard 3.0 input too', async () => {
    await render(DEFAULT_MAPPING);
    await commitText(input('nickname', 'vCard 3.0 write key for nickname'), 'X-NICK');
    expect(stored('nickname')).toMatchObject({ writeV3: 'X-NICK' });
  });

  it('shows the vCard 3.0 key a row has', async () => {
    await render(DEFAULT_MAPPING);
    expect(input('gender', 'vCard 3.0 write key for gender').value).toBe('X-GENDER');
  });

  it('shows what a relation row reads and writes, as text', async () => {
    await render(DEFAULT_MAPPING);
    expect(fieldNames('spouse')).toEqual(['Name in note', 'Read from', 'Mirrored by', 'Write as (vCard 4.0)', 'Write as (vCard 3.0)', 'Sync']);
    expect(control('spouse', 'Read from')!.textContent).toBe('spouse');
    expect(control('spouse', 'Mirrored by')!.textContent).toBe('spouse');
    expect(control('spouse', 'Write as (vCard 4.0)')!.textContent).toBe('RELATED;TYPE=spouse');
    expect(control('spouse', 'Write as (vCard 4.0)')!.querySelector('input')).toBeNull();
    expect(control('spouse', 'Write as (vCard 3.0)')!.textContent).toBe('X-ABRELATEDNAMES · label Spouse');
    expect(control('emergency', 'Mirrored by')!.textContent).toBe('none');
  });

  it('a relation row without a label writes the same as 4.0', async () => {
    const mapping = DEFAULT_MAPPING.map((r) => (r.kind === 'relation' && r.property === 'spouse' ? { ...r, labels: [' '] } : r));
    await render(mapping);
    expect(control('spouse', 'Write as (vCard 3.0)')!.textContent).toBe('same as 4.0');
  });

  it('the anniversary row shows its vCard 3.0 date as text', async () => {
    await render(DEFAULT_MAPPING);
    expect(input('anniversary', 'Write key for anniversary').value).toBe('ANNIVERSARY');
    expect(control('anniversary', 'Write as (vCard 3.0)')!.textContent).toBe('X-ABDATE · label Anniversary');
    expect(control('anniversary', 'Write as (vCard 3.0)')!.querySelector('input')).toBeNull();
  });

  describe('in a narrow pane', () => {
    let width = 400;
    beforeEach(() => {
      width = 400;
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
    });
    afterEach(() => {
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    });

    it('shows the details right under the chosen property', async () => {
      await render(DEFAULT_MAPPING);
      select('email');
      const shown = detail();
      expect(container.querySelectorAll('.vcf-props-detail')).toHaveLength(1);
      expect(shown.previousElementSibling).toBe(item('email'));
      expect(container.querySelector('.vcf-props-layout')!.classList.contains('is-narrow')).toBe(true);
    });

    it('beside the list when there is room', async () => {
      width = 700;
      await render(DEFAULT_MAPPING);
      expect(detail().parentElement).toBe(container.querySelector('.vcf-props-layout'));
    });
  });
});
