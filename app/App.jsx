"use client";
// One instrument, two looks. The musical state, sound and input live here (engine.js) and survive a
// switch; only the chosen version is mounted, so the other's 3D scene is torn down with it.
import { useState } from "react";
import { useInstrument } from "./engine";
import Studio from "./Studio";
import Workstation from "./Workstation";

const STORE = "studio-piano-version";
const VERSIONS = { v1: "V1", v2: "V2" };

export default function App() {
  const ins = useInstrument();
  // ?v=v1 / ?v=v2 picks a version for this visit (links, the reel recorder); otherwise the last one chosen
  const [v, setV] = useState(() => {
    const q = new URLSearchParams(location.search).get("v");
    if (q in VERSIONS) return q;
    try { return localStorage.getItem(STORE) === "v1" ? "v1" : "v2"; } catch { return "v2"; }
  });
  const choose = (next) => {
    if (next === v) return;
    ins.api.releaseAll();   // nothing keeps ringing from the scene that's going away
    setV(next);
    try { localStorage.setItem(STORE, next); } catch {}
  };
  return (
    <>
      {v === "v1" ? <Studio ins={ins} /> : <Workstation ins={ins} />}
      <div className="vswitch" role="group" aria-label="Version">
        {Object.entries(VERSIONS).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={v === k} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(k)}>{l}</button>
        ))}
      </div>
    </>
  );
}
