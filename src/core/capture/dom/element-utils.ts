export const FOCUSABLE_SELECTOR =
  'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [tabindex], [contenteditable="true"]';

const MAX_ELEMENT_RATIO = 0.8;

export function findFocusableAncestor(el: Element): HTMLElement {
  let cursor: Element | null = el;
  while (cursor) {
    const match: Element | null = cursor.closest(FOCUSABLE_SELECTOR);
    if (match instanceof HTMLElement) return match;
    if (match) {
      cursor = match.parentElement;
      continue;
    }
    break;
  }
  if (el instanceof HTMLElement) return el;
  let parent: Element | null = el.parentElement;
  while (parent && !(parent instanceof HTMLElement)) {
    parent = parent.parentElement;
  }
  return (parent as HTMLElement) ?? document.body;
}

export function isTextField(el: Element): boolean {
  if (el instanceof HTMLInputElement) {
    return ['text', 'email', 'password', 'search', 'tel', 'url', 'number'].includes(el.type);
  }
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
}

/**
 * True when a click on `el` will replace the current page with another one.
 *
 * Only a same-tab link counts. A link into a new window, a download, or a fragment-only
 * href leaves this page where it is, so the screenshot can be taken after the click and
 * there is no reason to hold the click back.
 */
export function isNavigatingClick(el: HTMLElement): boolean {
  const anchor = el.closest('a[href]');
  if (!anchor) return false;
  const href = anchor.getAttribute('href');
  if (!href || href === '#' || href.startsWith('javascript:')) return false;
  if (anchor.hasAttribute('download')) return false;
  const target = anchor.getAttribute('target');
  return !target || target === '_self';
}

/**
 * True when a click on `el` submits a form, which usually unloads the page as well.
 *
 * A `<button>` inside a form submits unless it says otherwise, so the default type is
 * treated the same as an explicit `type="submit"`.
 */
export function isSubmitClick(el: HTMLElement): boolean {
  if (el instanceof HTMLButtonElement) return el.type === 'submit' && el.form !== null;
  if (el instanceof HTMLInputElement) return (el.type === 'submit' || el.type === 'image') && el.form !== null;
  return false;
}

export function isTooLarge(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width / window.innerWidth > MAX_ELEMENT_RATIO || rect.height / window.innerHeight > MAX_ELEMENT_RATIO;
}

export function isMimikElement(el: Element): boolean {
  return !!el.closest('[data-mimik-ignore]');
}

export function getFieldValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  if (el.isContentEditable) return el.textContent?.trim() ?? '';
  return '';
}

export function getFieldLabel(el: HTMLElement): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return placeholder;

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const labels = el.labels;
    if (labels && labels.length > 0) {
      const labelText = labels[0].innerText?.trim();
      if (labelText) return labelText;
    }
  }

  const id = el.getAttribute('id');
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label) {
      const labelText = (label as HTMLElement).innerText?.trim();
      if (labelText) return labelText;
    }
  }

  const parentLabel = el.closest('label');
  if (parentLabel) {
    const labelText = parentLabel.innerText?.trim();
    if (labelText) return labelText;
  }

  const name = el.getAttribute('name');
  if (name && !/[-_]test|[-_]id|[-_]key/i.test(name)) return name;

  return 'text field';
}
