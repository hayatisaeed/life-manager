import { ENTITIES } from '@lm/core';
import { describe, expect, it } from 'vitest';
import {
  SEARCHABLE,
  extractSearchText,
  normalizeSearchText,
  searchFields,
  toMatchQuery,
} from './search-text';

describe('search fields', () => {
  it('picks a title field and the long-text fields', () => {
    expect(SEARCHABLE['task']).toEqual({ title: 'title', body: ['notes'] });
    expect(SEARCHABLE['inboxItem']).toEqual({ title: 'text', body: ['transcript'] });
    expect(SEARCHABLE['card']).toEqual({ title: 'front', body: ['back'] });
    expect(searchFields(ENTITIES.weeklyReview)?.title).toBeNull();
    expect(SEARCHABLE).not.toHaveProperty('settings');
    expect(SEARCHABLE).not.toHaveProperty('habitLog');
  });

  it('extracts text, skipping missing and non-string values', () => {
    expect(
      extractSearchText(
        { title: null, body: ['done', 'slipped', 'next'] },
        { done: 'a', slipped: 3, next: 'b' },
      ),
    ).toEqual({ title: '', body: 'a\nb' });
  });
});

describe('normalization', () => {
  it('folds Arabic letters and compatibility forms', () => {
    expect(normalizeSearchText('يكﻻ', false)).toBe('یکلا');
  });

  it('indexes ZWNJ words both split and joined; queries drop the ZWNJ', () => {
    expect(normalizeSearchText('می‌روم خانه', true)).toBe('می روم خانه میروم');
    expect(normalizeSearchText('می‌روم', false)).toBe('میروم');
  });

  it('quotes every word as a prefix term', () => {
    expect(toMatchQuery('Plan  my-week')).toBe('"Plan"* "my"* "week"*');
    expect(toMatchQuery('"*()')).toBeNull();
  });
});
