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

// ── Visual Orchestra Note Animation ──────────────────────────────────────────

const sectionMap: Record<string, HTMLElement | null> = {
  "0": document.getElementById("section-0"), // Violin I (channel 0)
  "3": document.getElementById("section-1"), // Violin II (channel 3)
  "1": document.getElementById("section-2"), // Viola (channel 1)
  "2": document.getElementById("section-3"), // Violoncello (channel 2)
  "Violin I": document.getElementById("section-0"),
  "Violin II": document.getElementById("section-1"),
  "Viola": document.getElementById("section-2"),
  "Violoncello": document.getElementById("section-3"),
};

function swingBaton(): void {
  const baton = document.getElementById("baton-line");
  if (baton) {
    baton.classList.remove("swing");
    void baton.offsetWidth;
    baton.classList.add("swing");
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

    // Reset visual highlights when not playing
    if (state !== "playing") {
      document.querySelectorAll(".musician.playing, .instrument-section.playing").forEach(el => {
        el.classList.remove("playing");
      });
    }
  },
  onBeat: () => {
    flashBeat();
    swingBaton();
  },
  onNoteVisual: (event) => {
    setTimeout(() => {
      const section = sectionMap[String(event.channel)] || sectionMap[event.trackId] || document.getElementById("section-0");
      if (!section) return;

      const eggs = section.querySelectorAll<SVGElement>(".musician");
      const eggIndex = Math.abs(event.midiNote) % Math.max(1, eggs.length);
      const targetEgg = eggs[eggIndex] || eggs[0];

      if (event.type === "noteOn") {
        section.classList.add("playing");
        if (targetEgg) targetEgg.classList.add("playing");
      } else {
        if (targetEgg) targetEgg.classList.remove("playing");
        const anyActive = section.querySelector(".musician.playing");
        if (!anyActive) {
          section.classList.remove("playing");
        }
      }
    }, event.delayMs);
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
