import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({
  App: class {},
  Notice: class {},
  FuzzySuggestModal: class {},
  SuggestModal: class {},
  Modal: class {},
  TFile: class {},
}));

import { remoteCardFor } from 'src/contacts/relationEdit';
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
