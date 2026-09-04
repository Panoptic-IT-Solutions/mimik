import { AlertTriangle, Check, CloudUpload, Copy, FolderPlus, Loader2, Shield } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { i18n } from '#imports';
import { actionSteps } from '@/core/guides/blocks';
import type { Guide, Step } from '@/core/guides/types';
import { isValidCategoryName, NEW_CATEGORY, resolveCategory } from '@/core/publish/category';
import { deleteRecording, searchTargets, type TargetPage } from '@/core/publish/panoptic-client';
import {
  type PublishProgress,
  type PublishResult,
  type PublishTarget,
  publishGuideToPanoptic,
} from '@/core/publish/publish';
import { localStorage } from '@/lib/browser-api';
import { currentIdentity, type PanopticIdentity, signIn } from '@/lib/panoptic/auth';
import { loadPanopticConfig } from '@/lib/panoptic/config';
import { Button } from '@/ui/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guideId: string;
  guide: Guide;
  steps: Step[];
}

type TargetMode = 'page' | 'new';
type Phase = 'idle' | 'publishing' | 'done';

const SEARCH_DEBOUNCE_MS = 250;
const LAST_TARGET_KEY = 'panopticLastTarget';

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // The hub URL is a hand-edited setting, so it can be half-finished. Showing it raw
    // beats throwing inside the dialog whose whole job is to say where the guide goes.
    return url;
  }
}

function progressLabel(progress: PublishProgress | null): string {
  if (!progress || progress.phase === 'steps') return i18n.t('panoptic.creating');
  if (progress.phase === 'screenshots' && progress.total > 0) {
    // `uploaded` counts the ones already through, so the one in flight is the next
    // number along, and it stops at the total rather than reading "13 of 12" at the end.
    const current = Math.min(progress.uploaded + 1, progress.total);
    return i18n.t('panoptic.uploading', [String(current), String(progress.total)]);
  }
  return i18n.t('panoptic.finishing');
}

async function discard(id: string): Promise<void> {
  // The recording was created before the screenshots were, so an abandoned attempt
  // leaves a draft behind. A tidy-up that itself fails is not worth putting in front of
  // someone who has already moved on from this publish.
  await deleteRecording(id).catch(() => undefined);
}

function identityLabel(identity: PanopticIdentity): string {
  // Kinde can return a token with neither claim, and "Signed in as" followed by nothing
  // reads as a bug rather than as a session.
  const who = identity.email ?? identity.name;
  return who ? i18n.t('panoptic.signedInAs', [who]) : i18n.t('panoptic.signedIn');
}

export default function PublishDialog({ open, onOpenChange, guideId, guide, steps }: PublishDialogProps) {
  const [host, setHost] = useState('');
  const [identity, setIdentity] = useState<PanopticIdentity | null>(null);
  const [checking, setChecking] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const [mode, setMode] = useState<TargetMode>('page');
  const [query, setQuery] = useState('');
  const [pages, setPages] = useState<TargetPage[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [path, setPath] = useState('');
  const [categoryChoice, setCategoryChoice] = useState('');
  const [newCategory, setNewCategory] = useState('');

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const count = actionSteps(steps).length;
  const signedIn = identity !== null;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setChecking(true);
    void loadPanopticConfig().then((config) => {
      if (active) setHost(hostOf(config.hubUrl));
    });
    void currentIdentity().then((who) => {
      if (!active) return;
      setIdentity(who);
      setChecking(false);
    });
    void localStorage.get([LAST_TARGET_KEY]).then((stored) => {
      const last = stored[LAST_TARGET_KEY] as { mode?: TargetMode; category?: string } | undefined;
      if (!active || !last) return;
      if (last.mode) setMode(last.mode);
      if (last.category) setCategoryChoice(last.category);
    });
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !signedIn) return;
    const controller = new AbortController();
    setSearching(true);
    // Debounced, because this fires on every keystroke and the hub runs a real search
    // behind it. An empty query is the first call and returns the categories as well.
    const timer = window.setTimeout(() => {
      searchTargets(query, { signal: controller.signal })
        .then((found) => {
          // A slow answer to an earlier keystroke can still land after a later one, and
          // aborting a fetch that has already delivered its body does nothing. Without
          // this the stale list wins and the person is shown results for what they
          // typed two words ago.
          if (controller.signal.aborted) return;
          setPages(found.pages);
          setCategories(found.categories);
          setSearchError('');
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setSearchError(err instanceof Error ? err.message : i18n.t('panoptic.searchFailed'));
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, signedIn, query]);

  async function handleConnect() {
    setConnecting(true);
    setError('');
    try {
      setIdentity(await signIn());
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n.t('panoptic.connectFailed'));
    } finally {
      setConnecting(false);
    }
  }

  const category = resolveCategory(categoryChoice, newCategory, categories);

  async function runPublish(replacing: string | null) {
    const target: PublishTarget = mode === 'page' ? { kind: 'page', path } : { kind: 'new', category };
    const controller = new AbortController();
    abort.current = controller;
    setPhase('publishing');
    setError('');
    setProgress(null);
    setCopied(false);
    try {
      const published = await publishGuideToPanoptic(guideId, target, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      // A cancel part way through the uploads does not throw: publishGuideToPanoptic
      // stops claiming screenshots and returns the ones it managed. Without this check a
      // cancelled publish would show a success receipt listing the rest as failures.
      if (controller.signal.aborted) {
        await discard(published.id);
        setPhase(replacing ? 'done' : 'idle');
        return;
      }
      setResult(published);
      setPhase('done');
      void localStorage.set({ [LAST_TARGET_KEY]: { mode, category } });
      if (replacing && replacing !== published.id) {
        // The earlier attempt left a recording on the hub with screenshots missing.
        // Leaving it there hands an agent two drafts of the same workflow, and the
        // incomplete one is the wrong answer.
        await discard(replacing);
      }
    } catch (err) {
      // panoptic-client rethrows an abort as it came rather than wrapping it, so this
      // matches on the name and not on DOMException.
      if (err instanceof Error && err.name === 'AbortError') {
        setPhase(replacing ? 'done' : 'idle');
        return;
      }
      // PanopticApiError messages are written to be acted on, so this shows the hub's
      // own sentence rather than one of ours wrapped around it.
      setError(err instanceof Error ? err.message : String(err));
      // A second attempt that fails must not take the first receipt away with it. That
      // recording is still on the hub and its id is the only way back to it.
      setPhase(replacing ? 'done' : 'idle');
    } finally {
      abort.current = null;
    }
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      onOpenChange(true);
      return;
    }
    abort.current?.abort();
    onOpenChange(false);
    // The next open starts at the picker, not at the receipt for a recording that was
    // already published.
    setPhase('idle');
    setResult(null);
    setProgress(null);
    setError('');
    setCopied(false);
    setQuery('');
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // A side panel that has lost focus is refused the clipboard. The line is on
      // screen and can be selected by hand, so this is not worth an error beside it.
    }
  }

  const failed = result?.failed ?? [];
  const ready = mode === 'page' ? path !== '' : category !== '';
  const newName = newCategory.trim();
  const newNameInvalid = newName !== '' && !isValidCategoryName(newName);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <CloudUpload size={16} className="text-accent" />
            {i18n.t('panoptic.publish')}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            <span className="font-semibold text-foreground">{guide.title}</span>
            {' · '}
            {count === 1
              ? i18n.t('fullview.stepCount', [String(count)])
              : i18n.t('fullview.stepCountPlural', [String(count)])}
          </DialogDescription>
        </DialogHeader>

        {host && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-secondary text-[10px] text-muted-foreground leading-relaxed">
            <Shield size={12} className="shrink-0 mt-0.5 text-accent" />
            <span>{i18n.t('panoptic.leavesBrowser', [host])}</span>
          </div>
        )}

        {phase === 'done' && result ? (
          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
              <Check size={13} style={{ color: 'var(--color-success)' }} />
              {i18n.t('panoptic.publishedTitle', [result.id])}
            </p>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 min-w-0 truncate rounded-lg bg-secondary px-2.5 py-2 text-[11px] text-foreground">
                {i18n.t('panoptic.nextStep', [result.id])}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleCopy(i18n.t('panoptic.nextStep', [result.id]))}
                className="h-8 shrink-0 rounded-lg bg-card text-[11px] font-semibold"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? i18n.t('panoptic.copied') : i18n.t('panoptic.copyLine')}
              </Button>
            </div>
            {failed.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-start gap-1.5 text-[11px] text-destructive leading-relaxed" role="alert">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  <span>
                    {failed.length === 1
                      ? i18n.t('panoptic.someFailed', [String(failed.length)])
                      : i18n.t('panoptic.someFailedPlural', [String(failed.length)])}
                  </span>
                </p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">{i18n.t('panoptic.retryHint')}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void runPublish(result.id)}
                  className="h-8 rounded-lg bg-card text-[11px] font-semibold"
                >
                  {i18n.t('panoptic.retryFailed')}
                </Button>
              </div>
            )}
          </div>
        ) : checking ? (
          <p className="text-[11px] text-muted-foreground">{i18n.t('panoptic.checking')}</p>
        ) : !identity ? (
          <Button onClick={() => void handleConnect()} disabled={connecting} className="w-full rounded-lg">
            {connecting ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />}
            {connecting ? i18n.t('panoptic.connecting') : i18n.t('panoptic.connect')}
          </Button>
        ) : (
          <div className="space-y-3">
            <p className="truncate text-[11px] text-muted-foreground">{identityLabel(identity)}</p>

            <div>
              <span className="block text-[11px] font-semibold text-foreground mb-1.5">
                {i18n.t('panoptic.whereTitle')}
              </span>
              <div className="flex gap-1 p-0.5 rounded-lg bg-secondary">
                {(['page', 'new'] as TargetMode[]).map((option) => (
                  <button
                    key={option}
                    onClick={() => setMode(option)}
                    className={`flex-1 rounded-md py-1.5 text-[11px] font-semibold transition-colors ${
                      mode === option ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    {option === 'page' ? i18n.t('panoptic.modeExisting') : i18n.t('panoptic.modeNew')}
                  </button>
                ))}
              </div>
            </div>

            {mode === 'page' ? (
              <div>
                <label className="block text-[11px] font-semibold text-foreground mb-1">
                  {i18n.t('panoptic.searchLabel')}
                </label>
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={i18n.t('panoptic.searchPlaceholder')}
                  className="h-8 text-[12px] rounded-lg border-border"
                />
                <div className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-border">
                  {searching && pages.length === 0 ? (
                    <p className="px-2.5 py-2 text-[11px] text-muted-foreground">{i18n.t('panoptic.searching')}</p>
                  ) : pages.length === 0 ? (
                    <p className="px-2.5 py-2 text-[11px] text-muted-foreground">{i18n.t('panoptic.noPages')}</p>
                  ) : (
                    pages.map((page) => (
                      <button
                        key={page.path}
                        onClick={() => setPath(page.path)}
                        className={`block w-full px-2.5 py-2 text-left transition-colors hover:bg-secondary ${
                          path === page.path ? 'bg-secondary' : ''
                        }`}
                      >
                        <span className="block truncate text-[12px] font-medium text-foreground">{page.title}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">{page.path}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-[11px] font-semibold text-foreground mb-1">
                  {i18n.t('panoptic.categoryLabel')}
                </label>
                <Select value={categoryChoice} onValueChange={setCategoryChoice}>
                  <SelectTrigger className="w-full rounded-lg px-3 py-2 text-[13px]">
                    <SelectValue placeholder={i18n.t('panoptic.categoryLabel')} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_CATEGORY} className={categories.length > 0 ? 'border-t border-border' : ''}>
                      <span className="flex items-center gap-1.5">
                        <FolderPlus size={12} className="text-accent" />
                        {i18n.t('panoptic.newCategory')}
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {categoryChoice === NEW_CATEGORY && (
                  <div className="mt-2">
                    <label className="block text-[11px] font-semibold text-foreground mb-1">
                      {i18n.t('panoptic.newCategoryLabel')}
                    </label>
                    <Input
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      placeholder={i18n.t('panoptic.newCategoryPlaceholder')}
                      aria-invalid={newNameInvalid || undefined}
                      className={`h-8 text-[12px] rounded-lg ${newNameInvalid ? 'border-destructive' : 'border-border'}`}
                    />
                    <p
                      className={`mt-1 text-[10px] leading-relaxed ${newNameInvalid ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                      {category ? i18n.t('panoptic.newCategoryPath', [category]) : i18n.t('panoptic.newCategoryHint')}
                    </p>
                  </div>
                )}
              </div>
            )}

            {searchError && (
              <p className="text-[11px] text-destructive leading-relaxed" role="alert">
                {searchError}
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="text-[11px] text-destructive leading-relaxed" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          {phase === 'publishing' ? (
            <>
              <span className="mr-auto flex items-center gap-1.5 text-[11px] text-muted-foreground" aria-live="polite">
                <Loader2 size={12} className="animate-spin" />
                {progressLabel(progress)}
              </span>
              <Button variant="outline" size="sm" onClick={() => abort.current?.abort()} className="rounded-lg">
                {i18n.t('common.cancel')}
              </Button>
            </>
          ) : phase === 'done' ? (
            <Button size="sm" onClick={() => handleOpenChange(false)} className="rounded-lg">
              {i18n.t('common.close')}
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} className="rounded-lg">
                {i18n.t('common.cancel')}
              </Button>
              <Button
                size="sm"
                disabled={!signedIn || !ready}
                onClick={() => void runPublish(null)}
                className="rounded-lg"
              >
                {i18n.t('panoptic.publishAction')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
