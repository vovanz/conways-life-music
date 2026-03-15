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
const REGION = 20;
const GAP    = 2;

// Active scale / key / octave — rebuilt when any of these change
let selectedScale  = SCALES['majorPentatonic'];
let selectedKey    = 'C';
let selectedOctave = 4;
let NOTES: string[] = buildNotes(selectedScale, REGION, selectedKey, selectedOctave);

// ── Game of Life ───────────────────────────────────────────────────────────
type Grid = Set<string>;

/**
 * Serialises a grid coordinate into the string key used by the sparse cell set.
 * Keeping this in one place ensures encode/lookup always use the same format.
 */
function key(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Computes the next Conway generation from a sparse cell set.
 * Only live cells and their neighbours are examined, so the cost scales
 * with the live population rather than the size of the visible canvas.
 */
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
let hoverCell: { gx: number; gy: number } | null = null;

let currentPreset: SoundPreset = SOUND_PRESETS[0];
let activeSynth:   ActiveSynth = SOUND_PRESETS[0].make();

// ── Sequencer region ────────────────────────────────────────────────────────
let regionX = 0, regionY = 0, regionW = REGION, regionH = REGION;

// Resize handles — one per corner and edge midpoint
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

// Area interaction state
let draggingHandle: Handle | null = null;
let selectingArea  = false;
let selectStart:   { gx: number; gy: number } | null = null;
let selectEnd:     { gx: number; gy: number } | null = null;

/**
 * Places a few well-known patterns into the starting grid so the app opens
 * with something visually interesting rather than a blank canvas.
 */
function seed() {
  [[1,0],[2,1],[0,2],[1,2],[2,2]].forEach(([x,y]) => current.add(key(x, y)));  // glider
  [[9,10],[10,10],[11,10]].forEach(([x,y]) => current.add(key(x, y)));          // blinker
  [[13,14],[14,14],[12,15],[13,15],[13,16]].forEach(([x,y]) => current.add(key(x, y))); // r-pent
}
seed();

// ── Canvas / rendering ─────────────────────────────────────────────────────
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx    = canvas.getContext('2d')!;

/**
 * Returns the side length of a single cell in pixels.
 * Derived from the viewport's smaller dimension so the 20×20 sequencer region
 * always occupies 75% of the screen's short axis, regardless of aspect ratio.
 */
function cellSize(): number {
  return Math.min(window.innerWidth, window.innerHeight) * 0.75 / REGION;
}

/**
 * Returns the canvas pixel coordinates of the top-left corner of the 20×20
 * sequencer region. Used by both the renderer and the mouse-to-grid converter
 * to keep the region visually centred at all times.
 */
function regionOffset(): { rx: number; ry: number } {
  const cs = cellSize();
  return {
    rx: (window.innerWidth  - REGION * cs) / 2,
    ry: (window.innerHeight - REGION * cs) / 2,
  };
}

/** Snaps the canvas to the current viewport size. Called on load and on every window resize. */
function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  positionUI();
}

/**
 * Places the #ui panel on the side of the viewport with the most space
 * relative to the active sequencer region. Re-runs on every resize.
 */
function positionUI() {
  const cs  = cellSize();
  const { rx, ry } = regionOffset();

  const spaceLeft   = rx + regionX * cs;
  const spaceRight  = window.innerWidth  - (rx + (regionX + regionW) * cs);
  const spaceTop    = ry + regionY * cs;
  const spaceBottom = window.innerHeight - (ry + (regionY + regionH) * cs);

  const max = Math.max(spaceLeft, spaceRight, spaceTop, spaceBottom);

  const MARGIN = 20;
  const uiEl = document.getElementById('ui')!;
  uiEl.style.width = '';
  if (max === spaceRight) {
    uiEl.className  = 'placement-right';
    uiEl.style.width = Math.floor(spaceRight - MARGIN * 2) + 'px';
  } else if (max === spaceLeft) {
    uiEl.className  = 'placement-left';
    uiEl.style.width = Math.floor(spaceLeft - MARGIN * 2) + 'px';
  } else if (max === spaceTop) {
    uiEl.className = 'placement-top';
  } else {
    uiEl.className = 'placement-bottom';
  }
}

/**
 * Returns whether a grid cell should appear alive in the current frame.
 * Inside the sequencer region, columns already passed by the scan line show
 * the next generation's state — creating the progressive reveal animation.
 * Everywhere else the current generation is shown.
 */
function isAlive(gx: number, gy: number): boolean {
  const inRegion = gx >= regionX && gx < regionX + regionW &&
                   gy >= regionY && gy < regionY + regionH;
  if (playing && inRegion && gx < regionX + scanCol) return next.has(key(gx, gy));
  return current.has(key(gx, gy));
}

/**
 * Draws one frame: all visible cells, the sequencer region border, the scan
 * line, and (while paused in shape-placement mode) a translucent preview of
 * where the selected shape would land. Called every animation frame.
 */
function render() {
  const cs      = cellSize();
  const { rx, ry } = regionOffset();
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = COLOR_BACKGROUND;
  ctx.fillRect(0, 0, w, h);

  const inner  = cs - GAP;
  const radius = inner * 0.2;

  const minGx = Math.floor(-rx / cs) - 1;
  const minGy = Math.floor(-ry / cs) - 1;
  const maxGx = Math.ceil((w - rx) / cs) + 1;
  const maxGy = Math.ceil((h - ry) / cs) + 1;

  // Cells
  for (let gx = minGx; gx <= maxGx; gx++) {
    for (let gy = minGy; gy <= maxGy; gy++) {
      const px = rx + gx * cs + GAP / 2;
      const py = ry + gy * cs + GAP / 2;
      ctx.fillStyle = isAlive(gx, gy) ? COLOR_CELL_ALIVE : COLOR_CELL_DEAD;
      ctx.beginPath();
      (ctx as any).roundRect(px, py, inner, inner, radius);
      ctx.fill();
    }
  }

  // Shape preview
  if (!playing && selectedShape && hoverCell) {
    const { cells, ox, oy } = shapeOffsets(selectedShape);
    ctx.fillStyle = COLOR_SHAPE_PREVIEW;
    for (const [dx, dy] of cells) {
      const gx = hoverCell.gx + dx - ox;
      const gy = hoverCell.gy + dy - oy;
      const px = rx + gx * cs + GAP / 2;
      const py = ry + gy * cs + GAP / 2;
      ctx.beginPath();
      (ctx as any).roundRect(px, py, inner, inner, radius);
      ctx.fill();
    }
  }

  // Highlighted region border
  const bx = rx + regionX * cs;
  const by = ry + regionY * cs;
  const bw = regionW * cs;
  const bh = regionH * cs;
  ctx.strokeStyle = COLOR_REGION_BORDER;
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(bx - 1, by - 1, bw + 2, bh + 2);

  // Scan line
  if (playing) {
    const lx = rx + (regionX + scanCol) * cs;
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
      const hx = bx + bw * h.fx;
      const hy = by + bh * h.fy;
      ctx.fillRect(hx - HALF, hy - HALF, HALF * 2, HALF * 2);
    }
  }

  // Area selection preview
  if (selectingArea && selectStart && selectEnd) {
    const sx = rx + Math.min(selectStart.gx, selectEnd.gx) * cs;
    const sy = ry + Math.min(selectStart.gy, selectEnd.gy) * cs;
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
/**
 * Fired once per beat. Reads the next generation's state at the current scan
 * column, triggers audio notes for every live cell found there, then advances
 * the scan column. When the column wraps around, the generation is committed
 * and a new one is pre-computed ready for the next sweep.
 */
function onBeat() {
  const col = regionX + scanCol;
  const notesToPlay: string[] = [];
  for (let row = 0; row < regionH; row++) {
    if (next.has(key(col, regionY + row))) notesToPlay.push(NOTES[row]);
  }
  if (notesToPlay.length > 0) activeSynth.play(notesToPlay, currentPreset.dur);

  scanCol++;
  if (scanCol >= regionW) {
    current = next;
    next    = nextGen(current);
    scanCol = 0;
  }
}

// ── Main loop ──────────────────────────────────────────────────────────────
/**
 * The single requestAnimationFrame loop that drives the whole app.
 * Checks whether enough time has elapsed for the next beat, then always
 * re-renders. Separating beat timing from rendering keeps the visual smooth
 * even when the beat interval doesn't align with the display refresh rate.
 */
function loop(ts: number) {
  if (playing && ts - lastBeat >= beatMs) {
    lastBeat += beatMs;
    onBeat();
  }
  render();
  requestAnimationFrame(loop);
}

/**
 * Begins playback: pre-computes the first next-generation, resets the scan
 * column to 0, and anchors the beat clock. Always restarts from the left edge
 * so the visual and audio are in sync regardless of when the user resumes.
 */
function startPlaying() {
  playing  = true;
  scanCol  = 0;
  next     = nextGen(current);
  beatMs   = 60000 / bpm;
  lastBeat = performance.now();
  updateUI();
}

/** Pauses playback and updates the UI. The grid state and scan position are preserved but the scan line is hidden until the user resumes. */
function stopPlaying() {
  playing = false;
  updateUI();
}

// ── Region resizing ────────────────────────────────────────────────────────
/** Applies a new region, clamps scan column, rebuilds notes, repositions UI. */
function applyRegion(x: number, y: number, w: number, h: number) {
  regionX = x; regionY = y; regionW = w; regionH = h;
  if (scanCol >= regionW) scanCol = 0;
  rebuildNotes();
  positionUI();
}

/** Returns the handle under the mouse, or null. */
function handleAt(e: MouseEvent): Handle | null {
  const cs = cellSize();
  const { rx, ry } = regionOffset();
  const bx = rx + regionX * cs;
  const by = ry + regionY * cs;
  const bw = regionW * cs;
  const bh = regionH * cs;
  const THRESHOLD = 10;
  for (const h of HANDLES) {
    const hx = bx + bw * h.fx;
    const hy = by + bh * h.fy;
    if (Math.abs(e.clientX - hx) <= THRESHOLD && Math.abs(e.clientY - hy) <= THRESHOLD) {
      return h;
    }
  }
  return null;
}

// ── Cell editing ───────────────────────────────────────────────────────────
let painting: boolean | null = null;

/**
 * Converts a mouse event's viewport coordinates into grid cell coordinates.
 * The inverse of the pixel calculation in render(), using the same region
 * offset so mouse interaction stays aligned with what's drawn on screen.
 */
function cellAt(e: MouseEvent): { gx: number; gy: number } {
  const cs      = cellSize();
  const { rx, ry } = regionOffset();
  return {
    gx: Math.floor((e.clientX - rx) / cs),
    gy: Math.floor((e.clientY - ry) / cs),
  };
}

/**
 * Sets a single cell's state in the current grid while the app is paused.
 * The `alive` flag is captured on mousedown so a drag either draws or erases
 * consistently throughout the gesture.
 */
function paint(gx: number, gy: number, alive: boolean) {
  const k = key(gx, gy);
  if (alive) current.add(k);
  else       current.delete(k);
}

/**
 * Stamps a preset shape into the current grid, centred on the given cell.
 * Delegates centering to shapeOffsets() so placement matches the hover preview
 * the user saw before clicking.
 */
function placeShape(id: string, gx: number, gy: number) {
  const { cells, ox, oy } = shapeOffsets(id);
  for (const [dx, dy] of cells) current.add(key(gx + dx - ox, gy + dy - oy));
}

canvas.addEventListener('mousedown', e => {
  if (playing) return;

  // Draw new area
  if (selectingArea) {
    const { gx, gy } = cellAt(e);
    selectStart = { gx, gy };
    selectEnd   = { gx, gy };
    return;
  }

  // Resize via handle
  const h = handleAt(e);
  if (h) { draggingHandle = h; return; }

  // Shape placement / cell painting
  const { gx, gy } = cellAt(e);
  if (selectedShape) { placeShape(selectedShape, gx, gy); return; }
  painting = !current.has(key(gx, gy));
  paint(gx, gy, painting);
});

canvas.addEventListener('mousemove', e => {
  hoverCell = cellAt(e);

  // Handle resize drag
  if (draggingHandle) {
    const cs = cellSize();
    const { rx, ry } = regionOffset();
    const mouseGx = Math.round((e.clientX - rx) / cs);
    const mouseGy = Math.round((e.clientY - ry) / cs);
    let x1 = regionX, y1 = regionY, x2 = regionX + regionW, y2 = regionY + regionH;
    if (draggingHandle.affL) x1 = Math.min(mouseGx, x2 - 1);
    if (draggingHandle.affR) x2 = Math.max(mouseGx, x1 + 1);
    if (draggingHandle.affT) y1 = Math.min(mouseGy, y2 - 1);
    if (draggingHandle.affB) y2 = Math.max(mouseGy, y1 + 1);
    applyRegion(x1, y1, x2 - x1, y2 - y1);
    canvas.style.cursor = HANDLE_CURSORS[draggingHandle.id];
    return;
  }

  // Area selection preview
  if (selectingArea && selectStart) {
    selectEnd = hoverCell;
    return;
  }

  // Update cursor: check for handle hover
  if (!playing) {
    if (selectingArea || selectedShape) {
      canvas.style.cursor = 'crosshair';
    } else {
      const h = handleAt(e);
      canvas.style.cursor = h ? HANDLE_CURSORS[h.id] : 'default';
    }
  }

  // Cell painting drag
  if (playing || painting === null || selectedShape) return;
  paint(hoverCell.gx, hoverCell.gy, painting);
});

canvas.addEventListener('mouseleave', () => {
  hoverCell      = null;
  painting       = null;
  draggingHandle = null;
  if (selectingArea) { selectStart = null; selectEnd = null; }
});

canvas.addEventListener('mouseup', () => {
  if (draggingHandle) { draggingHandle = null; return; }

  if (selectingArea && selectStart && selectEnd) {
    const x1 = Math.min(selectStart.gx, selectEnd.gx);
    const y1 = Math.min(selectStart.gy, selectEnd.gy);
    const x2 = Math.max(selectStart.gx, selectEnd.gx);
    const y2 = Math.max(selectStart.gy, selectEnd.gy);
    applyRegion(x1, y1, x2 - x1 + 1, y2 - y1 + 1);
    selectingArea = false;
    selectStart   = null;
    selectEnd     = null;
    updateUI();
    return;
  }

  painting = null;
});

// ── UI ─────────────────────────────────────────────────────────────────────
const playBtn    = document.getElementById('playBtn')!;
const bpmDisplay = document.getElementById('bpmDisplay')!;
const clearBtn   = document.getElementById('clearBtn') as HTMLButtonElement;
const hint       = document.getElementById('hint')!;
const soundSel   = document.getElementById('soundSelect') as HTMLSelectElement;
const scaleSel   = document.getElementById('scaleSelect') as HTMLSelectElement;
const keySel     = document.getElementById('keySelect') as HTMLSelectElement;
const octaveSel  = document.getElementById('octaveSelect') as HTMLSelectElement;
const shapeContainer = document.getElementById('shapeButtons')!;
const selectAreaBtn  = document.getElementById('selectAreaBtn') as HTMLButtonElement;

// Populate sound selector
for (const preset of SOUND_PRESETS) {
  const opt = document.createElement('option');
  opt.value       = preset.id;
  opt.textContent = preset.name;
  soundSel.appendChild(opt);
}

soundSel.addEventListener('change', () => {
  const preset = SOUND_PRESETS.find(p => p.id === soundSel.value);
  if (!preset) return;
  activeSynth.dispose();
  currentPreset = preset;
  activeSynth   = preset.make();
});

// Populate scale selector
for (const [id, scale] of Object.entries(SCALES)) {
  const opt = document.createElement('option');
  opt.value       = id;
  opt.textContent = scale.label;
  scaleSel.appendChild(opt);
}

scaleSel.addEventListener('change', () => {
  const scale = SCALES[scaleSel.value];
  if (scale) { selectedScale = scale; rebuildNotes(); }
});

// Populate key selector
for (const note of CHROMATIC) {
  const opt = document.createElement('option');
  opt.value       = note;
  opt.textContent = note;
  keySel.appendChild(opt);
}
keySel.value = selectedKey;

keySel.addEventListener('change', () => {
  selectedKey = keySel.value;
  rebuildNotes();
});

// Populate octave selector
for (let oct = 2; oct <= 7; oct++) {
  const opt = document.createElement('option');
  opt.value       = String(oct);
  opt.textContent = `C${oct}`;
  octaveSel.appendChild(opt);
}
octaveSel.value = String(selectedOctave);

octaveSel.addEventListener('change', () => {
  selectedOctave = parseInt(octaveSel.value);
  rebuildNotes();
});

function rebuildNotes() {
  NOTES = buildNotes(selectedScale, regionH, selectedKey, selectedOctave);
}

selectAreaBtn.addEventListener('click', () => {
  if (playing) return;
  selectingArea = !selectingArea;
  if (selectingArea) { selectedShape = null; selectStart = null; selectEnd = null; }
  updateUI();
});

// Populate shape buttons
for (const [id, { label }] of Object.entries(SHAPES)) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.dataset['shape'] = id;
  btn.addEventListener('click', () => {
    if (playing) return;
    selectedShape = selectedShape === id ? null : id;
    updateUI();
  });
  shapeContainer.appendChild(btn);
}

/**
 * Syncs every UI element to the current app state.
 * Called after any state change that affects the controls: play/pause,
 * BPM change, shape selection, or clear. Centralising this avoids scattered
 * per-element updates across the codebase.
 */
function updateUI() {
  playBtn.textContent    = playing ? '⏸' : '▶';
  clearBtn.disabled      = playing;
  bpmDisplay.textContent = String(bpm);

  // Shape buttons
  for (const btn of Array.from(shapeContainer.querySelectorAll('button'))) {
    const b = btn as HTMLButtonElement;
    b.disabled = playing;
    b.classList.toggle('active', b.dataset['shape'] === selectedShape);
  }

  // Select area button
  selectAreaBtn.disabled = playing;
  selectAreaBtn.classList.toggle('active', selectingArea);

  // Hint
  if (playing) {
    hint.textContent = '';
  } else if (selectingArea) {
    hint.textContent = 'drag to draw new area — Esc to cancel';
  } else if (selectedShape) {
    hint.textContent = `placing ${SHAPES[selectedShape].label} — click to place, Esc to cancel`;
  } else {
    hint.textContent = 'paused — click or drag to draw cells; drag handles to resize area';
  }

  // Cursor
  canvas.style.cursor = (!playing && (selectedShape || selectingArea)) ? 'crosshair' : 'default';
}

document.getElementById('bpmDown')!.addEventListener('click', () => {
  bpm    = Math.max(40, bpm - 10);
  beatMs = 60000 / bpm;
  bpmDisplay.textContent = String(bpm);
});

document.getElementById('bpmUp')!.addEventListener('click', () => {
  bpm    = Math.min(480, bpm + 10);
  beatMs = 60000 / bpm;
  bpmDisplay.textContent = String(bpm);
});

clearBtn.addEventListener('click', () => {
  if (playing) return;
  current = new Set();
});

playBtn.addEventListener('click', async () => {
  await Tone.start();
  playing ? stopPlaying() : startPlaying();
});

document.addEventListener('keydown', async e => {
  if (e.code === 'Space') {
    e.preventDefault();
    await Tone.start();
    playing ? stopPlaying() : startPlaying();
  }
  if (e.code === 'Escape') {
    selectedShape = null;
    selectingArea = false;
    selectStart   = null;
    selectEnd     = null;
    updateUI();
  }
});

// ── Boot ───────────────────────────────────────────────────────────────────
resize();
window.addEventListener('resize', resize);
updateUI();
requestAnimationFrame(loop);
