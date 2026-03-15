/** One scale entry: the note names within a single octave and the octave to start from. */
export interface Scale {
  label:       string;
  notes:       string[];
  startOctave: number;
}

export const SCALES: Record<string, Scale> = {
  majorPentatonic: {
    label:       'Major pentatonic',
    notes:       ['C', 'D', 'E', 'G', 'A'],
    startOctave: 3,   // 20 rows → C3–A6 (4 octaves)
  },
  minorPentatonic: {
    label:       'Minor pentatonic',
    notes:       ['C', 'Eb', 'F', 'G', 'Bb'],
    startOctave: 3,   // 20 rows → C3–Bb6
  },
  major: {
    label:       'Major',
    notes:       ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
    startOctave: 3,   // 20 rows → C3–E5 (~2.8 octaves)
  },
  minor: {
    label:       'Minor',
    notes:       ['C', 'D', 'Eb', 'F', 'G', 'Ab', 'Bb'],
    startOctave: 3,   // 20 rows → C3–Eb5 (~2.4 octaves)
  },
  wholeTone: {
    label:       'Whole tone',
    notes:       ['C', 'D', 'E', 'F#', 'G#', 'A#'],
    startOctave: 3,   // 20 rows → C3–A#5 (~3.3 octaves)
  },
  octatonic: {
    label:       'Octatonic',
    notes:       ['C', 'D', 'Eb', 'F', 'F#', 'G#', 'A', 'B'],
    startOctave: 3,   // 20 rows → C3–D5 (2.5 octaves)
  },
  chromatic: {
    label:       'Chromatic',
    notes:       ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
    startOctave: 4,   // 20 rows → C4–G#5 (~1.7 octaves)
  },
};

/**
 * Builds the NOTES array for a given scale and grid height.
 * Row 0 (top) gets the highest note, row (region-1) (bottom) gets the lowest,
 * ascending stepwise through the scale across octaves.
 */
export function buildNotes(scale: Scale, region: number): string[] {
  return Array.from({ length: region }, (_, row) => {
    const idx    = region - 1 - row;
    const octave = scale.startOctave + Math.floor(idx / scale.notes.length);
    return `${scale.notes[idx % scale.notes.length]}${octave}`;
  });
}
