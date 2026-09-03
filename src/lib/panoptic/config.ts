import { localStorage, managedStorage } from '@/lib/browser-api';

/*
 * Panoptic's own documentation hub and Kinde tenant. A fork of this fork points
 * at its own instance by changing these constants, or by overwriting them once
 * in Settings. Nothing else in the extension hard-codes an address.
 */
export const DEFAULT_HUB_URL = 'https://docs.panoptic.tools';
export const DEFAULT_KINDE_ISSUER = 'https://panopticitsolutions.kinde.com';
/*
 * The extension's own Kinde application: a public PKCE client, so the id is
 * not a secret and shipping it means nobody has to type it. A fork pointing at
 * another tenant replaces it here or in Settings.
 */
export const DEFAULT_KINDE_CLIENT_ID = '8bd85dbbc6c6427eaaf2380dcf706c14';

/*
 * Keys in browser.storage.managed, set by an enterprise policy (Intune, Group
 * Policy, a macOS profile) through the extension's managed_schema. A value set
 * here wins over what the person typed, and the fields go read-only.
 */
export const MANAGED_HUB_URL_KEY = 'hubUrl';
export const MANAGED_KINDE_ISSUER_KEY = 'kindeIssuer';
export const MANAGED_KINDE_CLIENT_ID_KEY = 'kindeClientId';

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

/** Which fields an enterprise policy has fixed. Empty when unmanaged. */
export type ManagedFields = Partial<Record<keyof PanopticConfig, true>>;

async function managedValues(): Promise<Partial<PanopticConfig>> {
  const policy = await managedStorage.get([MANAGED_HUB_URL_KEY, MANAGED_KINDE_ISSUER_KEY, MANAGED_KINDE_CLIENT_ID_KEY]);
  const out: Partial<PanopticConfig> = {};
  if (typeof policy?.[MANAGED_HUB_URL_KEY] === 'string') out.hubUrl = policy[MANAGED_HUB_URL_KEY] as string;
  if (typeof policy?.[MANAGED_KINDE_ISSUER_KEY] === 'string')
    out.kindeIssuer = policy[MANAGED_KINDE_ISSUER_KEY] as string;
  if (typeof policy?.[MANAGED_KINDE_CLIENT_ID_KEY] === 'string')
    out.kindeClientId = policy[MANAGED_KINDE_CLIENT_ID_KEY] as string;
  return out;
}

export async function loadManagedFields(): Promise<ManagedFields> {
  const managed = await managedValues();
  const fields: ManagedFields = {};
  if (managed.hubUrl?.trim()) fields.hubUrl = true;
  if (managed.kindeIssuer?.trim()) fields.kindeIssuer = true;
  if (managed.kindeClientId?.trim()) fields.kindeClientId = true;
  return fields;
}

export async function loadPanopticConfig(): Promise<PanopticConfig> {
  const [stored, managed] = await Promise.all([
    localStorage.get([HUB_URL_KEY, KINDE_ISSUER_KEY, KINDE_CLIENT_ID_KEY]),
    managedValues(),
  ]);
  // Policy first, then what the person saved, then the shipped default.
  return {
    hubUrl: safeOrigin(managed.hubUrl ?? stored?.[HUB_URL_KEY], DEFAULT_HUB_URL, 'hub URL'),
    kindeIssuer: safeOrigin(managed.kindeIssuer ?? stored?.[KINDE_ISSUER_KEY], DEFAULT_KINDE_ISSUER, 'Kinde issuer'),
    kindeClientId: storedText(managed.kindeClientId ?? stored?.[KINDE_CLIENT_ID_KEY], DEFAULT_KINDE_CLIENT_ID),
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
