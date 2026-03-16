export type Grid = Set<string>;

/**
 * Encodes grid coordinates as a `"x,y"` string for use as a Set/Map key.
 * Every cell identity in the codebase flows through this function, so the
 * format must stay stable — callers that parse keys (e.g. the render glow
 * pass) rely on the comma separator and integer formatting.
 */
export function key(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Computes one Conway's Life step and returns the successor generation as a
 * new Set, leaving `grid` unchanged. Callers keep both generations alive
 * simultaneously during playback: `current` drives the visible scan-line
 * column that hasn't been played yet, while `next` is pre-computed so the
 * sequencer can read it without a stall.
 */
export function nextGen(grid: Grid): Grid {
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
