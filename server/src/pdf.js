import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
if (!process.getBuiltinModule) process.getBuiltinModule = (n) => require(n);
const canvasLib = require('@napi-rs/canvas');
globalThis.DOMMatrix = globalThis.DOMMatrix || canvasLib.DOMMatrix;
globalThis.ImageData = globalThis.ImageData || canvasLib.ImageData;
globalThis.Path2D = globalThis.Path2D || canvasLib.Path2D;

const here = path.dirname(fileURLToPath(import.meta.url));
const pdfjsDir = path.join(here, '..', 'node_modules', 'pdfjs-dist');
const pdfjs = await import(path.join(pdfjsDir, 'legacy', 'build', 'pdf.mjs'));
const { OPS, AnnotationMode } = pdfjs;

export const IMAGE_DIR = path.join(here, '..', 'data', 'images');
fs.mkdirSync(IMAGE_DIR, { recursive: true });

const SCALE = 2.5;
const PAGE_W = 612;
const COL_SPLIT = 306;
const TOP_LIMIT = 700;
const BOTTOM_LIMIT = 48;

function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function applyBox(m, x0, y0, x1, y1) {
  const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

async function graphicsBoxes(page) {
  const ol = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
  const boxes = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let fillWhite = false;
  let lineWidth = 1;
  let strokeWhite = false;
  const stack = [];
  let pending = null;
  const fillOnly = new Set([OPS.fill, OPS.eoFill]);
  const strokeOnly = new Set([OPS.stroke, OPS.closeStroke]);
  const isWhite = (a) => a.length >= 3 && a[0] >= 250 && a[1] >= 250 && a[2] >= 250;
  const paintOps = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i];
    const args = ol.argsArray[i];
    if (fn === OPS.save) stack.push([ctm, fillWhite, strokeWhite, lineWidth]);
    else if (fn === OPS.restore) {
      const st = stack.pop();
      if (st) [ctm, fillWhite, strokeWhite, lineWidth] = st;
    } else if (fn === OPS.setLineWidth) lineWidth = args[0]; else if (fn === OPS.setFillRGBColor) fillWhite = isWhite(args);
    else if (fn === OPS.setStrokeRGBColor) strokeWhite = isWhite(args);
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push([ctm, fillWhite, strokeWhite]);
      if (args[0]) ctm = mul(ctm, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) {
      const st = stack.pop();
      if (st) [ctm, fillWhite, strokeWhite] = st;
    }
    else if (fn === OPS.constructPath) {
      const mm = args[2];
      if (mm && isFinite(mm[0]) && isFinite(mm[2])) {
        const b = applyBox(ctm, mm[0], mm[1], mm[2], mm[3]);
        pending = pending ? { x0: Math.min(pending.x0, b.x0), y0: Math.min(pending.y0, b.y0), x1: Math.max(pending.x1, b.x1), y1: Math.max(pending.y1, b.y1) } : b;
      }
    } else if (paintOps.has(fn)) {
      const invisible = (fillOnly.has(fn) && fillWhite) || (strokeOnly.has(fn) && strokeWhite) || (fillWhite && strokeWhite);
      if (pending && !invisible) {
        const b = { ...pending, kind: 'path' };
        if (!fillOnly.has(fn)) {
          const half = (lineWidth * Math.hypot(ctm[0], ctm[1])) / 2;
          if (half > 0.6) {
            b.x0 -= half;
            b.x1 += half;
            b.y0 -= half;
            b.y1 += half;
          }
        }
        boxes.push(b);
      }
      pending = null;
    } else if (fn === OPS.endPath) pending = null;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      boxes.push({ ...applyBox(ctm, 0, 0, 1, 1), kind: 'image' });
    }
  }
  return boxes;
}

function textItems(tc) {
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, , d, x, y] = it.transform;
    const size = Math.round(Math.hypot(a, b) * 10) / 10;
    const prev = items[items.length - 1];
    if (prev && /^[A-D]$/.test(prev.str.trim()) && it.str.trim() === ')' && Math.abs(prev.y - y) < 1 && x - (prev.x + prev.w) < 2) {
      prev.str = prev.str.trim() + ')';
      prev.w = x + it.width - prev.x;
      continue;
    }
    items.push({ str: it.str, x, y, w: it.width, h: it.height || size, size, font: it.fontName, rotated: Math.abs(b) > 0.01 });
  }
  return items;
}

function bodySize(items) {
  const counts = {};
  for (const it of items) {
    const k = Math.round(it.size);
    counts[k] = (counts[k] || 0) + it.str.length;
  }
  return Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 10);
}

function groupLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.base - it.y) <= 3.2 && !it.rotated && !l.rotated);
    if (line) {
      line.items.push(it);
      line.top = Math.max(line.top, it.y + it.size * 0.8);
      line.bottom = Math.min(line.bottom, it.y - it.size * 0.25);
    } else {
      lines.push({ base: it.y, items: [it], top: it.y + it.size * 0.8, bottom: it.y - it.size * 0.25, rotated: it.rotated });
    }
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.x0 = Math.min(...l.items.map((i) => i.x));
    l.x1 = Math.max(...l.items.map((i) => i.x + i.w));
  }
  return lines.sort((a, b) => b.base - a.base);
}

function lineText(line) {
  let out = '';
  let prevEnd = null;
  for (const it of line.items) {
    if (prevEnd !== null && it.x - prevEnd > it.size * 0.18 && !out.endsWith(' ') && !it.str.startsWith(' ')) out += ' ';
    out += it.str;
    prevEnd = it.x + it.w;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function overlapsY(a, b, pad = 0) {
  return a.bottom - pad < b.top && a.top + pad > b.bottom;
}

class PageRenderer {
  constructor(page) {
    this.page = page;
    this.canvas = null;
  }
  async ensure() {
    if (this.canvas) return;
    const vp = this.page.getViewport({ scale: SCALE });
    const c = canvasLib.createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    await this.page.render({ canvasContext: ctx, viewport: vp, annotationMode: AnnotationMode.DISABLE }).promise;
    this.canvas = c;
    this.height = vp.height / SCALE;
  }
  async crop(x0, top, x1, bottom) {
    await this.ensure();
    const pad = 3;
    const sx = Math.max(0, (x0 - pad) * SCALE);
    const sy = Math.max(0, (this.height - top - pad) * SCALE);
    const sw = Math.min(this.canvas.width - sx, (x1 - x0 + pad * 2) * SCALE);
    const sh = Math.min(this.canvas.height - sy, (top - bottom + pad * 2) * SCALE);
    const out = canvasLib.createCanvas(Math.max(1, Math.round(sw)), Math.max(1, Math.round(sh)));
    out.getContext('2d').drawImage(this.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    const buf = await out.encode('png');
    const name = crypto.createHash('sha1').update(buf).digest('hex') + '.png';
    const file = path.join(IMAGE_DIR, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
    const widthPx = Math.round((x1 - x0 + pad * 2) * 1.45);
    return `<img src="/images/${name}" alt="figure" style="max-width:100%;width:${widthPx}px" />`;
  }
}

function buildBlocks(lines, allGraphics, body, paraGap) {
  const graphics = [];
  for (const g of allGraphics) {
    const h = g.y1 - g.y0;
    const host = h < 14 && g.x1 - g.x0 < 160 ? lines.find((l) => !l.rotated && g.y0 > l.bottom - 6 && g.y1 < l.top + 6 && g.x0 > l.x0 - 12 && g.x1 < l.x1 + 12) : null;
    if (host) {
      host.forceImage = true;
      host.top = Math.max(host.top, g.y1);
      host.bottom = Math.min(host.bottom, g.y0);
      host.x0 = Math.min(host.x0, g.x0);
      host.x1 = Math.max(host.x1, g.x1);
    } else graphics.push(g);
  }
  const bands = graphics.map((g) => ({ top: g.y1, bottom: g.y0, x0: g.x0, x1: g.x1 }));
  const merged = [];
  for (const b of bands.sort((a, b) => b.top - a.top)) {
    const m = merged.find((x) => overlapsY(x, b, 9));
    if (m) {
      m.top = Math.max(m.top, b.top);
      m.bottom = Math.min(m.bottom, b.bottom);
      m.x0 = Math.min(m.x0, b.x0);
      m.x1 = Math.max(m.x1, b.x1);
    } else merged.push({ ...b });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const l of lines) {
      if (l.band) continue;
      for (const m of merged) {
        const small = l.items.every((i) => i.size < body - 0.6) || l.rotated;
        const tiny = lineText(l).length <= 2;
        const near = overlapsY(l, m, small || tiny ? 12 : 1.5);
        if (near) {
          l.band = m;
          m.top = Math.max(m.top, l.top);
          m.bottom = Math.min(m.bottom, l.bottom);
          m.x0 = Math.min(m.x0, l.x0);
          m.x1 = Math.max(m.x1, l.x1);
          changed = true;
          break;
        }
      }
    }
    for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        if (overlapsY(merged[i], merged[j], 9)) {
          const a = merged[i];
          const b = merged.splice(j, 1)[0];
          a.top = Math.max(a.top, b.top);
          a.bottom = Math.min(a.bottom, b.bottom);
          a.x0 = Math.min(a.x0, b.x0);
          a.x1 = Math.max(a.x1, b.x1);
          for (const l of lines) if (l.band === b) l.band = a;
          changed = true;
          j--;
        }
      }
    }
  }
  const blocks = [];
  let para = null;
  let prev = null;
  for (const l of lines) {
    if (l.band) {
      para = null;
      if (!blocks.find((b) => b.band === l.band)) blocks.push({ type: 'figure', band: l.band });
      prev = l;
      continue;
    }
    const gap = prev ? prev.base - l.base : 0;
    const startsNew = !para || prev?.band || gap > paraGap;
    if (startsNew) {
      para = { type: 'para', lines: [] };
      blocks.push(para);
    }
    para.lines.push(l);
    prev = l;
  }
  for (const m of merged) {
    if (!blocks.find((b) => b.band === m)) blocks.push({ type: 'figure', band: m });
  }
  blocks.sort((a, b) => topOf(b) - topOf(a));
  return blocks;
}

function topOf(block) {
  return block.type === 'figure' ? block.band.top : block.lines[0].top;
}

function isMathy(lines, body, bodyFonts) {
  for (const l of lines) {
    if (l.forceImage) return true;
    for (const it of l.items) {
      if (Math.abs(it.size - body) > 0.6) return true;
      if (Math.abs(it.y - l.base) > 1.5) return true;
      if (!bodyFonts.has(it.font) && /[=+<>^√π]|\d/.test(it.str)) return true;
    }
  }
  return false;
}

async function renderBlocks(blocks, renderer, colX0, colX1, body, bodyFonts) {
  const html = [];
  const text = [];
  for (const b of blocks) {
    if (b.type === 'figure') {
      html.push(`<p class="fig">${await renderer.crop(Math.max(colX0 - 20, b.band.x0, 8), b.band.top, Math.min(b.band.x1, PAGE_W - 8), b.band.bottom)}</p>`);
      text.push('[figure]');
      continue;
    }
    const t = b.lines.map(lineText).join(' ').replace(/\s+/g, ' ').trim();
    text.push(t);
    if (isMathy(b.lines, body, bodyFonts)) {
      const top = Math.max(...b.lines.map((l) => l.top));
      const bottom = Math.min(...b.lines.map((l) => l.bottom));
      const x0 = Math.min(...b.lines.map((l) => l.x0));
      const x1 = Math.max(...b.lines.map((l) => l.x1));
      html.push(`<p class="mathimg">${await renderer.crop(x0, top + 1, x1, bottom - 1)}</p>`);
    } else {
      html.push(`<p>${escapeHtml(t)}</p>`);
    }
  }
  return { html: html.join('\n'), text: text.join('\n') };
}

function detectTimings(allText) {
  const timings = {};
  const re = /(Reading and Writing|Math),\s*Module\s*(\d)\s*:\s*(\d+)\s*minutes/gi;
  let m;
  while ((m = re.exec(allText))) {
    const sec = /math/i.test(m[1]) ? 'math' : 'rw';
    timings[`${sec}${m[2]}`] = Number(m[3]) * 60;
  }
  const br = /(\d+)-minute break/i.exec(allText);
  if (br) timings.break = Number(br[1]) * 60;
  return timings;
}

export async function parseSatPdf(buffer, onProgress) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: path.join(pdfjsDir, 'standard_fonts') + path.sep,
    cMapUrl: path.join(pdfjsDir, 'cmaps') + path.sep,
    cMapPacked: true,
    verbosity: 0,
  }).promise;
  const questions = [];
  let section = null;
  let moduleNo = 0;
  let expected = 1;
  let allText = '';
  for (let p = 1; p <= doc.numPages; p++) {
    if (onProgress) onProgress(p, doc.numPages);
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = textItems(tc);
    allText += ' ' + items.map((i) => i.str).join(' ');
    const isIntro = items.some((i) => i.str.trim() === 'QUESTIONS');
    if (isIntro) {
      const joined = items.filter((i) => i.size >= 18).map((i) => i.str).join(' ');
      if (/Reading and Writing/i.test(joined)) section = 'rw';
      else if (/Math/i.test(joined)) section = 'math';
      const modItem = items.find((i) => /^\d$/.test(i.str.trim()) && i.y > 720 && i.y < 745 && i.x > 270 && i.x < 340);
      moduleNo = modItem ? Number(modItem.str.trim()) : moduleNo + 1;
      expected = 1;
    }
    if (!section) continue;
    const content = items.filter((i) => i.y < TOP_LIMIT && i.y > BOTTOM_LIMIT && i.size < 20 && !/^[-~.\s_]+$/.test(i.str));
    const cands = content.filter((i) => /^\d{1,2}$/.test(i.str.trim()) && Math.round(i.size) >= 9 && Math.round(i.size) <= 11);
    const leftCands = cands.filter((i) => i.x > 34 && i.x < 66);
    const offset = leftCands.length ? Math.round(Math.min(...leftCands.map((i) => i.x)) - 42) : (cands.some((i) => i.x > 332 && i.x < 344) ? 18 : 0);
    const split = COL_SPLIT + offset;
    const numbers = cands.filter((i) => Math.abs(i.x - (42 + offset)) < 5 || Math.abs(i.x - (321 + offset)) < 5);
    const starts = [];
    for (const n of numbers.sort((a, b) => (a.x > split) - (b.x > split) || b.y - a.y)) {
      if (Number(n.str.trim()) === expected) {
        starts.push(n);
        expected++;
      }
    }
    if (!starts.length) continue;
    const body = bodySize(content);
    const fontCounts = {};
    for (const it of content) if (Math.abs(it.size - body) < 0.6) fontCounts[it.font] = (fontCounts[it.font] || 0) + it.str.length;
    const bodyFonts = new Set(Object.entries(fontCounts).filter(([, c]) => c > 40).map(([f]) => f));
    const gfx = (await graphicsBoxes(page)).filter((g) => {
      const w = g.x1 - g.x0;
      const h = g.y1 - g.y0;
      if (g.y0 > TOP_LIMIT || g.y1 < BOTTOM_LIMIT) return false;
      if (h > 400 || w > 560) return false;
      if (w < 0.5 && h < 0.5) return false;
      return true;
    });
    const renderer = new PageRenderer(page);
    const rightHasStart = starts.some((s) => s.x > split);
    const lastLeft = starts.filter((s) => s.x <= split).sort((a, b) => a.y - b.y)[0];
    for (const start of starts) {
      const right = start.x > split;
      const next = starts.filter((s) => (s.x > split) === right && s.y < start.y).sort((a, b) => b.y - a.y)[0];
      const rowBoxes = gfx.filter((g) => g.y0 - 2 < start.y + 3 && g.y1 + 2 > start.y + 3 && g.y1 - g.y0 < 18 && g.x1 > start.x - 20);
      const anchor = rowBoxes.find((g) => g.x0 < start.x + 2 && g.x1 > start.x);
      let bar = null;
      if (anchor) {
        bar = { x0: anchor.x0, x1: anchor.x1 };
        let grew = true;
        while (grew) {
          grew = false;
          for (const g of rowBoxes) {
            if (g.x0 <= bar.x1 + 3 && g.x1 > bar.x1) {
              bar.x1 = g.x1;
              grew = true;
            }
          }
        }
        if (bar.x1 - bar.x0 < 80) bar = null;
      }
      const segs = [{
        x0: bar ? bar.x0 - 2 : right ? split + 4 : 28 + offset,
        x1: bar ? bar.x1 + 4 : right ? PAGE_W - 12 : split - 4,
        top: start.y - 6,
        bottom: next ? next.y + 14 : BOTTOM_LIMIT,
        labelX: start.x + 12,
      }];
      const collect = (seg, skipZones) => {
        const inZone = (top, bottom) => skipZones.some((z) => bottom < z.top && top > z.bottom);
        seg.items = content.filter((i) => i !== start && i.x >= seg.x0 && i.x < seg.x1 && i.y < seg.top && i.y > seg.bottom && !inZone(i.y + i.size * 0.8, i.y));
        seg.gfx = gfx.filter((g) => {
          const cx = (g.x0 + g.x1) / 2;
          if (!(cx >= seg.x0 && cx < seg.x1 && g.y1 < seg.top + 8 && g.y0 > seg.bottom - 2)) return false;
          if (g.y1 - g.y0 < 16 && g.y0 > start.y - 10 && seg === segs[0]) return false;
          if (g.x1 - g.x0 < 3 && (g.y1 - g.y0 > 150 || Math.abs(cx - split) < 8)) return false;
          if (inZone(g.y1, g.y0)) return false;
          return true;
        });
        const entries = [...seg.items.map((i) => ({ top: i.y + i.size * 0.8, bottom: i.y - i.size * 0.25 })), ...seg.gfx.map((g) => ({ top: g.y1, bottom: g.y0 }))].sort((x, y) => y.top - x.top);
        let cut = seg.bottom;
        let low = null;
        for (const e of entries) {
          if (low !== null && low - e.top > 48) {
            cut = low - 1;
            break;
          }
          low = low === null ? e.bottom : Math.min(low, e.bottom);
        }
        if (cut > seg.bottom) {
          seg.bottom = cut;
          seg.items = seg.items.filter((i) => i.y > cut);
          seg.gfx = seg.gfx.filter((g) => g.y0 > cut - 2);
        }
        const labels = {};
        for (const L of ['A', 'B', 'C', 'D']) {
          const lab = seg.items.filter((i) => i.str.trim() === `${L})` && Math.abs(i.x - seg.labelX) < 7).sort((x, y) => y.y - x.y);
          if (lab.length) labels[L] = lab[lab.length - 1];
        }
        seg.labels = ['A', 'B', 'C', 'D'].every((L) => labels[L]) && labels.A.y > labels.B.y && labels.B.y > labels.C.y && labels.C.y > labels.D.y ? labels : null;
      };
      collect(segs[0], []);
      const overflow = gfx.filter((g) => {
        const cx = (g.x0 + g.x1) / 2;
        return cx >= segs[0].x0 && cx < segs[0].x1 && g.x1 > segs[0].x1 + 2 && g.y1 < segs[0].top + 8 && g.y0 > segs[0].bottom - 2;
      }).map((g) => ({ top: g.y1 + 2, bottom: g.y0 - 2 }));
      if (!right && start === lastLeft && !rightHasStart) {
        const extra = { x0: Math.max(split + 4, segs[0].x1), x1: PAGE_W - 12, top: TOP_LIMIT - 20, bottom: BOTTOM_LIMIT, labelX: 333 + offset };
        collect(extra, overflow);
        if (extra.items.length) segs.push(extra);
      }
      const choiceSeg = [...segs].reverse().find((sg) => sg.labels);
      const isMcq = !!choiceSeg;
      const choices = [];
      let htmlParts = [];
      let textParts = [];
      for (const seg of segs) {
        let stemItems = seg.items;
        let stemGfx = seg.gfx;
        if (seg === choiceSeg) {
          const labels = seg.labels;
          const ys = ['A', 'B', 'C', 'D'].map((L) => labels[L].y);
          const minGap = Math.min(ys[0] - ys[1], ys[1] - ys[2], ys[2] - ys[3]);
          const T = Math.min(minGap / 2, body * 1.1);
          const stemCut = ys[0] + T;
          stemItems = seg.items.filter((i) => i.y > stemCut);
          stemGfx = seg.gfx.filter((g) => g.y0 > stemCut - 2);
          const choiceParts = [];
          for (let k = 0; k < 4; k++) {
            const L = 'ABCD'[k];
            const lab = labels[L];
            const top = ys[k] + T;
            const bottom = k === 3 ? seg.bottom : ys[k + 1] + T;
            const cItems = seg.items.filter((i) => i !== lab && i.y <= top && i.y > bottom && i.x > lab.x + 8);
            const cGfx = seg.gfx.filter((g) => g.y1 <= top + 2 && g.y0 >= bottom - 2 && g.x0 > lab.x + 8);
            const cLines = groupLines(cItems);
            choiceParts.push({ L, lab, cLines, cGfx });
          }
          const anyMath = section === 'math' && choiceParts.some((c) => c.cGfx.length || isMathy(c.cLines, body, bodyFonts));
          for (const { L, cLines, cGfx } of choiceParts) {
            const t = cLines.map(lineText).join(' ').trim();
            let html;
            if (!cLines.length && !cGfx.length) html = '';
            else if (anyMath || cGfx.length || isMathy(cLines, body, bodyFonts)) {
              const xs0 = [...cLines.map((l) => l.x0), ...cGfx.map((g) => g.x0)];
              const xs1 = [...cLines.map((l) => l.x1), ...cGfx.map((g) => g.x1)];
              const tops = [...cLines.map((l) => l.top), ...cGfx.map((g) => g.y1)];
              const bots = [...cLines.map((l) => l.bottom), ...cGfx.map((g) => g.y0)];
              html = await renderer.crop(Math.min(...xs0), Math.max(...tops) + 1, Math.max(...xs1), Math.min(...bots) - 1);
            } else html = escapeHtml(t);
            choices.push({ id: L, html, text: t || '[figure]' });
          }
        }
        const blocks = buildBlocks(groupLines(stemItems), stemGfx, body, section === 'math' ? body * 2.7 : body * 1.55);
        const r = await renderBlocks(blocks, renderer, seg.x0, seg.x1, body, bodyFonts);
        if (r.html) htmlParts.push(r.html);
        if (r.text) textParts.push(r.text);
      }
      const text = textParts.join('\n');
      questions.push({
        section,
        module: moduleNo,
        number: Number(start.str.trim()),
        page: p,
        type: isMcq ? 'mcq' : 'spr',
        stimulus_html: '',
        stem_html: htmlParts.join('\n'),
        choices,
        text: text + (choices.length ? '\n' + choices.map((c) => `${c.id}) ${c.text}`).join('\n') : ''),
      });
    }
  }
  return { questions, timings: detectTimings(allText), pages: doc.numPages };
}
