import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { audioContext } from "./lib/audio";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/pages.css";
import "./styles/calendar.css";

// Audio erst nach der ersten Nutzeraktion freischalten (Autoplay-Regeln),
// damit Signaltöne später auch bei minimiertem Fenster erklingen.
for (const ev of ["pointerdown", "keydown"] as const) {
  window.addEventListener(ev, () => void audioContext(), { once: true, capture: true });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
