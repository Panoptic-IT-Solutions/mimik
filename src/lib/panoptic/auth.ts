import { browser } from '#imports';
import { logger } from '@/lib/logger';
import { loadPanopticConfig } from './config';

export const PANOPTIC_SESSION_KEY = 'panopticSession';

/*
 * "offline" is what makes a refresh token possible. Without it Kinde issues an
 * access token only, and the person has to sign in again roughly every hour,
 * in the middle of publishing a guide.
 */
const SCOPES = 'openid profile email offline';

/*
 * Refresh this far ahead of expiry. A publish uploads one screenshot per step,
 * so a token that expires mid-run would fail a request that had already been
 * accepted at the start of the run.
 */
const REFRESH_MARGIN_MS = 60_000;

const REQUEST_TIMEOUT_MS = 20_000;

export interface PanopticIdentity {
  email: string | null;
  name: string | null;
}

interface StoredSession {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  email: string | null;
  name: string | null;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  // PKCE is defined over base64url with the padding removed. A '+', a '/' or a
  // '=' would be re-encoded in the query string and the challenge would no
  // longer match the verifier the server recomputes.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomUrlSafe(byteLength: number): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** The S256 code challenge for a verifier, per RFC 7636 section 4.2. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  // 64 random bytes encode to 86 characters, inside RFC 7636's 43..128 range.
  const verifier = randomUrlSafe(64);
  return { verifier, challenge: await pkceChallenge(verifier) };
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/*
 * The id_token's signature is deliberately not verified here. It came back over
 * TLS from the token endpoint we just called ourselves, and the only use we
 * make of it is labelling the signed-in state in the UI. The hub verifies the
 * access token on every request, so a forged id_token buys an attacker a wrong
 * name on a settings screen and nothing else.
 */
function identityFromIdToken(idToken: string | undefined): PanopticIdentity {
  const payload = idToken ? decodeBase64UrlJson(idToken.split('.')[1] ?? '') : null;
  if (!payload) return { email: null, name: null };

  const email = typeof payload.email === 'string' ? payload.email : null;
  const full = typeof payload.name === 'string' ? payload.name.trim() : '';
  const given = typeof payload.given_name === 'string' ? payload.given_name : '';
  const family = typeof payload.family_name === 'string' ? payload.family_name : '';
  const name = full || [given, family].filter(Boolean).join(' ');

  return { email, name: name || null };
}

async function readSession(): Promise<StoredSession | null> {
  const stored = await browser.storage.local.get([PANOPTIC_SESSION_KEY]);
  const session = stored?.[PANOPTIC_SESSION_KEY] as StoredSession | undefined;
  if (!session?.accessToken) return null;
  return session;
}

function writeSession(session: StoredSession): Promise<void> {
  return browser.storage.local.set({ [PANOPTIC_SESSION_KEY]: session });
}

function clearSession(): Promise<void> {
  return browser.storage.local.remove(PANOPTIC_SESSION_KEY);
}

function decodeJsonSafely(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

class TokenError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'TokenError';
    this.status = status;
  }
}

async function postToken(issuer: string, body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(`${issuer}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    // A failed token response carries no tokens, so quoting it is safe and it
    // is usually the only sentence that says what actually went wrong.
    const detail = await res.text().catch(() => '');
    const parsed = detail ? (decodeJsonSafely(detail) ?? {}) : {};
    const description = typeof parsed.error_description === 'string' ? parsed.error_description : '';
    throw new TokenError(res.status, description || `Kinde refused the token request (HTTP ${res.status}).`);
  }

  return (await res.json()) as TokenResponse;
}

function sessionFromTokens(tokens: TokenResponse, previous: StoredSession | null): StoredSession {
  if (!tokens.access_token) throw new Error('Kinde returned no access token.');

  // Kinde always sends expires_in. The fallback stops a missing field from
  // making every single request refresh first.
  const expiresIn = Number(tokens.expires_in) || 3600;
  const identity = tokens.id_token ? identityFromIdToken(tokens.id_token) : null;

  return {
    accessToken: tokens.access_token,
    // Kinde rotates the refresh token, but only sends a replacement when it
    // rotates. Keeping the old one is what makes a non-rotating response work.
    refreshToken: tokens.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt: Date.now() + expiresIn * 1000,
    email: identity?.email ?? previous?.email ?? null,
    name: identity?.name ?? previous?.name ?? null,
  };
}

/*
 * A refresh that started before signOut must not write the session back after
 * it, which would sign the person silently back in. The counter is read again
 * after the network round trip: if it moved, the new tokens are dropped.
 */
let sessionEpoch = 0;

/*
 * One shared in-flight refresh. Kinde rotates the refresh token, so two
 * parallel exchanges would each spend the same token and whichever landed
 * second would be refused, leaving the session dead. Publishing uploads one
 * screenshot per step in parallel, so that burst is the normal case here, not
 * an edge case. The promise is per JavaScript context, so a publish run has to
 * stay in the context it started in for this to hold.
 */
let refreshInFlight: Promise<StoredSession | null> | null = null;

async function runRefresh(): Promise<StoredSession | null> {
  const epoch = sessionEpoch;

  // Read here rather than trusting the snapshot the caller took. During a
  // publish burst every upload asks for a token at once, and a caller whose
  // storage read was still in flight when the last refresh landed is holding a
  // refresh token Kinde has already rotated. Spending that one is refused, and
  // a refusal clears the session, so the person is signed out mid-publish.
  const session = await readSession();
  if (!session) return null;
  if (session.expiresAt - Date.now() > REFRESH_MARGIN_MS) return session;

  if (!session.refreshToken) {
    // The access token has expired and there is nothing to renew it with, so
    // the session is spent. Clearing it makes the UI ask for a fresh sign-in.
    if (epoch === sessionEpoch) await clearSession();
    return null;
  }

  const config = await loadPanopticConfig();

  try {
    const tokens = await postToken(
      config.kindeIssuer,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.kindeClientId,
        refresh_token: session.refreshToken,
      }),
    );
    if (epoch !== sessionEpoch) return null;

    const next = sessionFromTokens(tokens, session);
    await writeSession(next);
    return next;
  } catch (err) {
    // Only a refusal means the grant is dead. A timeout or a 500 is the hub's
    // provider having a bad minute, and signing the person out over that would
    // lose their place for no reason, so the session is kept and the caller
    // just gets no token this time.
    const refused = err instanceof TokenError && err.status >= 400 && err.status < 500;
    if (refused && epoch === sessionEpoch) await clearSession();
    logger.error('Panoptic Docs token refresh failed', refused ? 'grant refused' : 'network or provider error');
    return null;
  }
}

function refreshSession(): Promise<StoredSession | null> {
  if (!refreshInFlight) {
    // Assigned synchronously so a second caller arriving in the same tick joins
    // this promise instead of starting a second refresh.
    const started = runRefresh().finally(() => {
      // Only the refresh that owns the slot may clear it. signOut() nulls it
      // too, so clearing unconditionally would retire a refresh that started
      // after the sign-in and let a second one run beside it, which is the
      // double spend this shared promise exists to prevent.
      if (refreshInFlight === started) refreshInFlight = null;
    });
    refreshInFlight = started;
  }
  return refreshInFlight;
}

/**
 * The callback URL, without the trailing slash Chrome adds.
 *
 * `browser.identity.getRedirectURL()` returns
 * `https://<extension id>.chromiumapp.org/`, but Kinde stores an allowed
 * callback with the trailing slash trimmed, and OAuth compares `redirect_uri`
 * as an exact string. Sending Chrome's form is refused with "Invalid callback
 * URL" no matter what is typed into Kinde, which reads as a misconfiguration
 * rather than as the normalisation it is.
 *
 * Trimming is safe in the other direction: the browser only needs the URL it is
 * sent back to to begin with the extension's own redirect prefix, and
 * `https://<id>.chromiumapp.org?code=...` still does.
 */
function callbackUrl(): string {
  return browser.identity.getRedirectURL().replace(/\/+$/, '');
}

/** Sends the person to Kinde and stores the session. Returns who signed in. */
export async function signIn(): Promise<PanopticIdentity> {
  const config = await loadPanopticConfig();
  if (!config.kindeClientId) {
    throw new Error('Add the Panoptic Docs client ID in Settings before signing in.');
  }

  const { verifier, challenge } = await createPkcePair();
  const state = randomUrlSafe(32);
  const redirectUri = callbackUrl();

  const authUrl = new URL(`${config.kindeIssuer}/oauth2/auth`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', config.kindeClientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const redirected = await browser.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  if (!redirected) throw new Error('Sign-in was closed before Panoptic Docs answered.');

  const returned = new URL(redirected).searchParams;

  const error = returned.get('error');
  if (error) {
    throw new Error(returned.get('error_description') || `Panoptic Docs refused the sign-in (${error}).`);
  }

  // An unsolicited redirect carrying somebody else's code would sign this
  // browser in as them. The state is the only thing tying the answer to the
  // request we just made, so a mismatch is refused before the code is spent.
  if (returned.get('state') !== state) {
    throw new Error('Sign-in was refused: the reply did not match the request.');
  }

  const code = returned.get('code');
  if (!code) throw new Error('Panoptic Docs returned no authorisation code.');

  const tokens = await postToken(
    config.kindeIssuer,
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.kindeClientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  );

  const session = sessionFromTokens(tokens, null);
  sessionEpoch += 1;
  await writeSession(session);
  return { email: session.email, name: session.name };
}

/** A token good for at least the next minute, or null if there is no session. */
export async function getAccessToken(): Promise<string | null> {
  const session = await readSession();
  if (!session) return null;
  if (session.expiresAt - Date.now() > REFRESH_MARGIN_MS) return session.accessToken;

  const refreshed = await refreshSession();
  return refreshed?.accessToken ?? null;
}

export async function signOut(): Promise<void> {
  sessionEpoch += 1;
  refreshInFlight = null;
  await clearSession();
}

export async function currentIdentity(): Promise<PanopticIdentity | null> {
  const session = await readSession();
  if (!session) return null;
  return { email: session.email, name: session.name };
}
