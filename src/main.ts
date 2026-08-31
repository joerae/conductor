/**
 * main.ts — Conductor entry point
 * Instantiates ExperienceController and wires it to the DOM.
 */

import { ExperienceController } from "./experience/ExperienceController";
import type { ExperienceState } from "./experience/ExperienceController";
import type { PieceDefinition } from "./score/repertoire";
import "./style.css";

// ── DOM refs ─────────────────────────────────────────────────────────────────

const promptEl = document.getElementById("prompt") as HTMLElement;
const titleEl = document.getElementById("piece-title") as HTMLElement;
const subtitleEl = document.getElementById("piece-subtitle") as HTMLElement;
const loadingEl = document.getElementById("loading-screen") as HTMLElement;
const stageEl = document.getElementById("stage") as HTMLElement;
const beatFlashEl = document.getElementById("beat-flash") as HTMLElement;
const restartBtn = document.getElementById("restart-btn") as HTMLButtonElement;
const switchPieceBtn = document.getElementById("repertoire-switch-btn") as HTMLButtonElement;
const debugHintEl = document.getElementById("debug-hint") as HTMLElement;
const versionBtn = document.getElementById("version-btn") as HTMLButtonElement;
const versionModal = document.getElementById("version-modal") as HTMLElement;
const closeModalBtn = document.getElementById("close-modal-btn") as HTMLButtonElement;
const modalContent = document.getElementById("modal-content") as HTMLElement;

const repertoireBtn = document.getElementById("repertoire-btn") as HTMLButtonElement;
const repertoireModal = document.getElementById("repertoire-modal") as HTMLElement;
const closeRepertoireBtn = document.getElementById("close-repertoire-btn") as HTMLButtonElement;
const repertoireList = document.getElementById("repertoire-list") as HTMLElement;
const silhouetteContainer = document.getElementById("orchestra-silhouette") as HTMLElement;

// ── Beat flash animation ──────────────────────────────────────────────────────

function flashBeat(): void {
  beatFlashEl.classList.remove("flash");
  void beatFlashEl.offsetWidth;
  beatFlashEl.classList.add("flash");
}

function swingBaton(): void {
  const baton = document.getElementById("baton-line");
  if (baton) {
    baton.classList.remove("swing");
    void baton.offsetWidth;
    baton.classList.add("swing");
  }
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
    case "completed":
      return "Bravo! Masterpiece concluded. Tap SPACE twice to conduct again.";
  }
}

// ── Dynamic SVG Orchestra Stage Generator ─────────────────────────────────────

let channelToSectionMap: Map<number, HTMLElement> = new Map();
let trackNameToSectionMap: Map<string, HTMLElement> = new Map();

function renderOrchestraStage(piece: PieceDefinition): void {
  channelToSectionMap.clear();
  trackNameToSectionMap.clear();

  let sectionsSvg = "";
  const numSections = piece.sections.length;

  if (piece.layout === "chamber_strings") {
    // 4 sections in classical semi-circle
    const positions = [
      { x: 155, labelX: 155, eggs: [{ cx: 110, cy: 155 }, { cx: 155, cy: 148 }, { cx: 200, cy: 155 }] },
      { x: 315, labelX: 315, eggs: [{ cx: 270, cy: 148 }, { cx: 315, cy: 142 }, { cx: 360, cy: 148 }] },
      { x: 525, labelX: 525, eggs: [{ cx: 480, cy: 148 }, { cx: 525, cy: 142 }, { cx: 570, cy: 148 }] },
      { x: 685, labelX: 685, eggs: [{ cx: 640, cy: 155 }, { cx: 685, cy: 148 }, { cx: 730, cy: 155 }] },
    ];

    piece.sections.forEach((sec, idx) => {
      const pos = positions[idx] || positions[0];
      sectionsSvg += `
        <g id="section-${sec.id}" class="instrument-section" data-section-id="${sec.id}">
          ${pos.eggs.map((e, ei) => `<ellipse cx="${e.cx}" cy="${e.cy}" rx="18" ry="28" class="musician ${sec.id} egg-${ei}" />`).join("")}
          <text x="${pos.labelX}" y="198" text-anchor="middle" class="section-label">${sec.name}</text>
        </g>
      `;
    });
  } else {
    // 7 sections for Full Symphony Orchestra
    piece.sections.forEach((sec, idx) => {
      const centerX = 35 + (idx + 1) * (770 / (numSections + 1));
      const cy = idx % 2 === 0 ? 152 : 144;
      sectionsSvg += `
        <g id="section-${sec.id}" class="instrument-section" data-section-id="${sec.id}">
          <ellipse cx="${centerX - 24}" cy="${cy + 6}" rx="14" ry="22" class="musician ${sec.id} egg-0" />
          <ellipse cx="${centerX}" cy="${cy}" rx="15" ry="24" class="musician ${sec.id} egg-1" />
          <ellipse cx="${centerX + 24}" cy="${cy + 6}" rx="14" ry="22" class="musician ${sec.id} egg-2" />
          <text x="${centerX}" y="198" text-anchor="middle" class="section-label" style="font-size: 9.5px;">${sec.name}</text>
        </g>
      `;
    });
  }

  silhouetteContainer.innerHTML = `
    <svg viewBox="0 0 840 230" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <!-- Conductor podium & Baton (Center) -->
      <g id="conductor-group" class="conductor-group">
        <rect x="395" y="75" width="50" height="8" rx="4" class="podium" />
        <ellipse cx="420" cy="62" rx="16" ry="22" class="conductor" />
        <line id="baton-line" x1="428" y1="54" x2="465" y2="22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="baton" />
      </g>
      ${sectionsSvg}
      <!-- Stage floor -->
      <rect x="20" y="210" width="800" height="4" rx="2" class="stage-floor" />
    </svg>
  `;

  // Build mapping from channel & trackName to DOM section
  piece.sections.forEach(sec => {
    const el = document.getElementById(`section-${sec.id}`);
    if (el) {
      sec.channels.forEach(ch => channelToSectionMap.set(ch, el));
      if (sec.trackNames) {
        sec.trackNames.forEach(tn => trackNameToSectionMap.set(tn.toUpperCase(), el));
      }
    }
  });
}

// ── Experience setup ──────────────────────────────────────────────────────────

const controller = new ExperienceController({
  onStateChange: (state: ExperienceState) => {
    const pausedBeat = controller.getPausedBeat();
    promptEl.textContent = getPromptText(state, pausedBeat);

    const showControls = (state === "playing" || state === "paused" || state === "completed");
    restartBtn.style.display = showControls ? "inline-block" : "none";
    switchPieceBtn.style.display = showControls ? "inline-block" : "none";

    if (state === "completed") {
      restartBtn.textContent = "↺ Conduct Again";
    } else {
      restartBtn.textContent = "↺ Restart from Top";
    }

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
      const section = channelToSectionMap.get(event.channel) ||
                      trackNameToSectionMap.get(event.trackId.toUpperCase()) ||
                      document.querySelector(".instrument-section");
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

// ── A/B Tempo Mode Controls ──────────────────────────────────────────────────

const modeBtnA = document.getElementById("mode-btn-a") as HTMLButtonElement;
const modeBtnB = document.getElementById("mode-btn-b") as HTMLButtonElement;

function updateModeButtons(mode: "balanced" | "instant"): void {
  if (mode === "balanced") {
    modeBtnA?.classList.add("active");
    modeBtnB?.classList.remove("active");
  } else {
    modeBtnA?.classList.remove("active");
    modeBtnB?.classList.add("active");
  }
}

function setMode(mode: "balanced" | "instant"): void {
  controller.setTempoMode(mode);
  updateModeButtons(mode);
}

modeBtnA?.addEventListener("click", () => setMode("balanced"));
modeBtnB?.addEventListener("click", () => setMode("instant"));

// ── Master Dynamics / Volume Control ─────────────────────────────────────────

const volumeBarFill = document.getElementById("volume-bar-fill") as HTMLElement;
const volumePercent = document.getElementById("volume-percent") as HTMLElement;
const volumeContainer = document.getElementById("volume-indicator-container") as HTMLElement;

function updateVolumeUI(volume: number): void {
  const percent = Math.round(volume * 100);
  if (volumeBarFill) volumeBarFill.style.width = `${Math.min(100, percent)}%`;
  if (volumePercent) volumePercent.textContent = `${percent}%`;
}

function adjustVolume(delta: number): void {
  const current = controller.getMasterVolume();
  const next = Math.max(0.0, Math.min(1.0, Math.round((current + delta) * 100) / 100));
  controller.setMasterVolume(next);
  updateVolumeUI(next);
}

// Mouse wheel scroll to adjust orchestral dynamics
window.addEventListener("wheel", (e) => {
  // If user is scrolling inside a modal list, allow normal scrolling
  if ((e.target as HTMLElement)?.closest(".modal-body")) return;

  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.05 : -0.05;
  adjustVolume(delta);
}, { passive: false });

// Keyboard shortcuts: T (toggle mode), ArrowUp / ArrowDown (volume)
window.addEventListener("keydown", (e) => {
  if (versionModal.style.display === "flex" || repertoireModal.style.display === "flex") return;

  if (e.code === "KeyT" && !e.repeat) {
    const current = controller.getTempoMode();
    const next = current === "balanced" ? "instant" : "balanced";
    setMode(next);
  } else if (e.code === "ArrowUp") {
    e.preventDefault();
    adjustVolume(0.05);
  } else if (e.code === "ArrowDown") {
    e.preventDefault();
    adjustVolume(-0.05);
  }
});

// Click / drag on volume bar
volumeContainer?.addEventListener("click", (e) => {
  const rect = volumeContainer.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const ratio = Math.max(0.1, Math.min(1.0, clickX / rect.width));
  controller.setMasterVolume(ratio);
  updateVolumeUI(ratio);
});

restartBtn.addEventListener("click", () => controller.restart());
switchPieceBtn.addEventListener("click", () => openRepertoireModal());

// ── Repertoire Modal Handling ─────────────────────────────────────────────────

function renderRepertoireList(): void {
  const currentPiece = controller.getCurrentPiece();
  const pieces = controller.getRepertoire();

  repertoireList.innerHTML = pieces.map(piece => {
    const isActive = piece.id === currentPiece.id;
    return `
      <div class="piece-card ${isActive ? "active-piece" : ""}">
        <div class="piece-card-info">
          <div class="piece-card-title">${piece.title}</div>
          <div class="piece-card-composer">${piece.composer} — ${piece.movement} (${piece.year})</div>
          <div class="piece-card-desc">${piece.description}</div>
        </div>
        <button class="piece-select-btn" data-piece-id="${piece.id}">
          ${isActive ? "Currently Conducting" : "Conduct This Piece"}
        </button>
      </div>
    `;
  }).join("");

  repertoireList.querySelectorAll<HTMLButtonElement>(".piece-select-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const pieceId = btn.dataset.pieceId;
      if (!pieceId) return;
      repertoireModal.style.display = "none";
      await switchPiece(pieceId);
    });
  });
}

function openRepertoireModal(): void {
  renderRepertoireList();
  repertoireModal.style.display = "flex";
}

async function switchPiece(pieceId: string): Promise<void> {
  loadingEl.style.display = "flex";
  try {
    await controller.loadPiece(pieceId);
    const piece = controller.getCurrentPiece();
    titleEl.textContent = piece.title;
    subtitleEl.textContent = `${piece.composer} — ${piece.movement}`;
    renderOrchestraStage(piece);
  } catch (err) {
    console.error("Failed to switch piece", err);
  } finally {
    loadingEl.style.display = "none";
  }
}

repertoireBtn.addEventListener("click", () => openRepertoireModal());
closeRepertoireBtn.addEventListener("click", () => {
  repertoireModal.style.display = "none";
});
repertoireModal.addEventListener("click", (e) => {
  if (e.target === repertoireModal) {
    repertoireModal.style.display = "none";
  }
});

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
  if (e.code === "Escape") {
    versionModal.style.display = "none";
    repertoireModal.style.display = "none";
  }
});

// ── Load application ──────────────────────────────────────────────────────────

loadVersionInfo();

const initialPiece = controller.getCurrentPiece();
titleEl.textContent = initialPiece.title;
subtitleEl.textContent = `${initialPiece.composer} — ${initialPiece.movement}`;
renderOrchestraStage(initialPiece);

controller.load().then(() => {
  loadingEl.style.display = "none";
  stageEl.style.display = "flex";
}).catch(err => {
  loadingEl.innerHTML = `<p class="error">Failed to load: ${err.message}</p>`;
});
