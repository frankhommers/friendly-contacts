import { describe, expect, it } from 'vitest';
import { insertLabelledDateRow, labelledDateRow } from 'src/contacts/friendly/dateLabels';
import { DEFAULT_MAPPING, renameRow } from 'src/contacts/friendly/mapping';
import {
  inNewContacts,
  newContactProperty,
  otherNewContactKeys,
  newContactAddition,
  renameNewContactKeys,
  withNewContactProperty,
} from 'src/settings/newContactFields';

const rows = DEFAULT_MAPPING;

describe('new contact fields', () => {
  it('creates a vCard key under its property, and any other key as it is', () => {
    expect(newContactProperty('mobile', rows)).toBe('mobile');
    expect(newContactProperty('TEL[CELL]', rows)).toBe('mobile');
    expect(newContactProperty('N.GN', rows)).toBe('firstname');
    expect(newContactProperty('X-FOO', rows)).toBe('X-FOO');
  });

  it('knows a property is in new contacts by its name or by a vCard key', () => {
    expect(inNewContacts('mobile', ['mobile'], rows)).toBe(true);
    expect(inNewContacts('mobile', ['TEL[CELL]'], rows)).toBe(true);
    expect(inNewContacts('mobile', ['email'], rows)).toBe(false);
  });

  it('adds a property at the end, once', () => {
    expect(withNewContactProperty(['email'], 'mobile', true, rows)).toEqual(['email', 'mobile']);
    expect(withNewContactProperty(['TEL[CELL]'], 'mobile', true, rows)).toEqual(['TEL[CELL]']);
  });

  it('removes every entry created under a property', () => {
    expect(withNewContactProperty(['mobile', 'email', 'TEL[CELL]'], 'mobile', false, rows)).toEqual(['email']);
  });

  it('follows renames, also numbered properties, and swaps', () => {
    expect(renameNewContactKeys(['mobile', 'mobile-2', 'mobiles', 'X-FOO'], [{ from: 'mobile', to: 'gsm' }])).toEqual([
      'gsm',
      'gsm-2',
      'mobiles',
      'X-FOO',
    ]);
    expect(
      renameNewContactKeys(['email', 'phone'], [
        { from: 'email', to: 'phone' },
        { from: 'phone', to: 'email' },
      ]),
    ).toEqual(['phone', 'email']);
  });

  it('lists the entries that are not a property in the list', () => {
    const dated = insertLabelledDateRow(rows, labelledDateRow('Verkering', 'dating'));
    expect(otherNewContactKeys(['mobile', 'NOTE', 'X-FOO', 'TEL[CELL]', 'mobile-2', 'dating'], dated)).toEqual(['X-FOO', 'mobile-2']);
  });

  describe('what a person types', () => {
    it('takes a property name as typed', () => {
      expect(newContactAddition(' mobile ', [], rows)).toEqual({ property: 'mobile' });
    });

    it('takes the property that reads a card field', () => {
      expect(newContactAddition('tel[cell]', [], rows)).toEqual({ property: 'mobile' });
    });

    it('a card field no property reads needs a row of its own', () => {
      expect(newContactAddition('x-banaan', [], rows)).toEqual({ cardField: 'X-BANAAN' });
      expect(newContactAddition('tel[fax]', [], rows)).toEqual({ cardField: 'TEL[FAX]' });
    });

    it('refuses empty, unknown and double entries', () => {
      expect(newContactAddition('  ', [], rows)).toHaveProperty('error');
      expect(newContactAddition('foo', [], rows)).toHaveProperty('error');
      expect(newContactAddition('mobile', ['TEL[CELL]'], rows)).toEqual({ error: 'New contacts already get mobile.' });
      expect(newContactAddition('TEL[CELL]', ['mobile'], rows)).toEqual({ error: 'New contacts already get mobile.' });
    });

    it('takes a property name of a renamed row', () => {
      expect(newContactAddition('gsm', [], renameRow(rows, 'mobile', 'gsm'))).toEqual({ property: 'gsm' });
    });
  });
});
