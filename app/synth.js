// Piano: the Salamander Grand Piano (Yamaha C5, by Alexander Holm, CC-BY 3.0), one sample every
// three semitones in public/sounds/piano/, pitched to the notes in between. A held chord rings for
// the sample's full natural length (16 s around middle C) and is damped when the key comes up.
// Until the samples have decoded (the first press or two) a small synthesized piano stands in.
import { freq } from "./theory.mjs";

let ctx, master, wave, noise, meter, buffers = null, decoding = false;

// [midi, file]: A0, C1 D♯1 F♯1 A1 … A7, C8
const SAMPLES = [[21, "A0"], [108, "C8"]];
for (let o = 1; o <= 7; o++) [["C", 0], ["Ds", 3], ["Fs", 6], ["A", 9]].forEach(([n, i]) => SAMPLES.push([12 * (o + 1) + i, n + o]));
const files = typeof window === "undefined" ? null
  : Promise.all(SAMPLES.map(([, f]) => fetch(`/sounds/piano/${f}.mp3`).then((r) => r.arrayBuffer())));

async function decode() {
  decoding = true;
  try {
    const data = await files;
    const decoded = await Promise.all(data.map((d) => ctx.decodeAudioData(d)));
    buffers = SAMPLES.map(([m], i) => [m, decoded[i]]);
  } catch { decoding = false; }   // stay on the synth; the next press tries again
}

function init() {
  ctx = new AudioContext();
  const comp = ctx.createDynamicsCompressor(), verb = ctx.createConvolver(), wet = ctx.createGain();
  master = ctx.createGain(); master.gain.value = 0.55; wet.gain.value = 0.12;
  // a limiter for big stacked chords only; the defaults (-24 dB, 12:1) squashed the piano to a whisper
  comp.threshold.value = -6; comp.knee.value = 6; comp.ratio.value = 4;
  // reverb impulse: 2.4 s of decaying stereo noise
  const len = ctx.sampleRate * 2.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3; }
  verb.buffer = ir;
  meter = ctx.createAnalyser(); meter.fftSize = 512;
  master.connect(comp); master.connect(verb).connect(wet).connect(comp); comp.connect(meter).connect(ctx.destination);
  wave = ctx.createPeriodicWave(new Float32Array(9), Float32Array.from([0, 1, 0.5, 0.28, 0.16, 0.1, 0.06, 0.03, 0.015]));
  noise = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
  const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function sampleNote(m, t, peak, out) {
  const [sm, buf] = buffers.reduce((a, b) => (Math.abs(b[0] - m) < Math.abs(a[0] - m) ? b : a));
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf; src.playbackRate.value = 2 ** ((m - sm) / 12); g.gain.value = peak * 10;
  src.connect(g).connect(out); src.start(t);
  return src;
}

function synthNote(m, t, peak, out) {
  const f = freq(m), osc = ctx.createOscillator(), lp = ctx.createBiquadFilter(), env = ctx.createGain();
  osc.setPeriodicWave(wave); osc.frequency.value = f; osc.detune.value = Math.random() * 6 - 3;
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(Math.min(f * 10, 14000), t);
  lp.frequency.setTargetAtTime(Math.min(f * 2.5, 14000), t, 0.5);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.004);
  env.gain.setTargetAtTime(peak * 0.4, t + 0.004, 0.12);
  env.gain.setTargetAtTime(0, t + 0.35, Math.max(0.35, 2.2 - (m - 40) * 0.025));
  osc.connect(lp).connect(env).connect(out); osc.start(t); osc.stop(t + 12);
  const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();   // hammer tick
  n.buffer = noise; bp.type = "bandpass"; bp.frequency.value = Math.min(f * 4, 9000); bp.Q.value = 1.5;
  ng.gain.setValueAtTime(peak * 0.25, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  n.connect(bp).connect(ng).connect(out); n.start(t);
  return osc;
}

// play MIDI notes as a chord (strummed by 12 ms); returns a voice with release()
export function play(notes, gain = 1) {
  if (!ctx) init();
  if (ctx.state === "suspended") ctx.resume();
  if (!buffers && !decoding) decode();
  const now = ctx.currentTime, out = ctx.createGain(), peak = (0.32 * gain) / Math.sqrt(notes.length);
  out.connect(master);
  const note = buffers ? sampleNote : synthNote;
  const srcs = notes.map((m, i) => note(m, now + i * 0.012, peak, out));
  return {
    release() {
      const t = ctx.currentTime;
      out.gain.setTargetAtTime(0, t, 0.15);   // the damper
      srcs.forEach((s) => { try { s.stop(t + 1.2); } catch {} });
    },
  };
}

// output loudness right now (RMS, 0..~0.5), for the studio monitors' cones
const buf = new Float32Array(512);
export function level() {
  if (!meter) return 0;
  meter.getFloatTimeDomainData(buf);
  let sum = 0; for (const v of buf) sum += v * v;
  return Math.sqrt(sum / buf.length);
}
