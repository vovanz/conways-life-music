import { Grid, key } from './life';
import { shapeOffsets } from './shapes';
import {
  COLOR_BACKGROUND,
  COLOR_CELL_DEAD,
  COLOR_CELL_ALIVE,
  COLOR_REGION_BORDER,
  COLOR_SHAPE_PREVIEW,
  COLOR_SCAN_LINE,
} from './colors';

export const GAP       = 2;
export const BASE_CELL = 30;

// ── Offscreen cell-layer cache ──────────────────────────────────────────────
// The cell layer (background + all cells) is drawn onto an offscreen canvas
// and only redrawn when something relevant actually changes. Every frame we
// just blit the cached layer and then draw the transient overlays on top.
let _cellCanvas: HTMLCanvasElement | null = null;
let _cellCtx: CanvasRenderingContext2D | null = null;
const _prev = {
  canvasW:  0,     canvasH:  0,
  camX:     NaN,   camY:     NaN,   zoom:    NaN,
  scanCol:  -1,    playing:  false as boolean,
  regionX:  NaN,   regionY:  NaN,   regionW: NaN,   regionH: NaN,
  current:      null as Grid | null,
  next:         null as Grid | null,
  cellsVersion: -1,
};

export const DUR_BEATS: Record<string, number> = {
  '16n': 0.25, '8n': 0.5, '4n': 1.0, '2n': 2.0,
};

export interface GlowEntry {
  startMs:   number;
  attackMs:  number;
  holdMs:    number;
  releaseMs: number;
}

export const HANDLES = [
  { id: 'tl', fx: 0,   fy: 0,   affL: true,  affR: false, affT: true,  affB: false },
  { id: 'tc', fx: 0.5, fy: 0,   affL: false, affR: false, affT: true,  affB: false },
  { id: 'tr', fx: 1,   fy: 0,   affL: false, affR: true,  affT: true,  affB: false },
  { id: 'ml', fx: 0,   fy: 0.5, affL: true,  affR: false, affT: false, affB: false },
  { id: 'mr', fx: 1,   fy: 0.5, affL: false, affR: true,  affT: false, affB: false },
  { id: 'bl', fx: 0,   fy: 1,   affL: true,  affR: false, affT: false, affB: true  },
  { id: 'bc', fx: 0.5, fy: 1,   affL: false, affR: false, affT: false, affB: true  },
  { id: 'br', fx: 1,   fy: 1,   affL: false, affR: true,  affT: false, affB: true  },
] as const;

export type Handle = typeof HANDLES[number];

export const HANDLE_CURSORS: Record<string, string> = {
  tl: 'nw-resize', tc: 'n-resize',  tr: 'ne-resize',
  ml: 'w-resize',                    mr: 'e-resize',
  bl: 'sw-resize', bc: 's-resize',  br: 'se-resize',
};

export interface RenderState {
  canvas:        HTMLCanvasElement;
  ctx:           CanvasRenderingContext2D;
  current:       Grid;
  next:          Grid;
  playing:       boolean;
  scanCol:       number;
  regionX:       number;
  regionY:       number;
  regionW:       number;
  regionH:       number;
  camX:          number;
  camY:          number;
  zoom:          number;
  selectedShape: string | null;
  shapeRotations: Record<string, number>;
  hoverCell:     { gx: number; gy: number } | null;
  glowingCells:  Map<string, GlowEntry>;
  selectingArea: boolean;
  selectStart:   { gx: number; gy: number } | null;
  selectEnd:     { gx: number; gy: number } | null;
  cellsVersion:  number;
}

/**
 * Returns the *visual* alive state for a cell during a frame.
 * Inside the sequencer region, columns that the scan line has already passed
 * this beat are read from `next` rather than `current`, so the display stays
 * in sync with the notes that were already triggered.
 */
function isAlive(s: RenderState, gx: number, gy: number): boolean {
  const inRegion = gx >= s.regionX && gx < s.regionX + s.regionW &&
                   gy >= s.regionY && gy < s.regionY + s.regionH;
  if (s.playing && inRegion && gx < s.regionX + s.scanCol) return s.next.has(key(gx, gy));
  return s.current.has(key(gx, gy));
}

/**
 * Draws one complete frame: all visible cells, the glow overlay for recently
 * triggered notes (advancing and expiring entries in `glowingCells` as a
 * side effect), a shape-placement ghost when one is selected, the sequencer
 * region border plus scan line during playback, resize handles when paused,
 * and the dashed area-selection rectangle while the user is drawing a new
 * region.
 */
export function render(s: RenderState): void {
  const { canvas, ctx, camX, camY, zoom, playing, scanCol,
          regionX, regionY, regionW, regionH,
          selectedShape, shapeRotations, hoverCell,
          glowingCells, selectingArea, selectStart, selectEnd } = s;

  const cs = BASE_CELL * zoom;
  const w  = canvas.width;
  const h  = canvas.height;

  const inner  = Math.max(0, cs - GAP);
  const radius = inner * 0.2;

  const minGx = Math.floor(-camX / cs) - 1;
  const minGy = Math.floor(-camY / cs) - 1;
  const maxGx = Math.ceil((w - camX) / cs) + 1;
  const maxGy = Math.ceil((h - camY) / cs) + 1;

  // Ensure offscreen canvas exists and matches main canvas size
  if (!_cellCanvas) {
    _cellCanvas = document.createElement('canvas');
    _cellCtx    = _cellCanvas.getContext('2d')!;
  }
  if (_cellCanvas.width !== w || _cellCanvas.height !== h) {
    _cellCanvas.width  = w;
    _cellCanvas.height = h;
    _prev.current = null; // force full redraw after resize
  }
  const cellCtx = _cellCtx!;

  // Redraw cell layer only when something that affects it has changed
  const dirty =
    s.cellsVersion !== _prev.cellsVersion ||
    s.current !== _prev.current ||
    s.next    !== _prev.next    ||
    scanCol   !== _prev.scanCol ||
    playing   !== _prev.playing ||
    camX      !== _prev.camX   ||
    camY      !== _prev.camY   ||
    zoom      !== _prev.zoom   ||
    regionX   !== _prev.regionX ||
    regionY   !== _prev.regionY ||
    regionW   !== _prev.regionW ||
    regionH   !== _prev.regionH;

  if (dirty) {
    cellCtx.fillStyle = COLOR_BACKGROUND;
    cellCtx.fillRect(0, 0, w, h);
    for (let gx = minGx; gx <= maxGx; gx++) {
      for (let gy = minGy; gy <= maxGy; gy++) {
        const px = camX + gx * cs + GAP / 2;
        const py = camY + gy * cs + GAP / 2;
        cellCtx.fillStyle = isAlive(s, gx, gy) ? COLOR_CELL_ALIVE : COLOR_CELL_DEAD;
        cellCtx.beginPath();
        (cellCtx as any).roundRect(px, py, inner, inner, radius);
        cellCtx.fill();
      }
    }
    _prev.cellsVersion = s.cellsVersion;
    _prev.current = s.current;
    _prev.next    = s.next;
    _prev.scanCol = scanCol;
    _prev.playing = playing;
    _prev.camX    = camX;
    _prev.camY    = camY;
    _prev.zoom    = zoom;
    _prev.regionX = regionX;
    _prev.regionY = regionY;
    _prev.regionW = regionW;
    _prev.regionH = regionH;
  }

  // Blit cell layer (includes background) onto the main canvas
  ctx.drawImage(_cellCanvas, 0, 0);

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
    if (cs >= 5) {
      ctx.save();
      ctx.shadowColor = `rgba(255, 200, 80, ${intensity})`;
      ctx.shadowBlur  = inner * 1.5 * intensity;
      ctx.fillStyle   = `rgba(255, 210, 100, ${intensity * 0.6})`;
      ctx.beginPath();
      (ctx as any).roundRect(px, py, inner, inner, radius);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = `rgba(255, 210, 100, ${intensity})`;
      ctx.beginPath();
      (ctx as any).roundRect(px, py, inner, inner, radius);
      ctx.fill();
    }
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
