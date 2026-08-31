import { getExtensionURL } from '@/lib/browser-api';

/**
 * The extension URL of the square Panoptic mark.
 *
 * Everything that draws the mark points here rather than inlining the artwork,
 * so there is one file to change and the content script does not carry the
 * logo into every page the user visits.
 *
 * It is the 512px mark and not icon.svg, because that SVG is the wide wordmark
 * (viewBox 1292 x 275) and every slot that draws this is square, so the
 * wordmark would letterbox down to a sliver. It is not icon128.png either: the
 * capture notification draws the mark at up to 250px, where 128px of source
 * would go soft. This is also the logo the exports fall back to, so the mark
 * matches between the extension and a published guide.
 *
 * Anything drawn into a customer page (the capture notification) needs this
 * file listed in web_accessible_resources in wxt.config.ts, or the browser
 * blocks the request and the mark silently fails to load.
 */
export function brandMarkUrl(): string {
  return getExtensionURL('/panoptic-mark.png');
}
