"use client";
// V1: the 88-key stage piano and chord pad controller on a desk in a dark room. The musical state,
// keyboard input and sound come from engine.js; this file only draws them.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, RoundedBox, SoftShadows } from "@react-three/drei";
import { NAMES, TYPES, MODES, HANDS, noteName } from "./theory.mjs";
import { KEYS, WW, HI, OCTS, BAND, KEYROWS, keyLabel, PIANO_SPAN, PIANO_LETTER, clampLow, clampBase, xOf } from "./engine";

const { damp } = THREE.MathUtils;
const WL = 0.95, BW = 0.072, BL = 0.6, KEY_TOP = 0.22;
// the one colour: red, like the keyboard's speaker rings. Pressed keys, light bars, lit buttons, rings, wall wash
// monochrome: indicators and highlights are white light, everything else black and grey
const ACCENT = "#f4f4f4", ACCENT_DARK = "#3a3a3a";
const ACCENT_C = new THREE.Color(ACCENT);
const font = () => getComputedStyle(document.body).fontFamily;
const hover = (on) => (document.body.style.cursor = on ? "pointer" : "");

const BUMPS = {};
function bump(kind, rx = 1, ry = rx) {
  if (!BUMPS[kind]) {
    const N = 256, h = new Float32Array(N * N), rnd = () => Math.random();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (kind === "weave") h[i] = Math.sin((x / N) * Math.PI * 64) * (y % 8 < 4 ? 1 : -1) * 0.5 + Math.sin((y / N) * Math.PI * 64) * 0.5 + rnd() * 0.3;
      else if (kind === "brushed") h[i] = rnd();
      else h[i] = rnd();
    }
    // soften: grain = small blur both ways, brushed = long blur along x only
    const blur = (rad, alongX, alongY) => {
      const out = new Float32Array(N * N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let sum = 0, n = 0;
        for (let k = -rad; k <= rad; k++) {
          if (alongX) { sum += h[y * N + ((x + k + N) % N)]; n++; }
          if (alongY) { sum += h[((y + k + N) % N) * N + x]; n++; }
        }
        out[y * N + x] = sum / n;
      }
      h.set(out);
    };
    if (kind === "brushed") blur(24, true, false); else blur(1, true, true);
    const c = document.createElement("canvas"); c.width = c.height = N;
    const g = c.getContext("2d"), img = g.createImageData(N, N), k = kind === "weave" ? 2 : 6;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = (h[y * N + (x + 1) % N] - h[y * N + (x - 1 + N) % N]) * k, dy = (h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x]) * k;
      const l = Math.hypot(dx, dy, 1), j = (y * N + x) * 4;
      img.data[j] = (-dx / l * 0.5 + 0.5) * 255; img.data[j + 1] = (-dy / l * 0.5 + 0.5) * 255; img.data[j + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[j + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    BUMPS[kind] = c;
  }
  const t = new THREE.CanvasTexture(BUMPS[kind]);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8;
  return t;
}

function canvasTex(w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- OLED displays (white on black glass)
function drawOLED(tex, s) {
  const c = tex.image, g = c.getContext("2d"), W = c.width, H = c.height, f = font();
  g.fillStyle = "#030303"; g.fillRect(0, 0, W, H);
  const dim = "#6b6b6b", lit = "#f2f2f2";
  g.textBaseline = "alphabetic"; g.textAlign = "left";
  g.font = `600 28px ${f}`; g.fillStyle = dim;
  const head = s.mode === "chord"
    ? `CHORD  ·  ${NAMES[s.keyIx]} ${s.scale.toUpperCase()}  ·  LEFT HAND ${HANDS[s.hand].toUpperCase()}`
    : `PIANO  ·  ${noteName(s.base)} – ${noteName(Math.min(HI, s.base + PIANO_SPAN))}  ·  SUSTAIN ${s.sustain ? "ON" : "OFF"}`;
  g.fillText(head, 32, 50);
  g.fillStyle = lit; g.font = `600 150px ${f}`; g.fillText(s.now ? s.now.name : "—", 28, 220);
  if (s.now) {
    const nameW = g.measureText(s.now.name).width;
    g.font = `500 40px ${f}`; g.fillStyle = "#8a8a8a"; g.fillText(s.now.roman || "", 28 + nameW + 22, 220);
    g.font = `500 32px ${f}`; g.fillStyle = "#b5b5b5"; g.textAlign = "right"; g.fillText(s.now.notes, W - 32, 220);
  }
  g.textAlign = "left"; g.font = `500 24px ${f}`; g.fillStyle = dim;
  g.fillText(s.mode === "chord" ? "← → KEY    ↑ ↓ OCTAVES    SPACE MAJ / MIN    TAB LEFT HAND" : "Z – / LOW    Q – ] HIGH    ← → OCTAVE    SPACE SUSTAIN", 32, H - 34);
  tex.needsUpdate = true;
}

// printed panel legend (light grey silkscreen)
function Legend({ x, z, text, size = 0.05, y = PANEL_Y, w = 0.5 }) {
  const tex = useMemo(() => {
    const t = canvasTex(512, 64), g = t.image.getContext("2d");
    g.fillStyle = "#9c9c9c"; g.textAlign = "center"; g.textBaseline = "middle"; g.font = `600 34px ${font()}`;
    g.letterSpacing = "4px"; g.fillText(text, 256, 34);
    return t;
  }, [text]);
  return <mesh position={[x, y + 0.002, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[w, size]} /><meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} /></mesh>;
}

// ---------------------------------------------------------------- piano
function PianoKey({ k, st, api, letter }) {
  const pivot = useRef(), mat = useRef(), dotRef = useRef();
  const tex = useMemo(() => {
    if (!letter) return null;
    const t = canvasTex(64, 64), g = t.image.getContext("2d");
    g.fillStyle = k.black ? "#f2f2f2" : "#151515"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `700 50px ${font()}`; g.fillText(letter, 32, 35);
    return t;
  }, [letter, k.black]);
  const L = k.black ? BL : WL, w = k.black ? BW : WW - 0.007, h = k.black ? 0.135 : 0.1, lift = k.black ? 0.03 : 0;
  const base = useMemo(() => new THREE.Color(k.black ? "#0e0e0e" : "#f3f3f3"), [k.black]), pressed = useMemo(() => new THREE.Color(k.black ? "#3a3a3a" : "#8f8f8f"), [k.black]), lit = useRef(0);
  useFrame((_, dt) => {
    const s = st.keys[k.m];
    pivot.current.rotation.x = damp(pivot.current.rotation.x, s.press * (k.black ? 0.11 : 0.1), 26, dt);
    lit.current = damp(lit.current, s.press, 18, dt);
    mat.current.color.copy(base).lerp(pressed, lit.current);
    mat.current.emissiveIntensity = k.black ? lit.current * 0.35 : 0;   // black keys light up from inside; white ones shade down
    dotRef.current.material.opacity = damp(dotRef.current.material.opacity, s.dot > 0 || s.press > 0.5 ? 1 : 0, 16, dt);
  });
  const events = {
    onPointerDown: (e) => { e.stopPropagation(); api.noteDown(k.m, e.pointerId); },
    onPointerOver: () => hover(true), onPointerLeave: () => hover(false),
  };
  return (
    <group position={[k.x, KEY_TOP + lift, -0.75]}>
      <group ref={pivot}>
        <RoundedBox args={[w, h, L]} radius={k.black ? 0.012 : 0.007} smoothness={2} position={[0, h / 2, L / 2]} {...events}>
          <meshPhysicalMaterial ref={mat} color={k.black ? "#0e0e0e" : "#f3f3f3"} emissive={ACCENT} emissiveIntensity={0}
            roughness={k.black ? 0.32 : 0.3} clearcoat={k.black ? 1 : 0.5} clearcoatRoughness={k.black ? 0.25 : 0.35} />
        </RoundedBox>
        {/* note marker: chord notes and held keys. Dark on white keys, white on black, so it shows on both */}
        <mesh ref={dotRef} position={[0, h + 0.003, L - (tex ? (k.black ? 0.16 : 0.21) : 0.07)]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[k.black ? 0.02 : 0.026, 20]} />
          <meshBasicMaterial color={k.black ? ACCENT : "#141414"} transparent opacity={0} toneMapped={false} depthWrite={false} />
        </mesh>
        {tex && (
          <mesh position={[0, h + 0.002, L - (k.black ? 0.08 : 0.11)]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[k.black ? 0.068 : 0.108, k.black ? 0.068 : 0.108]} />
            <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
          </mesh>
        )}
      </group>
    </group>
  );
}

// --- an 88-key stage piano: powder-coated steel shell, graphite aluminium end cheeks, charcoal felt key slip,
// pitch/mod wheels, a knurled volume knob, an OLED and a few controls. No brand.
const BODY_W = 6.6, PANEL_Y = 0.4, CHEEK = 0.34;
const PANEL_Z = -1.28;   // centre of the control panel

function SoftButton({ x, z, w = 0.16, d = 0.07, label, lit, onClick }) {
  const led = useRef(), cap = useRef(), litRef = useRef(lit), down = useRef(0);
  litRef.current = lit;
  useFrame((_, dt) => {
    led.current.material.color.lerp(litRef.current ? ACCENT_C : new THREE.Color("#2a2a2a"), Math.min(1, dt * 12));
    down.current = damp(down.current, 0, 12, dt); cap.current.position.y = -down.current * 0.008;
  });
  return (
    <group position={[x, PANEL_Y, z]}>
      <mesh ref={led} position={[0, 0.002, -d / 2 - 0.035]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.011, 16]} /><meshBasicMaterial color="#2a2a2a" toneMapped={false} /></mesh>
      <group ref={cap}>
        <RoundedBox args={[w, 0.022, d]} radius={0.009} smoothness={3} position={[0, 0.011, 0]}
          onPointerDown={(e) => { e.stopPropagation(); down.current = 1; onClick?.(); }} onPointerOver={() => hover(true)} onPointerLeave={() => hover(false)}>
          <meshStandardMaterial color="#1f1f20" roughness={0.75} />
        </RoundedBox>
      </group>
      <Legend x={0} z={d / 2 + 0.04} text={label} size={0.04} w={0.32} y={0} />
    </group>
  );
}

function Knob({ x, z, r = 0.06, label }) {
  return (
    <group position={[x, PANEL_Y, z]}>
      <mesh position={[0, 0.006, 0]}><cylinderGeometry args={[r * 1.25, r * 1.3, 0.012, 48]} /><meshStandardMaterial color="#141414" roughness={0.5} /></mesh>
      <mesh position={[0, 0.04, 0]}><cylinderGeometry args={[r * 0.92, r, 0.065, 48]} /><meshStandardMaterial color="#8d8e91" metalness={1} roughness={0.32} normalMap={bump("brushed", 1, 6)} normalScale={[0.6, 0.6]} /></mesh>
      <mesh position={[0, 0.0735, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[r * 0.9, 48]} /><meshStandardMaterial color="#b8b9bc" metalness={1} roughness={0.22} /></mesh>
      <mesh position={[0, 0.074, -r * 0.55]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.008, r * 0.6]} /><meshBasicMaterial color="#1a1a1a" /></mesh>
      {label && <Legend x={0} z={r + 0.06} text={label} size={0.04} w={0.32} y={0} />}
    </group>
  );
}

function Wheel({ x }) {
  return (
    <group position={[x, PANEL_Y, PANEL_Z]}>
      <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.1, 0.3]} /><meshBasicMaterial color="#030303" /></mesh>
      <mesh position={[0, -0.05, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.13, 0.13, 0.07, 48]} />
        <meshStandardMaterial color="#1b1b1b" roughness={0.9} normalMap={bump("weave", 6, 1)} normalScale={[0.8, 0.8]} />
      </mesh>
    </group>
  );
}

function Piano({ st, lcd, mode, setMode, base }) {
  const oled = useMemo(() => canvasTex(1300, 360), []);
  useEffect(() => drawOLED(oled, lcd));
  const mats = useMemo(() => {
    return {
      shell: new THREE.MeshPhysicalMaterial({ color: "#141414", roughness: 0.55, metalness: 0.35, normalMap: bump("grain", 10, 3), normalScale: new THREE.Vector2(0.12, 0.12), clearcoat: 0.1 }),
      cheek: new THREE.MeshPhysicalMaterial({ color: "#2c2c2e", metalness: 0.85, roughness: 0.34, normalMap: bump("brushed", 1, 4), normalScale: new THREE.Vector2(0.35, 0.35) }),
      felt: new THREE.MeshStandardMaterial({ color: "#1c1c1c", roughness: 1, normalMap: bump("grain", 20, 1), normalScale: new THREE.Vector2(0.8, 0.8) }),
    };
  }, []);
  return (
    <group>
      {/* shell: keybed under the keys, front rail, raised control panel behind */}
      <RoundedBox args={[BODY_W, KEY_TOP, 2.0]} radius={0.04} smoothness={4} position={[0, KEY_TOP / 2, -0.78]} material={mats.shell} />
      <RoundedBox args={[BODY_W, PANEL_Y, 0.94]} radius={0.045} smoothness={4} position={[0, PANEL_Y / 2, -1.31]} material={mats.shell} />
      {/* red felt key slip between the keys and the panel */}
      <mesh position={[0, KEY_TOP + 0.075, -0.79]} material={mats.felt}><boxGeometry args={[52 * WW, 0.15, 0.06]} /></mesh>
      {/* aluminium end cheeks */}
      {[-1, 1].map((sd) => (
        <RoundedBox key={sd} args={[CHEEK, PANEL_Y + 0.06, 2.06]} radius={0.05} smoothness={4} position={[sd * (BODY_W / 2 + CHEEK / 2), (PANEL_Y + 0.06) / 2, -0.78]} material={mats.cheek} />
      ))}
      {/* panel: wheels, volume, mode buttons, OLED, sound controls */}
      <Wheel x={-2.95} /><Wheel x={-2.75} />
      <Legend x={-2.85} z={PANEL_Z + 0.25} text="PITCH   MOD" size={0.04} w={0.36} />
      <Knob x={-2.3} z={PANEL_Z - 0.03} r={0.075} label="VOLUME" />
      <SoftButton x={-1.75} z={PANEL_Z} label="CHORD" lit={mode === "chord"} onClick={() => setMode("chord")} />
      <SoftButton x={-1.48} z={PANEL_Z} label="PIANO" lit={mode === "piano"} onClick={() => setMode("piano")} />
      <RoundedBox args={[1.42, 0.012, 0.46]} radius={0.006} smoothness={2} position={[0, PANEL_Y + 0.006, PANEL_Z]}>
        <meshPhysicalMaterial color="#030303" roughness={0.35} clearcoat={0.4} clearcoatRoughness={0.3} />
      </RoundedBox>
      <mesh position={[0, PANEL_Y + 0.0125, PANEL_Z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[1.3, 0.36]} /><meshBasicMaterial map={oled} toneMapped={false} /></mesh>
      <Knob x={1.35} z={PANEL_Z - 0.03} label="TONE" />
      <Knob x={1.75} z={PANEL_Z - 0.03} label="REVERB" />
      <Knob x={2.15} z={PANEL_Z - 0.03} label="DELAY" />
      <SoftButton x={2.6} z={PANEL_Z} w={0.12} label="LAYER" />
      <SoftButton x={2.85} z={PANEL_Z} w={0.12} label="SPLIT" />
      {KEYS.map((k) => (
        <PianoKey key={k.m} k={k} st={st} api={st.api} letter={mode === "piano" && k.m - base >= 0 ? PIANO_LETTER[k.m - base] : null} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- chord pad controller
// Anodised aluminium unibody, eight backlit silicone pads, an OLED strip naming each pad's chord,
// key letters and octave LEDs printed below each pad; KEY and OCT buttons with a small status OLED on the left.
const CB_Z = 1.1, CB_TOP = 0.12, PAD = 0.42, PAD_X = (col) => -1.2 + col * 0.5;

function drawBarStatus(tex, { keyIx, scale, hand, low }) {
  const g = tex.image.getContext("2d"), W = tex.image.width, H = tex.image.height, f = font();
  g.fillStyle = "#030303"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#f2f2f2"; g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.font = `600 64px ${f}`; g.fillText(`${NAMES[keyIx]} ${scale}`, 22, 78);
  g.fillStyle = "#7a7a7a"; g.font = `600 24px ${f}`;
  g.fillText(`LEFT HAND  ${HANDS[hand].toUpperCase()}`, 22, 130);
  g.fillText(`OCTAVES  ${low} – ${low + BAND - 1}`, 22, 168);
  tex.needsUpdate = true;
}
function drawBarStrip(tex, labels, romans, activeCols) {
  const g = tex.image.getContext("2d"), W = tex.image.width, H = tex.image.height, f = font(), cw = W / 8;
  g.fillStyle = "#030303"; g.fillRect(0, 0, W, H);
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  labels.forEach((name, c) => {
    const cx = cw * c + cw / 2, on = activeCols[c];
    g.fillStyle = on ? "#ffffff" : "#8f8f8f"; g.font = `600 64px ${f}`; g.fillText(name || "+", cx, 78);
    g.fillStyle = "#777"; g.font = `500 28px ${f}`; g.fillText(romans[c], cx, 118);
  });
  tex.needsUpdate = true;
}

function Pad({ col, low, active, api }) {
  const cap = useRef(), mat = useRef(), leds = useRef([]), state = useRef({ on: false, octs: [] });
  state.current.octs = [0, 1, 2, 3].map((j) => active.includes(`${col}-${low + j}`));
  state.current.on = state.current.octs.some(Boolean);
  useFrame((_, dt) => {
    const { on, octs } = state.current;
    cap.current.position.y = damp(cap.current.position.y, on ? -0.012 : 0, 24, dt);
    mat.current.emissiveIntensity = damp(mat.current.emissiveIntensity, on ? 0.55 : 0.0, 14, dt);
    leds.current.forEach((d, j) => d.material.color.lerp(octs[j] ? ACCENT_C : new THREE.Color("#262626"), Math.min(1, dt * 14)));
  });
  return (
    <group position={[PAD_X(col), CB_TOP, CB_Z]}>
      <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[PAD + 0.024, PAD + 0.024]} /><meshStandardMaterial color="#060606" roughness={0.9} /></mesh>
      <group ref={cap}>
        <RoundedBox args={[PAD, 0.05, PAD]} radius={0.024} smoothness={4} position={[0, 0.025, 0]}
          onPointerDown={(e) => { e.stopPropagation(); api.chordPointer(`${col}-${low + 1}`, e.pointerId); }}
          onPointerOver={() => hover(true)} onPointerLeave={() => hover(false)}>
          <meshPhysicalMaterial ref={mat} color="#262626" emissive={ACCENT} emissiveIntensity={0} roughness={0.78} sheen={0.4} sheenRoughness={0.6} sheenColor="#555" />
        </RoundedBox>
      </group>
      {/* below the pad: four octave LEDs over the four keys that play it, low → high */}
      {[0, 1, 2, 3].map((j) => (
        <group key={j} position={[(j - 1.5) * 0.085, 0, PAD / 2 + 0.05]}>
          <mesh ref={(el) => (leds.current[j] = el)} position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.009, 14]} /><meshBasicMaterial color="#262626" toneMapped={false} /></mesh>
          <Legend x={0} z={0.045} text={keyLabel(KEYROWS[BAND - 1 - j][col])} size={0.05} w={0.4} y={0} />
        </group>
      ))}
    </group>
  );
}

function SmallButton({ x, z, text, onClick }) {
  const cap = useRef(), down = useRef(0);
  const tex = useMemo(() => {
    const t = canvasTex(128, 128), g = t.image.getContext("2d");
    g.fillStyle = "#bdbdbd"; g.textAlign = "center"; g.textBaseline = "middle"; g.font = `600 56px ${font()}`; g.fillText(text, 64, 68);
    return t;
  }, [text]);
  useFrame((_, dt) => { down.current = damp(down.current, 0, 10, dt); cap.current.position.y = -down.current * 0.01; });
  return (
    <group position={[x, CB_TOP, z]}>
      <group ref={cap}>
        <RoundedBox args={[0.12, 0.026, 0.12]} radius={0.012} smoothness={3} position={[0, 0.013, 0]}
          onPointerDown={(e) => { e.stopPropagation(); down.current = 1; onClick(); }} onPointerOver={() => hover(true)} onPointerLeave={() => hover(false)}>
          <meshStandardMaterial color="#1f1f20" roughness={0.75} />
        </RoundedBox>
        <mesh position={[0, 0.0275, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.1, 0.1]} /><meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} /></mesh>
      </group>
    </group>
  );
}

function ChordBar({ st, bar, mode, setKey, setLow }) {
  const status = useMemo(() => canvasTex(480, 200), []), strip = useMemo(() => canvasTex(2000, 140), []), root = useRef();
  const romans = bar.labels.map((_, c) => MODES[bar.scale].roman[c] || "custom");
  const activeCols = bar.labels.map((_, c) => bar.active.some((id) => id.startsWith(`${c}-`)));
  useEffect(() => drawBarStatus(status, bar));
  useEffect(() => drawBarStrip(strip, bar.labels, romans, activeCols));
  const metal = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#2d2e31", metalness: 0.85, roughness: 0.36, normalMap: bump("brushed", 3, 1), normalScale: new THREE.Vector2(0.35, 0.35) }), []);
  // sinks into the desk in piano mode, rises back for chords
  useFrame((_, dt) => { root.current.position.y = damp(root.current.position.y, mode === "piano" ? -0.3 : 0, 4, dt); });
  const X0 = -0.1, WID = 5.75;   // spans the left controls through the eighth pad
  return (
    <group ref={root}>
      <RoundedBox args={[WID, CB_TOP, 0.98]} radius={0.04} smoothness={5} position={[X0, CB_TOP / 2, CB_Z]} material={metal} />
      {/* rubber foot line, so it reads as sitting on the desk */}
      <mesh position={[X0, 0.004, CB_Z]}><boxGeometry args={[WID - 0.12, 0.008, 0.86]} /><meshStandardMaterial color="#0a0a0a" roughness={1} /></mesh>
      {/* OLED strip naming each pad's chord */}
      <RoundedBox args={[4.02, 0.008, 0.2]} radius={0.004} smoothness={2} position={[PAD_X(3.5), CB_TOP + 0.004, CB_Z - 0.36]}>
        <meshPhysicalMaterial color="#030303" roughness={0.35} clearcoat={0.4} clearcoatRoughness={0.3} />
      </RoundedBox>
      <mesh position={[PAD_X(3.5), CB_TOP + 0.0085, CB_Z - 0.36]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[3.96, 0.1386 * 2]} /><meshBasicMaterial map={strip} toneMapped={false} /></mesh>
      {bar.labels.map((_, col) => <Pad key={col} col={col} low={bar.low} active={bar.active} api={st.api} />)}
      {/* left: status OLED, band LEDs, KEY and OCT buttons */}
      <RoundedBox args={[0.74, 0.008, 0.33]} radius={0.004} smoothness={2} position={[-2.42, CB_TOP + 0.004, CB_Z - 0.2]}>
        <meshPhysicalMaterial color="#030303" roughness={0.35} clearcoat={0.4} clearcoatRoughness={0.3} />
      </RoundedBox>
      <mesh position={[-2.42, CB_TOP + 0.0085, CB_Z - 0.2]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.68, 0.283]} /><meshBasicMaterial map={status} toneMapped={false} /></mesh>
      {Array.from({ length: OCTS }, (_, i) => {
        const on = i + 1 >= bar.low && i + 1 < bar.low + BAND;
        return <mesh key={i} position={[-2.7 + i * 0.08, CB_TOP + 0.002, CB_Z + 0.02]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.011, 14]} /><meshBasicMaterial color={on ? ACCENT : "#262626"} toneMapped={false} /></mesh>;
      })}
      <SmallButton x={-2.68} z={CB_Z + 0.2} text="◀" onClick={() => setKey((k) => (k + 11) % 12)} />
      <SmallButton x={-2.53} z={CB_Z + 0.2} text="▶" onClick={() => setKey((k) => (k + 1) % 12)} />
      <SmallButton x={-2.28} z={CB_Z + 0.2} text="▼" onClick={() => setLow((l) => clampLow(l - 1))} />
      <SmallButton x={-2.13} z={CB_Z + 0.2} text="▲" onClick={() => setLow((l) => clampLow(l + 1))} />
      <group position={[0, CB_TOP, 0]}>
        <Legend x={-2.6} z={CB_Z + 0.33} text="KEY" size={0.04} w={0.3} y={0} />
        <Legend x={-2.2} z={CB_Z + 0.33} text="OCT" size={0.04} w={0.3} y={0} />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------- desk and wall
// the room's one tint: a hair of warmth in the light and wood so it reads as a dark room, not a desaturated photo.
// Set both to pure greys ("#ffffff", "#1e1e1e") for strict black and white.
const LIGHT = "#fff8f2", WOOD = "#302e2c";
// dark wood: long streaky grain, a few darker lines, drawn once
function woodTex() {
  const t = canvasTex(1024, 512), c = t.image, g = c.getContext("2d");
  g.fillStyle = WOOD; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 900; i++) {
    const y = Math.random() * c.height, a = Math.random() * 0.14;
    g.strokeStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,240,225,${a * 0.35})`;
    g.lineWidth = 0.5 + Math.random() * 2.5;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= c.width; x += 64) g.lineTo(x, y + Math.sin(x / 180 + y) * 3);
    g.stroke();
  }
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// wall: felt backing with vertical wooden acoustic slats, washed from above so it falls off into the dark
const SLATS = 120, SLAT_W = 0.07, SLAT_GAP = 0.13;
function Room() {
  const desk = useMemo(() => new THREE.MeshPhysicalMaterial({ map: woodTex(), roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.35, normalMap: bump("grain", 12, 6), normalScale: new THREE.Vector2(0.05, 0.05) }), []);
  const slats = useRef();
  useEffect(() => {
    const m = new THREE.Matrix4();
    for (let i = 0; i < SLATS; i++) slats.current.setMatrixAt(i, m.makeTranslation((i - SLATS / 2) * SLAT_GAP, 2.4, -3.36));
    slats.current.instanceMatrix.needsUpdate = true;
  }, []);
  const slatMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#252423", roughness: 0.7, normalMap: bump("grain", 1, 8), normalScale: new THREE.Vector2(0.3, 0.3) }), []);
  return (
    <group>
      <RoundedBox args={[11, 0.08, 6]} radius={0.03} smoothness={4} position={[0, -0.04, 0.4]} material={desk} />
      <ContactShadows position={[0, 0.002, 0.4]} scale={[11, 6]} resolution={1024} blur={2.2} opacity={0.6} far={0.8} />
      <mesh position={[0, 2, -3.42]}><planeGeometry args={[40, 14]} /><meshStandardMaterial color="#0c0c0c" roughness={1} normalMap={bump("weave", 40, 14)} /></mesh>
      <instancedMesh ref={slats} args={[null, null, SLATS]} material={slatMat}><boxGeometry args={[SLAT_W, 5.6, 0.05]} /></instancedMesh>
    </group>
  );
}

// a spot aimed at a point (three needs the target in the scene to update it)
function Spot({ at, ...props }) {
  const target = useMemo(() => new THREE.Object3D(), []);
  return <><primitive object={target} position={at} /><spotLight target={target} color={LIGHT} decay={0} penumbra={1} {...props} /></>;
}

// cast and receive shadows on every lit mesh (unlit decals and labels skip it)
function Shadows({ dep }) {
  const { scene } = useThree();
  useEffect(() => {
    const id = setTimeout(() => scene.traverse((o) => {
      if (o.isMesh && !o.material.isMeshBasicMaterial) { o.castShadow = true; o.receiveShadow = true; }
    }), 300);
    return () => clearTimeout(id);
  }, [scene, dep]);
  return null;
}

// Chord mode: the whole desk, framed for the screen, from a fixed seat.
// Piano mode: glide down to a near top-down, flat view of just the playable keys (view = octaves shown).
function Rig({ mode, base, view }) {
  const look = useMemo(() => new THREE.Vector3(0, 0.2, -0.2), []), aim = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, dt) => {
    const { camera, size } = state, aspect = size.width / size.height;
    let x, y, z, fov;
    if (mode === "piano") {
      const width = view * 7 * WW + 0.3, half = Math.min(width / 2, 3.35);
      const cx = Math.max(-3.35 + half, Math.min(3.35 - half, (xOf(base) + xOf(base + PIANO_SPAN)) / 2));
      fov = 18;
      const d = Math.max(width / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect), 1.3 / Math.tan(THREE.MathUtils.degToRad(fov / 2)));   // keys plus the LCD above them
      x = cx; y = 0.3 + d * 0.985; z = -0.66 + d * 0.17;   // ~10° off straight down
      aim.set(cx, 0.3, -0.66);
    } else {
      // first person: seated at the desk, looking down at the keys, chord bar under your hands,
      // fixed angle: the camera doesn't follow the cursor.
      fov = 48;
      const pitch = 0.95;
      const d = Math.max(4.8, 7.9 / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect));
      x = 0; y = 0.3 + d * Math.sin(pitch); z = -0.35 + d * Math.cos(pitch);
      aim.set(0, 0.3, -0.35);
    }
    camera.position.x = damp(camera.position.x, x, 3, dt);
    camera.position.y = damp(camera.position.y, y, 3, dt);
    camera.position.z = damp(camera.position.z, z, 3, dt);
    look.x = damp(look.x, aim.x, 3, dt); look.y = damp(look.y, aim.y, 3, dt); look.z = damp(look.z, aim.z, 3, dt);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = damp(camera.fov, fov, 3, dt); camera.updateProjectionMatrix(); }
    camera.lookAt(look);
  });
  return null;
}

function Scene({ st, lcd, mode, setMode, setKey, setLow, base, view }) {
  const bar = { keyIx: lcd.keyIx, scale: lcd.scale, hand: lcd.hand, low: lcd.low, labels: lcd.labels, active: lcd.active };
  return (
    <>
      <Rig mode={mode} base={base} view={view} />
      <Room />
      <Shadows dep={mode} />
      <Piano st={st} lcd={lcd} mode={mode} setMode={setMode} base={base} />
      <ChordBar st={st} bar={bar} mode={mode} setKey={setKey} setLow={setLow} />
    </>
  );
}

const keepFocus = (e) => e.preventDefault();

export default function Studio({ ins }) {
  const [ready, setReady] = useState(false);
  const { st, api, rootSel, mode, setMode, keyIx, setKey, scale, setScale, hand, setHand, low, setLow, custom, pick, now, active, base, setBase, sustain, view, setView, labels } = ins;
  useEffect(() => { document.fonts.ready.then(() => setReady(true)); }, []);   // canvas labels need the web font

  const Seg = ({ label, value, options, onPick }) => (
    <div className="lp-group">
      {label && <span>{label}</span>}
      <div className="lp-mode" role="group" aria-label={label || "Mode"}>
        {Object.entries(options).map(([k, l]) => <button key={k} type="button" aria-pressed={value === k} onMouseDown={keepFocus} onClick={() => onPick(k)}>{l}</button>)}
      </div>
    </div>
  );
  const lcd = { mode, keyIx, scale, hand, low, labels, now, active, base, sustain };

  return (
    <div className="lp-page">
      <Canvas shadows camera={{ position: [0, 3.1, 3], fov: 60 }} dpr={[1, 2]}
        gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.05 }}>
        <color attach="background" args={["#0a0a0a"]} />
        {/* contact-hardening shadows: crisp where objects touch the desk, soft further away */}
        <SoftShadows size={22} samples={12} focus={0.6} />
        {/* key: a big window-like source high front-left. Fill comes from the environment (indirect light). */}
        <directionalLight position={[-4, 9, 4]} intensity={1.3} color={LIGHT} castShadow
          shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.03}
          shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={5} shadow-camera-bottom={-5} shadow-camera-near={1} shadow-camera-far={25} />
        <hemisphereLight args={["#f2f2f2", "#1a1a1a", 0.12]} />
        {/* a pool of light over the instruments that falls off at the desk edges, and a wash grazing down the slats */}
        <Spot position={[0, 7, 1.5]} at={[0, 0, 0]} angle={0.55} intensity={2.2} />
        <Spot position={[0, 6, -2.4]} at={[0, 0.5, -3.4]} angle={0.9} intensity={1.6} />
        {ready && <Scene st={st} lcd={lcd} mode={mode} setMode={setMode} setKey={setKey} setLow={setLow} base={base} view={view} />}
        {/* the room as the materials see it: a window on the left, a ceiling softbox, warm bounce from walls and desk */}
        <Environment resolution={256} environmentIntensity={0.55}>
          <color attach="background" args={["#363636"]} />
          <Lightformer form="rect" intensity={3} color="#ffffff" position={[-8, 3, 2]} rotation-y={Math.PI / 2} scale={[7, 4, 1]} />
          <Lightformer form="rect" intensity={1.4} position={[0, 7, 1]} rotation-x={Math.PI / 2} scale={[10, 5, 1]} />
          <Lightformer form="rect" intensity={0.5} color="#e6e6e6" position={[8, 2, 1]} rotation-y={-Math.PI / 2} scale={[8, 4, 1]} />
          <Lightformer form="rect" intensity={0.45} color="#e6e6e6" position={[0, 2, -7]} scale={[14, 5, 1]} />
          <Lightformer form="rect" intensity={0.35} color="#e6e6e6" position={[0, -2, 2]} rotation-x={-Math.PI / 2} scale={[12, 6, 1]} />
        </Environment>
      </Canvas>
      <div className="lp-bar">
        <Seg value={mode} options={{ chord: "chord", piano: "piano" }} onPick={setMode} />
        {mode === "chord" ? (
          <>
            <Seg value={scale} options={{ major: "major", minor: "minor" }} onPick={setScale} />
            <Seg label="Left hand" value={hand} options={HANDS} onPick={setHand} />
            <div className="lp-group"><span>Custom chord</span>
              <select ref={rootSel} aria-label="Custom chord root" value={custom ? custom.root : ""} onChange={pick((v) => ({ root: v }))}>
                <option value="">none</option>
                {NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
              </select>
              <select aria-label="Custom chord type" value={custom ? custom.type : "maj"} onChange={pick((v) => ({ type: v }))}>
                {Object.entries(TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
              </select>
            </div>
          </>
        ) : (
          <>
            <div className="lp-group"><span>Octave</span>
              <div className="lp-mode">
                <button type="button" aria-label="Octave down" onMouseDown={keepFocus} onClick={() => setBase((b) => clampBase(b - 12))}>−</button>
                <button type="button" aria-label="Octave up" onMouseDown={keepFocus} onClick={() => setBase((b) => clampBase(b + 12))}>+</button>
              </div>
            </div>
            <div className="lp-group"><span>View</span>
              <div className="lp-mode">
                <button type="button" aria-label="Show fewer octaves" onMouseDown={keepFocus} onClick={() => setView((v) => Math.max(2, v - 1))}>−</button>
                <span className="lp-count">{view} oct</span>
                <button type="button" aria-label="Show more octaves" onMouseDown={keepFocus} onClick={() => setView((v) => Math.min(7, v + 1))}>+</button>
              </div>
            </div>
            <Seg value={sustain ? "on" : "off"} label="Sustain" options={{ off: "off", on: "on" }} onPick={(v) => api.pedal(v === "on")} />
          </>
        )}
      </div>
      <a className="credit" href="https://archive.org/details/SalamanderGrandPianoV3" target="_blank" rel="noreferrer">
        Piano samples: Salamander Grand Piano by Alexander Holm · CC-BY 3.0
      </a>
    </div>
  );
}
