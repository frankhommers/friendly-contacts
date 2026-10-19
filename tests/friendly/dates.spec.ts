import { VCardLine } from 'src/contacts/friendly/lines';
import { noteDateFor, normalizeNoteDate, readDate, writeDate } from 'src/contacts/friendly/dates';
import { describe, expect, it } from 'vitest';

const line = (value: string, ...params: [string, string][]): VCardLine => ({ name: 'BDAY', params, value });
const APPLE: [string, string] = ['X-APPLE-OMIT-YEAR', '1604'];

describe('readDate', () => {
  it('reads basic and extended full dates as YYYY-MM-DD', () => {
    expect(readDate(line('19800315'))).toBe('1980-03-15');
    expect(readDate(line('1980-03-15'))).toBe('1980-03-15');
  });

  it('reads year-less as --MM-DD', () => {
    expect(readDate(line('--0315'))).toBe('--03-15');
    expect(readDate(line('--03-15'))).toBe('--03-15');
  });

  it('reads apple year-less as --MM-DD', () => {
    expect(readDate(line('1604-03-15', APPLE))).toBe('--03-15');
  });

  it('reads X-ABDATE in 1604 without the apple param as year-less (DAVx5 drops the param on X-ABDATE)', () => {
    const abdate = (value: string): VCardLine => ({ group: 'item1', name: 'X-ABDATE', params: [], value });
    expect(readDate(abdate('1604-06-21'))).toBe('--06-21');
    expect(readDate(abdate('16040621'))).toBe('--06-21');
    expect(readDate(abdate('2012-06-21'))).toBe('2012-06-21');
    // Only X-ABDATE: a birthday in 1604 without the param is a birthday in 1604.
    expect(readDate(line('1604-06-21'))).toBe('1604-06-21');
  });

  it('apple param with another year keeps the year', () => {
    expect(readDate(line('1980-03-15', APPLE))).toBe('1980-03-15');
  });

  it('reads other forms verbatim', () => {
    for (const value of ['1985', '1985-04', '---15', '19800315T120000Z']) expect(readDate(line(value))).toBe(value);
    expect(readDate(line('around 1980\\, spring', ['VALUE', 'text']))).toBe('around 1980, spring');
  });

  it('reads an empty value as empty', () => {
    expect(readDate(line(''))).toBe('');
  });
});

describe('normalizeNoteDate', () => {
  it('turns --MMDD into --MM-DD and leaves the rest trimmed', () => {
    expect(normalizeNoteDate('--0315')).toBe('--03-15');
    expect(normalizeNoteDate(' --03-15 ')).toBe('--03-15');
    expect(normalizeNoteDate(' 19800315 ')).toBe('19800315');
    expect(normalizeNoteDate('spring')).toBe('spring');
  });
});

describe('noteDateFor', () => {
  it('reads a full date in the apple year of the line as year-less', () => {
    expect(noteDateFor('1604-03-15', line('1604-03-15', APPLE))).toBe('--03-15');
    expect(noteDateFor(' 16040401 ', line('1604-03-15', APPLE))).toBe('--04-01');
  });

  it('leaves other values normalised', () => {
    expect(noteDateFor('1604-03-15', line('1604-03-15'))).toBe('1604-03-15');
    expect(noteDateFor('1980-03-15', line('1604-03-15', APPLE))).toBe('1980-03-15');
    expect(noteDateFor('--0315', undefined)).toBe('--03-15');
    expect(noteDateFor('spring', line('1604-03-15', APPLE))).toBe('spring');
  });
});

describe('writeDate', () => {
  it('writes year-less on 3.0 with the apple trick', () => {
    expect(writeDate('--03-15', undefined, '3.0')).toEqual({ value: '1604-03-15', params: [APPLE] });
    expect(writeDate('--0315', line('1980-01-01'), '3.0')).toEqual({ value: '1604-03-15', params: [APPLE] });
  });

  it('writes year-less on an apple line with its own year', () => {
    const apple: [string, string] = ['X-APPLE-OMIT-YEAR', '1900'];
    expect(writeDate('--03-15', line('1900-01-01', apple), '4.0')).toEqual({ value: '1900-03-15', params: [apple] });
  });

  it('writes year-less on an X-ABDATE line in 1604 without the param in the apple form', () => {
    const abdate = (value: string): VCardLine => ({ group: 'item1', name: 'X-ABDATE', params: [], value });
    expect(noteDateFor('1604-06-21', abdate('1604-06-21'))).toBe('--06-21');
    expect(writeDate('--07-01', abdate('1604-06-21'), '3.0')).toEqual({ value: '1604-07-01', params: [APPLE] });
    expect(writeDate('--07-01', abdate('16040621'), '3.0')).toEqual({ value: '16040701', params: [APPLE] });
    expect(writeDate('--07-01', abdate('1604-06-21'), '4.0')).toEqual({ value: '1604-07-01', params: [APPLE] });
    expect(writeDate('2012-07-01', abdate('1604-06-21'), '3.0')).toEqual({ value: '2012-07-01', params: [] });
  });

  it('writes year-less on 4.0 as --MMDD', () => {
    expect(writeDate('--03-15', undefined, '4.0')).toEqual({ value: '--0315', params: [] });
    const existing = line('19800101', ['X-FOO', 'bar']);
    expect(writeDate('--0315', existing, '4.0')).toEqual({ value: '--0315', params: [['X-FOO', 'bar']] });
  });

  it('drops the apple param when a year is added', () => {
    expect(writeDate('1980-03-15', line('1604-03-15', APPLE), '3.0')).toEqual({ value: '1980-03-15', params: [] });
    expect(writeDate('19800315', line('16040315', APPLE), '3.0')).toEqual({ value: '19800315', params: [] });
  });

  it('keeps the style of the existing value', () => {
    expect(writeDate('1980-03-15', line('19700101'), '3.0').value).toBe('19800315');
    expect(writeDate('19800315', line('1970-01-01'), '3.0').value).toBe('1980-03-15');
    expect(writeDate('19800315', line('--0101'), '4.0').value).toBe('19800315');
    expect(writeDate('1980-03-15', line('--0101'), '4.0').value).toBe('19800315');
    expect(writeDate('19800315', line('--01-01'), '4.0').value).toBe('1980-03-15');
  });

  it('styles a new full date by version', () => {
    expect(writeDate('19800315', undefined, '3.0')).toEqual({ value: '1980-03-15', params: [] });
    expect(writeDate('1980-03-15', undefined, '4.0')).toEqual({ value: '19800315', params: [] });
  });

  it('removes VALUE=text when the new value is a date', () => {
    const text = line('spring', ['VALUE', 'text'], ['X-FOO', 'bar']);
    expect(writeDate('1980-03-15', text, '4.0').params).toEqual([['X-FOO', 'bar']]);
    expect(writeDate('--03-15', text, '4.0').params).toEqual([['X-FOO', 'bar']]);
  });

  it('non-dates on 4.0 get VALUE=text', () => {
    expect(writeDate('spring, 1980', undefined, '4.0')).toEqual({ value: 'spring\\, 1980', params: [['VALUE', 'text']] });
    const text = line('x', ['VALUE', 'text']);
    expect(writeDate('spring', text, '4.0').params).toEqual([['VALUE', 'text']]);
  });

  it('non-dates on 4.0 replace any VALUE param with a single VALUE=text', () => {
    const dateTime = line('19890612T143000Z', ['TYPE', 'child'], ['VALUE', 'DATE-TIME']);
    expect(writeDate('spring', dateTime, '4.0').params).toEqual([['TYPE', 'child'], ['VALUE', 'text']]);
    const both = line('x', ['VALUE', 'date'], ['VALUE', 'TEXT']);
    expect(writeDate('spring', both, '4.0').params).toEqual([['VALUE', 'text']]);
  });

  it('writing a date removes every VALUE param', () => {
    const dateTime = line('19890612T143000Z', ['TYPE', 'child'], ['VALUE', 'DATE-TIME']);
    expect(writeDate('1990-01-02', dateTime, '3.0')).toEqual({ value: '1990-01-02', params: [['TYPE', 'child']] });
    expect(writeDate('--01-02', dateTime, '4.0')).toEqual({ value: '--0102', params: [['TYPE', 'child']] });
    expect(writeDate('--01-02', dateTime, '3.0').params).toEqual([['TYPE', 'child'], APPLE]);
    expect(writeDate('1985', dateTime, '4.0')).toEqual({ value: '1985', params: [['TYPE', 'child']] });
  });

  it('4.0 reduced-precision dates and date-times are written verbatim without VALUE=text', () => {
    const text = line('x', ['VALUE', 'text']);
    for (const value of ['1985', '1985-04', '198504', '---15', '--04', '19850412T120000Z', '--0412T1200', '1985-04-12T12:00:00Z']) {
      expect(writeDate(value, text, '4.0')).toEqual({ value, params: [] });
      expect(writeDate(value, undefined, '4.0')).toEqual({ value, params: [] });
    }
  });

  it('non-dates drop the apple param', () => {
    expect(writeDate('spring', line('1604-03-15', APPLE), '3.0')).toEqual({ value: 'spring', params: [] });
    expect(writeDate('spring', line('1604-03-15', APPLE), '4.0')).toEqual({ value: 'spring', params: [['VALUE', 'text']] });
    expect(writeDate('1985', line('1604-03-15', APPLE), '4.0')).toEqual({ value: '1985', params: [] });
  });

  it('a full date in the apple year of the line is that line\'s year-less date', () => {
    expect(writeDate('1604-03-15', line('1604-03-15', APPLE), '3.0')).toEqual({ value: '1604-03-15', params: [APPLE] });
    expect(writeDate('16040401', line('1604-03-15', APPLE), '3.0')).toEqual({ value: '1604-04-01', params: [APPLE] });
    expect(writeDate('1604-03-15', line('16040315', APPLE), '3.0')).toEqual({ value: '16040315', params: [APPLE] });
    expect(writeDate('1605-03-15', line('1604-03-15', APPLE), '3.0')).toEqual({ value: '1605-03-15', params: [] });
  });

  it('non-dates on 3.0 are plain escaped text', () => {
    expect(writeDate('1985', line('19800315'), '3.0')).toEqual({ value: '1985', params: [] });
    expect(writeDate('a;b', undefined, '3.0')).toEqual({ value: 'a\\;b', params: [] });
  });
});
