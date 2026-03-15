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

// ── Constants ──────────────────────────────────────────────────────────────
const REGION = 20;
const GAP    = 2;

// C-major pentatonic: row 0 (top) = highest, row 19 (bottom) = lowest
const SCALE = ['C', 'D', 'E', 'G', 'A'] as const;
const NOTES: string[] = Array.from({ length: REGION }, (_, row) => {
  const idx    = REGION - 1 - row;
  const octave = 3 + Math.floor(idx / 5);
  return `${SCALE[idx % 5]}${octave}`;
});

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
let bpm            = 120;
let beatMs         = 60000 / bpm;
let lastBeat       = 0;
let selectedShape: string | null = null;
let hoverCell: { gx: number; gy: number } | null = null;

let currentPreset: SoundPreset = SOUND_PRESETS[0];
let activeSynth:   ActiveSynth = SOUND_PRESETS[0].make();

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
}

/**
 * Returns whether a grid cell should appear alive in the current frame.
 * Inside the sequencer region, columns already passed by the scan line show
 * the next generation's state — creating the progressive reveal animation.
 * Everywhere else the current generation is shown.
 */
function isAlive(gx: number, gy: number): boolean {
  const inRegion = gx >= 0 && gx < REGION && gy >= 0 && gy < REGION;
  if (playing && inRegion && gx < scanCol) return next.has(key(gx, gy));
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
  ctx.strokeStyle = COLOR_REGION_BORDER;
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(rx - 1, ry - 1, REGION * cs + 2, REGION * cs + 2);

  // Scan line
  if (playing) {
    const lx = rx + scanCol * cs;
    ctx.strokeStyle = COLOR_SCAN_LINE;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(lx, ry);
    ctx.lineTo(lx, ry + REGION * cs);
    ctx.stroke();
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
  const notesToPlay: string[] = [];
  for (let row = 0; row < REGION; row++) {
    if (next.has(key(scanCol, row))) notesToPlay.push(NOTES[row]);
  }
  if (notesToPlay.length > 0) activeSynth.play(notesToPlay, currentPreset.dur);

  scanCol++;
  if (scanCol >= REGION) {
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
  const { gx, gy } = cellAt(e);
  if (selectedShape) {
    placeShape(selectedShape, gx, gy);
    return;
  }
  painting = !current.has(key(gx, gy));
  paint(gx, gy, painting);
});

canvas.addEventListener('mousemove', e => {
  hoverCell = cellAt(e);
  if (playing || painting === null || selectedShape) return;
  paint(hoverCell.gx, hoverCell.gy, painting);
});

canvas.addEventListener('mouseleave', () => {
  hoverCell = null;
  painting  = null;
});
canvas.addEventListener('mouseup', () => { painting = null; });

// ── UI ─────────────────────────────────────────────────────────────────────
const playBtn    = document.getElementById('playBtn')!;
const bpmDisplay = document.getElementById('bpmDisplay')!;
const clearBtn   = document.getElementById('clearBtn') as HTMLButtonElement;
const hint       = document.getElementById('hint')!;
const soundSel   = document.getElementById('soundSelect') as HTMLSelectElement;
const shapeContainer = document.getElementById('shapeButtons')!;

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
  playBtn.textContent = playing ? '⏸' : '▶';
  clearBtn.disabled   = playing;

  // Shape buttons
  for (const btn of Array.from(shapeContainer.querySelectorAll('button'))) {
    const b = btn as HTMLButtonElement;
    b.disabled = playing;
    b.classList.toggle('active', b.dataset['shape'] === selectedShape);
  }

  // Hint
  if (playing) {
    hint.textContent = '';
  } else if (selectedShape) {
    hint.textContent = `placing ${SHAPES[selectedShape].label} — click to place, Esc to cancel`;
  } else {
    hint.textContent = 'paused — click or drag to draw cells';
  }

  // Cursor
  canvas.style.cursor = (!playing && selectedShape) ? 'crosshair' : 'default';
}

document.getElementById('bpmDown')!.addEventListener('click', () => {
  bpm    = Math.max(40, bpm - 10);
  beatMs = 60000 / bpm;
  bpmDisplay.textContent = String(bpm);
});

document.getElementById('bpmUp')!.addEventListener('click', () => {
  bpm    = Math.min(240, bpm + 10);
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
    updateUI();
  }
});

// ── Boot ───────────────────────────────────────────────────────────────────
resize();
window.addEventListener('resize', resize);
updateUI();
requestAnimationFrame(loop);
