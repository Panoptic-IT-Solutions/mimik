import { localStorage } from '@/lib/browser-api';

/*
 * Panoptic's own documentation hub and Kinde tenant. A fork of this fork points
 * at its own instance by changing these constants, or by overwriting them once
 * in Settings. Nothing else in the extension hard-codes an address.
 */
export const DEFAULT_HUB_URL = 'https://docs.panoptic.tools';
export const DEFAULT_KINDE_ISSUER = 'https://panoptic.kinde.com';
/*
 * Blank on purpose. Shipping a guessed client id would fail at the Kinde
 * consent screen with a message nobody can act on, so sign-in refuses early and
 * asks for the id instead.
 */
export const DEFAULT_KINDE_CLIENT_ID = '';

export const HUB_URL_KEY = 'panopticHubUrl';
export const KINDE_ISSUER_KEY = 'panopticKindeIssuer';
export const KINDE_CLIENT_ID_KEY = 'panopticKindeClientId';

export interface PanopticConfig {
  hubUrl: string;
  kindeIssuer: string;
  kindeClientId: string;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function normaliseOrigin(value: string, label: string): string {
  // A trailing slash would turn every built path into a double slash, and some
  // routers treat //api/recordings as a different route from /api/recordings.
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error(`The Panoptic ${label} cannot be blank.`);

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`The Panoptic ${label} is not a valid address: ${trimmed}`);
  }

  // Every request to the hub carries a bearer token. On a plaintext hop anyone
  // on the path can lift that token and act as the person until it expires, so
  // http is allowed only against a hub running on this machine.
  if (parsed.protocol !== 'https:' && !isLoopback(parsed.hostname)) {
    throw new Error(`The Panoptic ${label} must start with https:// unless it is localhost.`);
  }

  return trimmed;
}

/** Throws on an address that cannot carry a bearer token safely. */
export function normalisePanopticConfig(config: PanopticConfig): PanopticConfig {
  return {
    hubUrl: normaliseOrigin(config.hubUrl, 'hub URL'),
    kindeIssuer: normaliseOrigin(config.kindeIssuer, 'Kinde issuer'),
    kindeClientId: config.kindeClientId.trim(),
  };
}

function storedText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function safeOrigin(value: unknown, fallback: string, label: string): string {
  try {
    return normaliseOrigin(storedText(value, fallback), label);
  } catch {
    // A value written by an older build or edited by hand must not brick
    // sign-in for every caller, so each field falls back on its own.
    // savePanopticConfig is where a bad address gets refused out loud.
    return normaliseOrigin(fallback, label);
  }
}

export async function loadPanopticConfig(): Promise<PanopticConfig> {
  const stored = await localStorage.get([HUB_URL_KEY, KINDE_ISSUER_KEY, KINDE_CLIENT_ID_KEY]);
  return {
    hubUrl: safeOrigin(stored?.[HUB_URL_KEY], DEFAULT_HUB_URL, 'hub URL'),
    kindeIssuer: safeOrigin(stored?.[KINDE_ISSUER_KEY], DEFAULT_KINDE_ISSUER, 'Kinde issuer'),
    kindeClientId: storedText(stored?.[KINDE_CLIENT_ID_KEY], DEFAULT_KINDE_CLIENT_ID),
  };
}

/** Merges a partial change over what is stored, then writes the whole group. */
export async function savePanopticConfig(partial: Partial<PanopticConfig>): Promise<PanopticConfig> {
  const current = await loadPanopticConfig();
  const next = normalisePanopticConfig({ ...current, ...partial });
  await localStorage.set({
    [HUB_URL_KEY]: next.hubUrl,
    [KINDE_ISSUER_KEY]: next.kindeIssuer,
    [KINDE_CLIENT_ID_KEY]: next.kindeClientId,
  });
  return next;
}
