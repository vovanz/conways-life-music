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

export const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Maps a note name (including flats) to its semitone index 0–11. */
function noteToSemitone(name: string): number {
  const enharmonic: Record<string, string> = {
    Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B',
  };
  return CHROMATIC.indexOf(enharmonic[name] ?? name);
}

/**
 * Builds the NOTES array for a given scale, grid height, root note and base octave.
 * Row 0 (top) gets the highest note, row (region-1) (bottom) gets the lowest,
 * ascending stepwise through the scale across octaves.
 * rootNote transposes the scale (e.g. 'D' shifts all notes up by 2 semitones).
 * baseOctave sets the octave of the lowest note.
 */
export function buildNotes(
  scale: Scale,
  region: number,
  rootNote = 'C',
  baseOctave = scale.startOctave,
): string[] {
  const shift = noteToSemitone(rootNote);
  return Array.from({ length: region }, (_, row) => {
    const idx              = region - 1 - row;
    const scaleOctaveOff   = Math.floor(idx / scale.notes.length);
    const noteSemitone     = noteToSemitone(scale.notes[idx % scale.notes.length]);
    const transposed       = noteSemitone + shift;
    const octaveShift      = Math.floor(transposed / 12);
    const note             = CHROMATIC[transposed % 12];
    return `${note}${baseOctave + scaleOctaveOff + octaveShift}`;
  });
}
