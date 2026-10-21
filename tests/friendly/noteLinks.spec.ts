import { parseCard } from 'src/contacts/friendly/lines';
import { DEFAULT_MAPPING } from 'src/contacts/friendly/mapping';
import {
  cardNoteLinks,
  DEFAULT_NOTE_LINKS,
  isOwnNoteLink,
  normalizeNoteLinks,
  noteLinksDiffer,
  noteLinkOptions,
  noteLinkUrl,
  parseNoteLink,
  setLinkVault,
  turnNoteLinks,
  wantedNoteLinks,
} from 'src/contacts/friendly/noteLinks';
import { RelationContext } from 'src/contacts/friendly/relations';
import { describe, expect, it } from 'vitest';

const ger = { path: 'Contacts/Ger Verhallen.md', name: 'Ger Verhallen' };
const sem = { path: 'Contacts/Sem/index.md', name: 'Sem de Vries' };
const notes: Record<string, { path: string; name: string }> = {
  'Ger Verhallen': ger,
  'Contacts/Ger Verhallen': ger,
  Sem: sem,
};
const base: RelationContext = {
  uidToName: () => undefined,
  displayName: () => undefined,
  resolveLink: (name) => ({ text: name }),
};
const ctx: RelationContext = { ...base, contactNote: (target) => notes[target] };

const url = noteLinkUrl('Notes', ger.path);
const urlSem = noteLinkUrl('Notes', sem.path);
const card = (...lines: string[]) => parseCard(lines.join('\r\n'));

describe('noteLinkUrl and parseNoteLink', () => {
  it('builds the URL without .md, escaped', () => {
    expect(noteLinkUrl('My Notes', 'Contacts/Ger Verhallen.md')).toBe(
      'obsidian://open?vault=My%20Notes&file=Contacts%2FGer%20Verhallen',
    );
    expect(noteLinkUrl('V', 'a/b.MD')).toBe('obsidian://open?vault=V&file=a%2Fb');
  });

  it('parses it back', () => {
    expect(parseNoteLink('obsidian://open?vault=My%20Notes&file=Contacts%2FGer%20Verhallen')).toEqual({
      vault: 'My Notes',
      file: 'Contacts/Ger Verhallen',
    });
  });

  it('ignores case of scheme and open, and the order of the parts', () => {
    expect(parseNoteLink('OBSIDIAN://open?file=a&vault=b')).toEqual({ vault: 'b', file: 'a' });
    expect(parseNoteLink('obsidian://OPEN?file=a&vault=b')).toEqual({ vault: 'b', file: 'a' });
  });

  it('reads the value as on the card (unescaped)', () => {
    expect(parseNoteLink('obsidian://open?vault=a\\,b&file=c')).toEqual({ vault: 'a,b', file: 'c' });
  });

  it('is undefined for anything else', () => {
    for (const value of [
      'obsidian://open?vault=b',
      'obsidian://open?path=%2Fx',
      'https://example.org',
      'obsidian://open?vault=%E0&file=a',
    ]) {
      expect(parseNoteLink(value)).toBeUndefined();
    }
  });
});

describe('isOwnNoteLink', () => {
  const line = (text: string) => card(text)[0];

  it('needs a group, a URL line and an own vault (ignoring case)', () => {
    expect(isOwnNoteLink(line('item1.URL:obsidian://open?vault=Notes&file=a'), ['Notes'])).toBe(true);
    expect(isOwnNoteLink(line('item1.URL:obsidian://open?vault=notes&file=a'), ['Notes'])).toBe(true);
    expect(isOwnNoteLink(line('URL:obsidian://open?vault=Notes&file=a'), ['Notes'])).toBe(false);
    expect(isOwnNoteLink(line('item1.URL:obsidian://open?vault=Other&file=a'), ['Notes'])).toBe(false);
    expect(isOwnNoteLink(line('item1.EMAIL:obsidian://open?vault=Notes&file=a'), ['Notes'])).toBe(false);
    expect(isOwnNoteLink(line('item1.URL:https://example.org'), ['Notes'])).toBe(false);
  });

  it('is never true without own vaults', () => {
    expect(isOwnNoteLink(line('item1.URL:obsidian://open?vault=Notes&file=a'), [])).toBe(false);
  });
});

describe('cardNoteLinks', () => {
  it('lists own links in card order with the first label of their group', () => {
    const lines = card(
      `item2.URL:${url}`,
      'item2.X-ABLabel:Ger Verhallen\\, sr',
      `item3.URL:${urlSem}`,
      'URL:https://example.org',
    );
    expect(cardNoteLinks(lines, ['Notes'])).toEqual([
      { line: 0, url, label: 'Ger Verhallen, sr', labelLine: 1 },
      { line: 2, url: urlSem },
    ]);
  });

  it('reads unparsed lines in any spelling (as patch writes them)', () => {
    const lines = [
      { group: 'item4', name: 'url', params: [], value: url },
      { group: 'item4', name: 'X-ABLabel', params: [], value: 'Verhallen\\, Ger' },
    ];
    expect(isOwnNoteLink(lines[0], ['Notes'])).toBe(true);
    expect(cardNoteLinks(lines, ['Notes'])).toEqual([{ line: 0, url, label: 'Verhallen, Ger', labelLine: 1 }]);
    expect(noteLinksDiffer(lines, [{ url, label: 'Verhallen, Ger' }], ['Notes'])).toBe(false);
  });
});

describe('wantedNoteLinks', () => {
  it('follows the mapping order, resolves targets and skips what has no contact note', () => {
    const props = { friends: ['[[Piet]]', '[[Ger Verhallen]]'], spouse: '[[Contacts/Ger Verhallen|Ger]]', children: ['[[Sem]]'] };
    expect(wantedNoteLinks(props, DEFAULT_MAPPING, ctx, 'Notes')).toEqual([
      { url, label: 'Ger Verhallen' },
      { url: urlSem, label: 'Sem de Vries' },
    ]);
  });

  it('orders ordinals of a row after the row itself', () => {
    const props = { 'spouse-2': '[[Sem]]', spouse: '[[Ger Verhallen]]' };
    expect(wantedNoteLinks(props, DEFAULT_MAPPING, ctx, 'Notes').map((l) => l.label)).toEqual([
      'Ger Verhallen',
      'Sem de Vries',
    ]);
  });

  it('is empty without a contact-note lookup', () => {
    expect(wantedNoteLinks({ spouse: '[[Ger Verhallen]]' }, DEFAULT_MAPPING, base, 'Notes')).toEqual([]);
  });
});

describe('noteLinksDiffer', () => {
  const wanted = [
    { url, label: 'Ger Verhallen' },
    { url: urlSem, label: 'Sem de Vries' },
  ];
  const lines = (...extra: string[]) =>
    card(
      `item1.URL:${urlSem}`,
      'item1.X-ABLabel:Sem de Vries',
      `item2.URL:${url}`,
      'item2.X-ABLabel:Ger Verhallen',
      ...extra,
    );

  it('ignores order', () => {
    expect(noteLinksDiffer(lines(), wanted, ['Notes'])).toBe(false);
  });

  it('sees a changed label', () => {
    const changed = card(`item1.URL:${url}`, 'item1.X-ABLabel:Ger', `item2.URL:${urlSem}`, 'item2.X-ABLabel:Sem de Vries');
    expect(noteLinksDiffer(changed, wanted, ['Notes'])).toBe(true);
  });

  it('sees a duplicate and an extra own link', () => {
    expect(noteLinksDiffer(lines(`item3.URL:${url}`, 'item3.X-ABLabel:Ger Verhallen'), wanted, ['Notes'])).toBe(true);
    expect(noteLinksDiffer(lines('item3.URL:obsidian://open?vault=Notes&file=x'), wanted, ['Notes'])).toBe(true);
  });

  it('sees a missing link', () => {
    expect(noteLinksDiffer(card(`item1.URL:${url}`, 'item1.X-ABLabel:Ger Verhallen'), wanted, ['Notes'])).toBe(true);
  });

  it('counts a missing label as empty', () => {
    expect(noteLinksDiffer(card(`item1.URL:${url}`), [{ url, label: '' }], ['Notes'])).toBe(false);
  });

  it('ignores a non-own URL and a link to another vault', () => {
    const extra = lines('URL:obsidian://open?vault=Notes&file=x', 'item3.URL:obsidian://open?vault=Other&file=x');
    expect(noteLinksDiffer(extra, wanted, ['Notes'])).toBe(false);
  });
});

describe('settings', () => {
  it('normalizes the stored value', () => {
    expect(normalizeNoteLinks(undefined)).toEqual(DEFAULT_NOTE_LINKS);
    expect(normalizeNoteLinks({ enabled: 'yes', vaultName: ' N ', formerVaultNames: ['A', '', 'A', 3] })).toEqual({
      enabled: false,
      vaultName: 'N',
      formerVaultNames: ['A'],
    });
  });

  it('turns on with the device vault only when no name is stored', () => {
    const on = turnNoteLinks(DEFAULT_NOTE_LINKS, true, 'Mac Notes');
    expect(on).toEqual({ enabled: true, vaultName: 'Mac Notes', formerVaultNames: [] });
    const off = turnNoteLinks(on, false, 'Mac Notes');
    expect(off.enabled).toBe(false);
    expect(off.vaultName).toBe('Mac Notes');
    expect(turnNoteLinks({ enabled: false, vaultName: 'Phone', formerVaultNames: [] }, true, 'Mac Notes').vaultName).toBe('Phone');
  });

  it('keeps former vault names when the name changes', () => {
    const first = setLinkVault({ enabled: true, vaultName: 'Mac Notes', formerVaultNames: [] }, 'Phone', 'Mac Notes');
    expect(first).toEqual({ enabled: true, vaultName: 'Phone', formerVaultNames: ['Mac Notes'] });
    const second = setLinkVault(first, '  ', 'Mac Notes');
    expect(second).toEqual({ enabled: true, vaultName: 'Mac Notes', formerVaultNames: ['Phone'] });
    expect(noteLinkOptions(second)).toEqual({ enabled: true, vault: 'Mac Notes', ownVaults: ['Mac Notes', 'Phone'] });
  });

  it('derives the options for Sync', () => {
    expect(noteLinkOptions(DEFAULT_NOTE_LINKS)).toEqual({ enabled: false, vault: '', ownVaults: [] });
    expect(noteLinkOptions({ enabled: true, vaultName: '', formerVaultNames: ['X'] }).enabled).toBe(false);
    // Off: no links are written, but the stored names stay recognised so Sync can remove the old links.
    expect(noteLinkOptions({ enabled: false, vaultName: 'Notes', formerVaultNames: ['Old'] }))
      .toEqual({ enabled: false, vault: 'Notes', ownVaults: ['Notes', 'Old'] });
  });
});
