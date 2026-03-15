import * as Tone from 'tone';

// ── Constants ──────────────────────────────────────────────────────────────
const REGION = 20;
const GAP    = 2;    // px gap between cells

// C-major pentatonic mapped to rows.
// Row 0 = top = highest note, row 19 = bottom = lowest note.
const SCALE = ['C', 'D', 'E', 'G', 'A'] as const;
const NOTES: string[] = Array.from({ length: REGION }, (_, row) => {
  const idx    = REGION - 1 - row;          // row 19 → idx 0, row 0 → idx 19
  const octave = 3 + Math.floor(idx / 5);
  return `${SCALE[idx % 5]}${octave}`;
});
// NOTES[19] = 'C3' (lowest), NOTES[0] = 'A6' (highest)

// ── Game of Life ───────────────────────────────────────────────────────────
type Grid = Set<string>;

function key(x: number, y: number): string {
  return `${x},${y}`;
}

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
let playing  = false;
let scanCol  = 0;
let bpm      = 120;
let beatMs   = 60000 / bpm;
let lastBeat = 0;

// Seed some initial patterns inside the 20×20 region
function seed() {
  // Glider (top-left area)
  [[1,0],[2,1],[0,2],[1,2],[2,2]].forEach(([x,y]) => current.add(key(x, y)));
  // Blinker (center)
  [[9,10],[10,10],[11,10]].forEach(([x,y]) => current.add(key(x, y)));
  // R-pentomino (bottom-right area)
  [[13,14],[14,14],[12,15],[13,15],[13,16]].forEach(([x,y]) => current.add(key(x, y)));
}
seed();

// ── Synth ──────────────────────────────────────────────────────────────────
const synth = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: 'triangle' },
  envelope:   { attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.4 },
}).toDestination();
synth.set({ volume: -10 });

// ── Canvas / rendering ─────────────────────────────────────────────────────
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx    = canvas.getContext('2d')!;

function cellSize(): number {
  return Math.min(window.innerWidth, window.innerHeight) * 0.75 / REGION;
}

function regionOffset(): { rx: number; ry: number } {
  const cs = cellSize();
  return {
    rx: (window.innerWidth  - REGION * cs) / 2,
    ry: (window.innerHeight - REGION * cs) / 2,
  };
}

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

// During a sweep, columns < scanCol in the highlighted region show `next`.
// Everything else shows `current`.
function isAlive(gx: number, gy: number): boolean {
  const inRegion = gx >= 0 && gx < REGION && gy >= 0 && gy < REGION;
  if (playing && inRegion && gx < scanCol) {
    return next.has(key(gx, gy));
  }
  return current.has(key(gx, gy));
}

function render() {
  const cs      = cellSize();
  const { rx, ry } = regionOffset();
  const w = canvas.width;
  const h = canvas.height;

  // Background
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  const inner  = cs - GAP;
  const radius = inner * 0.2;

  // Visible cell range
  const minGx = Math.floor(-rx / cs) - 1;
  const minGy = Math.floor(-ry / cs) - 1;
  const maxGx = Math.ceil((w - rx) / cs) + 1;
  const maxGy = Math.ceil((h - ry) / cs) + 1;

  for (let gx = minGx; gx <= maxGx; gx++) {
    for (let gy = minGy; gy <= maxGy; gy++) {
      const px = rx + gx * cs + GAP / 2;
      const py = ry + gy * cs + GAP / 2;
      ctx.fillStyle = isAlive(gx, gy) ? '#f0f0f0' : '#1c1c1c';
      ctx.beginPath();
      (ctx as any).roundRect(px, py, inner, inner, radius);
      ctx.fill();
    }
  }

  // Highlighted region border
  ctx.strokeStyle = '#444';
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(rx - 1, ry - 1, REGION * cs + 2, REGION * cs + 2);

  // Scan line (only while playing)
  if (playing) {
    const lx = rx + scanCol * cs;
    ctx.strokeStyle = 'rgba(220, 50, 50, 0.9)';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(lx, ry);
    ctx.lineTo(lx, ry + REGION * cs);
    ctx.stroke();
  }
}

// ── Sequencer ──────────────────────────────────────────────────────────────
function onBeat() {
  // Play notes for live cells in this column of the next generation
  const notesToPlay: string[] = [];
  for (let row = 0; row < REGION; row++) {
    if (next.has(key(scanCol, row))) {
      notesToPlay.push(NOTES[row]);
    }
  }
  if (notesToPlay.length > 0) {
    synth.triggerAttackRelease(notesToPlay, '8n');
  }

  scanCol++;

  if (scanCol >= REGION) {
    // End of sweep: advance generation
    current = next;
    next    = nextGen(current);
    scanCol = 0;
  }
}

// ── Main loop ──────────────────────────────────────────────────────────────
function loop(ts: number) {
  if (playing && ts - lastBeat >= beatMs) {
    lastBeat += beatMs;
    onBeat();
  }
  render();
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
  updateUI();
}

// ── Cell editing (while paused) ────────────────────────────────────────────
let painting: boolean | null = null;

function cellAt(e: MouseEvent): { gx: number; gy: number } {
  const cs      = cellSize();
  const { rx, ry } = regionOffset();
  return {
    gx: Math.floor((e.clientX - rx) / cs),
    gy: Math.floor((e.clientY - ry) / cs),
  };
}

function paint(gx: number, gy: number, alive: boolean) {
  const k = key(gx, gy);
  if (alive) current.add(k);
  else       current.delete(k);
}

canvas.addEventListener('mousedown', e => {
  if (playing) return;
  const { gx, gy } = cellAt(e);
  painting = !current.has(key(gx, gy));
  paint(gx, gy, painting);
});

canvas.addEventListener('mousemove', e => {
  if (playing || painting === null) return;
  const { gx, gy } = cellAt(e);
  paint(gx, gy, painting);
});

canvas.addEventListener('mouseup',    () => { painting = null; });
canvas.addEventListener('mouseleave', () => { painting = null; });

// ── UI ─────────────────────────────────────────────────────────────────────
const playBtn    = document.getElementById('playBtn')!;
const bpmDisplay = document.getElementById('bpmDisplay')!;
const hint       = document.getElementById('hint')!;

function updateUI() {
  playBtn.textContent = playing ? '⏸' : '▶';
  hint.style.display  = playing ? 'none' : 'block';
  bpmDisplay.textContent = String(bpm);
}

document.getElementById('bpmDown')!.addEventListener('click', () => {
  bpm    = Math.max(40, bpm - 10);
  beatMs = 60000 / bpm;
  updateUI();
});

document.getElementById('bpmUp')!.addEventListener('click', () => {
  bpm    = Math.min(240, bpm + 10);
  beatMs = 60000 / bpm;
  updateUI();
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
});

// ── Boot ───────────────────────────────────────────────────────────────────
resize();
window.addEventListener('resize', resize);
updateUI();
requestAnimationFrame(loop);
