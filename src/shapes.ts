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
  ggun:    { label: 'Glider gun',   cells: [[24,0],[22,1],[24,1],[12,2],[13,2],[20,2],[21,2],[34,2],[35,2],[11,3],[15,3],[20,3],[21,3],[34,3],[35,3],[0,4],[1,4],[10,4],[16,4],[20,4],[21,4],[0,5],[1,5],[10,5],[14,5],[16,5],[17,5],[22,5],[24,5],[10,6],[16,6],[24,6],[11,7],[15,7],[12,8],[13,8]] },
};

/** Rotate cells 90° CW `rotations` times, normalized so min coords are 0. */
function rotateCells(cells: [number, number][], rotations: number): [number, number][] {
  let result = cells;
  for (let i = 0; i < rotations % 4; i++) {
    result = result.map(([dx, dy]) => [dy, -dx] as [number, number]);
    const minX = Math.min(...result.map(([x]) => x));
    const minY = Math.min(...result.map(([, y]) => y));
    result = result.map(([x, y]) => [x - minX, y - minY] as [number, number]);
  }
  return result;
}

/**
 * Returns a shape's cell offsets together with the centering adjustments (ox, oy).
 * Used both for preview rendering and final placement so the click point always
 * lands at the visual center of the shape rather than its top-left corner.
 */
export function shapeOffsets(id: string, rotation = 0): { cells: [number, number][]; ox: number; oy: number } {
  const cells = rotateCells(SHAPES[id].cells, rotation);
  const maxX = Math.max(...cells.map(([dx]) => dx));
  const maxY = Math.max(...cells.map(([, dy]) => dy));
  return { cells, ox: Math.floor(maxX / 2), oy: Math.floor(maxY / 2) };
}
