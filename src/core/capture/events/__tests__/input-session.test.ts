// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '@/lib/messaging';
import { type CaptureHandle, startCapture } from '../handlers';

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn(), onMessage: vi.fn() }));

vi.mock('@/lib/browser-api', () => ({
  localStorage: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
}));

interface Deferred {
  type: string;
  resolve: () => void;
}

let pending: Deferred[];
let handle: CaptureHandle;
let nextStep = 1;

function placeField(): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'text';
  el.setAttribute('aria-label', 'Search');
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ x: 4, y: 6, top: 6, left: 4, right: 124, bottom: 46, width: 120, height: 40 }),
  });
  document.body.appendChild(el);
  return el;
}

function type(field: HTMLInputElement, value: string) {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

function userClick(el: Element) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 20 });
  Object.defineProperty(event, 'isTrusted', { configurable: true, value: true });
  el.dispatchEvent(event);
}

async function settle(turns = 16) {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function calls(type: string) {
  return vi.mocked(sendMessage).mock.calls.filter((c) => c[0] === type);
}

function answerAll() {
  for (const d of pending.splice(0)) d.resolve();
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  });
  pending = [];
  nextStep = 1;
  vi.mocked(sendMessage).mockClear();
  vi.mocked(sendMessage).mockImplementation(((type: string) => {
    return new Promise((resolve) => {
      const id = `step-${nextStep++}`;
      pending.push({
        type,
        resolve: () => resolve(type === 'captureStep' ? { stepId: id } : { updated: true }),
      });
    });
  }) as unknown as typeof sendMessage);
  handle = startCapture('guide-1');
});

afterEach(() => {
  handle.stop();
  answerAll();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('typing into one field', () => {
  it('opens a single step when keystrokes arrive faster than the background answers', async () => {
    const field = placeField();

    type(field, 'a');
    type(field, 'ab');
    type(field, 'abc');
    await settle();

    expect(calls('captureStep')).toHaveLength(1);

    answerAll();
    await settle();

    // The queue catching up must not open a second step for the same field.
    expect(calls('captureStep')).toHaveLength(1);
    const updates = calls('updateInputStep');
    expect(updates.at(-1)?.[1]).toMatchObject({ stepId: 'step-1', description: 'Type "abc" in Search' });
  });

  it('opens a single step when the field is clicked and then typed into', async () => {
    const field = placeField();

    userClick(field);
    type(field, 'a');
    await settle();
    answerAll();
    await settle();
    type(field, 'ab');
    await settle();

    expect(calls('captureStep')).toHaveLength(1);
    expect(calls('updateInputStep').at(-1)?.[1]).toMatchObject({ description: 'Type "ab" in Search' });
  });

  it('finalizes the step on Enter even if the background has not answered yet', async () => {
    const field = placeField();

    type(field, 'abc');
    await settle();
    expect(calls('captureStep')).toHaveLength(1);

    // The step is still being opened when Enter lands.
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(calls('finalizeInputStep')).toHaveLength(0);

    answerAll();
    await settle();
    answerAll();
    await settle();

    expect(calls('captureStep')).toHaveLength(1);
    expect(calls('finalizeInputStep')).toHaveLength(1);
    expect(calls('finalizeInputStep')[0][1]).toMatchObject({ stepId: 'step-1' });
  });
});
