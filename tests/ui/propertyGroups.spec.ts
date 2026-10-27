import { describe, expect, it } from 'vitest';
import { DEFAULT_MAPPING, MappingRow } from 'src/contacts/friendly/mapping';
import { groupRows, propertyGroup } from 'src/ui/settings/propertyGroups';

const row = (property: string) => DEFAULT_MAPPING.find((r) => r.property === property)!;
const field = (write: string, format?: 'date' | 'list'): MappingRow => ({ kind: 'field', property: 'x', read: [write], write, ...(format ? { format } : {}) });

describe('propertyGroup', () => {
  it.each([
    ['name', 'Name'], ['firstname', 'Name'], ['nickname', 'Name'],
    ['mobile', 'Phone, email and web'], ['work-email', 'Phone, email and web'], ['website', 'Phone, email and web'],
    ['company', 'Work'], ['department', 'Work'], ['title', 'Work'], ['role', 'Work'],
    ['street', 'Address'], ['work-country', 'Address'],
    ['birthday', 'Dates'], ['anniversary', 'Dates'],
    ['friends', 'Relationships'], ['emergency', 'Relationships'],
    ['gender', 'Other'], ['note', 'Other'], ['categories', 'Other'], ['photo', 'Other'], ['uid', 'Other'],
  ])('%s is under %s', (property, group) => {
    expect(propertyGroup(row(property))).toBe(group);
  });

  it('goes by the field a row of your own writes, without parameters or group prefix', () => {
    expect(propertyGroup(field('TEL;TYPE=FAX'))).toBe('Phone, email and web');
    expect(propertyGroup(field('item1.EMAIL'))).toBe('Phone, email and web');
    expect(propertyGroup(field('impp'))).toBe('Phone, email and web');
    expect(propertyGroup(field('X-SOMETHING'))).toBe('Other');
    expect(propertyGroup(field('X-ABDATE', 'date'))).toBe('Dates');
  });
});

describe('groupRows', () => {
  it('keeps the rows in their order and leaves out empty groups and excluded rows', () => {
    const rows = [row('friends'), row('email'), row('firstname'), row('mobile')];
    expect(groupRows(rows, (r) => r.property !== 'firstname')).toEqual([
      { group: 'Phone, email and web', indexes: [1, 3] },
      { group: 'Relationships', indexes: [0] },
    ]);
  });
});
