import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from '#imports';
import {
  createPkcePair,
  currentIdentity,
  getAccessToken,
  PANOPTIC_SESSION_KEY,
  pkceChallenge,
  signIn,
  signOut,
} from './auth';
import { HUB_URL_KEY, KINDE_CLIENT_ID_KEY, KINDE_ISSUER_KEY } from './config';

const ISSUER = 'https://panoptic.kinde.com';
// What Chrome hands back: always with a trailing slash.
const REDIRECT_URL = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';
// What Kinde stores and therefore what has to be sent. See `callbackUrl`.
const CALLBACK = REDIRECT_URL.replace(/\/+$/, '');

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

type LaunchFlow = (details: { url: string; interactive?: boolean }) => Promise<string | undefined>;
const launchFlow = vi.fn<LaunchFlow>();

function idToken(claims: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
}

function jsonResponse(body: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => body };
}

function bodyOf(call: unknown[]): URLSearchParams {
  return new URLSearchParams((call[1] as { body: string }).body);
}

/** Lets every caller already started get as far as the network. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function expiringSession(refreshToken: string) {
  return {
    accessToken: 'stale',
    // Inside the 60 second margin, so a caller wants a new token.
    expiresAt: Date.now() + 5_000,
    email: 'donnacha@panoptic.ie',
    name: 'Donnacha Gutteridge',
    refreshToken,
  };
}

describe('panoptic auth', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    launchFlow.mockReset();
    await browser.storage.local.remove(PANOPTIC_SESSION_KEY);
    await browser.storage.local.set({
      [HUB_URL_KEY]: 'https://docs.panoptic.tools',
      [KINDE_ISSUER_KEY]: ISSUER,
      [KINDE_CLIENT_ID_KEY]: 'panoptic-extension',
    });
    vi.spyOn(browser.identity, 'getRedirectURL').mockReturnValue(REDIRECT_URL);
    vi.spyOn(browser.identity, 'launchWebAuthFlow').mockImplementation(launchFlow as never);
  });

  describe('PKCE', () => {
    it('derives the challenge in RFC 7636 appendix B from its verifier', async () => {
      const challenge = await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
      expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });

    it('emits base64url with no padding and no + or /', async () => {
      for (let i = 0; i < 25; i++) {
        const { verifier, challenge } = await createPkcePair();
        expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
        // RFC 7636 section 4.1 caps the verifier at 43..128 characters.
        expect(verifier.length).toBeGreaterThanOrEqual(43);
        expect(verifier.length).toBeLessThanOrEqual(128);
      }
    });
  });

  describe('signIn', () => {
    it('exchanges the code and stores who signed in', async () => {
      launchFlow.mockImplementation(async ({ url }) => {
        const state = new URL(url).searchParams.get('state');
        return `${REDIRECT_URL}?code=auth-code&state=${state}`;
      });
      fetchMock.mockResolvedValue(
        jsonResponse({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          id_token: idToken({ email: 'donnacha@panoptic.ie', given_name: 'Donnacha', family_name: 'Gutteridge' }),
        }),
      );

      expect(await signIn()).toEqual({ email: 'donnacha@panoptic.ie', name: 'Donnacha Gutteridge' });

      const asked = new URL(launchFlow.mock.calls[0][0].url).searchParams;
      expect(asked.get('response_type')).toBe('code');
      // Kinde trims the trailing slash when it stores an allowed callback and
      // then compares redirect_uri exactly, so sending Chrome's own form is
      // refused as an invalid callback URL however it is typed into Kinde.
      expect(asked.get('redirect_uri')).toBe(CALLBACK);
      expect(asked.get('code_challenge_method')).toBe('S256');
      // The exchange has to repeat the redirect_uri byte for byte, so a
      // mismatch between the two calls fails at the token endpoint rather than
      // at the visible sign-in screen.
      const exchanged = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
      expect(exchanged.get('redirect_uri')).toBe(CALLBACK);
      expect(asked.get('scope')).toBe('openid profile email offline');

      const sent = bodyOf(fetchMock.mock.calls[0]);
      expect(fetchMock.mock.calls[0][0]).toBe(`${ISSUER}/oauth2/token`);
      expect(sent.get('grant_type')).toBe('authorization_code');
      expect(sent.get('code')).toBe('auth-code');
      // The verifier sent must be the one the challenge was derived from, or
      // Kinde rejects the exchange.
      expect(await pkceChallenge(sent.get('code_verifier') ?? '')).toBe(asked.get('code_challenge'));

      expect(await currentIdentity()).toEqual({ email: 'donnacha@panoptic.ie', name: 'Donnacha Gutteridge' });
      expect(await getAccessToken()).toBe('access-1');
    });

    it('refuses a reply whose state does not match the request', async () => {
      launchFlow.mockImplementation(async () => `${REDIRECT_URL}?code=injected-code&state=someone-elses-state`);

      await expect(signIn()).rejects.toThrow(/did not match/);
      // The code must never be spent, so no exchange may have been attempted.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await currentIdentity()).toBeNull();
    });
  });

  describe('getAccessToken', () => {
    it('refreshes once when two callers ask at the same time', async () => {
      await browser.storage.local.set({ [PANOPTIC_SESSION_KEY]: expiringSession('refresh-1') });

      let release: (value: unknown) => void = () => {};
      fetchMock.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );

      const both = Promise.all([getAccessToken(), getAccessToken()]);
      await tick();
      release(jsonResponse({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }));

      expect(await both).toEqual(['access-2', 'access-2']);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const sent = bodyOf(fetchMock.mock.calls[0]);
      expect(sent.get('grant_type')).toBe('refresh_token');
      expect(sent.get('refresh_token')).toBe('refresh-1');

      const stored = (await browser.storage.local.get([PANOPTIC_SESSION_KEY])) as Record<
        string,
        { refreshToken: string }
      >;
      // Kinde rotates the refresh token, so the replacement has to be kept or
      // the next refresh spends a token that has already been retired.
      expect(stored[PANOPTIC_SESSION_KEY].refreshToken).toBe('refresh-2');
    });

    it('does not let a refresh that outlived a sign-out retire the one after it', async () => {
      const releases: Array<(value: unknown) => void> = [];
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            releases.push(resolve);
          }),
      );

      await browser.storage.local.set({ [PANOPTIC_SESSION_KEY]: expiringSession('refresh-1') });
      const abandoned = getAccessToken();
      await tick();

      await signOut();
      await browser.storage.local.set({ [PANOPTIC_SESSION_KEY]: expiringSession('refresh-2') });

      const second = getAccessToken();
      await tick();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // The first refresh lands after the second one started. It must not clear
      // the shared slot, or the caller behind it spends refresh-2 a second time
      // and Kinde refuses the one that lands second.
      releases[0](jsonResponse({ access_token: 'access-old', expires_in: 3600 }));
      await expect(abandoned).resolves.toBeNull();

      const third = getAccessToken();
      await tick();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      releases[1](jsonResponse({ access_token: 'access-new', refresh_token: 'refresh-3', expires_in: 3600 }));
      expect(await second).toBe('access-new');
      expect(await third).toBe('access-new');
    });
  });
});
