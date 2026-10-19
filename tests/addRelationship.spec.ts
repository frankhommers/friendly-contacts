import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  App: class {},
  Notice: class {},
  FuzzySuggestModal: class {},
  SuggestModal: class {},
  Modal: class {},
  TFile: class {},
}));

import { ghostAction, remoteCardFor } from 'src/contacts/relationEdit';
import { pickableContacts } from 'src/ui/modals/addRelationshipModal';

describe('pickableContacts', () => {
  const notes = [
    { path: 'People/Sem.md', name: 'Sem' },
    { path: 'People/Jan.md', name: 'Jan' },
    { path: 'People/anna.md', name: 'anna' },
  ];

  it('picker excludes self', () => {
    expect(pickableContacts(notes, 'People/Jan.md').map((n) => n.path)).toEqual(['People/anna.md', 'People/Sem.md']);
  });

  it('picker sorts by name', () => {
    expect(pickableContacts(notes, 'Other.md').map((n) => n.name)).toEqual(['anna', 'Jan', 'Sem']);
  });
});

describe('remoteCardFor', () => {
  const remote = [
    { uid: 'u1', fileName: 'Sem', href: '/a' },
    { uid: 'u2', fileName: 'Lot', href: '/b' },
    { uid: 'u2', fileName: 'Lot', href: '/c' },
    { uid: 'u3', fileName: 'Piet', href: '/d' },
    { uid: 'u4', fileName: 'Piet', href: '/e' },
  ];

  it('finds the one card a link text names', () => {
    expect(remoteCardFor('[[Sem]]', remote)?.href).toBe('/a');
    expect(remoteCardFor('[[Lot|Lotje]]', remote)?.uid).toBe('u2');
  });

  it('is undefined for no match or an ambiguous name', () => {
    expect(remoteCardFor('[[Nobody]]', remote)).toBeUndefined();
    expect(remoteCardFor('[[Piet]]', remote)).toBeUndefined();
    expect(remoteCardFor('  ', remote)).toBeUndefined();
  });
});

describe('ghostAction', () => {
  const remote = [
    { uid: 'u1', fileName: 'Sem de Vries', href: '/a' },
    { uid: 'u2', fileName: 'Lot', href: '/b' },
    { uid: 'u3', fileName: 'Piet', href: '/c' },
    { uid: 'u4', fileName: 'Piet', href: '/d' },
  ];
  const notes: Record<string, string> = { u1: 'People/Sem.md', u3: 'People/Piet.md', u9: 'People/Jan.md' };
  const notePathOf = (uid: string) => notes[uid];

  it('offers Import for a card without a note', () => {
    expect(ghostAction('[[Lot]]', remote, notePathOf, 'People/Jan.md')).toEqual({ import: remote[1] });
  });

  it('no Import for a name whose card already has a note', () => {
    expect(ghostAction('[[Sem de Vries]]', remote, notePathOf, 'People/Jan.md')).toEqual({ link: 'People/Sem.md' });
  });

  it('judges ambiguity on every card, with or without a note', () => {
    expect(ghostAction('[[Piet]]', remote, notePathOf, 'People/Jan.md')).toBeUndefined();
    expect(ghostAction('[[Nobody]]', remote, notePathOf, 'People/Jan.md')).toBeUndefined();
  });

  it('offers nothing when the card is the contact itself', () => {
    expect(ghostAction('[[Sem de Vries]]', remote, notePathOf, 'People/Sem.md')).toBeUndefined();
  });
});
