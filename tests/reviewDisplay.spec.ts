import {
  applyHint,
  cellValue,
  displayValue,
  isMultiline,
  linkDisplayName,
  pickSides,
  shownRows,
  sideLabel,
  willRemove,
} from 'src/sync/reviewDisplay';
import type { ReviewRow } from 'src/sync/review';
import { describe, expect, it } from 'vitest';

const row = (over: Partial<ReviewRow>): ReviewRow => ({
  property: 'mobile',
  server: undefined,
  local: undefined,
  preselect: undefined,
  kind: 'text',
  changed: true,
  ...over,
});
const name = (link: string) => link.replace(/^\[\[|\]\]$/g, '').split('|').pop() as string;

describe('displayValue', () => {
  it('text is shown as is', () => {
    expect(displayValue(row({ server: '06-111' }), 'server', name)).toEqual({ text: '06-111' });
  });

  it('photo shows as image', () => {
    const uri = 'data:image/png;base64,AAAA';
    expect(displayValue(row({ kind: 'photo', property: 'photo', local: uri }), 'local', name)).toEqual({ image: uri });
    const url = 'https://example.com/a.jpg';
    expect(displayValue(row({ kind: 'photo', property: 'photo', server: url }), 'server', name)).toEqual({ image: url });
  });

  it('bare base64 photo becomes a data uri', () => {
    const r = row({ kind: 'photo', property: 'photo', server: '/9j/4AAQSkZJRg==' });
    expect(displayValue(r, 'server', name)).toEqual({ image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' });
  });

  it('relation items show names and one-side markers', () => {
    const r = row({
      kind: 'relation',
      property: 'children',
      server: ['[[Sem]]', '[[Folder/Fleur|Fleur K]]'],
      local: ['[[Sem|Sem]]', '[[Mila]]'],
    });
    expect(displayValue(r, 'server', name).items).toEqual([
      { name: 'Sem', only: false },
      { name: 'Fleur K', only: true },
    ]);
    expect(displayValue(r, 'local', name).items).toEqual([
      { name: 'Sem', only: false },
      { name: 'Mila', only: true },
    ]);
  });

  it('list items are marked when only on this side', () => {
    const r = row({ kind: 'list', property: 'email', server: ['a@x', 'b@x'], local: ['a@x'] });
    expect(displayValue(r, 'server', name).items).toEqual([
      { name: 'a@x', only: false },
      { name: 'b@x', only: true },
    ]);
  });

  it('absent shows (none)', () => {
    expect(displayValue(row({}), 'server', name)).toEqual({ text: '(none)' });
    expect(displayValue(row({ kind: 'list', local: [] }), 'local', name)).toEqual({ text: '(none)' });
    expect(displayValue(row({ kind: 'photo', server: ' ' }), 'server', name)).toEqual({ text: '(none)' });
  });
});

describe('linkDisplayName', () => {
  it('prefers the alias, else the last part of the target', () => {
    expect(linkDisplayName('[[Folder/Fleur|Fleur K]]')).toBe('Fleur K');
    expect(linkDisplayName('[[Folder/Fleur]]')).toBe('Fleur');
    expect(linkDisplayName('[Fleur K](Folder/Fleur.md)')).toBe('Fleur K');
    expect(linkDisplayName('Fleur')).toBe('Fleur');
  });
});

describe('labels', () => {
  it('the server side is labelled with the address book name, the note side Obsidian', () => {
    expect(sideLabel('server', 'Family')).toBe('Family');
    expect(sideLabel('local', 'Family')).toBe('Obsidian');
  });

  it('a new card offers only Obsidian: picking the empty server side would wipe the note', () => {
    expect(pickSides(false)).toEqual(['server', 'local']);
    expect(pickSides(true)).toEqual(['local']);
  });

  it('a new card\'s server column says the card is not in the book yet', () => {
    const r = row({ local: '06-1', preselect: 'local' });
    expect(cellValue(r, 'server', name, { newCardIn: 'Family' })).toEqual({ text: 'Not in Family yet', muted: true });
    expect(cellValue(r, 'local', name, { newCardIn: 'Family' })).toEqual({ text: '06-1' });
    expect(cellValue(row({ server: '06-2' }), 'server', name)).toEqual({ text: '06-2' });
  });
});

describe('shownRows', () => {
  const rows = [
    row({ property: 'uid', server: 'u', local: 'u', preselect: 'server', changed: false }),
    row({ property: 'email', server: 'a', local: 'a', preselect: 'server', changed: false }),
    row({ property: 'mobile', server: '1', local: '2' }),
  ];

  it('lists the changed rows, and with Show all the unchanged ones too, but never uid', () => {
    expect(shownRows(rows, false).visible.map((r) => r.property)).toEqual(['mobile']);
    expect(shownRows(rows, true).visible.map((r) => r.property)).toEqual(['email', 'mobile']);
    expect(shownRows(rows, false).hidden).toBe(1);
  });
});

describe('the Edit result field', () => {
  it('is multi-line when a side or the custom text has a newline', () => {
    expect(isMultiline(row({ server: 'a\nb', local: 'c' }), undefined)).toBe(true);
    expect(isMultiline(row({ server: 'a', local: 'c' }), { custom: 'x\ny' })).toBe(true);
    expect(isMultiline(row({ server: 'a', local: 'c' }), 'server')).toBe(false);
  });

  it('says an empty custom value removes the property, but not on an undecided conflict', () => {
    const preselected = row({ server: '1', local: '2', preselect: 'server' });
    expect(willRemove(preselected, { custom: ' ' })).toBe(true);
    expect(willRemove(preselected, { custom: 'x' })).toBe(false);
    expect(willRemove(preselected, 'server')).toBe(false);
    expect(willRemove(row({ server: '1', local: '2' }), { custom: '' })).toBe(false);
  });
});

describe('applyHint', () => {
  it('says how many conflicts are left', () => {
    expect(applyHint(0)).toBeUndefined();
    expect(applyHint(1)).toBe('Decide 1 conflict');
    expect(applyHint(3)).toBe('Decide 3 conflicts');
  });
});
