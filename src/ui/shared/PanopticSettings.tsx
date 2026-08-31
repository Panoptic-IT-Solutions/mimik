import { CloudUpload, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { i18n } from '#imports';
import { currentIdentity, type PanopticIdentity, signIn, signOut } from '@/lib/panoptic/auth';
import {
  DEFAULT_HUB_URL,
  DEFAULT_KINDE_ISSUER,
  loadPanopticConfig,
  type PanopticConfig,
  savePanopticConfig,
} from '@/lib/panoptic/config';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';

const SAVE_DEBOUNCE_MS = 400;

function identityLabel(identity: PanopticIdentity): string {
  // Kinde can hand back a token with neither claim, and "Signed in as" followed by
  // nothing reads as a bug rather than as a session.
  const who = identity.email ?? identity.name;
  return who ? i18n.t('panoptic.signedInAs', [who]) : i18n.t('panoptic.signedIn');
}

export default function PanopticSettings() {
  const [config, setConfig] = useState<PanopticConfig | null>(null);
  const [identity, setIdentity] = useState<PanopticIdentity | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<PanopticConfig | null>(null);

  useEffect(() => {
    void loadPanopticConfig().then(setConfig);
    void currentIdentity().then(setIdentity);
  }, []);

  // Returns whether what is on screen is now what is stored, so a caller about to
  // act on the config can stop rather than act on the old one.
  const flush = useCallback(async (): Promise<boolean> => {
    const next = pending.current;
    pending.current = null;
    if (!next) return true;
    try {
      await savePanopticConfig(next);
      setError('');
      return true;
    } catch (err) {
      // savePanopticConfig refuses an address that cannot carry a bearer token
      // safely. Logging that and moving on would leave someone looking at a hub
      // URL on screen that was never written.
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  // Unmounting is how the side panel closes a view, so a change typed a moment
  // earlier would never reach storage without this.
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      void flush();
    },
    [flush],
  );

  function update(patch: Partial<PanopticConfig>) {
    if (!config) return;
    const next = { ...config, ...patch };
    setConfig(next);
    pending.current = next;
    // Saving on every keystroke would hand the publish dialog a half-typed hub
    // URL, and the dialog reads this the moment someone opens it.
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }

  async function handleAccount() {
    setBusy(true);
    setError('');
    try {
      if (identity) {
        await signOut();
        setIdentity(null);
      } else {
        // Sign-in reads the hub URL and the Kinde fields, so a debounced edit
        // has to land before the browser opens the consent window. A refused
        // address is on screen but not in storage, and signing in on it would
        // open the consent window against the hub they just edited away from.
        window.clearTimeout(saveTimer.current);
        if (!(await flush())) return;
        setIdentity(await signIn());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n.t('panoptic.connectFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded-[10px] p-3.5 space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center">
          <CloudUpload size={14} className="text-accent" />
        </div>
        <span className="text-xs font-bold text-foreground">{i18n.t('panoptic.settingsTitle')}</span>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">{i18n.t('panoptic.settingsHint')}</p>

      {!config ? (
        <p className="text-[11px] text-muted-foreground">{i18n.t('common.loading')}</p>
      ) : (
        <>
          <div>
            <label className="block text-[11px] font-semibold text-foreground mb-1">{i18n.t('panoptic.hubUrl')}</label>
            <Input
              value={config.hubUrl}
              onChange={(e) => update({ hubUrl: e.target.value })}
              placeholder={DEFAULT_HUB_URL}
              className="h-8 text-[12px] rounded-lg border-border"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-foreground mb-1">
              {i18n.t('panoptic.kindeIssuer')}
            </label>
            <Input
              value={config.kindeIssuer}
              onChange={(e) => update({ kindeIssuer: e.target.value })}
              placeholder={DEFAULT_KINDE_ISSUER}
              className="h-8 text-[12px] rounded-lg border-border"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-foreground mb-1">
              {i18n.t('panoptic.kindeClientId')}
            </label>
            <Input
              value={config.kindeClientId}
              onChange={(e) => update({ kindeClientId: e.target.value })}
              className="h-8 text-[12px] rounded-lg border-border"
            />
          </div>

          <p className="text-[10px] text-muted-foreground leading-relaxed">{i18n.t('panoptic.defaultsNote')}</p>

          <div className="flex items-center justify-between gap-2 border-t border-secondary pt-3">
            <span className="text-[11px] text-muted-foreground truncate">
              {identity ? identityLabel(identity) : i18n.t('panoptic.notConnected')}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void handleAccount()}
              className="h-8 shrink-0 rounded-lg bg-card text-[11px] font-semibold"
            >
              {busy && <Loader2 size={12} className="animate-spin" />}
              {identity ? i18n.t('panoptic.signOut') : i18n.t('panoptic.signIn')}
            </Button>
          </div>

          {error && (
            <p className="text-[11px] text-destructive leading-relaxed" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
