import { brandMarkUrl } from '@/lib/brand-mark';

const ANIMATION_DURATION_MS = 4000;
const FILL_DURATION = '2s';
const FILL_DELAY = '0.5s';

const STYLES = `
  :host {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    pointer-events: none;
  }

  .wrap {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: show ${ANIMATION_DURATION_MS}ms ease forwards;
  }

  @keyframes show {
    0% { opacity: 0; }
    8% { opacity: 1; }
    75% { opacity: 1; }
    100% { opacity: 0; }
  }

  .mark-wrap {
    position: relative;
    width: clamp(120px, 20vw, 250px);
    aspect-ratio: 1;
    animation: bounceSquash 1.8s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
  }

  .mark-wrap img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .ghost {
    opacity: 0.3;
  }

  .fill {
    clip-path: inset(100% 0 0 0);
    animation: rise ${FILL_DURATION} cubic-bezier(0.22, 0.61, 0.36, 1) ${FILL_DELAY} forwards;
  }

  @keyframes rise {
    to { clip-path: inset(0 0 0 0); }
  }

  @keyframes bounceSquash {
    0%   { transform: translateY(-80px) scaleY(1.1) scaleX(0.9); opacity: 0; }
    25%  { transform: translateY(10px) scaleY(0.85) scaleX(1.12); opacity: 1; }
    40%  { transform: translateY(-15px) scaleY(1.05) scaleX(0.97); }
    55%  { transform: translateY(5px) scaleY(0.95) scaleX(1.03); }
    70%  { transform: translateY(-3px) scaleY(1.02) scaleX(0.99); }
    100% { transform: translateY(0) scaleY(1) scaleX(1); }
  }
`;

/**
 * Markup for the mark, as a string, because this runs in a content script with
 * no React on hand.
 *
 * Two stacked copies of the same image: a dimmed one underneath, and a full
 * strength one on top that is clipped from the bottom and unclipped by the
 * `rise` animation. That is what fills the mark in as the capture starts.
 */
function buildMarkMarkup(): string {
  const src = brandMarkUrl();
  return `<img class="ghost" src="${src}" alt="" aria-hidden="true">
    <img class="fill" src="${src}" alt="" aria-hidden="true">`;
}

export function showStartNotification(): Promise<void> {
  return new Promise((resolve) => {
    const host = document.createElement('mimik-notification');
    host.setAttribute('data-mimik-ignore', '');
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLES;
    shadow.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    const markWrap = document.createElement('div');
    markWrap.className = 'mark-wrap';
    markWrap.innerHTML = buildMarkMarkup();

    wrap.appendChild(markWrap);
    shadow.appendChild(wrap);
    document.documentElement.appendChild(host);

    wrap.addEventListener('animationend', (e) => {
      if (e.target !== wrap) return;
      host.remove();
      resolve();
    });
  });
}
