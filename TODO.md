# TODO

## 1. Auto-placement of control bars

Control bars should automatically position themselves on the side of the screen with the most available space (left, right, top, or bottom of the interactive area).

- Measure available space on all four sides on load and on every window resize
- Place bars on the side with the most space
- Items within the bar orient to match: vertical layout when placed on left/right, horizontal layout when placed on top/bottom
- Reposition on every window resize

## 2. ~~Speed control~~ ✓

~~Replace the current BPM control with a unified speed control.~~

~~- Keep the current minimum BPM~~
~~- Default: 240 BPM~~
~~- Maximum: 480 BPM~~

## 3. Resizable interactive area

Users can define a rectangular region of the grid that produces music. The Conway's Life algorithm runs on the full grid regardless; only the selected area is "listened to" for note generation.

- On the canvas, click and drag (or touch and drag on mobile) to draw a rectangle defining the interactive area
- After drawing, drag handles appear on the edges and corners to resize the area
- Visual indicator for the selected area: same style as currently used
- Default on load: full canvas

## 4. Key and octave selectors

Add controls to set the root note from which all scale notes are derived.

- **Key picker**: full chromatic selector — C, C#, D, D#, E, F, F#, G, G#, A, A#, B
- **Octave dropdown**: C2 through C7, default C4 (middle C)

## 5. ~~Split diatonic into major and minor~~ ✓

~~Remove "diatonic" from the scale list. Replace it with two separate entries: "major" and "minor".~~
