import * as Tone from 'tone';
import { SHAPES, shapeOffsets } from './shapes';
import { SOUND_PRESETS, ActiveSynth, SoundPreset } from './sound_presets';
import {
  COLOR_BACKGROUND,
  COLOR_CELL_DEAD,
  COLOR_CELL_ALIVE,
  COLOR_REGION_BORDER,
  COLOR_SHAPE_PREVIEW,
  COLOR_SCAN_LINE,
} from './colors';
import { SCALES, CHROMATIC, buildNotes } from './scales';

// ── Constants ──────────────────────────────────────────────────────────────
const REGION    = 20;
const GAP       = 2;
const BASE_CELL = 30; // cell size in pixels at zoom = 1

// ── Active scale / key / octave ────────────────────────────────────────────
let selectedScale  = SCALES['majorPentatonic'];
let selectedKey    = 'C';
let selectedOctave = 4;
let NOTES: string[] = buildNotes(selectedScale, REGION, selectedKey, selectedOctave);

// ── Game of Life ───────────────────────────────────────────────────────────
type Grid = Set<string>;

function key(x: number, y: number): string { return `${x},${y}`; }

function nextGen(grid: Grid): Grid {
  const counts = new Map<string, number>();
  for (const k of grid) {
    const comma = k.indexOf(',');
    const x = parseInt(k.slice(0, comma));
    const y = parseInt(k.slice(comma + 1));
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nk = key(x + dx, y + dy);
        counts.set(nk, (counts.get(nk) ?? 0) + 1);
      }
    }
  }
  const next: Grid = new Set();
  for (const [k, n] of counts) {
    if (n === 3 || (n === 2 && grid.has(k))) next.add(k);
  }
  return next;
}

// ── State ──────────────────────────────────────────────────────────────────
let current: Grid = new Set();
let next:    Grid = new Set();
let playing        = false;
let scanCol        = 0;
let bpm            = 240;
let beatMs         = 60000 / 240;
let lastBeat       = 0;
let selectedShape: string | null = null;
const shapeRotations: Record<string, number> = {}; // 0–3 CW rotations per shape
let hoverCell: { gx: number; gy: number } | null = null;
let paintMode        = false;
let isPainting       = false;
let lastPaintedCell: string | null = null;
let isDoubleClickPan = false;
let lastClickTime    = 0;
let lastTouchTime    = 0;

let currentPreset: SoundPreset = SOUND_PRESETS[0];
let activeSynth:   ActiveSynth = SOUND_PRESETS[0].make();

// ── Glow ───────────────────────────────────────────────────────────────────
interface GlowEntry { startMs: number; attackMs: number; holdMs: number; releaseMs: number; }
const glowingCells = new Map<string, GlowEntry>();
const DUR_BEATS: Record<string, number> = { '16n': 0.25, '8n': 0.5, '4n': 1.0, '2n': 2.0 };

// ── Sequencer region ────────────────────────────────────────────────────────
let regionX = 0, regionY = 0, regionW = REGION, regionH = REGION;

const HANDLES = [
  { id: 'tl', fx: 0,   fy: 0,   affL: true,  affR: false, affT: true,  affB: false },
  { id: 'tc', fx: 0.5, fy: 0,   affL: false, affR: false, affT: true,  affB: false },
  { id: 'tr', fx: 1,   fy: 0,   affL: false, affR: true,  affT: true,  affB: false },
  { id: 'ml', fx: 0,   fy: 0.5, affL: true,  affR: false, affT: false, affB: false },
  { id: 'mr', fx: 1,   fy: 0.5, affL: false, affR: true,  affT: false, affB: false },
  { id: 'bl', fx: 0,   fy: 1,   affL: true,  affR: false, affT: false, affB: true  },
  { id: 'bc', fx: 0.5, fy: 1,   affL: false, affR: false, affT: false, affB: true  },
  { id: 'br', fx: 1,   fy: 1,   affL: false, affR: true,  affT: false, affB: true  },
] as const;
type Handle = typeof HANDLES[number];

const HANDLE_CURSORS: Record<string, string> = {
  tl: 'nw-resize', tc: 'n-resize',  tr: 'ne-resize',
  ml: 'w-resize',                    mr: 'e-resize',
  bl: 'sw-resize', bc: 's-resize',  br: 'se-resize',
};

let draggingHandle: Handle | null = null;
let selectingArea  = false;
let selectStart:   { gx: number; gy: number } | null = null;
let selectEnd:     { gx: number; gy: number } | null = null;

// ── Camera ─────────────────────────────────────────────────────────────────
let zoom = 1;
let camX = 0;
let camY = 0;

function cellSize(): number { return BASE_CELL * zoom; }

function pixelToCell(px: number, py: number): { gx: number; gy: number } {
  const cs = cellSize();
  return { gx: Math.floor((px - camX) / cs), gy: Math.floor((py - camY) / cs) };
}

/**
 * Resets zoom and pan so the sequencer region is centered in the space
 * between the two bars. Called on first load and on orientation change.
 */
function resetCamera() {
  const bar1 = document.getElementById('bar1')!.getBoundingClientRect();
  const bar2 = document.getElementById('bar2')!.getBoundingClientRect();
  const landscape = window.innerWidth > window.innerHeight;

  let availX: number, availY: number, availW: number, availH: number;
  if (landscape) {
    availX = bar1.right;  availY = 0;
    availW = bar2.left - bar1.right;  availH = window.innerHeight;
  } else {
    availX = 0;  availY = bar1.bottom;
    availW = window.innerWidth;  availH = bar2.top - bar1.bottom;
  }

  const cs = Math.min(availW, availH) * 0.85 / REGION;
  zoom = cs / BASE_CELL;

  const regionCX = regionX + regionW / 2;
  const regionCY = regionY + regionH / 2;
  camX = availX + availW / 2 - regionCX * cellSize();
  camY = availY + availH / 2 - regionCY * cellSize();
}

function seed() {
  [[1,0],[2,1],[0,2],[1,2],[2,2]].forEach(([x,y]) => current.add(key(x, y)));  // glider
  [[9,10],[10,10],[11,10]].forEach(([x,y]) => current.add(key(x, y)));          // blinker
  [[13,14],[14,14],[12,15],[13,15],[13,16]].forEach(([x,y]) => current.add(key(x, y))); // r-pent
}
seed();

// ── Canvas / rendering ─────────────────────────────────────────────────────
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx    = canvas.getContext('2d')!;

function isAlive(gx: number, gy: number): boolean {
  const inRegion = gx >= regionX && gx < regionX + regionW &&
                   gy >= regionY && gy < regionY + regionH;
  if (playing && inRegion && gx < regionX + scanCol) return next.has(key(gx, gy));
  return current.has(key(gx, gy));
}

function render() {
  const cs = cellSize();
  const w  = canvas.width;
  const h  = canvas.height;

  ctx.fillStyle = COLOR_BACKGROUND;
  ctx.fillRect(0, 0, w, h);

  const inner  = Math.max(0, cs - GAP);
  const radius = inner * 0.2;

  const minGx = Math.floor(-camX / cs) - 1;
  const minGy = Math.floor(-camY / cs) - 1;
  const maxGx = Math.ceil((w - camX) / cs) + 1;
  const maxGy = Math.ceil((h - camY) / cs) + 1;

  // Cells
  for (let gx = minGx; gx <= maxGx; gx++) {
    for (let gy = minGy; gy <= maxGy; gy++) {
      const px = camX + gx * cs + GAP / 2;
      const py = camY + gy * cs + GAP / 2;
      ctx.fillStyle = isAlive(gx, gy) ? COLOR_CELL_ALIVE : COLOR_CELL_DEAD;
      ctx.beginPath();
      (ctx as any).roundRect(px, py, inner, inner, radius);
      ctx.fill();
    }
  }

  // Glow pass
  const nowMs = Date.now();
  const toDelete: string[] = [];
  for (const [k, g] of glowingCells) {
    const elapsed = nowMs - g.startMs;
    let intensity: number;
    if (elapsed < g.attackMs) {
      intensity = g.attackMs > 0 ? elapsed / g.attackMs : 1;
    } else if (elapsed < g.holdMs) {
      intensity = 1;
    } else if (elapsed < g.holdMs + g.releaseMs) {
      intensity = g.releaseMs > 0 ? 1 - (elapsed - g.holdMs) / g.releaseMs : 0;
    } else {
      toDelete.push(k);
      continue;
    }
    if (intensity <= 0) continue;
    const comma = k.indexOf(',');
    const gx = parseInt(k.slice(0, comma));
    const gy = parseInt(k.slice(comma + 1));
    const px = camX + gx * cs + GAP / 2;
    const py = camY + gy * cs + GAP / 2;
    ctx.save();
    ctx.shadowColor = `rgba(255, 200, 80, ${intensity})`;
    ctx.shadowBlur  = inner * 1.5 * intensity;
    ctx.fillStyle   = `rgba(255, 210, 100, ${intensity * 0.6})`;
    ctx.beginPath();
    (ctx as any).roundRect(px, py, inner, inner, radius);
    ctx.fill();
    ctx.restore();
  }
  for (const k of toDelete) glowingCells.delete(k);

  // Shape preview
  if (!playing && selectedShape && hoverCell) {
    const { cells, ox, oy } = shapeOffsets(selectedShape, shapeRotations[selectedShape] ?? 0);
    ctx.fillStyle = COLOR_SHAPE_PREVIEW;
    for (const [dx, dy] of cells) {
      const gx = hoverCell.gx + dx - ox;
      const gy = hoverCell.gy + dy - oy;
      const px = camX + gx * cs + GAP / 2;
      const py = camY + gy * cs + GAP / 2;
      ctx.beginPath();
      (ctx as any).roundRect(px, py, inner, inner, radius);
      ctx.fill();
    }
  }

  // Region border
  const bx = camX + regionX * cs;
  const by = camY + regionY * cs;
  const bw = regionW * cs;
  const bh = regionH * cs;
  ctx.strokeStyle = COLOR_REGION_BORDER;
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(bx - 1, by - 1, bw + 2, bh + 2);

  // Scan line
  if (playing) {
    const lx = camX + (regionX + scanCol) * cs;
    ctx.strokeStyle = COLOR_SCAN_LINE;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(lx, by);
    ctx.lineTo(lx, by + bh);
    ctx.stroke();
  }

  // Resize handles (only when paused)
  if (!playing) {
    const HALF = 5;
    ctx.fillStyle = COLOR_REGION_BORDER;
    for (const h of HANDLES) {
      ctx.fillRect(bx + bw * h.fx - HALF, by + bh * h.fy - HALF, HALF * 2, HALF * 2);
    }
  }

  // Area selection preview
  if (selectingArea && selectStart && selectEnd) {
    const sx = camX + Math.min(selectStart.gx, selectEnd.gx) * cs;
    const sy = camY + Math.min(selectStart.gy, selectEnd.gy) * cs;
    const sw = (Math.abs(selectEnd.gx - selectStart.gx) + 1) * cs;
    const sh = (Math.abs(selectEnd.gy - selectStart.gy) + 1) * cs;
    ctx.strokeStyle = COLOR_REGION_BORDER;
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(sx - 1, sy - 1, sw + 2, sh + 2);
    ctx.setLineDash([]);
  }
}

// ── Sequencer ──────────────────────────────────────────────────────────────
function onBeat() {
  const col = regionX + scanCol;
  const notesToPlay: string[] = [];
  const noteDurMs = beatMs * (DUR_BEATS[currentPreset.dur] ?? 1);
  const glowEntry: GlowEntry = {
    startMs:   Date.now(),
    attackMs:  currentPreset.attackMs,
    holdMs:    currentPreset.attackMs + noteDurMs,
    releaseMs: currentPreset.releaseMs,
  };
  for (let row = 0; row < regionH; row++) {
    const k = key(col, regionY + row);
    if (next.has(k)) { notesToPlay.push(NOTES[row]); glowingCells.set(k, glowEntry); }
  }
  if (notesToPlay.length > 0) activeSynth.play(notesToPlay, currentPreset.dur);

  // Advance the scan line after the attack has had time to bloom
  const delay = currentPreset.attackMs;
  setTimeout(() => {
    if (!playing) return;
    scanCol++;
    if (scanCol >= regionW) {
      current = next;
      next    = nextGen(current);
      scanCol = 0;
    }
  }, delay);
}

// ── Main loop ──────────────────────────────────────────────────────────────
function loop(ts: number) {
  render();
  if (playing && ts - lastBeat >= beatMs) {
    lastBeat += beatMs;
    onBeat();
  }
  requestAnimationFrame(loop);
}

function startPlaying() {
  playing  = true;
  scanCol  = 0;
  next     = nextGen(current);
  beatMs   = 60000 / bpm;
  lastBeat = performance.now();
  updateUI();
}

function stopPlaying() {
  playing = false;
  glowingCells.clear();
  updateUI();
}

// ── Region ─────────────────────────────────────────────────────────────────
function applyRegion(x: number, y: number, w: number, h: number) {
  regionX = x; regionY = y; regionW = w; regionH = h;
  if (scanCol >= regionW) scanCol = 0;
  rebuildNotes();
}

function handleAt(e: { clientX: number; clientY: number }): Handle | null {
  const cs = cellSize();
  const bx = camX + regionX * cs;
  const by = camY + regionY * cs;
  const bw = regionW * cs;
  const bh = regionH * cs;
  const T  = 10;
  for (const h of HANDLES) {
    if (Math.abs(e.clientX - (bx + bw * h.fx)) <= T &&
        Math.abs(e.clientY - (by + bh * h.fy)) <= T) return h;
  }
  return null;
}

// ── Cell editing ───────────────────────────────────────────────────────────
function toggleCell(gx: number, gy: number) {
  const k = key(gx, gy);
  if (current.has(k)) current.delete(k); else current.add(k);
}

function paintCell(gx: number, gy: number) {
  const k = key(gx, gy);
  if (k !== lastPaintedCell) { current.add(k); lastPaintedCell = k; }
}

function placeShape(id: string, gx: number, gy: number) {
  const { cells, ox, oy } = shapeOffsets(id, shapeRotations[id] ?? 0);
  for (const [dx, dy] of cells) current.add(key(gx + dx - ox, gy + dy - oy));
}

// ── Mouse input ─────────────────────────────────────────────────────────────
const CLICK_THRESHOLD = 5;

let isPanning    = false;
let panStartX    = 0, panStartY    = 0;
let camStartX    = 0, camStartY    = 0;
let pointerDownX = 0, pointerDownY = 0;
let pointerMoved = false;

canvas.addEventListener('mousedown', e => {
  if (!playing) {
    const h = handleAt(e);
    if (h) { draggingHandle = h; return; }
  }

  if (paintMode && !selectedShape && !selectingArea && !playing) {
    const now = Date.now();
    if (now - lastClickTime < 300) {
      isDoubleClickPan = true;
      panStartX = e.clientX; panStartY = e.clientY;
      camStartX = camX;      camStartY = camY;
      lastClickTime = 0;
    } else {
      lastClickTime = now;
      isPainting = true; lastPaintedCell = null;
      const { gx, gy } = pixelToCell(e.clientX, e.clientY);
      paintCell(gx, gy);
    }
    return;
  }

  pointerDownX = e.clientX; pointerDownY = e.clientY;
  pointerMoved = false;
  isPanning    = true;
  panStartX = e.clientX; panStartY = e.clientY;
  camStartX = camX;      camStartY = camY;

  if (selectingArea && !playing) {
    const { gx, gy } = pixelToCell(e.clientX, e.clientY);
    selectStart = { gx, gy }; selectEnd = { gx, gy };
  }
});

canvas.addEventListener('mousemove', e => {
  hoverCell = pixelToCell(e.clientX, e.clientY);

  if (draggingHandle) {
    const cs = cellSize();
    const gx = Math.round((e.clientX - camX) / cs);
    const gy = Math.round((e.clientY - camY) / cs);
    let x1 = regionX, y1 = regionY, x2 = regionX + regionW, y2 = regionY + regionH;
    if (draggingHandle.affL) x1 = Math.min(gx, x2 - 1);
    if (draggingHandle.affR) x2 = Math.max(gx, x1 + 1);
    if (draggingHandle.affT) y1 = Math.min(gy, y2 - 1);
    if (draggingHandle.affB) y2 = Math.max(gy, y1 + 1);
    applyRegion(x1, y1, x2 - x1, y2 - y1);
    canvas.style.cursor = HANDLE_CURSORS[draggingHandle.id];
    return;
  }

  if (isDoubleClickPan) {
    camX = camStartX + (e.clientX - panStartX);
    camY = camStartY + (e.clientY - panStartY);
    canvas.style.cursor = 'grabbing';
    return;
  }

  if (isPainting) {
    const { gx, gy } = pixelToCell(e.clientX, e.clientY);
    paintCell(gx, gy);
    return;
  }

  if (selectingArea && selectStart && isPanning) {
    selectEnd = hoverCell;
    pointerMoved = true;
    return;
  }

  if (isPanning) {
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    if (Math.hypot(dx, dy) > CLICK_THRESHOLD) pointerMoved = true;
    camX = camStartX + dx;
    camY = camStartY + dy;
  }

  // Cursor feedback
  if (!playing) {
    if (paintMode && !selectedShape && !selectingArea) {
      canvas.style.cursor = 'crosshair';
    } else if (selectingArea || selectedShape) {
      canvas.style.cursor = 'crosshair';
    } else if (isPanning && pointerMoved) {
      canvas.style.cursor = 'grabbing';
    } else {
      const h = handleAt(e);
      canvas.style.cursor = h ? HANDLE_CURSORS[h.id] : 'grab';
    }
  }
});

canvas.addEventListener('mouseup', e => {
  if (draggingHandle) { draggingHandle = null; return; }
  if (isDoubleClickPan) { isDoubleClickPan = false; updateUI(); return; }
  if (isPainting) { isPainting = false; lastPaintedCell = null; updateUI(); return; }

  if (selectingArea && selectStart && selectEnd && pointerMoved) {
    const x1 = Math.min(selectStart.gx, selectEnd.gx);
    const y1 = Math.min(selectStart.gy, selectEnd.gy);
    const x2 = Math.max(selectStart.gx, selectEnd.gx);
    const y2 = Math.max(selectStart.gy, selectEnd.gy);
    applyRegion(x1, y1, x2 - x1 + 1, y2 - y1 + 1);
    selectingArea = false; selectStart = null; selectEnd = null;
    updateUI(); isPanning = false; return;
  }

  if (!pointerMoved && !playing) {
    const { gx, gy } = pixelToCell(pointerDownX, pointerDownY);
    if (selectedShape) placeShape(selectedShape, gx, gy);
    else toggleCell(gx, gy);
  }
  isPanning = false;
});

canvas.addEventListener('mouseleave', () => {
  hoverCell = null; isPanning = false; draggingHandle = null;
  isPainting = false; isDoubleClickPan = false; lastPaintedCell = null;
  if (selectingArea) { selectStart = null; selectEnd = null; }
});

// Zoom toward cursor
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const cs     = cellSize();
  const gx     = (e.clientX - camX) / cs;
  const gy     = (e.clientY - camY) / cs;
  zoom = Math.max(0.1, Math.min(20, zoom * factor));
  camX = e.clientX - gx * cellSize();
  camY = e.clientY - gy * cellSize();
}, { passive: false });

// ── Touch input ─────────────────────────────────────────────────────────────
let touchStartX  = 0, touchStartY  = 0;
let touchCamX    = 0, touchCamY    = 0;
let touchMoved   = false;
let pinchDist0   = 0;
let isMultitouch = false;

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  isMultitouch = e.touches.length > 1;
  touchMoved   = isMultitouch;

  if (e.touches.length === 1) {
    if (paintMode && !selectedShape && !selectingArea && !playing) {
      const now = Date.now();
      if (now - lastTouchTime < 300) {
        isDoubleClickPan = true;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchCamX = camX; touchCamY = camY;
        lastTouchTime = 0;
      } else {
        lastTouchTime = now;
        isPainting = true; lastPaintedCell = null;
        const { gx, gy } = pixelToCell(e.touches[0].clientX, e.touches[0].clientY);
        paintCell(gx, gy);
      }
      return;
    }
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchCamX   = camX; touchCamY = camY;
  } else if (e.touches.length === 2) {
    pinchDist0 = Math.hypot(
      e.touches[1].clientX - e.touches[0].clientX,
      e.touches[1].clientY - e.touches[0].clientY,
    );
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();

  if (isDoubleClickPan && e.touches.length === 1) {
    camX = touchCamX + (e.touches[0].clientX - touchStartX);
    camY = touchCamY + (e.touches[0].clientY - touchStartY);
    return;
  }

  if (isPainting && e.touches.length === 1) {
    const { gx, gy } = pixelToCell(e.touches[0].clientX, e.touches[0].clientY);
    paintCell(gx, gy);
    touchMoved = true;
    return;
  }

  if (e.touches.length === 1 && !isMultitouch) {
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.hypot(dx, dy) > CLICK_THRESHOLD) touchMoved = true;
    camX = touchCamX + dx;
    camY = touchCamY + dy;
  } else if (e.touches.length === 2) {
    const t1 = e.touches[0], t2 = e.touches[1];
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const mx = (t1.clientX + t2.clientX) / 2;
    const my = (t1.clientY + t2.clientY) / 2;
    const cs = cellSize();
    const gx = (mx - camX) / cs; const gy = (my - camY) / cs;
    zoom = Math.max(0.1, Math.min(20, zoom * dist / pinchDist0));
    camX = mx - gx * cellSize(); camY = my - gy * cellSize();
    pinchDist0 = dist;
    touchMoved = true;
  }
}, { passive: false });

canvas.addEventListener('touchend', e => {
  if (isDoubleClickPan) {
    if (e.touches.length === 0) isDoubleClickPan = false;
    return;
  }
  if (isPainting) {
    if (e.touches.length === 0) { isPainting = false; lastPaintedCell = null; }
    return;
  }
  if (!touchMoved && !isMultitouch && !playing) {
    const t = e.changedTouches[0];
    const { gx, gy } = pixelToCell(t.clientX, t.clientY);
    if (selectedShape) placeShape(selectedShape, gx, gy);
    else toggleCell(gx, gy);
  }
  if (e.touches.length === 0) isMultitouch = false;
});

// ── Layout ─────────────────────────────────────────────────────────────────
let lastOrientation: 'landscape' | 'portrait' | null = null;

/**
 * Sets body class (landscape/portrait) from aspect ratio.
 * On orientation change, resets the camera so the region stays centered
 * in the available space between the two bars.
 */
function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const orientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
  document.body.className = orientation;
  if (orientation !== lastOrientation) {
    lastOrientation = orientation;
    requestAnimationFrame(resetCamera); // wait for bars to reflow first
  }
}

// ── UI ─────────────────────────────────────────────────────────────────────
const playBtn        = document.getElementById('playBtn')!;
const bpmDisplay     = document.getElementById('bpmDisplay')!;
const clearBtn       = document.getElementById('clearBtn') as HTMLButtonElement;
const hint           = document.getElementById('hint')!;
const soundSel       = document.getElementById('soundSelect') as HTMLSelectElement;
const scaleSel       = document.getElementById('scaleSelect') as HTMLSelectElement;
const keySel         = document.getElementById('keySelect') as HTMLSelectElement;
const octaveSel      = document.getElementById('octaveSelect') as HTMLSelectElement;
const shapeContainer = document.getElementById('shapeButtons')!;
const selectAreaBtn  = document.getElementById('selectAreaBtn') as HTMLButtonElement;
const dragModeBtn    = document.getElementById('dragModeBtn') as HTMLButtonElement;
const paintModeBtn   = document.getElementById('paintModeBtn') as HTMLButtonElement;
const rotateCCWBtn   = document.getElementById('rotateCCWBtn') as HTMLButtonElement;
const rotateCWBtn    = document.getElementById('rotateCWBtn') as HTMLButtonElement;
const randomBtn      = document.getElementById('randomBtn') as HTMLButtonElement;

for (const preset of SOUND_PRESETS) {
  const opt = document.createElement('option');
  opt.value = preset.id; opt.textContent = preset.name;
  soundSel.appendChild(opt);
}
soundSel.addEventListener('change', () => {
  const preset = SOUND_PRESETS.find(p => p.id === soundSel.value);
  if (!preset) return;
  activeSynth.dispose(); currentPreset = preset; activeSynth = preset.make();
});

for (const [id, scale] of Object.entries(SCALES)) {
  const opt = document.createElement('option');
  opt.value = id; opt.textContent = scale.label;
  scaleSel.appendChild(opt);
}
scaleSel.addEventListener('change', () => {
  const scale = SCALES[scaleSel.value];
  if (scale) { selectedScale = scale; rebuildNotes(); }
});

for (const note of CHROMATIC) {
  const opt = document.createElement('option');
  opt.value = note; opt.textContent = note;
  keySel.appendChild(opt);
}
keySel.value = selectedKey;
keySel.addEventListener('change', () => { selectedKey = keySel.value; rebuildNotes(); });

for (let oct = 2; oct <= 7; oct++) {
  const opt = document.createElement('option');
  opt.value = String(oct); opt.textContent = `C${oct}`;
  octaveSel.appendChild(opt);
}
octaveSel.value = String(selectedOctave);
octaveSel.addEventListener('change', () => { selectedOctave = parseInt(octaveSel.value); rebuildNotes(); });

function rebuildNotes() {
  NOTES = buildNotes(selectedScale, regionH, selectedKey, selectedOctave);
}

dragModeBtn.addEventListener('click', () => { paintMode = false; updateUI(); });
paintModeBtn.addEventListener('click', () => { paintMode = true;  updateUI(); });

rotateCCWBtn.addEventListener('click', () => {
  if (!selectedShape) return;
  shapeRotations[selectedShape] = ((shapeRotations[selectedShape] ?? 0) + 3) % 4;
});
rotateCWBtn.addEventListener('click', () => {
  if (!selectedShape) return;
  shapeRotations[selectedShape] = ((shapeRotations[selectedShape] ?? 0) + 1) % 4;
});

selectAreaBtn.addEventListener('click', () => {
  if (playing) return;
  selectingArea = !selectingArea;
  if (selectingArea) { selectedShape = null; selectStart = null; selectEnd = null; }
  updateUI();
});

for (const [id, { label }] of Object.entries(SHAPES)) {
  const btn = document.createElement('button');
  btn.textContent = label; btn.dataset['shape'] = id;
  btn.addEventListener('click', () => {
    if (playing) return;
    selectedShape = selectedShape === id ? null : id;
    updateUI();
  });
  shapeContainer.appendChild(btn);
}

function updateUI() {
  playBtn.textContent    = playing ? '⏸' : '▶';
  clearBtn.disabled      = playing;
  randomBtn.disabled     = playing;
  bpmDisplay.textContent = String(bpm);

  dragModeBtn.classList.toggle('active', !paintMode);
  paintModeBtn.classList.toggle('active', paintMode);

  rotateCCWBtn.disabled = !selectedShape;
  rotateCWBtn.disabled  = !selectedShape;

  for (const btn of Array.from(shapeContainer.querySelectorAll('button'))) {
    const b = btn as HTMLButtonElement;
    b.disabled = playing;
    b.classList.toggle('active', b.dataset['shape'] === selectedShape);
  }

  selectAreaBtn.disabled = playing;
  selectAreaBtn.classList.toggle('active', selectingArea);

  if (playing) {
    hint.textContent = '';
  } else if (selectingArea) {
    hint.textContent = 'drag to draw new area — Esc to cancel';
  } else if (selectedShape) {
    hint.textContent = `placing ${SHAPES[selectedShape].label} — click to place, Esc to cancel`;
  } else if (paintMode) {
    hint.textContent = 'drag to paint · double-click to pan · scroll/pinch to zoom';
  } else {
    hint.textContent = 'click to toggle · drag to pan · scroll/pinch to zoom · drag handles to resize area';
  }

  canvas.style.cursor = (!playing && (selectedShape || selectingArea)) ? 'crosshair'
                      : playing ? 'default'
                      : (paintMode && !selectedShape && !selectingArea) ? 'crosshair'
                      : 'grab';
}

document.getElementById('bpmDown')!.addEventListener('click', () => {
  bpm = Math.max(40, bpm - 10); beatMs = 60000 / bpm; bpmDisplay.textContent = String(bpm);
});
document.getElementById('bpmUp')!.addEventListener('click', () => {
  bpm = Math.min(480, bpm + 10); beatMs = 60000 / bpm; bpmDisplay.textContent = String(bpm);
});

function advanceGen() {
  if (playing) {
    current = next;
    next    = nextGen(current);
    scanCol = 0;
    lastBeat = performance.now();
    glowingCells.clear();
  } else {
    current = nextGen(current);
  }
}

{
  const btn = document.getElementById('nextGenBtn')!;
  let holdTimeout: ReturnType<typeof setTimeout> | null = null;
  let holdInterval: ReturnType<typeof setInterval> | null = null;

  function startHold() {
    advanceGen();
    holdTimeout = setTimeout(() => {
      holdInterval = setInterval(advanceGen, 100);
    }, 200);
  }

  function stopHold() {
    if (holdTimeout)  { clearTimeout(holdTimeout);   holdTimeout  = null; }
    if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
  }

  btn.addEventListener('mousedown', startHold);
  btn.addEventListener('mouseup',   stopHold);
  btn.addEventListener('mouseleave', stopHold);
  btn.addEventListener('touchstart', e => { e.preventDefault(); startHold(); }, { passive: false });
  btn.addEventListener('touchend',   stopHold);
}

clearBtn.addEventListener('click', () => { if (!playing) current = new Set(); });

randomBtn.addEventListener('click', () => {
  if (playing) return;
  for (let gx = regionX; gx < regionX + regionW; gx++) {
    for (let gy = regionY; gy < regionY + regionH; gy++) {
      const k = key(gx, gy);
      if (Math.random() < 0.3) current.add(k); else current.delete(k);
    }
  }
});

playBtn.addEventListener('click', async () => {
  await Tone.start();
  playing ? stopPlaying() : startPlaying();
});

document.addEventListener('keydown', async e => {
  if (e.code === 'Space') {
    e.preventDefault(); await Tone.start();
    playing ? stopPlaying() : startPlaying();
  }
  if (e.code === 'Escape') {
    selectedShape = null; selectingArea = false;
    selectStart = null; selectEnd = null;
    updateUI();
  }
});

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && playing) lastBeat = performance.now();
});

resize();
window.addEventListener('resize', resize);
updateUI();
requestAnimationFrame(loop);
