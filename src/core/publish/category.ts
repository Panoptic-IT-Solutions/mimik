/**
 * The category a new page is proposed under, as the publish dialog builds it.
 *
 * The hub lists the categories it has as `process/<folder>` and validates a proposed one
 * only for shape, so a category nobody has written under yet is sent the same way.
 */

/** Select value standing for "a category the hub does not have yet". No real path has a leading underscore. */
export const NEW_CATEGORY = '__new__';
/** The folder every support document lives under. The hub lists its categories as `process/<folder>`. */
const DEFAULT_CATEGORY_ROOT = 'process';
const CATEGORY_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidCategoryName(name: string): boolean {
  return CATEGORY_NAME.test(name);
}

/**
 * The folder a new category is created under, read from the categories the hub already
 * offers so it stays right if the hub ever moves them.
 */
export function categoryRoot(categories: string[]): string {
  const nested = categories.find((name) => name.includes('/'));
  return nested ? nested.slice(0, nested.indexOf('/')) : DEFAULT_CATEGORY_ROOT;
}

/** The proposedCategory to send, or '' while the choice is incomplete or the name is not yet valid. */
export function resolveCategory(choice: string, newName: string, categories: string[]): string {
  if (choice !== NEW_CATEGORY) return choice;
  const name = newName.trim();
  return isValidCategoryName(name) ? `${categoryRoot(categories)}/${name}` : '';
}
