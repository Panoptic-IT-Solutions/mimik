import { brandMarkUrl } from '@/lib/brand-mark';

interface MascotIconProps {
  size?: number;
  pose?: 'happy' | 'lookaway';
  tone?: 'brand' | 'muted';
}

/**
 * The Panoptic mark, square, at whatever size the caller asks for.
 *
 * It renders an <img> against the packaged icon instead of inline SVG so the
 * artwork lives in one file rather than in every bundle that shows it.
 *
 * `pose` stays in the props because the call sites still pass it. A logo has
 * one pose, so it no longer changes what is drawn; dropping the prop would
 * only force edits in files this rebrand has no other reason to touch.
 */
export default function MascotIcon({ size = 22, tone = 'brand' }: MascotIconProps) {
  return (
    <img
      src={brandMarkUrl()}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={tone === 'muted' ? 'block shrink-0 grayscale opacity-55' : 'block shrink-0'}
    />
  );
}
