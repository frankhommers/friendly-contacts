import { compareBirthdays, nextBirthday } from 'src/util/birthday';
import { describe, expect, it } from 'vitest';

const today = new Date(2026, 9, 18);

describe('nextBirthday', () => {
  it('next birthday later this year', () => {
    expect(nextBirthday('1980-12-01', today)).toEqual(new Date(2026, 11, 1));
  });

  it('already passed goes to next year', () => {
    expect(nextBirthday('--03-15', today)).toEqual(new Date(2027, 2, 15));
    expect(nextBirthday('--0315', today)).toEqual(new Date(2027, 2, 15));
  });

  it('today is today', () => {
    expect(nextBirthday('1990-10-18', today)).toEqual(new Date(2026, 9, 18));
  });

  it('leap day in a non-leap year', () => {
    expect(nextBirthday('2000-02-29', today)).toEqual(new Date(2027, 2, 1));
  });

  it('unparseable is undefined', () => {
    for (const value of ['1985', '1985-04', 'circa 1950', '', '1980-13-01']) {
      expect(nextBirthday(value, today)).toBeUndefined();
    }
  });

  it('accepts a non-string value, such as an unquoted YAML number', () => {
    expect(nextBirthday(19801020, today)).toEqual(new Date(2026, 9, 20));
    expect(nextBirthday(1985, today)).toBeUndefined();
    expect(nextBirthday(null, today)).toBeUndefined();
    expect(nextBirthday({}, today)).toBeUndefined();
  });
});

describe('compareBirthdays', () => {
  it('sorts non-string values without throwing', () => {
    const values: unknown[] = [null, 1985, 19701019, '--10-20'];
    const sorted = [...values].sort((a, b) => compareBirthdays(a, b, today));
    expect(sorted).toEqual([19701019, '--10-20', 1985, null]);
  });

  it('sorts unparseable birthdays last', () => {
    const values = ['circa 1950', '--10-20', undefined, '1985', '1970-10-19'];
    const sorted = [...values].sort((a, b) => compareBirthdays(a, b, today));
    expect(sorted).toEqual(['1970-10-19', '--10-20', 'circa 1950', '1985', undefined]);
  });
});
