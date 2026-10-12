// Everything both versions share and neither draws: the 88-key layout, the computer-key maps, and
// useInstrument(), which owns the musical state, the note/chord/sustain API and the only keyboard,
// pointer and wheel listeners. V1 (Studio.jsx) and V2 (Workstation.jsx) only present it.
// Chord mode: 1–8 / Q–I / A–K / Z–, play the chords of the key (a band of four octaves; ↑/↓ moves it,
// ←/→ key, Space major/minor, Tab left hand). Piano mode (DAW layout): Z–/ with S D G H J L ; is the
// lower octave, Q–] with 2 3 5 6 7 9 0 = the upper one; ←/→ octave, Space sustain pedal. ` switches mode.
import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { MODES, HANDS, family, chordName, voicing, noteName, bassNotes } from "./theory.mjs";
import { play } from "./synth";

export const BLACK = new Set([1, 3, 6, 8, 10]);
export const WW = 0.125;   // white-key pitch in scene units; both versions lay the keys out on it
// 88 keys: A0 (21) … C8 (108), 52 white keys centred on x = 0
export const LO = 21, HI = 108, KEYS = [];
for (let m = LO, w = 0; m <= HI; m++) {
  const black = BLACK.has(m % 12);
  KEYS.push({ m, black, x: black ? (w - 0.5 - 25.5) * WW : (w - 25.5) * WW });
  if (!black) w++;
}
export const xOf = (m) => KEYS[Math.max(0, Math.min(KEYS.length - 1, m - LO))].x;
export const OCTS = 8, BAND = 4;
export const KEYROWS = [
  ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8"],
  ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI"],
  ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK"],
  ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma"],
];
export const keyLabel = (code) => ({ Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Equal: "=" }[code] || code.slice(-1));
// piano mode: semitones above the current C
export const PIANO_MAP = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
  KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, Equal: 30, BracketRight: 31,
};
export const PIANO_SPAN = 31;
// where two keys play the same note (, and Q), the key shows the upper row
export const PIANO_LETTER = Object.fromEntries(Object.entries(PIANO_MAP).map(([c, o]) => [o, keyLabel(c)]));
const OCT_GAIN = [0, 1, 1, 1, 1, 1, 0.95, 0.9, 0.8];
export const clampLow = (n) => Math.max(1, Math.min(OCTS - BAND + 1, n));
export const clampBase = (n) => Math.max(24, Math.min(72, n));

// The instrument. `st.keys[m]` holds each key's animation state (press 0..1, dot = chord notes on it),
// read every frame by whichever piano is on screen.
export function useInstrument() {
  const [mode, setModeRaw] = useState("chord");
  const [keyIx, setKey] = useState(0), [scale, setScale] = useState("major"), [hand, setHand] = useState("off");
  const [low, setLow] = useState(3), [custom, setCustom] = useState(null), [now, setNow] = useState(null), [active, setActive] = useState([]);
  const [base, setBase] = useState(48), [sustain, setSustainRaw] = useState(false), [view, setView] = useState(3);
  const rootSel = useRef(), st = useRef(null);
  const chords = useMemo(() => [...family(keyIx, scale), custom], [keyIx, scale, custom]);
  const labels = useMemo(() => chords.map((c) => c && chordName(c)), [chords]);

  if (!st.current) {
    const keys = Object.fromEntries(KEYS.map((k) => [k.m, { press: 0, n: 0, dot: 0 }]));
    const chordVoices = {}, noteVoices = {}, ptr = {};
    // a key is down while anything holds it (a chord and a single note can share keys)
    const hold = (m) => { const k = keys[m]; if (k && k.n++ === 0) gsap.to(k, { press: 1, duration: 0.04, overwrite: true }); };
    const mark = (m, d) => { if (keys[m]) keys[m].dot += d; };   // chord notes: a dot, not a press
    const unhold = (m) => { const k = keys[m]; if (k && k.n && --k.n === 0) gsap.to(k, { press: 0, duration: 0.22, ease: "power2.out", overwrite: true }); };
    const syncActive = () => setActive(Object.keys(chordVoices));
    const api = {
      chords: [], scale: "major", hand: "off", sustain: false,
      chordDown(id) {
        if (chordVoices[id]) return;
        const [c, oct] = id.split("-").map(Number), chord = api.chords[c];
        if (!chord) { try { rootSel.current?.focus(); rootSel.current?.showPicker?.(); } catch {} return; }   // empty custom column
        const bass = bassNotes(chord, oct, api.hand), notes = voicing(chord, oct), all = [...bass, ...notes];
        chordVoices[id] = { v: play(all, OCT_GAIN[oct]), all };
        all.forEach((m) => mark(m, 1));
        const names = (ms) => ms.map(noteName).join("  ");
        setNow({ name: chordName(chord), roman: MODES[api.scale].roman[c] || "custom", notes: (bass.length ? names(bass) + "  |  " : "") + names(notes) });
        syncActive();
      },
      chordUp(id) {
        const cv = chordVoices[id]; if (!cv) return;
        cv.v.release(); cv.all.forEach((m) => mark(m, -1)); delete chordVoices[id];
        syncActive();
      },
      noteDown(m, pointerId) {
        const n = noteVoices[m];
        if (n?.held) return;
        n?.v.release();
        noteVoices[m] = { v: play([m]), held: true };
        hold(m);
        if (pointerId !== undefined) ptr[pointerId] = () => api.noteUp(m);
        setNow({ name: noteName(m), roman: "", notes: "" });
      },
      noteUp(m) {
        const n = noteVoices[m]; if (!n?.held) return;
        n.held = false; unhold(m);
        if (!api.sustain) { n.v.release(); delete noteVoices[m]; }   // with the pedal down it rings on
      },
      pedal(on) {
        api.sustain = on; setSustainRaw(on);
        if (!on) for (const m in noteVoices) if (!noteVoices[m].held) { noteVoices[m].v.release(); delete noteVoices[m]; }
      },
      chordPointer(id, pointerId) { api.chordDown(id); ptr[pointerId] = () => api.chordUp(id); },
      releasePointer(pointerId) { ptr[pointerId]?.(); delete ptr[pointerId]; },
      releaseAll() { Object.keys(chordVoices).forEach(api.chordUp); Object.keys(noteVoices).forEach((m) => api.noteUp(+m)); api.pedal(false); },
    };
    st.current = { keys, api };
  }
  Object.assign(st.current.api, { chords, scale, hand });

  const setMode = (m) => { st.current.api.releaseAll(); setModeRaw(m); };

  const live = useRef({});
  live.current = { mode, low, base };
  useEffect(() => {
    const { api } = st.current, held = {};
    const forget = () => { for (const k in held) delete held[k]; };
    const down = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target.tagName === "SELECT") return;
      const { mode, low, base } = live.current;
      if (e.code === "Backquote") { e.preventDefault(); forget(); api.releaseAll(); return setModeRaw((m) => (m === "chord" ? "piano" : "chord")); }
      if (e.code === "Tab" || e.code === "Space" || e.code.startsWith("Arrow") || e.code === "Quote" || e.code === "Slash") e.preventDefault();
      if (held[e.code]) return;
      if (mode === "piano") {
        if (e.code === "Space") { held.Space = () => api.pedal(false); return api.pedal(true); }
        if (e.code === "ArrowLeft" || e.code === "ArrowRight") return setBase((b) => clampBase(b + (e.code === "ArrowLeft" ? -12 : 12)));
        const off = PIANO_MAP[e.code]; if (off === undefined) return;
        const m = base + off; if (m < 21 || m > 108) return;
        held[e.code] = () => api.noteUp(m); return api.noteDown(m);
      }
      if (e.code === "Space") return setScale((s) => (s === "major" ? "minor" : "major"));
      if (e.code === "Tab") return setHand((h) => { const k = Object.keys(HANDS); return k[(k.indexOf(h) + 1) % k.length]; });
      const arrow = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 1, ArrowDown: -1 }[e.code];
      if (arrow) return e.code === "ArrowLeft" || e.code === "ArrowRight" ? setKey((k) => (k + arrow + 12) % 12) : setLow((l) => clampLow(l + arrow));
      const r = KEYROWS.findIndex((row) => row.includes(e.code)); if (r < 0) return;
      const id = `${KEYROWS[r].indexOf(e.code)}-${low + BAND - 1 - r}`;
      held[e.code] = () => api.chordUp(id); api.chordDown(id);
    };
    // release what the key started, even if the mode, band or octave changed since
    const up = (e) => {
      held[e.code]?.(); delete held[e.code];
      if (e.key === "Meta") { forget(); api.releaseAll(); }   // macOS swallows key-ups while ⌘ is held
    };
    const blur = () => { forget(); api.releaseAll(); };
    const pup = (e) => api.releasePointer(e.pointerId);
    let spin = 0;   // wheel or two-finger swipe: one octave per notch's worth
    const wheel = (e) => {
      if (live.current.mode !== "piano") return;
      spin += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(spin) < 90) return;
      const step = Math.sign(spin) * 12; spin = 0;   // read before the reset: the updater runs later
      setBase((b) => clampBase(b + step));
    };
    addEventListener("wheel", wheel, { passive: true });
    addEventListener("keydown", down); addEventListener("keyup", up); addEventListener("blur", blur); addEventListener("pointerup", pup); addEventListener("pointercancel", pup);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("blur", blur); removeEventListener("pointerup", pup); removeEventListener("pointercancel", pup); removeEventListener("wheel", wheel); };
  }, []);

  // custom chord pickers: a change to either select; empty root clears it
  const pick = (patch) => (e) => {
    const next = { root: custom?.root ?? keyIx, type: custom?.type ?? "maj", ...patch(e.target.value) };
    setCustom(next.root === "" ? null : { root: +next.root, type: next.type });
    e.target.blur();   // hand the keys back to the instrument
  };

  return { st: st.current, api: st.current.api, rootSel, mode, setMode, keyIx, setKey, scale, setScale, hand, setHand, low, setLow,
    custom, pick, now, active, base, setBase, sustain, view, setView, labels };
}
