import { getAccessToken } from '@/lib/panoptic/auth';
import { loadPanopticConfig } from '@/lib/panoptic/config';

export type RecordingStatus = 'draft' | 'attached' | 'archived';

/** One step as the hub stores it. Field names are fixed by the recordings contract. */
export interface RecordingStep {
  index: number;
  action: string;
  description: string;
  url: string;
  elementText: string | null;
  inputValue: string | null;
  blockType: 'heading' | 'callout' | null;
}

export interface CreateRecordingRequest {
  title: string;
  sourceUrl?: string;
  targetDocPath?: string | null;
  proposedCategory?: string | null;
  steps: RecordingStep[];
}

export interface CreatedRecording {
  id: string;
  status: RecordingStatus;
  stepCount: number;
  /**
   * Step index (as a string key) to the path its screenshot is PUT to. The hub sends a
   * map rather than a template so nothing on this side ever assembles an upload URL.
   */
  uploads: Record<string, string>;
  viewUrl: string;
}

export interface RecordingSummary {
  id: string;
  title: string;
  sourceDomain: string | null;
  status: RecordingStatus;
  targetDocPath: string | null;
  proposedCategory: string | null;
  stepCount: number;
  screenshotCount: number;
  createdAt: string;
  updatedAt: string;
  owner: { email: string; name: string };
}

export interface RecordingScreenshot {
  url: string;
  width: number;
  height: number;
}

export interface RecordingStepDetail extends RecordingStep {
  screenshot: RecordingScreenshot | null;
}

export interface RecordingDetail {
  recording: RecordingSummary;
  steps: RecordingStepDetail[];
}

export interface ScreenshotUpload {
  key: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
}

export interface RecordingPatch {
  title?: string;
  targetDocPath?: string | null;
  proposedCategory?: string | null;
  status?: RecordingStatus;
}

export interface TargetPage {
  path: string;
  title: string;
  section: string;
}

export interface TargetSearch {
  pages: TargetPage[];
  categories: string[];
}

/**
 * The status on a PanopticApiError when the request never reached the hub at all, so a
 * caller deciding whether to retry can treat "no answer" and "the hub fell over" alike.
 */
export const NETWORK_STATUS = 0;

export class PanopticApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PanopticApiError';
    this.status = status;
  }
}

const SIGN_IN_AGAIN = 'Your Panoptic Docs sign-in has run out. Sign in again, then publish.';
const UNREACHABLE = 'Could not reach Panoptic Docs. Check your connection, then try again.';

function joinUrl(hubUrl: string, path: string): string {
  const base = hubUrl.replace(/\/+$/, '');
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

async function refusalMessage(res: Response): Promise<string> {
  // Every hub refusal carries { error: "<one sentence the person can act on>" }, and that
  // sentence names the page or the tier at fault. Anything we invent here would be vaguer.
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === 'string' && body.error.trim()) return body.error.trim();
  } catch {
    // A proxy in front of the hub can answer with HTML, so fall through to the status.
  }
  return `Panoptic Docs refused the request (${res.status}).`;
}

interface RequestOptions {
  method: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions): Promise<T> {
  const { hubUrl } = await loadPanopticConfig();
  const token = await getAccessToken();
  if (!token) throw new PanopticApiError(401, SIGN_IN_AGAIN);

  let res: Response;
  try {
    res = await fetch(joinUrl(hubUrl, path), {
      method: opts.method,
      headers: { ...opts.headers, Authorization: `Bearer ${token}` },
      body: opts.body,
      signal: opts.signal,
    });
  } catch (err) {
    // An abort is the caller's own doing. Wrapping it would make a publish the person
    // cancelled look like a hub outage, and would send it down the retry path.
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new PanopticApiError(NETWORK_STATUS, UNREACHABLE);
  }

  if (!res.ok) {
    // A 401 means one of two things, and both are fixed by the same act: the token has
    // run out, or the hub has never seen this person. Say so. "Unauthorized", which is
    // what anything sitting in front of the hub will say, tells them nothing to do.
    if (res.status === 401) throw new PanopticApiError(401, SIGN_IN_AGAIN);
    throw new PanopticApiError(res.status, await refusalMessage(res));
  }

  // DELETE answers 204 with no body, and calling res.json() on it throws.
  if (res.status === 204) return undefined as T;

  try {
    return (await res.json()) as T;
  } catch (err) {
    // A 200 whose body is not the hub's JSON is a connection that dropped part way
    // through the answer, or a proxy answering in the hub's place. Letting the parser's
    // own message out would put "Unexpected token <" in front of the person and would
    // break the one rule every caller here relies on: a failure is a PanopticApiError
    // carrying a sentence, and only a cancel comes through as anything else.
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new PanopticApiError(NETWORK_STATUS, UNREACHABLE);
  }
}

export async function createRecording(
  payload: CreateRecordingRequest,
  opts: { signal?: AbortSignal } = {},
): Promise<CreatedRecording> {
  return request<CreatedRecording>('/api/recordings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: opts.signal,
  });
}

/**
 * `uploadPath` must be a value out of `CreatedRecording.uploads`, never a string built
 * here. The hub owns the shape of that route and can move it without telling us.
 */
export async function uploadScreenshot(
  uploadPath: string,
  blob: Blob,
  opts: { signal?: AbortSignal } = {},
): Promise<ScreenshotUpload> {
  // The hub checks the image's magic bytes against Content-Type and refuses a mismatch,
  // so the header has to be what the blob actually is rather than what we hoped for.
  return request<ScreenshotUpload>(uploadPath, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type },
    body: blob,
    signal: opts.signal,
  });
}

export async function listRecordings(
  opts: { status?: RecordingStatus; mine?: boolean; signal?: AbortSignal } = {},
): Promise<RecordingSummary[]> {
  const params = new URLSearchParams();
  // Omitting status is not the same as asking for one: the hub's default is draft and
  // attached together, which no single value can express.
  if (opts.status) params.set('status', opts.status);
  if (opts.mine !== undefined) params.set('mine', String(opts.mine));
  const query = params.toString();
  const { recordings } = await request<{ recordings: RecordingSummary[] }>(
    query ? `/api/recordings?${query}` : '/api/recordings',
    { method: 'GET', signal: opts.signal },
  );
  return recordings;
}

export async function getRecording(id: string, opts: { signal?: AbortSignal } = {}): Promise<RecordingDetail> {
  return request<RecordingDetail>(`/api/recordings/${encodeURIComponent(id)}`, {
    method: 'GET',
    signal: opts.signal,
  });
}

export async function patchRecording(
  id: string,
  patch: RecordingPatch,
  opts: { signal?: AbortSignal } = {},
): Promise<RecordingSummary> {
  const { recording } = await request<{ recording: RecordingSummary }>(`/api/recordings/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    signal: opts.signal,
  });
  return recording;
}

export async function deleteRecording(id: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
  await request<void>(`/api/recordings/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal: opts.signal,
  });
}

export async function searchTargets(query: string, opts: { signal?: AbortSignal } = {}): Promise<TargetSearch> {
  const params = new URLSearchParams({ query });
  return request<TargetSearch>(`/api/recordings/targets?${params.toString()}`, {
    method: 'GET',
    signal: opts.signal,
  });
}
