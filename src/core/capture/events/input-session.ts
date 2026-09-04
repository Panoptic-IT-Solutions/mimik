import { logger } from '@/lib/logger';
import { sendMessage } from '@/lib/messaging';
import { extractDOMContext } from '../dom/context';
import { extractElementMeta, type FrozenRect, freezeRect } from '../dom/element-meta';
import { getFieldLabel, getFieldValue } from '../dom/element-utils';

export class InputSession {
  stepId: string | null = null;
  target: HTMLElement | null = null;

  private guideId: string;
  private atEvent: FrozenRect | undefined;
  private starting: Promise<void> | null = null;

  constructor(guideId: string) {
    this.guideId = guideId;
  }

  /**
   * True from the moment a session is asked for, not from when the background answers.
   *
   * Keystrokes arrive faster than a screenshot round trip, so the second keystroke into
   * a field used to find no session yet and open another one. That is how one field
   * ended up as two "Type into" steps a second apart.
   */
  get active() {
    return this.stepId !== null || this.starting !== null;
  }

  start(target: HTMLElement, atEvent?: FrozenRect): Promise<void> {
    if (this.active) return this.starting ?? Promise.resolve();
    this.target = target;
    this.atEvent = atEvent;
    this.starting = this.open(target, atEvent).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async open(target: HTMLElement, atEvent?: FrozenRect) {
    const res = await sendMessage('captureStep', {
      guideId: this.guideId,
      action: 'input',
      elementMeta: extractElementMeta(target, atEvent),
      domContext: extractDOMContext(target, 'input'),
    });
    if ('stepId' in res) {
      this.stepId = res.stepId;
      // Anything typed while the step was being opened was dropped by update(), so the
      // description catches up with the field as it stands now.
      if (getFieldValue(target)) this.update(target);
    } else {
      this.target = null;
      this.atEvent = undefined;
    }
  }

  update(target: HTMLElement) {
    if (!this.stepId) return;
    this.atEvent = freezeRect(target);
    const val = getFieldValue(target);
    const desc = val ? `Type "${val}" in ${getFieldLabel(target)}` : `Clear ${getFieldLabel(target)}`;
    sendMessage('updateInputStep', { stepId: this.stepId, description: desc, inputValue: val || undefined }).catch(
      (err) => logger.warn('Failed to update input step', err),
    );
  }

  async finalize() {
    // A session still waiting on the background has nothing to finalize yet, but it will
    // in a moment, so wait for it rather than leave the step open.
    if (this.starting) await this.starting;
    if (!this.target || !this.stepId) return;
    const target = this.target;
    const stepId = this.stepId;
    const atEvent = this.atEvent;
    this.stepId = null;
    this.target = null;
    this.atEvent = undefined;
    await sendMessage('finalizeInputStep', {
      stepId,
      elementMeta: extractElementMeta(target, atEvent),
      domContext: extractDOMContext(target, 'input'),
    });
  }
}
