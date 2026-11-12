import { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { LiquidGlass } from '@ybouane/liquidglass';

const GRADIENTS = {
  light: 'radial-gradient(at 12% 18%, #c7d2fe 0, transparent 45%), radial-gradient(at 88% 8%, #fbcfe8 0, transparent 45%), radial-gradient(at 75% 85%, #a7f3d0 0, transparent 45%), radial-gradient(at 20% 90%, #fde68a 0, transparent 40%), linear-gradient(#eef2ff, #f5f3ff)',
  dark: 'radial-gradient(at 12% 18%, #312e81 0, transparent 45%), radial-gradient(at 88% 8%, #831843 0, transparent 45%), radial-gradient(at 75% 85%, #064e3b 0, transparent 45%), radial-gradient(at 20% 90%, #78350f 0, transparent 40%), linear-gradient(#0b0d12, #111827)',
};

const EXCLUDED = '.MuiDialog-root, .MuiPopover-root, .MuiMenu-root, .MuiDrawer-root, .MuiSnackbar-root, .MuiAppBar-root, [data-no-glass]';
const MAX_SLABS = 40;

function glassDefaults(mode) {
  const dark = mode === 'dark';
  return {
    blurAmount: 0.55,
    refraction: 0.85,
    chromAberration: 0.06,
    edgeHighlight: 0.22,
    specular: 0.3,
    fresnel: 1,
    distortion: 0,
    cornerRadius: 16,
    zRadius: 28,
    opacity: 1,
    saturation: 0.2,
    tintStrength: 0.1,
    brightness: dark ? -0.16 : 0.1,
    shadowOpacity: dark ? 0.4 : 0.22,
    shadowSpread: 16,
    shadowOffsetY: 5,
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
    if (out.length >= MAX_SLABS) break;
  }
  return out;
}

export default function GlassLayer({ image, animated, mode }) {
  const rootRef = useRef(null);
  const instRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let instance = null;
    let targets = [];
    let slabs = new Map();
    let disposed = false;
    let raf = 0;
    let rebuildTimer = 0;
    let building = false;

    const place = () => {
      let moved = false;
      for (const [target, slab] of slabs) {
        const r = target.getBoundingClientRect();
        const next = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
        if (slab.dataset.rect === next) continue;
        slab.dataset.rect = next;
        slab.style.left = `${Math.round(r.left)}px`;
        slab.style.top = `${Math.round(r.top)}px`;
        slab.style.width = `${Math.round(r.width)}px`;
        slab.style.height = `${Math.round(r.height)}px`;
        moved = true;
      }
      if (moved && instance) instance.markChanged();
    };

    const teardown = () => {
      if (instance) instance.destroy();
      instance = null;
      instRef.current = null;
      for (const slab of slabs.values()) slab.remove();
      slabs = new Map();
    };

    const rebuild = async () => {
      if (disposed || building) return;
      building = true;
      try {
        const next = findTargets(root);
        const same = next.length === targets.length && next.every((t, i) => t === targets[i]);
        if (same && instance) {
          place();
          return;
        }
        teardown();
        targets = next;
        if (!targets.length) return;
        const config = JSON.stringify({ cornerRadius: 16 });
        for (const t of targets) {
          const slab = document.createElement('div');
          slab.style.position = 'absolute';
          slab.style.zIndex = '1';
          slab.style.isolation = 'isolate';
          slab.dataset.config = config;
          root.appendChild(slab);
          slabs.set(t, slab);
        }
        place();
        const created = await LiquidGlass.init({ root, glassElements: [...slabs.values()], defaults: glassDefaults(mode) });
        if (disposed) created.destroy();
        else {
          instance = created;
          instRef.current = created;
          requestAnimationFrame(() => instance === created && created.markChanged());
          setTimeout(() => instance === created && created.markChanged(), 400);
        }
      } catch (e) {
        console.warn('Liquid glass could not start', e);
      } finally {
        building = false;
      }
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(rebuild, 180);
    };

    const observer = new MutationObserver((mutations) => {
      if (mutations.every((m) => root.contains(m.target))) return;
      schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', schedule);
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(document.body);
    rebuild();

    return () => {
      disposed = true;
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(raf);
      clearTimeout(rebuildTimer);
      teardown();
    };
  }, [image, mode]);

  return (
    <Box ref={rootRef} aria-hidden="true" sx={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none', overflow: 'hidden' }}>
      {image ? (
        <Box component="img" src={image} alt="" onLoad={() => instRef.current?.markChanged()} data-dynamic={animated ? '' : undefined} sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <Box sx={{ position: 'absolute', inset: 0, backgroundImage: GRADIENTS[mode] }} />
      )}
    </Box>
  );
}
