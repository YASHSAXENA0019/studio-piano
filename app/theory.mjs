// Chord maths only, no audio or 3D. MIDI note numbers throughout (C4 = 60).
// every note is named by its sharp (Yash reads sharps)
export const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

// suffix shown on the pad, label in the custom-chord picker, intervals in semitones
export const TYPES = {
  maj: { s: "", label: "major", iv: [0, 4, 7] },
  min: { s: "m", label: "minor", iv: [0, 3, 7] },
  7: { s: "7", label: "7", iv: [0, 4, 7, 10] },
  maj7: { s: "maj7", label: "maj7", iv: [0, 4, 7, 11] },
  m7: { s: "m7", label: "m7", iv: [0, 3, 7, 10] },
  sus2: { s: "sus2", label: "sus2", iv: [0, 2, 7] },
  sus4: { s: "sus4", label: "sus4", iv: [0, 5, 7] },
  dim: { s: "°", label: "dim", iv: [0, 3, 6] },
  aug: { s: "+", label: "aug", iv: [0, 4, 8] },
};

// the seven chords of a key
export const MODES = {
  major: { scale: [0, 2, 4, 5, 7, 9, 11], qual: ["maj", "min", "min", "maj", "maj", "min", "dim"], roman: ["I", "ii", "iii", "IV", "V", "vi", "vii°"] },
  minor: { scale: [0, 2, 3, 5, 7, 8, 10], qual: ["min", "dim", "maj", "min", "min", "maj", "maj"], roman: ["i", "ii°", "III", "iv", "v", "VI", "VII"] },
};
export function family(key, mode = "major") {
  const { scale, qual } = MODES[mode];
  return scale.map((d, i) => ({ root: (key + d) % 12, type: qual[i] }));
}
export const chordName = (c) => NAMES[c.root] + TYPES[c.type].s;

// The chord in one octave, root position. Full chords turn to mud at the bottom of the range,
// so octave 1 plays root + fifth and octave 2 adds the root an octave up.
export function voicing({ root, type }, oct) {
  const base = 12 * (oct + 1) + root, iv = TYPES[type].iv;
  const notes = oct === 1 ? [0, iv[2]] : oct === 2 ? [0, iv[2], 12] : iv;
  return notes.map((i) => base + i);
}
// Left hand under the chord: the root as an octave, or root–fifth–octave, two octaves below.
// Octaves 1–2 are already bass voicings, so they get none.
export const HANDS = { off: "off", octave: "octave", fifth: "octave + 5th" };
export function bassNotes({ root, type }, oct, hand) {
  if (hand === "off" || oct <= 2) return [];
  const b = 12 * (oct - 1) + root;
  return hand === "octave" ? [b, b + 12] : [b, b + TYPES[type].iv[2], b + 12];
}
export const noteName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
export const noteNames = (chord, oct) => voicing(chord, oct).map(noteName);
export const freq = (m) => 440 * 2 ** ((m - 69) / 12);
