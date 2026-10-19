import { displayValue, linkDisplayName } from 'src/sync/reviewDisplay';
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
