// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { replayClick, replayInit, shouldInterceptClick } from '@/core/capture/events/click-intercept';

function el(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild as HTMLElement;
}

function inForm(html: string): HTMLElement {
  const form = el(`<form action="/go">${html}</form>`);
  return form.firstElementChild as HTMLElement;
}

function click(over: Partial<MouseEventInit> & { isTrusted?: boolean } = {}): MouseEvent {
  return {
    isTrusted: true,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    button: 0,
    buttons: 1,
    detail: 1,
    clientX: 40,
    clientY: 90,
    screenX: 0,
    screenY: 0,
    ...over,
  } as MouseEvent;
}

describe('shouldInterceptClick', () => {
  it('intercepts a same-tab link, which is about to take the page away', () => {
    expect(shouldInterceptClick(el('<a href="/next">Next</a>'), click())).toBe(true);
    expect(shouldInterceptClick(el('<a href="/next" target="_self">Next</a>'), click())).toBe(true);
  });

  it('intercepts a form submit, which usually takes the page away too', () => {
    expect(shouldInterceptClick(inForm('<button>Save</button>'), click())).toBe(true);
    expect(shouldInterceptClick(inForm('<button type="submit">Save</button>'), click())).toBe(true);
    expect(shouldInterceptClick(inForm('<input type="submit" value="Save">'), click())).toBe(true);
  });

  it('leaves a toggle button alone so the page responds at once', () => {
    expect(shouldInterceptClick(el('<button aria-expanded="false">Folder</button>'), click())).toBe(false);
    expect(shouldInterceptClick(inForm('<button type="button">Show</button>'), click())).toBe(false);
    expect(shouldInterceptClick(el('<button>Copy link</button>'), click())).toBe(false);
  });

  it('leaves a link that opens a new window or a download alone, since this page stays', () => {
    expect(shouldInterceptClick(el('<a href="/next" target="_blank">Next</a>'), click())).toBe(false);
    expect(shouldInterceptClick(el('<a href="/file.pdf" download>File</a>'), click())).toBe(false);
    expect(shouldInterceptClick(el('<a href="#">Top</a>'), click())).toBe(false);
  });

  it('leaves a modified click alone so the browser can open a new tab', () => {
    expect(shouldInterceptClick(el('<a href="/next">Next</a>'), click({ metaKey: true }))).toBe(false);
    expect(shouldInterceptClick(el('<a href="/next">Next</a>'), click({ ctrlKey: true }))).toBe(false);
    expect(shouldInterceptClick(el('<a href="/next">Next</a>'), click({ shiftKey: true }))).toBe(false);
  });

  it('lets our own replayed click through untouched', () => {
    expect(shouldInterceptClick(inForm('<button>Save</button>'), click({ isTrusted: false }))).toBe(false);
  });

  it('leaves native dropdowns and checkboxes alone, which break when their click is blocked', () => {
    expect(shouldInterceptClick(el('<select><option>a</option></select>'), click())).toBe(false);
    expect(shouldInterceptClick(el('<input type="checkbox">'), click())).toBe(false);
  });

  it('leaves editable surfaces and text fields to the typing session', () => {
    const editable = el('<div contenteditable="true">notes</div>');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(shouldInterceptClick(editable, click())).toBe(false);
    expect(shouldInterceptClick(el('<input type="text">'), click())).toBe(false);
    expect(shouldInterceptClick(el('<textarea></textarea>'), click())).toBe(false);
  });
});

describe('replayInit', () => {
  it('carries the pointer position through to the replayed click', () => {
    const init = replayInit(click({ clientX: 120, clientY: 340 }));
    expect(init).toMatchObject({ clientX: 120, clientY: 340, bubbles: true, cancelable: true });
  });

  it('preserves the modifier keys the page may branch on', () => {
    const init = replayInit(click({ ctrlKey: true, metaKey: true, altKey: true, button: 1 }));
    expect(init).toMatchObject({ ctrlKey: true, metaKey: true, altKey: true, button: 1 });
  });

  it('reaches a delegated listener on the document as an untrusted click', () => {
    const button = el('<button>Copy link</button>');
    const seen: Array<{ trusted: boolean; x: number }> = [];
    document.addEventListener('click', (e) => seen.push({ trusted: e.isTrusted, x: (e as MouseEvent).clientX }), {
      once: true,
    });
    replayClick(button, replayInit(click({ clientX: 77 })));
    expect(seen).toEqual([{ trusted: false, x: 77 }]);
  });

  it('focuses the target first, the way a real click would', () => {
    const button = el('<button>Copy link</button>');
    replayClick(button, replayInit(click()));
    expect(document.activeElement).toBe(button);
  });
});
