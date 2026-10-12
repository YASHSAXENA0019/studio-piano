"use client";
// V2: the hybrid workstation. The 88-key piano is a 3D product shot on a dark stage; everything you set
// or read sits below it in an HTML console (readout, chord pads, key/scale/octave/left hand, sustain).
// State, input and sound come from engine.js, shared with V1.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { NAMES, TYPES, MODES, HANDS, noteName } from "./theory.mjs";
import { KEYS, WW, HI, BAND, KEYROWS, keyLabel, PIANO_SPAN, PIANO_LETTER, clampLow, clampBase, xOf } from "./engine";

const { damp, degToRad, clamp } = THREE.MathUtils;
// the one accent, red, marks what is active right now (held keys, playing pads, sustain); the CSS uses --ws-red
const RED = "#e5484d", BG = "#111112";
const IVORY = "#efe9df", IVORY_DOWN = "#d3ccbf", EBONY = "#151515", EBONY_DOWN = "#2c2c2c";
const KEY_TOP = 0.16, WL = 0.95, BW = 0.072, BL = 0.6, KEY_Z = -0.75;
const font = () => getComputedStyle(document.body).fontFamily;
const cursor = (on) => (document.body.style.cursor = on ? "pointer" : "");

// ---------------------------------------------------------------- 3D piano
function letterTex(letter, black) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = black ? "#e9e4da" : "#1c1b19"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `600 46px ${font()}`; g.fillText(letter, 32, 35);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function Key({ k, st, api, letter }) {
  const pivot = useRef(), mat = useRef(), dot = useRef(), lit = useRef(0);
  const tex = useMemo(() => letter && letterTex(letter, k.black), [letter, k.black]);
  const L = k.black ? BL : WL, w = k.black ? BW : WW - 0.008, h = k.black ? 0.12 : 0.09, lift = k.black ? 0.03 : 0;
  const up = useMemo(() => new THREE.Color(k.black ? EBONY : IVORY), [k.black]);
  const down = useMemo(() => new THREE.Color(k.black ? EBONY_DOWN : IVORY_DOWN), [k.black]);
  useFrame((_, dt) => {
    const s = st.keys[k.m];
    pivot.current.rotation.x = damp(pivot.current.rotation.x, s.press * (k.black ? 0.1 : 0.085), 28, dt);
    lit.current = damp(lit.current, s.press, 18, dt);
    mat.current.color.copy(up).lerp(down, lit.current);
    dot.current.material.opacity = damp(dot.current.material.opacity, s.dot > 0 || s.press > 0.5 ? 1 : 0, 16, dt);
  });
  return (
    <group position={[k.x, KEY_TOP + lift, KEY_Z]}>
      <group ref={pivot}>
        <RoundedBox args={[w, h, L]} radius={k.black ? 0.01 : 0.006} smoothness={2} position={[0, h / 2, L / 2]} castShadow receiveShadow
          onPointerDown={(e) => { e.stopPropagation(); api.noteDown(k.m, e.pointerId); }} onPointerOver={() => cursor(true)} onPointerLeave={() => cursor(false)}>
          <meshPhysicalMaterial ref={mat} color={k.black ? EBONY : IVORY} roughness={k.black ? 0.28 : 0.4} clearcoat={k.black ? 0.9 : 0.25} clearcoatRoughness={0.3} />
        </RoundedBox>
        {/* red marker: the notes of the chord that's playing, and any key held down */}
        <mesh ref={dot} position={[0, h + 0.002, L - (tex ? (k.black ? 0.16 : 0.21) : 0.08)]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[k.black ? 0.018 : 0.024, 24]} />
          <meshBasicMaterial color={RED} transparent opacity={0} toneMapped={false} depthWrite={false} />
        </mesh>
        {tex && (
          <mesh position={[0, h + 0.002, L - (k.black ? 0.08 : 0.11)]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[k.black ? 0.066 : 0.1, k.black ? 0.066 : 0.1]} />
            <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
          </mesh>
        )}
      </group>
    </group>
  );
}

// a slim graphite body: keybed, raised back panel with an aluminium hairline, felt key slip, anodised end cheeks
function Body() {
  const m = useMemo(() => ({
    shell: new THREE.MeshPhysicalMaterial({ color: "#2b2b2e", roughness: 0.42, metalness: 0.3, clearcoat: 0.35, clearcoatRoughness: 0.45 }),
    cheek: new THREE.MeshPhysicalMaterial({ color: "#3c3c40", roughness: 0.3, metalness: 0.9 }),
    alu: new THREE.MeshStandardMaterial({ color: "#a2a2a6", roughness: 0.25, metalness: 1 }),
    felt: new THREE.MeshStandardMaterial({ color: "#0c0c0c", roughness: 1 }),
  }), []);
  return (
    <group>
      <RoundedBox args={[6.9, KEY_TOP, 1.62]} radius={0.04} smoothness={4} position={[0, KEY_TOP / 2, -0.52]} material={m.shell} castShadow receiveShadow />
      <RoundedBox args={[6.9, 0.34, 0.62]} radius={0.05} smoothness={4} position={[0, 0.17, -1.04]} material={m.shell} castShadow receiveShadow />
      <mesh position={[0, 0.3, -0.727]} material={m.alu}><boxGeometry args={[6.5, 0.008, 0.006]} /></mesh>
      <mesh position={[0, KEY_TOP + 0.05, -0.765]} material={m.felt}><boxGeometry args={[6.5, 0.1, 0.03]} /></mesh>
      {[-1, 1].map((sd) => (
        <RoundedBox key={sd} args={[0.2, 0.37, 1.66]} radius={0.05} smoothness={4} position={[sd * 3.36, 0.185, -0.52]} material={m.cheek} castShadow receiveShadow />
      ))}
    </group>
  );
}

// the stage floor: a soft pool of light under the instrument that falls off into the background colour
function Floor() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas"); c.width = c.height = 512;
    const g = c.getContext("2d"), r = g.createRadialGradient(256, 256, 0, 256, 256, 256);
    r.addColorStop(0, "#232325"); r.addColorStop(1, BG);
    g.fillStyle = r; g.fillRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  return <mesh position={[0, -0.001, -0.4]} rotation={[-Math.PI / 2, 0, 0]} scale={[16, 7, 1]}><planeGeometry /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>;
}

// Chord mode: a three-quarter product shot of the whole instrument. Piano mode: glide to a near
// top-down view of the playable keys (view = octaves shown).
function Rig({ mode, base, view }) {
  const look = useMemo(() => new THREE.Vector3(0, 0.12, -0.45), []), aim = useMemo(() => new THREE.Vector3(), []), to = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }, dt) => {
    const aspect = size.width / size.height;
    let fov, pitch, width, depth;
    if (mode === "piano") {
      fov = 22; pitch = degToRad(72); width = view * 7 * WW + 0.5; depth = 1.6;
      const half = Math.min(width / 2, 3.45);
      aim.set(clamp((xOf(base) + xOf(base + PIANO_SPAN)) / 2, -3.45 + half, 3.45 - half), 0.18, -0.38);
    } else {
      fov = 26; pitch = degToRad(32); width = 8.4; depth = 2.6;
      aim.set(0, 0.12, -0.45);
    }
    const t = Math.tan(degToRad(fov / 2)), d = Math.max(width / (2 * t * aspect), depth / (2 * t));
    to.set(aim.x, aim.y + d * Math.sin(pitch), aim.z + d * Math.cos(pitch));
    camera.position.x = damp(camera.position.x, to.x, 3.5, dt);
    camera.position.y = damp(camera.position.y, to.y, 3.5, dt);
    camera.position.z = damp(camera.position.z, to.z, 3.5, dt);
    look.x = damp(look.x, aim.x, 3.5, dt); look.y = damp(look.y, aim.y, 3.5, dt); look.z = damp(look.z, aim.z, 3.5, dt);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = damp(camera.fov, fov, 3.5, dt); camera.updateProjectionMatrix(); }
    camera.lookAt(look);
  });
  return null;
}

function Stage({ ins, ready }) {
  const { st, api, mode, base, view } = ins;
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 4, 7], fov: 26 }} gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.15 }}>
      <color attach="background" args={[BG]} />
      <Rig mode={mode} base={base} view={view} />
      {/* one key light high front-left for crisp key shadows; softboxes in the environment for the highlights */}
      <directionalLight position={[-3, 8, 5]} intensity={2} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0003} shadow-normalBias={0.02}
        shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={2.5} shadow-camera-bottom={-2.5} shadow-camera-near={1} shadow-camera-far={20} />
      <ambientLight intensity={0.12} />
      <Floor />
      <ContactShadows position={[0, 0, -0.5]} scale={[9, 4]} resolution={1024} blur={2.4} opacity={0.8} far={1} />
      {ready && (
        <group>
          <Body />
          {KEYS.map((k) => <Key key={k.m} k={k} st={st} api={api} letter={mode === "piano" && k.m - base >= 0 ? PIANO_LETTER[k.m - base] : null} />)}
        </group>
      )}
      <Environment resolution={256}>
        <color attach="background" args={["#08080a"]} />
        <Lightformer form="rect" intensity={3} position={[0, 6, 1]} rotation-x={Math.PI / 2} scale={[9, 3, 1]} />
        <Lightformer form="rect" intensity={1.8} position={[-7, 2, 0]} rotation-y={Math.PI / 2} scale={[4, 1.2, 1]} />
        <Lightformer form="rect" intensity={1.8} position={[7, 2, 0]} rotation-y={-Math.PI / 2} scale={[4, 1.2, 1]} />
        <Lightformer form="rect" intensity={0.9} position={[0, 1.5, 7]} scale={[10, 2, 1]} />
      </Environment>
    </Canvas>
  );
}

// ---------------------------------------------------------------- HTML console
const Seg = ({ label, value, options, onPick }) => (
  <div className="ws-group">
    {label && <span className="ws-label">{label}</span>}
    <div className="ws-seg" role="group" aria-label={label}>
      {Object.entries(options).map(([k, l]) => <button key={k} type="button" aria-pressed={value === k} onClick={() => onPick(k)}>{l}</button>)}
    </div>
  </div>
);
const Stepper = ({ label, value, onDown, onUp, downLabel, upLabel }) => (
  <div className="ws-group">
    <span className="ws-label">{label}</span>
    <div className="ws-step">
      <button type="button" aria-label={downLabel} onClick={onDown}>‹</button>
      <output>{value}</output>
      <button type="button" aria-label={upLabel} onClick={onUp}>›</button>
    </div>
  </div>
);

function Pads({ ins }) {
  const { api, labels, scale, low, active } = ins;
  return (
    <div className="ws-pads">
      {labels.map((name, col) => {
        const on = active.some((id) => id.startsWith(`${col}-`));
        return (
          <div key={col} className="ws-pad" data-on={on || undefined}>
            <button type="button" className="ws-pad-face" aria-label={name ? `Play ${name}` : "Pick a custom chord"}
              onPointerDown={(e) => api.chordPointer(`${col}-${low + 1}`, e.pointerId)}>
              <b>{name || "+"}</b><span>{MODES[scale].roman[col] || "custom"}</span>
            </button>
            {/* the four octaves of the band, low → high, each with the computer key that plays it */}
            <div className="ws-octs">
              {[0, 1, 2, 3].map((j) => {
                const id = `${col}-${low + j}`;
                return (
                  <button key={j} type="button" data-on={active.includes(id) || undefined} aria-label={`${name || "custom"}, octave ${low + j}`}
                    onPointerDown={(e) => api.chordPointer(id, e.pointerId)}>
                    <kbd>{keyLabel(KEYROWS[BAND - 1 - j][col])}</kbd><small>{low + j}</small>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// piano mode: the whole 88 as a strip with the playable window on it (click to move it), and the pedal
const WHITES = KEYS.filter((k) => !k.black);
function PianoPane({ ins }) {
  const { api, base, setBase, sustain } = ins;
  return (
    <div className="ws-piano">
      <div className="ws-range" role="group" aria-label="Playable range">
        {WHITES.map(({ m }) => (
          <button key={m} type="button" tabIndex={-1} aria-label={`Move to ${noteName(m)}`} data-in={(m >= base && m <= base + PIANO_SPAN) || undefined}
            onClick={() => setBase(clampBase(12 * Math.floor(m / 12)))}>
            {m % 12 === 0 && <small>{noteName(m)}</small>}
          </button>
        ))}
      </div>
      <button type="button" className="ws-pedal" aria-pressed={sustain} onClick={() => api.pedal(!sustain)}>
        <i />Sustain<kbd>space</kbd>
      </button>
    </div>
  );
}

// buttons never take focus, so Space and the arrows keep playing the instrument
const keepFocus = (e) => { if (e.target.tagName !== "SELECT" && e.target.tagName !== "OPTION") e.preventDefault(); };

export default function Workstation({ ins }) {
  const { rootSel, mode, setMode, keyIx, setKey, scale, setScale, hand, setHand, low, setLow, custom, pick, now, base, setBase, sustain, view, setView } = ins;
  const [ready, setReady] = useState(false);
  useEffect(() => { document.fonts.ready.then(() => setReady(true)); }, []);   // key letters are drawn in the web font
  const status = mode === "chord"
    ? [`${NAMES[keyIx]} ${scale}`, `octaves ${low}–${low + BAND - 1}`, `left hand ${HANDS[hand]}`]
    : [`${noteName(base)}–${noteName(Math.min(HI, base + PIANO_SPAN))}`, `${view} octaves in view`, sustain ? "sustain on" : "sustain off"];

  return (
    <div className="ws">
      <header className="ws-top">
        <span className="ws-mark">Studio Piano</span>
        <a className="ws-credit" href="https://archive.org/details/SalamanderGrandPianoV3" target="_blank" rel="noreferrer">Salamander Grand Piano · Alexander Holm · CC-BY 3.0</a>
      </header>
      <div className="ws-stage"><Stage ins={ins} ready={ready} /></div>

      <section className="ws-console" onMouseDown={keepFocus}>
        <div className="ws-bar">
          <Seg label="Mode" value={mode} options={{ chord: "Chord", piano: "Piano" }} onPick={setMode} />
          {mode === "chord" ? (
            <>
              <Stepper label="Key" value={NAMES[keyIx]} onDown={() => setKey((k) => (k + 11) % 12)} onUp={() => setKey((k) => (k + 1) % 12)} downLabel="Key down" upLabel="Key up" />
              <Seg label="Scale" value={scale} options={{ major: "Major", minor: "Minor" }} onPick={setScale} />
              <Stepper label="Octaves" value={`${low}–${low + BAND - 1}`} onDown={() => setLow((l) => clampLow(l - 1))} onUp={() => setLow((l) => clampLow(l + 1))} downLabel="Octaves down" upLabel="Octaves up" />
              <Seg label="Left hand" value={hand} options={{ off: "Off", octave: "Octave", fifth: "Oct + 5th" }} onPick={setHand} />
              <div className="ws-group">
                <span className="ws-label">Custom</span>
                <div className="ws-selects">
                  <select ref={rootSel} aria-label="Custom chord root" value={custom ? custom.root : ""} onChange={pick((v) => ({ root: v }))}>
                    <option value="">—</option>
                    {NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
                  </select>
                  <select aria-label="Custom chord type" value={custom ? custom.type : "maj"} onChange={pick((v) => ({ type: v }))}>
                    {Object.entries(TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
                  </select>
                </div>
              </div>
            </>
          ) : (
            <>
              <Stepper label="Octave" value={noteName(base)} onDown={() => setBase((b) => clampBase(b - 12))} onUp={() => setBase((b) => clampBase(b + 12))} downLabel="Octave down" upLabel="Octave up" />
              <Stepper label="View" value={`${view} oct`} onDown={() => setView((v) => Math.max(2, v - 1))} onUp={() => setView((v) => Math.min(7, v + 1))} downLabel="Show fewer octaves" upLabel="Show more octaves" />
            </>
          )}
        </div>

        <div className="ws-body">
          <div className="ws-display" aria-live="polite">
            <div className="ws-display-top"><span>{mode}</span>{status.map((s) => <span key={s}>{s}</span>)}</div>
            <div className="ws-now"><b>{now ? now.name : "—"}</b>{now?.roman && <span>{now.roman}</span>}</div>
            <div className="ws-notes">{now?.notes || " "}</div>
          </div>
          {mode === "chord" ? <Pads ins={ins} /> : <PianoPane ins={ins} />}
        </div>

        <p className="ws-hints">
          {mode === "chord"
            ? <><kbd>1–8</kbd> <kbd>Q–I</kbd> <kbd>A–K</kbd> <kbd>Z–,</kbd> chords <i /> <kbd>← →</kbd> key <i /> <kbd>↑ ↓</kbd> octaves <i /> <kbd>space</kbd> major / minor <i /> <kbd>tab</kbd> left hand <i /> <kbd>`</kbd> piano mode</>
            : <><kbd>Z – /</kbd> low <i /> <kbd>Q – ]</kbd> high <i /> <kbd>← →</kbd> octave <i /> <kbd>space</kbd> sustain <i /> <kbd>`</kbd> chord mode</>}
        </p>
      </section>
    </div>
  );
}
