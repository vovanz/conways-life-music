// Offsets are [dx, dy] from top-left of bounding box.
// Placement centers the bounding box on the clicked cell.
export const SHAPES: Record<string, { label: string; cells: [number, number][] }> = {
  glider:  { label: 'Glider',       cells: [[1,0],[2,1],[0,2],[1,2],[2,2]] },
  blinker: { label: 'Blinker',      cells: [[0,0],[1,0],[2,0]] },
  block:   { label: 'Block',        cells: [[0,0],[1,0],[0,1],[1,1]] },
  beehive: { label: 'Beehive',      cells: [[1,0],[2,0],[0,1],[3,1],[1,2],[2,2]] },
  loaf:    { label: 'Loaf',         cells: [[1,0],[2,0],[0,1],[3,1],[1,2],[3,2],[2,3]] },
  toad:    { label: 'Toad',         cells: [[1,0],[2,0],[3,0],[0,1],[1,1],[2,1]] },
  beacon:  { label: 'Beacon',       cells: [[0,0],[1,0],[0,1],[2,2],[3,2],[2,3],[3,3]] },
  lwss:    { label: 'LWSS',         cells: [[1,0],[4,0],[0,1],[0,2],[4,2],[0,3],[1,3],[2,3],[3,3]] },
  rpent:   { label: 'R-pentomino',  cells: [[1,0],[2,0],[0,1],[1,1],[1,2]] },
};

/**
 * Returns a shape's cell offsets together with the centering adjustments (ox, oy).
 * Used both for preview rendering and final placement so the click point always
 * lands at the visual center of the shape rather than its top-left corner.
 */
export function shapeOffsets(id: string): { cells: [number, number][]; ox: number; oy: number } {
  const { cells } = SHAPES[id];
  const maxX = Math.max(...cells.map(([dx]) => dx));
  const maxY = Math.max(...cells.map(([, dy]) => dy));
  return { cells, ox: Math.floor(maxX / 2), oy: Math.floor(maxY / 2) };
}
