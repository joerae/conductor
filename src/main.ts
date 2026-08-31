/**
 * main.ts — Conductor entry point
 * Instantiates ExperienceController and wires it to the DOM.
 */

import { ExperienceController } from "./experience/ExperienceController";
import type { ExperienceState } from "./experience/ExperienceController";
import "./style.css";

// ── DOM refs ─────────────────────────────────────────────────────────────────

const promptEl = document.getElementById("prompt") as HTMLElement;
const titleEl = document.getElementById("piece-title") as HTMLElement;
const subtitleEl = document.getElementById("piece-subtitle") as HTMLElement;
const loadingEl = document.getElementById("loading-screen") as HTMLElement;
const stageEl = document.getElementById("stage") as HTMLElement;
const beatFlashEl = document.getElementById("beat-flash") as HTMLElement;
const restartBtn = document.getElementById("restart-btn") as HTMLButtonElement;
const debugHintEl = document.getElementById("debug-hint") as HTMLElement;

// ── State messages ────────────────────────────────────────────────────────────

const STATE_PROMPTS: Record<ExperienceState, string> = {
  loading:   "Loading orchestra…",
  ready:     "Tap SPACE twice to set the pulse.",
  preparing: "Tap SPACE again…",
  playing:   "Conducting — keep tapping SPACE to conduct.",
  coasting:  "Coasting… tap to resume.",
  paused:    "Paused. Tap SPACE to restart.",
};

// ── Beat flash animation ──────────────────────────────────────────────────────

function flashBeat(): void {
  beatFlashEl.classList.remove("flash");
  // Force reflow so the animation restarts
  void beatFlashEl.offsetWidth;
  beatFlashEl.classList.add("flash");
}

// ── Experience setup ──────────────────────────────────────────────────────────

const controller = new ExperienceController({
  onStateChange: (state: ExperienceState) => {
    promptEl.textContent = STATE_PROMPTS[state];
    restartBtn.style.display = (state === "playing" || state === "coasting" || state === "paused")
      ? "inline-block" : "none";
    debugHintEl.style.display = state === "ready" ? "block" : "none";
    stageEl.dataset.state = state;
  },
  onBeat: () => {
    flashBeat();
  },
});

restartBtn.addEventListener("click", () => controller.restart());

// ── Load ──────────────────────────────────────────────────────────────────────

controller.load().then(() => {
  loadingEl.style.display = "none";
  stageEl.style.display = "flex";

  const meta = controller.getMidiMetadata();
  if (meta) {
    titleEl.textContent = meta.title || "Eine Kleine Nachtmusik";
    subtitleEl.textContent = `W.A. Mozart — ♩ = ${Math.round(meta.embeddedBpm)} BPM original`;
  }
}).catch(err => {
  loadingEl.innerHTML = `<p class="error">Failed to load: ${err.message}</p>`;
});
