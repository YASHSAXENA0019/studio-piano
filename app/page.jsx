"use client";
import dynamic from "next/dynamic";

// WebGL and Web Audio only exist in the browser, so the instrument never renders on the server
const App = dynamic(() => import("./App"), { ssr: false });

export default function Page() {
  return <App />;
}
