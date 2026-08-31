import { getGuide } from '@/core/guides/service';
import type { Screenshot, Step } from '@/core/guides/types';
import { renderScreenshot } from '@/core/screenshot/render';
import {
  type CreatedRecording,
  type CreateRecordingRequest,
  createRecording,
  NETWORK_STATUS,
  PanopticApiError,
  type RecordingStep,
  uploadScreenshot,
} from './panoptic-client';

/**
 * Where the recording is headed. `page` attaches it to a page that already exists,
 * `new` proposes a folder for a page nobody has written yet.
 */
export type PublishTarget = { kind: 'page'; path: string } | { kind: 'new'; category: string };

export interface PublishProgress {
  phase: 'steps' | 'screenshots' | 'done';
  uploaded: number;
  total: number;
}

export interface PublishResult {
  id: string;
  uploaded: number;
  /** Recording indices whose screenshot never reached the hub. */
  failed: number[];
}

export interface PublishOptions {
  signal?: AbortSignal;
  onProgress?: (progress: PublishProgress) => void;
}

/**
 * Three at a time. The screenshots are large and the hub converts each one to WebP as it
 * arrives, so a wider fan-out buys nothing and makes a slow connection worse.
 */
const UPLOAD_CONCURRENCY = 3;
const UPLOAD_ATTEMPTS = 2;
const MAX_TITLE_LENGTH = 200;
const FALLBACK_TITLE = 'Untitled guide';

function elementText(step: Step): string | null {
  const meta = step.elementMeta;
  if (!meta) return null;
  // Whatever a person would have read on the thing they clicked, in the order they would
  // have read it. An agent writing the process document has nothing else to name it by.
  for (const candidate of [meta.textContent, meta.ariaLabel, meta.altText, meta.placeholder, meta.name]) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function toRecordingSteps(steps: Step[]): RecordingStep[] {
  // Number the steps by their position in this array, not by step.index. The API refuses
  // a gap or a duplicate, and a guide's stored index is only contiguous until somebody
  // reorders or deletes a step, so the position is the one thing we know holds.
  return steps.map((step, position) => ({
    index: position,
    action: step.action,
    description: step.description,
    url: step.url,
    elementText: elementText(step),
    inputValue: step.inputValue ?? null,
    blockType: step.blockType ?? null,
  }));
}

function recordingTitle(title: string): string {
  // The hub truncates every other string at 4000 characters but refuses an over-long
  // title outright, so clamp it here rather than lose the whole publish to a 422.
  const trimmed = title.trim();
  if (!trimmed) return FALLBACK_TITLE;
  if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed;

  const clamped = trimmed.slice(0, MAX_TITLE_LENGTH);
  // Cutting at a fixed offset can land between the two halves of an emoji. The half left
  // behind is not valid UTF-8, Postgres refuses the insert, and the publish then dies on
  // the very title this clamp exists to save. Drop the orphan rather than send it.
  const last = clamped.charCodeAt(MAX_TITLE_LENGTH - 1);
  return last >= 0xd800 && last <= 0xdbff ? clamped.slice(0, -1) : clamped;
}

interface PendingUpload {
  index: number;
  screenshot: Screenshot;
}

function pendingUploads(steps: Step[], screenshots: Map<string, Screenshot>): PendingUpload[] {
  const pending: PendingUpload[] = [];
  // Same positions toRecordingSteps counts from, so `index` here is the recording index.
  // A heading or a callout block carries no screenshot and simply costs no upload.
  steps.forEach((step, position) => {
    const screenshot = screenshots.get(step.id);
    if (screenshot) pending.push({ index: position, screenshot });
  });
  return pending;
}

function isRetryable(err: unknown): boolean {
  // A 4xx is the hub telling us this particular screenshot is wrong (too large, wrong
  // type) and it will say the same thing again. Only an outage or a dropped connection
  // is worth a second attempt.
  return err instanceof PanopticApiError && (err.status === NETWORK_STATUS || err.status >= 500);
}

async function uploadOne(
  created: CreatedRecording,
  pending: PendingUpload,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const uploadPath = created.uploads[String(pending.index)];
  // The hub hands back one path per step so that nothing here builds a URL. A missing
  // entry means the two sides disagree about the step count, and guessing would hide it.
  if (!uploadPath) return false;

  let blob: Blob;
  try {
    // renderScreenshot, never screenshot.blob. The stored blob still holds the pixels the
    // person redacted; the blur and the crop live in screenshot.edits and are only applied
    // by this render. Uploading the raw blob would send the hub exactly the personal data
    // they asked us to hide. Format is pinned because the hub accepts webp, png or jpeg
    // and a change to the renderer's default must not quietly start failing every upload.
    blob = await renderScreenshot(pending.screenshot, { format: 'image/webp' });
  } catch {
    // A screenshot we cannot decode will not decode on a second attempt either.
    return false;
  }

  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    if (signal?.aborted) return false;
    try {
      await uploadScreenshot(uploadPath, blob, { signal });
      return true;
    } catch (err) {
      if (!isRetryable(err) || attempt === UPLOAD_ATTEMPTS) return false;
    }
  }
  return false;
}

/**
 * Sends one guide to Panoptic Docs as a recording: the ordered steps first, then a
 * rendered screenshot for each step that has one.
 *
 * A screenshot that will not upload is collected into `failed` rather than aborting the
 * run, because eleven of twelve screenshots is still worth having and the recording can
 * be finished later against the id this returns.
 */
export async function publishGuideToPanoptic(
  guideId: string,
  target: PublishTarget,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  const loaded = await getGuide(guideId);
  if (!loaded) throw new Error(`No guide with id ${guideId}.`);

  const { guide, steps, screenshots } = loaded;
  // The API needs at least one step. Saying so now saves a round trip to be told the
  // same thing about a guide the person can see is empty.
  if (steps.length === 0) throw new Error('This guide has no steps to publish.');

  const pending = pendingUploads(steps, screenshots);
  const total = pending.length;
  const report = (phase: PublishProgress['phase'], uploaded: number) => opts.onProgress?.({ phase, uploaded, total });

  report('steps', 0);

  const payload: CreateRecordingRequest = {
    title: recordingTitle(guide.title),
    targetDocPath: target.kind === 'page' ? target.path : null,
    proposedCategory: target.kind === 'new' ? target.category : null,
    steps: toRecordingSteps(steps),
  };
  // The hub derives sourceDomain from this and ignores a URL it cannot parse, so the
  // first step that recorded one is enough. Block steps carry an empty url.
  const source = steps.find((step) => step.url)?.url;
  if (source) payload.sourceUrl = source;

  const created = await createRecording(payload, { signal: opts.signal });

  report('screenshots', 0);

  const failed: number[] = [];
  let uploaded = 0;
  let next = 0;

  const worker = async () => {
    while (next < pending.length) {
      // A publish the person cancelled must stop spending their bandwidth, so check here
      // before claiming the next screenshot and not only once at the top.
      if (opts.signal?.aborted) return;
      const entry = pending[next++];
      if (await uploadOne(created, entry, opts.signal)) {
        uploaded += 1;
        report('screenshots', uploaded);
      } else {
        failed.push(entry.index);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pending.length) }, worker));

  // Whatever the workers never claimed did not reach the hub either, so it belongs in
  // failed alongside the attempts that were refused. The caller holds the signal and can
  // tell a cancelled run from a partly refused one without us returning a second flag.
  for (const entry of pending.slice(next)) failed.push(entry.index);
  failed.sort((a, b) => a - b);

  report('done', uploaded);

  return { id: created.id, uploaded, failed };
}
