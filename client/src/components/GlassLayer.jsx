import { useEffect, useRef } from 'react';
import { LiquidGlass } from '@ybouane/liquidglass';

// The default background as an SVG picture: the glass copies pictures straight in, while a CSS
// gradient would have to be re-captured (slowly) every time the glass resets.
function gradientImage(dark) {
  const base = dark ? ['#0b0d12', '#111827'] : ['#eef2ff', '#f5f3ff'];
  const spots = dark
    ? [[12, 18, '#312e81', 0.5], [88, 8, '#831843', 0.5], [75, 85, '#064e3b', 0.5], [20, 90, '#78350f', 0.45]]
    : [[12, 18, '#c7d2fe', 0.5], [88, 8, '#fbcfe8', 0.5], [75, 85, '#a7f3d0', 0.5], [20, 90, '#fde68a', 0.45]];
  const defs = spots
    .map(([x, y, c, rr], i) => `<radialGradient id="s${i}" cx="${x / 100}" cy="${y / 100}" r="${rr}"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${base[0]}"/><stop offset="1" stop-color="${base[1]}"/></linearGradient>${defs}</defs><rect width="100" height="100" fill="url(#b)"/>${spots.map((_, i) => `<rect width="100" height="100" fill="url(#s${i})"/>`).join('')}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const EXCLUDED = '.MuiDialog-root, .MuiPopover-root, .MuiMenu-root, .MuiDrawer-root, .MuiSnackbar-root, .MuiAppBar-root, [data-no-glass]';
const POOL_SIZE = 24;
// Cards cut off far above or below the screen are trimmed in steps of this many pixels,
// so a tall card's glass only changes size now and then while scrolling, not every frame.
const STEP = 200;

// Perfectly clear glass with a strong bend at the rim, like the library demo.
function glassDefaults(mode) {
  const dark = mode === 'dark';
  return {
    blurAmount: 0,
    refraction: 1.3,
    chromAberration: 0.08,
    edgeHighlight: 0.12,
    specular: 0,
    fresnel: 1,
    distortion: 0,
    cornerRadius: 24,
    zRadius: 24,
    opacity: 1,
    saturation: 0,
    tintStrength: 0,
    brightness: 0,
    shadowOpacity: dark ? 0.35 : 0.2,
    shadowSpread: 10,
    shadowOffsetY: 2,
  };
}

function findTargets(root) {
  const out = [];
  for (const el of document.querySelectorAll('.MuiPaper-root')) {
    if (root.contains(el)) continue;
    if (el.parentElement?.closest('.MuiPaper-root')) continue;
    if (el.closest(EXCLUDED)) continue;
    if (!el.offsetWidth || !el.offsetHeight) continue;
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'sticky') continue;
    out.push(el);
  }
  return out;
}

// The glass rim follows the card's own rounded corners, with a bevel as deep as the corner.
function slabConfig(target) {
  const r = Math.round(parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0);
  const radius = Math.max(4, Math.min(r, Math.floor(Math.min(target.offsetWidth, target.offsetHeight) / 2)));
  return JSON.stringify({ cornerRadius: radius, zRadius: radius });
}

function park(slab) {
  // An unused panel waits outside the layer, so the glass never has to restart.
  Object.assign(slab.style, { left: '-400px', top: '0px', width: '8px', height: '8px' });
  slab.dataset.rect = '';
}

/**
 * Liquid glass behind every card over a background that stays still.
 *
 * The background and the glass panels live in one fixed layer. It reaches one screen (plus a
 * step) past the top and bottom of the window, so a card that is partly off screen still has
 * background to bend. Only cards on or near the screen get a panel; while scrolling, panels are
 * moved in the scroll event itself so the glass never trails behind the card.
 */
export default function GlassLayer({ image, animated, mode }) {
  const rootRef = useRef(null);
  const bgRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let instance = null;
    let disposed = false;
    let scanTimer = 0;
    let settleUntil = 0;
    let settleRaf = 0;
    let targets = [];
    let configs = new Map();
    let margin = 0;
    const pool = [];
    const assigned = new Map(); // card -> panel

    const sizeLayer = () => {
      const vh = window.innerHeight;
      const next = vh + STEP;
      if (next === margin) return false;
      margin = next;
      Object.assign(root.style, { top: `${-margin}px`, height: `${vh + 2 * margin}px` });
      Object.assign(bgRef.current.style, { top: `${margin}px`, height: `${vh}px` });
      return true;
    };

    // The library's own update for a moved panel can reuse stale pieces of old frames (white
    // patches, smears). When any panel moves, drop its cached frames and redraw all panels.
    const refresh = () => {
      if (!instance) return;
      instance._glassCache?.clear?.();
      instance._globalDirty = true;
    };

    // A panel that changed size or card needs the library's full reset (what it does on a
    // window resize); a panel that only moved needs a redraw.
    const reset = () => {
      if (!instance) return;
      instance._handleResize?.();
      instance.markChanged();
    };

    const place = () => {
      let moved = false;
      let resized = false;
      const vh = window.innerHeight;
      const pad = vh;
      const free = [];
      const wanted = [];
      for (const target of targets) {
        const r = target.getBoundingClientRect();
        if (r.bottom < -pad || r.top > vh + pad || !r.width || !r.height) continue;
        // Trim far-off parts of tall cards in whole steps, so the panel keeps its size between steps.
        const cutTop = r.top < -pad - STEP ? Math.ceil((-pad - STEP - r.top) / STEP) * STEP : 0;
        const cutBottom = r.bottom > vh + pad + STEP ? Math.ceil((r.bottom - vh - pad - STEP) / STEP) * STEP : 0;
        wanted.push({ target, left: Math.round(r.left), top: Math.round(r.top + cutTop + margin), width: Math.round(r.width), height: Math.round(r.height - cutTop - cutBottom) });
      }
      const keep = new Set(wanted.map((w) => w.target));
      for (const [target, slab] of assigned) {
        if (keep.has(target)) continue;
        assigned.delete(target);
        park(slab);
        resized = true;
      }
      const used = new Set(assigned.values());
      for (const slab of pool) if (!used.has(slab)) free.push(slab);
      for (const w of wanted) {
        let slab = assigned.get(w.target);
        if (!slab) {
          slab = free.shift();
          if (!slab) continue;
          assigned.set(w.target, slab);
          resized = true;
        }
        const config = configs.get(w.target);
        if (config && slab.dataset.config !== config) {
          slab.dataset.config = config;
          resized = true;
        }
        const next = `${w.left},${w.top},${w.width},${w.height}`;
        if (slab.dataset.rect === next) continue;
        const [, , oldW, oldH] = (slab.dataset.rect || '0,0,0,0').split(',').map(Number);
        if (oldW !== w.width || oldH !== w.height) resized = true;
        slab.dataset.rect = next;
        Object.assign(slab.style, { left: `${w.left}px`, top: `${w.top}px`, width: `${w.width}px`, height: `${w.height}px` });
        moved = true;
      }
      if (resized) reset();
      else if (moved) refresh();
    };

    // Keep following the cards for a moment after a change, so page animations end up right.
    const settle = () => {
      cancelAnimationFrame(settleRaf);
      const step = () => {
        place();
        if (performance.now() < settleUntil) settleRaf = requestAnimationFrame(step);
      };
      settleUntil = performance.now() + 700;
      settleRaf = requestAnimationFrame(step);
    };

    const scan = () => {
      const resized = sizeLayer();
      targets = findTargets(root);
      configs = new Map(targets.map((t) => [t, slabConfig(t)]));
      place();
      if (resized) reset();
      settle();
    };

    const schedule = () => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(scan, 30);
    };

    for (let i = 0; i < POOL_SIZE; i++) {
      const slab = document.createElement('div');
      Object.assign(slab.style, { position: 'absolute', zIndex: '1', isolation: 'isolate' });
      slab.dataset.config = JSON.stringify({ cornerRadius: 24, zRadius: 24 });
      park(slab);
      root.appendChild(slab);
      pool.push(slab);
    }
    // A background picture that finishes loading later must be redrawn into the glass.
    const onBgLoad = () => instance?.markChanged();
    bgRef.current?.addEventListener('load', onBgLoad);
    // Everything is in place before the glass starts, so its first frame is already right.
    scan();
    LiquidGlass.init({ root, glassElements: pool, defaults: glassDefaults(mode) })
      .then((created) => {
        if (disposed) {
          created.destroy();
          return;
        }
        instance = created;
        scan();
        reset();
      })
      .catch((e) => console.warn('Liquid glass could not start', e));

    const observer = new MutationObserver((mutations) => {
      if (mutations.every((m) => root.contains(m.target))) return;
      schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('transitionend', schedule, true);
    document.addEventListener('animationend', schedule, true);
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(document.body);

    return () => {
      disposed = true;
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', schedule);
      document.removeEventListener('transitionend', schedule, true);
      document.removeEventListener('animationend', schedule, true);
      clearTimeout(scanTimer);
      cancelAnimationFrame(settleRaf);
      bgRef.current?.removeEventListener('load', onBgLoad);
      instance?.destroy();
      for (const slab of pool) slab.remove();
    };
  }, [image, animated, mode]);

  const src = image || gradientImage(mode === 'dark');
  return (
    <div ref={rootRef} aria-hidden="true" style={{ position: 'fixed', left: 0, width: '100%', top: 0, height: '100vh', zIndex: -1, pointerEvents: 'none', overflow: 'hidden' }}>
      <img ref={bgRef} key={src} src={src} alt="" data-dynamic={image && animated ? '' : undefined} style={{ position: 'absolute', left: 0, width: '100%', top: 0, height: '100vh', objectFit: image ? 'cover' : 'fill' }} />
    </div>
  );
}
