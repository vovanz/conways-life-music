# Conway's Life Music — Notes

## Synth

Tone.js `Synth` with triangle oscillator and short envelope:

```js
new Tone.Synth({
  oscillator: { type: "triangle" },
  envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.4 }
}).toDestination()
```

## Conway's Game of Life

Use **sparse set** approach — store only live cell coordinates (e.g. `Set<string>` with `"x,y"` keys).

## Rendering

- Full-screen canvas (100vw × 100vh)
- Black background
- Cell size: `Math.min(window.innerWidth, window.innerHeight) * 0.75 / 20`
- Cells are squares with rounded corners
  - Dead cells: dark gray
  - Alive cells: white
- A 20×20 cell square centered in the canvas, with a border drawn around the region

## Music

- A red vertical scan line sweeps left to right across the 20×20 highlighted region, repeatedly
- When the scan line crosses a live cell, it triggers a note
- Notes are mapped to the **C-major pentatonic scale** based on the cell's row:
  - Lower row (closer to bottom) → lower note
  - Higher row (closer to top) → higher note
- Tempo: 120 BPM default, one column per beat
- One generation advances per full sweep (20 beats)
- The scan line reveals the next generation progressively:
  - Inside the highlighted region: cells flip to their next state as the line crosses each column
  - Outside the highlighted region: all cells update simultaneously when the sweep completes
- UI controls to adjust BPM

## Interaction

- Spacebar (or a play/pause button) toggles play/pause
- While paused:
  - Scan line is hidden
  - User can click or click-drag to toggle cells alive/dead anywhere on the grid
- On resume: sweep restarts from the leftmost column of the highlighted region
- Synth: triangle oscillator with short envelope (see Synth section above)
