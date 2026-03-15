# Conway's Life Music

A browser toy that runs Conway's Game of Life and turns it into a step sequencer. A red scan line sweeps across a 20×20 grid, playing musical notes whenever it crosses a live cell — lower cells play lower notes, higher cells play higher notes.

## How it works

### Game of Life

The grid is infinite and stored as a **sparse set** of live cell coordinates (`Set<string>` with `"x,y"` keys). Each generation is computed by counting live neighbors around every currently-live cell and applying the standard rules:

- A live cell with 2 or 3 neighbors survives
- A dead cell with exactly 3 neighbors becomes alive
- All others die or stay dead

### The scan line sequencer

A red vertical line sweeps left to right across a highlighted **20×20 region** in the center of the canvas, one column per beat (default 120 BPM). Each full sweep of 20 columns = one generation.

The scan line doubles as a reveal animation for the next generation:

- **Inside the highlighted region:** as the line crosses each column, cells in that column flip to their next-generation state
- **Outside the highlighted region:** all cells update simultaneously when the sweep completes

### Music

When the scan line crosses a column, it plays a note for each **live cell** in that column (in the upcoming generation state). Notes are mapped to the selected scale based on the cell's row — bottom row plays the lowest note, top row plays the highest. Available scales: Major Pentatonic, Minor Pentatonic, Major, Minor, Whole Tone, Octatonic, Chromatic.

The synth is a `PolySynth` using a triangle oscillator with a short envelope, so chords are possible when multiple cells are alive in the same column.

### Rendering

- Full-screen canvas with black background
- Cell size: `min(viewport width, viewport height) × 0.75 / 20`
- Cells are rounded squares: white when alive, dark gray when dead
- A thin border marks the active 20×20 sequencer region

## Controls

| Control | Action |
|---|---|
| `Space` or `▶` button | Play / pause |
| `−` / `+` buttons | Decrease / increase BPM by 10 |
| Click or drag (while paused) | Toggle cells alive / dead |

When paused, the scan line disappears. Pressing play restarts the sweep from column 0.

## Development

```sh
npm install
npm run dev
```

Requires Node.js. Built with [Vite](https://vitejs.dev/) and [Tone.js](https://tonejs.github.io/).
