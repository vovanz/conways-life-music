import * as Tone from 'tone';

/** Shared compressor — all presets route through this before the destination. */
export const compressor = new Tone.Compressor({
  threshold: -12,
  ratio:     4,
  attack:    0.003,
  release:   0.25,
  knee:      6,
}).toDestination();

/** A live synth instance tied to the currently selected sound preset. */
export interface ActiveSynth {
  /** Play a set of notes for the given duration (e.g. '8n', '4n'). */
  play(notes: string[], dur: string): void;
  /** Release all audio nodes. Call when switching presets. */
  dispose(): void;
}

/** A named sound configuration that can construct an ActiveSynth on demand. */
export interface SoundPreset {
  id:       string;
  name:     string;
  /** Tone.js note duration used by the sequencer for this sound (e.g. '8n'). */
  dur:      string;
  /** Milliseconds to pre-trigger audio before advancing the scan line. */
  attackMs:  number;
  /** Milliseconds for the glow to fade out after the note duration ends. */
  releaseMs: number;
  make(): ActiveSynth;
}

/**
 * Wraps a PolySynth in the ActiveSynth interface.
 * Most presets use PolySynth directly, so this avoids repeating the same
 * two-method object literal for each one.
 */
function polyActive(synth: Tone.PolySynth): ActiveSynth {
  return {
    play(notes, dur) { synth.triggerAttackRelease(notes, dur); },
    dispose()        { synth.dispose(); },
  };
}

export const SOUND_PRESETS: SoundPreset[] = [
  {
    id: 'arp', name: 'Arp', dur: '8n', attackMs: 10, releaseMs: 400,
    make() {
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope:   { attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.4 },
      }).connect(compressor);
      s.set({ volume: -10 });
      return polyActive(s);
    },
  },
  {
    id: 'warm', name: 'Warm', dur: '4n', attackMs: 50, releaseMs: 1200,
    make() {
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 20 } as any,
        envelope:   { attack: 0.05, decay: 0.3, sustain: 0.4, release: 1.2 },
      }).connect(compressor);
      s.set({ volume: -10 });
      return polyActive(s);
    },
  },
  {
    id: 'pluck', name: 'Pluck', dur: '8n', attackMs: 0, releaseMs: 500,
    make() {
      const pool = Array.from({ length: 8 }, () =>
        new Tone.PluckSynth({ attackNoise: 1, dampening: 4000, resonance: 0.98 }).connect(compressor)
      );
      let idx = 0;
      return {
        play(notes) {
          for (const note of notes) {
            pool[idx % pool.length].triggerAttack(note);
            idx++;
          }
        },
        dispose() { pool.forEach(s => s.dispose()); },
      };
    },
  },
  {
    id: 'bell', name: 'Bell', dur: '4n', attackMs: 1, releaseMs: 500,
    make() {
      const s = new Tone.PolySynth(Tone.FMSynth, { maxPolyphony: 64,
        harmonicity:        5.1,
        modulationIndex:    32,
        oscillator:         { type: 'sine' },
        envelope:           { attack: 0.001, decay: 1.5, sustain: 0, release: 0.5 },
        modulation:         { type: 'sine' },
        modulationEnvelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.2 },
      } as any).connect(compressor);
      return polyActive(s);
    },
  },
  {
    id: 'pad', name: 'Pad', dur: '2n', attackMs: 300, releaseMs: 2000,
    make() {
      const reverb = new Tone.Reverb({ decay: 4, wet: 0.6 }).connect(compressor);
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fatsine', count: 4, spread: 30 } as any,
        envelope:   { attack: 0.3, decay: 0.5, sustain: 0.9, release: 2 },
      }).connect(reverb);
      s.set({ volume: -12 });
      return {
        play(notes, dur) { s.triggerAttackRelease(notes, dur); },
        dispose()        { s.dispose(); reverb.dispose(); },
      };
    },
  },
  {
    id: 'marimba', name: 'Marimba', dur: '8n', attackMs: 2, releaseMs: 100,
    make() {
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope:   { attack: 0.002, decay: 0.6, sustain: 0, release: 0.1 },
      }).connect(compressor);
      s.set({ volume: -8 });
      return polyActive(s);
    },
  },
  {
    id: 'bass', name: 'Bass', dur: '4n', attackMs: 50, releaseMs: 500,
    make() {
      const s = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope:   { attack: 0.05, decay: 0.2, sustain: 0.8, release: 0.5 },
      }).connect(compressor);
      s.set({ volume: -6 });
      return polyActive(s);
    },
  },
  {
    id: 'piano', name: 'Piano', dur: '4n', attackMs: 10, releaseMs: 1000,
    make() {
      let ready = false;
      const s = new Tone.Sampler({
        urls:    { A4: 'A4.mp3' },
        baseUrl: 'https://tonejs.github.io/audio/salamander/',
        onload:  () => { ready = true; },
      }).connect(compressor);
      // Salamander samples span A0–C8; filter notes outside that range.
      const inRange = (n: string) => {
        const oct = parseInt(n.match(/\d+$/)?.[0] ?? '99');
        return oct >= 0 && oct <= 8;
      };
      return {
        play(notes, dur) { if (ready) { const safe = notes.filter(inRange); if (safe.length) s.triggerAttackRelease(safe, dur); } },
        dispose()        { s.dispose(); },
      };
    },
  },
];
