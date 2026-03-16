# Conway's Life Music

**[Live demo](https://vovanz.github.io/conways-life-music/)**

A browser toy that runs Conway's Game of Life and turns it into a step sequencer. A red scan line sweeps across a resizable region of the grid, playing musical notes whenever it crosses a live cell — lower cells play lower notes, higher cells play higher notes.

## How it works

### Game of Life

The grid is infinite and stored as a **sparse set** of live cell coordinates (`Set<string>` with `"x,y"` keys). Each generation is computed by counting live neighbors around every currently-live cell and applying the standard rules:

- A live cell with 2 or 3 neighbors survives
- A dead cell with exactly 3 neighbors becomes alive
- All others die or stay dead

### The scan line sequencer

A red vertical line sweeps left to right across a highlighted region (default 20×20, resizable by dragging its handles or drawing a new area). One column per beat, default 240 BPM (adjustable 40–480). One full sweep = one generation.

The scan line doubles as a reveal animation for the next generation: as it crosses each column, cells in that column flip to their next-generation state. Outside the region, cells update all at once when the sweep completes.

**Pre-trigger:** audio fires slightly before the scan line visually advances (by the preset's attack time), so the sound onset lands on the beat rather than after it. A warm amber **glow** blooms on cells that are about to play, fades through the note duration, then releases — following the same ADSR envelope as the audio.

### Music

When the scan line crosses a column it plays a note for each live cell in that column. Notes are mapped to the selected scale by row position — bottom row is the lowest note, top row is the highest. Available scales: Major Pentatonic, Minor Pentatonic, Major, Minor, Whole Tone, Octatonic, Chromatic. Root key (C–B) and base octave (C2–C7) are selectable.

**Sound presets:** Arp, Warm, Pluck, Bell, Pad, Marimba, Bass, Piano. Each preset has its own oscillator type, envelope, and timing parameters.

### Rendering

- Full-screen canvas with black background
- Cells are rounded squares: white when alive, dark gray when dead
- Glowing amber overlay on cells currently playing (intensity follows the preset envelope)
- A thin border marks the active sequencer region with drag handles for resizing
- The grid behaves like a map: pan by dragging, zoom with scroll/pinch toward cursor
- **Landscape viewport**: controls split into two vertical bars on the left and right edges
- **Portrait viewport**: controls split into two horizontal bars on the top and bottom edges
- On orientation change the camera resets to center the region in the available space

## Controls

### Transport bar

| Control | Action |
|---|---|
| `Space` or `▶` | Play / pause |
| `⏭` (hold to repeat) | Skip to next generation |
| `−` / `+` | Decrease / increase BPM by 10 |
| Sound | Select sound preset |
| Scale | Select musical scale |
| Key / Octave | Root note and base octave |
| Clear | Clear all cells |
| Randomize | Fill sequencer region with ~30% random live cells |

### Canvas interactions

| Control | Action |
|---|---|
| Click / tap | Toggle cell (drag mode) or paint cell (paint mode) |
| Drag / touch-drag | Pan the grid (drag mode) or paint cells (paint mode) |
| Double-click / double-tap | Pan the grid (paint mode) |
| Scroll wheel / pinch | Zoom toward cursor |
| Drag handles on region border | Resize the sequencer area |
| `Esc` | Cancel shape placement or area selection |

### Shape bar

| Control | Action |
|---|---|
| 🖐️ / 🖌️ | Switch between drag mode and paint mode |
| ↺ / ↻ | Rotate selected shape counterclockwise / clockwise |
| Shape buttons | Select a shape to place (Glider, Blinker, Block, Beehive, Loaf, Toad, Beacon, LWSS, R-pentomino, Glider Gun) |
| Select area | Draw a new sequencer region by dragging |

Rotation is remembered per shape. Pressing `Esc` or clicking the active shape button deselects it.

## Development

```sh
npm install
npm run dev
```

Requires Node.js. Built with [Vite](https://vitejs.dev/) and [Tone.js](https://tonejs.github.io/).
