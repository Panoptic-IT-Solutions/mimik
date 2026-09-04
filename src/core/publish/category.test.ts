import { describe, expect, it } from 'vitest';
import { categoryRoot, isValidCategoryName, NEW_CATEGORY, resolveCategory } from './category';

const HUB = ['process/autotask-crm', 'process/nocodb', 'developer'];

describe('isValidCategoryName', () => {
  it('accepts lowercase kebab-case', () => {
    expect(isValidCategoryName('nocodb')).toBe(true);
    expect(isValidCategoryName('email-security')).toBe(true);
    expect(isValidCategoryName('m365')).toBe(true);
  });

  it('rejects anything the hub would turn into a different folder', () => {
    for (const bad of ['', 'Email Security', 'email_security', '-lead', 'trail-', 'double--hyphen', 'a/b', 'café']) {
      expect(isValidCategoryName(bad), bad).toBe(false);
    }
  });
});

describe('resolveCategory', () => {
  it('sends an existing category exactly as the hub listed it', () => {
    expect(resolveCategory('process/nocodb', 'ignored', HUB)).toBe('process/nocodb');
  });

  it('places a new category under the same root as the existing ones', () => {
    expect(resolveCategory(NEW_CATEGORY, 'email-security', HUB)).toBe('process/email-security');
    expect(resolveCategory(NEW_CATEGORY, '  nocodb ', HUB)).toBe('process/nocodb');
  });

  it('falls back to process when the hub offered nothing to read the root from', () => {
    expect(categoryRoot([])).toBe('process');
    expect(resolveCategory(NEW_CATEGORY, 'nocodb', [])).toBe('process/nocodb');
  });

  it('stays empty until the name is valid, so Publish stays disabled', () => {
    expect(resolveCategory(NEW_CATEGORY, '', HUB)).toBe('');
    expect(resolveCategory(NEW_CATEGORY, 'Not Valid', HUB)).toBe('');
    expect(resolveCategory('', '', HUB)).toBe('');
  });
});
