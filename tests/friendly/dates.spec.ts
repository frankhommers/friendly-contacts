import { VCardLine } from 'src/contacts/friendly/lines';
import { normalizeNoteDate, readDate, writeDate } from 'src/contacts/friendly/dates';
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

describe('writeDate', () => {
  it('writes year-less on 3.0 with the apple trick', () => {
    expect(writeDate('--03-15', undefined, '3.0')).toEqual({ value: '1604-03-15', params: [APPLE] });
    expect(writeDate('--0315', line('1980-01-01'), '3.0')).toEqual({ value: '1604-03-15', params: [APPLE] });
  });

  it('writes year-less on an apple line with its own year', () => {
    const apple: [string, string] = ['X-APPLE-OMIT-YEAR', '1900'];
    expect(writeDate('--03-15', line('1900-01-01', apple), '4.0')).toEqual({ value: '1900-03-15', params: [apple] });
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
    expect(writeDate('19800315', line('--0101'), '4.0').value).toBe('1980-03-15');
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
    expect(writeDate('1985', text, '4.0').params).toEqual([['VALUE', 'text']]);
  });

  it('non-dates on 3.0 are plain escaped text', () => {
    expect(writeDate('1985', line('19800315'), '3.0')).toEqual({ value: '1985', params: [] });
    expect(writeDate('a;b', undefined, '3.0')).toEqual({ value: 'a\\;b', params: [] });
  });
});
