import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElementMeta, Guide, Screenshot, Step } from '@/core/guides/types';
import { createRecording, deleteRecording, NETWORK_STATUS, PanopticApiError, searchTargets } from './panoptic-client';
import { type PublishProgress, publishGuideToPanoptic } from './publish';

const { getGuide, renderScreenshot, getAccessToken, loadPanopticConfig } = vi.hoisted(() => ({
  getGuide: vi.fn(),
  renderScreenshot: vi.fn(),
  getAccessToken: vi.fn(),
  loadPanopticConfig: vi.fn(),
}));

vi.mock('@/core/guides/service', () => ({ getGuide }));
vi.mock('@/core/screenshot/render', () => ({ renderScreenshot }));
vi.mock('@/lib/panoptic/auth', () => ({ getAccessToken }));
vi.mock('@/lib/panoptic/config', () => ({ loadPanopticConfig }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const HUB = 'http://localhost:3000';
const NEW_PAGE = { kind: 'new', category: 'process/nocodb' } as const;

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function createdResponse(stepCount: number) {
  const uploads: Record<string, string> = {};
  for (let i = 0; i < stepCount; i++) uploads[String(i)] = `/api/recordings/rec-1/steps/${i}/screenshot`;
  return jsonResponse(201, {
    id: 'rec-1',
    status: 'draft',
    stepCount,
    uploads,
    viewUrl: `${HUB}/docs`,
  });
}

function uploadedResponse(index: number) {
  return jsonResponse(200, {
    key: `recordings/rec-1/${index}.webp`,
    url: `/assets/recordings/rec-1/${index}.webp`,
    width: 1440,
    height: 812,
    bytes: 84213,
  });
}

function makeGuide(overrides: Partial<Guide> = {}): Guide {
  return {
    id: 'guide-1',
    title: 'Add a location in NocoDB',
    createdAt: 1,
    updatedAt: 2,
    stepIds: [],
    starred: false,
    deletedAt: null,
    ...overrides,
  };
}

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: 'step-1',
    guideId: 'guide-1',
    index: 0,
    description: 'Open the Locations table.',
    action: 'click',
    url: 'https://app.nocodb.com/dashboard',
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function makeElementMeta(overrides: Partial<ElementMeta> = {}): ElementMeta {
  return {
    tag: 'a',
    cssSelector: 'a.locations',
    textContent: null,
    ariaLabel: null,
    placeholder: null,
    altText: null,
    name: null,
    role: null,
    href: null,
    inputType: null,
    dataTestId: null,
    rect: { x: 0, y: 0, width: 10, height: 10 },
    devicePixelRatio: 2,
    ...overrides,
  };
}

/** The raw blob still carries the pixels the person redacted, so no test may upload it. */
function makeScreenshot(stepId: string): Screenshot {
  return {
    id: `shot-${stepId}`,
    stepId,
    blob: new Blob(['raw-and-unredacted'], { type: 'image/png' }),
    mimeType: 'image/png',
    width: 1440,
    height: 812,
  };
}

function stepsWithScreenshots(count: number): { steps: Step[]; screenshots: Map<string, Screenshot> } {
  const steps = Array.from({ length: count }, (_, i) =>
    makeStep({ id: `s${i}`, index: i, screenshotId: `shot-s${i}` }),
  );
  return { steps, screenshots: new Map(steps.map((step) => [step.id, makeScreenshot(step.id)])) };
}

const postCalls = () => fetchMock.mock.calls.filter(([, init]) => init.method === 'POST');
const putCalls = () => fetchMock.mock.calls.filter(([, init]) => init.method === 'PUT');
const postBody = () => JSON.parse(postCalls()[0][1].body as string);

/** Lets every pending microtask settle, so an assertion sees the requests in flight. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fetchMock.mockReset();
  getGuide.mockReset();
  renderScreenshot.mockReset();
  getAccessToken.mockReset();
  loadPanopticConfig.mockReset();
  loadPanopticConfig.mockReturnValue({
    hubUrl: HUB,
    kindeIssuer: 'https://panoptic.kinde.com',
    kindeClientId: 'mimik-extension',
  });
  getAccessToken.mockResolvedValue('kinde-token');
  renderScreenshot.mockImplementation(async () => new Blob(['rendered-and-redacted'], { type: 'image/webp' }));
});

describe('publishGuideToPanoptic', () => {
  it('numbers the steps by position, so a reordered guide still sends a contiguous run', async () => {
    // A guide whose steps were reordered and part deleted keeps whatever index it kept.
    // The hub refuses a gap, so 3/7/11 has to leave here as 0/1/2.
    const steps = [makeStep({ id: 'a', index: 3 }), makeStep({ id: 'b', index: 7 }), makeStep({ id: 'c', index: 11 })];
    getGuide.mockResolvedValue({ guide: makeGuide(), steps, screenshots: new Map() });
    fetchMock.mockResolvedValue(createdResponse(3));

    await publishGuideToPanoptic('guide-1', NEW_PAGE);

    expect(postBody().steps.map((step: { index: number }) => step.index)).toEqual([0, 1, 2]);
  });

  it('sends exactly the field names the recordings contract lists', async () => {
    const steps = [
      makeStep({
        id: 'a',
        index: 0,
        elementMeta: makeElementMeta({ textContent: 'Locations' }),
      }),
      makeStep({
        id: 'b',
        index: 1,
        action: 'input',
        description: 'Type the town.',
        url: 'https://app.nocodb.com/dashboard/locations',
        inputValue: 'Cork',
      }),
      makeStep({
        id: 'c',
        index: 2,
        action: 'heading',
        description: 'Before you start',
        url: '',
        blockType: 'heading',
      }),
    ];
    getGuide.mockResolvedValue({ guide: makeGuide(), steps, screenshots: new Map() });
    fetchMock.mockResolvedValue(createdResponse(3));

    await publishGuideToPanoptic('guide-1', { kind: 'page', path: 'process/nocodb/add-a-location' });

    const [url, init] = postCalls()[0];
    expect(url).toBe('http://localhost:3000/api/recordings');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers.Authorization).toBe('Bearer kinde-token');

    const body = postBody();
    expect(Object.keys(body).sort()).toEqual(['proposedCategory', 'sourceUrl', 'steps', 'targetDocPath', 'title']);
    expect(Object.keys(body.steps[0]).sort()).toEqual([
      'action',
      'blockType',
      'description',
      'elementText',
      'index',
      'inputValue',
      'url',
    ]);
    expect(body).toEqual({
      title: 'Add a location in NocoDB',
      sourceUrl: 'https://app.nocodb.com/dashboard',
      targetDocPath: 'process/nocodb/add-a-location',
      proposedCategory: null,
      steps: [
        {
          index: 0,
          action: 'click',
          description: 'Open the Locations table.',
          url: 'https://app.nocodb.com/dashboard',
          elementText: 'Locations',
          inputValue: null,
          blockType: null,
        },
        {
          index: 1,
          action: 'input',
          description: 'Type the town.',
          url: 'https://app.nocodb.com/dashboard/locations',
          elementText: null,
          inputValue: 'Cork',
          blockType: null,
        },
        {
          index: 2,
          action: 'heading',
          description: 'Before you start',
          url: '',
          elementText: null,
          inputValue: null,
          blockType: 'heading',
        },
      ],
    });
  });

  it('proposes a category instead of a page when the target is a page nobody has written', async () => {
    getGuide.mockResolvedValue({ guide: makeGuide(), steps: [makeStep()], screenshots: new Map() });
    fetchMock.mockResolvedValue(createdResponse(1));

    await publishGuideToPanoptic('guide-1', NEW_PAGE);

    expect(postBody().targetDocPath).toBeNull();
    expect(postBody().proposedCategory).toBe('process/nocodb');
  });

  it("uploads what renderScreenshot produced, under the blob's own content type", async () => {
    const screenshot = makeScreenshot('a');
    getGuide.mockResolvedValue({
      guide: makeGuide(),
      steps: [makeStep({ id: 'a', screenshotId: 'shot-a' })],
      screenshots: new Map([['a', screenshot]]),
    });
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(init.method === 'POST' ? createdResponse(1) : uploadedResponse(0)),
    );

    const result = await publishGuideToPanoptic('guide-1', NEW_PAGE);

    // The render is what applies the blur and the crop. Anything else on the wire is a leak.
    expect(renderScreenshot).toHaveBeenCalledWith(screenshot, { format: 'image/webp' });
    const [url, init] = putCalls()[0];
    expect(url).toBe('http://localhost:3000/api/recordings/rec-1/steps/0/screenshot');
    expect(init.headers['Content-Type']).toBe('image/webp');
    expect(await (init.body as Blob).text()).toBe('rendered-and-redacted');
    expect(result).toEqual({ id: 'rec-1', uploaded: 1, failed: [] });
  });

  it('sends a block step with the others and uploads nothing for it', async () => {
    const steps = [
      makeStep({ id: 'a', index: 0, screenshotId: 'shot-a' }),
      makeStep({ id: 'b', index: 1, action: 'callout', blockType: 'callout', url: '' }),
    ];
    getGuide.mockResolvedValue({
      guide: makeGuide(),
      steps,
      screenshots: new Map([['a', makeScreenshot('a')]]),
    });
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(init.method === 'POST' ? createdResponse(2) : uploadedResponse(0)),
    );

    const progress: PublishProgress[] = [];
    const result = await publishGuideToPanoptic('guide-1', NEW_PAGE, { onProgress: (p) => progress.push(p) });

    expect(postBody().steps).toHaveLength(2);
    expect(putCalls()).toHaveLength(1);
    expect(result).toEqual({ id: 'rec-1', uploaded: 1, failed: [] });
    expect(progress).toEqual([
      { phase: 'steps', uploaded: 0, total: 1 },
      { phase: 'screenshots', uploaded: 0, total: 1 },
      { phase: 'screenshots', uploaded: 1, total: 1 },
      { phase: 'done', uploaded: 1, total: 1 },
    ]);
  });

  it('retries a 5xx once, then records the step as failed rather than losing the rest', async () => {
    const { steps, screenshots } = stepsWithScreenshots(2);
    getGuide.mockResolvedValue({ guide: makeGuide(), steps, screenshots });
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (init.method === 'POST') return Promise.resolve(createdResponse(2));
      if (url.endsWith('/steps/0/screenshot')) return Promise.resolve(jsonResponse(503, { error: 'Hub restarting.' }));
      return Promise.resolve(uploadedResponse(1));
    });

    const result = await publishGuideToPanoptic('guide-1', NEW_PAGE);

    expect(putCalls().filter(([url]) => url.endsWith('/steps/0/screenshot'))).toHaveLength(2);
    expect(result).toEqual({ id: 'rec-1', uploaded: 1, failed: [0] });
  });

  it('retries a dropped connection once', async () => {
    const { steps, screenshots } = stepsWithScreenshots(1);
    getGuide.mockResolvedValue({ guide: makeGuide(), steps, screenshots });
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      init.method === 'POST' ? Promise.resolve(createdResponse(1)) : Promise.reject(new TypeError('Failed to fetch')),
    );

    const result = await publishGuideToPanoptic('guide-1', NEW_PAGE);

    expect(putCalls()).toHaveLength(2);
    expect(result.failed).toEqual([0]);
  });

  it('does not retry a refusal the hub will repeat', async () => {
    const { steps, screenshots } = stepsWithScreenshots(1);
    getGuide.mockResolvedValue({ guide: makeGuide(), steps, screenshots });
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(
        init.method === 'POST' ? createdResponse(1) : jsonResponse(413, { error: 'Screenshot too big.' }),
      ),
    );

    const result = await publishGuideToPanoptic('guide-1', NEW_PAGE);

    expect(putCalls()).toHaveLength(1);
    expect(result).toEqual({ id: 'rec-1', uploaded: 0, failed: [0] });
  });

  it('claims no further screenshots once the caller aborts', async () => {
    const { steps, screenshots } = stepsWithScreenshots(5);
    getGuide.mockResolvedValue({ guide: makeGuide(), steps, screenshots });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (init.method === 'POST') return createdResponse(5);
      await gate;
      return uploadedResponse(Number(url.split('/steps/')[1].split('/')[0]));
    });

    const controller = new AbortController();
    const publishing = publishGuideToPanoptic('guide-1', NEW_PAGE, { signal: controller.signal });
    await flush();

    // Three at a time, so three are in flight and two have not been claimed yet.
    expect(putCalls()).toHaveLength(3);
    controller.abort();
    release();

    const result = await publishing;

    expect(putCalls()).toHaveLength(3);
    expect(result.uploaded).toBe(3);
    expect(result.failed).toEqual([3, 4]);
  });

  it('uploads no more than three at a time', async () => {
    const { steps, screenshots } = stepsWithScreenshots(9);
    getGuide.mockResolvedValue({ guide: makeGuide(), steps, screenshots });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') return createdResponse(9);
      await gate;
      return uploadedResponse(0);
    });

    const publishing = publishGuideToPanoptic('guide-1', NEW_PAGE);
    await flush();
    expect(putCalls()).toHaveLength(3);

    release();
    const result = await publishing;

    expect(putCalls()).toHaveLength(9);
    expect(result).toEqual({ id: 'rec-1', uploaded: 9, failed: [] });
  });

  it('marks a step failed when the hub gave it no upload path', async () => {
    const { steps, screenshots } = stepsWithScreenshots(2);
    getGuide.mockResolvedValue({ guide: makeGuide(), steps, screenshots });
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(init.method === 'POST' ? createdResponse(1) : uploadedResponse(0)),
    );

    const result = await publishGuideToPanoptic('guide-1', NEW_PAGE);

    expect(putCalls()).toHaveLength(1);
    expect(result).toEqual({ id: 'rec-1', uploaded: 1, failed: [1] });
  });

  it('clamps a title the hub would refuse outright', async () => {
    getGuide.mockResolvedValue({
      guide: makeGuide({ title: 'x'.repeat(400) }),
      steps: [makeStep()],
      screenshots: new Map(),
    });
    fetchMock.mockResolvedValue(createdResponse(1));

    await publishGuideToPanoptic('guide-1', NEW_PAGE);

    expect(postBody().title).toHaveLength(200);
  });

  it('does not cut an emoji in half while clamping the title', async () => {
    // One letter then emoji, so the 200th code unit is the first half of the hundredth
    // one. The orphan is not valid UTF-8 and Postgres refuses the insert, so the clamp
    // meant to save the publish would be what kills it.
    getGuide.mockResolvedValue({
      guide: makeGuide({ title: `x${'👍'.repeat(150)}` }),
      steps: [makeStep()],
      screenshots: new Map(),
    });
    fetchMock.mockResolvedValue(createdResponse(1));

    await publishGuideToPanoptic('guide-1', NEW_PAGE);

    const title = postBody().title;
    expect(title).toBe(`x${'👍'.repeat(99)}`);
    expect(title).toHaveLength(199);
  });

  it('refuses a guide with no steps without spending a round trip', async () => {
    getGuide.mockResolvedValue({ guide: makeGuide(), steps: [], screenshots: new Map() });

    await expect(publishGuideToPanoptic('guide-1', NEW_PAGE)).rejects.toThrow(/no steps/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a guide id that is not in the database', async () => {
    getGuide.mockResolvedValue(null);

    await expect(publishGuideToPanoptic('gone', NEW_PAGE)).rejects.toThrow(/gone/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('panoptic client', () => {
  const minimal = { title: 'Add a location in NocoDB', steps: [] };

  it('tells the person to sign in again rather than repeating Unauthorized', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));

    const err = await createRecording(minimal).catch((e) => e);

    expect(err).toBeInstanceOf(PanopticApiError);
    expect(err.status).toBe(401);
    expect(err.message).toBe('Your Panoptic Docs sign-in has run out. Sign in again, then publish.');
  });

  it('does not send a request at all when there is no token to send', async () => {
    getAccessToken.mockResolvedValue(null);

    const err = await createRecording(minimal).catch((e) => e);

    expect(err.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the sentence the hub wrote for any other refusal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, { error: 'No page at process/nocodb/nope.' }));

    const err = await createRecording(minimal).catch((e) => e);

    expect(err.status).toBe(422);
    expect(err.message).toBe('No page at process/nocodb/nope.');
  });

  it("falls back to the status when the refusal is not the hub's own JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });

    const err = await createRecording(minimal).catch((e) => e);

    expect(err.message).toBe('Panoptic Docs refused the request (502).');
  });

  it('reports a request that never arrived as a network failure, not a refusal', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const err = await createRecording(minimal).catch((e) => e);

    expect(err).toBeInstanceOf(PanopticApiError);
    expect(err.status).toBe(NETWORK_STATUS);
    expect(err.message).toMatch(/Check your connection/);
  });

  it('reports a 200 that is not JSON as a network failure rather than a parser message', async () => {
    // A dropped connection part way through the answer, or a proxy replying for the hub.
    // "Unexpected token <" is not something a person can act on.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });

    const err = await createRecording(minimal).catch((e) => e);

    expect(err).toBeInstanceOf(PanopticApiError);
    expect(err.status).toBe(NETWORK_STATUS);
    expect(err.message).toMatch(/Check your connection/);
  });

  it('lets a cancel through as it came, so a cancelled publish is not read as an outage', async () => {
    // PublishDialog matches on the name to tell a cancel from a failure. Wrapping the
    // abort here would show "Could not reach Panoptic Docs" every time somebody cancels.
    fetchMock.mockRejectedValue(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }));

    const err = await createRecording(minimal).catch((e) => e);

    expect(err).not.toBeInstanceOf(PanopticApiError);
    expect(err.name).toBe('AbortError');
  });

  it('reads no body from the 204 the hub answers a delete with', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });

    await expect(deleteRecording('rec-1')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/recordings/rec-1');
    expect(init.method).toBe('DELETE');
  });

  it('asks the hub for targets at the path the contract names', async () => {
    // The extension never speaks the search API's own shape, so this one URL is the
    // whole agreement. A drift here fails as an empty picker with no error.
    fetchMock.mockResolvedValue(jsonResponse(200, { pages: [], categories: ['process/nocodb'] }));

    const found = await searchTargets('noco db');

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/recordings/targets?query=noco+db');
    expect(found.categories).toEqual(['process/nocodb']);
  });
});
