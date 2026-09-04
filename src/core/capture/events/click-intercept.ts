import { isNavigatingClick, isSubmitClick, isTextField } from '../dom/element-utils';

const replayed = new WeakSet<Event>();

export function isReplayedClick(event: Event): boolean {
  return replayed.has(event);
}

/**
 * Whether the recorder should hold this click back until the screenshot is taken.
 *
 * Only a click that is about to take the page away qualifies: a same-tab link or a form
 * submit. Everything else, a menu toggle, a checkbox, a button that opens a dialog, is
 * left to the page untouched and screenshotted a few frames later. Holding those back
 * meant the page did not respond for as long as the screenshot took, and a click that
 * arrives late or not at all is worse than a screenshot taken a frame after the click.
 */
export function shouldInterceptClick(target: HTMLElement, event: MouseEvent): boolean {
  if (!event.isTrusted || event.shiftKey || event.ctrlKey || event.metaKey) return false;
  if (target.isContentEditable || isTextField(target)) return false;
  return isNavigatingClick(target) || isSubmitClick(target);
}

export function replayInit(event: MouseEvent): PointerEventInit {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    detail: event.detail,
    button: event.button,
    buttons: event.buttons,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };
}

export function replayClick(target: HTMLElement, init: PointerEventInit): void {
  if (target.isConnected && target.tabIndex >= 0) target.focus();
  const event = new PointerEvent('click', init);
  replayed.add(event);
  target.dispatchEvent(event);
}
