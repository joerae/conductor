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
const versionBtn = document.getElementById("version-btn") as HTMLButtonElement;
const versionModal = document.getElementById("version-modal") as HTMLElement;
const closeModalBtn = document.getElementById("close-modal-btn") as HTMLButtonElement;
const modalContent = document.getElementById("modal-content") as HTMLElement;

// ── Beat flash animation ──────────────────────────────────────────────────────

function flashBeat(): void {
  beatFlashEl.classList.remove("flash");
  // Force reflow so the animation restarts
  void beatFlashEl.offsetWidth;
  beatFlashEl.classList.add("flash");
}

// ── Dynamic prompt formatter ──────────────────────────────────────────────────

function getPromptText(state: ExperienceState, pausedBeat: number): string {
  switch (state) {
    case "loading":
      return "Preparing the orchestra and instruments…";
    case "ready":
      return "Tap SPACE twice to set the pulse.";
    case "preparing":
      return pausedBeat > 0
        ? `Tap SPACE once more to resume from beat ${pausedBeat.toFixed(1)}…`
        : "Good — tap SPACE once more to begin…";
    case "playing":
      return "Orchestra is playing. Keep tapping SPACE to conduct the tempo.";
    case "paused":
      return `Orchestra paused at beat ${pausedBeat.toFixed(1)}. Tap SPACE twice to resume from here.`;
  }
}

// ── Experience setup ──────────────────────────────────────────────────────────

const controller = new ExperienceController({
  onStateChange: (state: ExperienceState) => {
    const pausedBeat = controller.getPausedBeat();
    promptEl.textContent = getPromptText(state, pausedBeat);
    restartBtn.style.display = (state === "playing" || state === "paused")
      ? "inline-block" : "none";
    if (debugHintEl) {
      debugHintEl.style.display = state === "ready" ? "inline" : "inline";
    }
    stageEl.dataset.state = state;
  },
  onBeat: () => {
    flashBeat();
  },
});

restartBtn.addEventListener("click", () => controller.restart());

// ── Version Modal Handling ────────────────────────────────────────────────────

interface VersionHistoryItem {
  version: string;
  date: string;
  summary: string;
  details: string[];
}

interface VersionData {
  version: string;
  name: string;
  localUrl: string;
  history: VersionHistoryItem[];
}

async function loadVersionInfo(): Promise<void> {
  try {
    const res = await fetch("/version.json");
    if (!res.ok) return;
    const data: VersionData = await res.json();
    versionBtn.textContent = `v${data.version}`;

    modalContent.innerHTML = data.history.map(item => `
      <div class="version-entry">
        <div class="version-tag-row">
          <span class="version-badge">v${item.version}</span>
          <span class="version-date">${item.date}</span>
        </div>
        <div class="version-summary">${item.summary}</div>
        <ul class="version-details-list">
          ${item.details.map(d => `<li>${d}</li>`).join("")}
        </ul>
      </div>
    `).join("") + `
      <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 0.75rem; color: var(--text-muted);">
        Dev Server: <a href="${data.localUrl}" target="_blank" style="color: var(--accent-gold); text-decoration: none;">${data.localUrl}</a>
      </div>
    `;
  } catch (err) {
    console.warn("Could not load version.json", err);
  }
}

versionBtn.addEventListener("click", () => {
  versionModal.style.display = "flex";
});

closeModalBtn.addEventListener("click", () => {
  versionModal.style.display = "none";
});

versionModal.addEventListener("click", (e) => {
  if (e.target === versionModal) {
    versionModal.style.display = "none";
  }
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && versionModal.style.display === "flex") {
    versionModal.style.display = "none";
  }
});

// ── Load application ──────────────────────────────────────────────────────────

loadVersionInfo();

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
