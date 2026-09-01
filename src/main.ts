/**
 * main.ts — Conductor entry point
 * Instantiates ExperienceController and wires it to the DOM.
 */

import { ExperienceController } from "./experience/ExperienceController";
import type { ExperienceState, InputSource } from "./experience/ExperienceController";
import type { TempoMode } from "./clock/ConductorClock";
import { loadRepertoireCatalog } from "./score/repertoire";
import type { PieceDefinition } from "./score/repertoire";
import type { DynamicLevel } from "./audio/dynamicsTypes";
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

function getPromptText(state: ExperienceState, pausedBeat: number, inputSource: InputSource = "keyboard"): string {
  const tempoMode = controller.getTempoMode();
  if (inputSource === "camera") {
    if (tempoMode === "gestural") {
      switch (state) {
        case "loading":
          return "Preparing orchestra and loading hand tracking AI model…";
        case "ready":
          return "Camera active. Raise your hands to start playing at intended tempo!";
        case "preparing":
          return "Hands raised — starting orchestra…";
        case "playing":
          return "Orchestra playing! Raise/lower hands together for accelerando/rallentando. Drop hands to stop.";
        case "paused":
          return `Orchestra paused at beat ${pausedBeat.toFixed(1)}. Raise hands to resume.`;
        case "completed":
          return "Bravo! Masterpiece concluded. Raise hands to conduct again.";
      }
    }

    switch (state) {
      case "loading":
        return "Preparing orchestra and loading hand tracking AI model…";
      case "ready":
        return "Camera active. Move your hand down and back up to conduct.";
      case "preparing":
        return pausedBeat > 0
          ? `Resume motion from beat ${pausedBeat.toFixed(1)}…`
          : "Good — continue your conducting motion…";
      case "playing":
        return "Orchestra following your motion. Keep conducting.";
      case "paused":
        return `Orchestra paused at beat ${pausedBeat.toFixed(1)}. Move your hands to resume.`;
      case "completed":
        return "Bravo! Masterpiece concluded. Conduct again.";
    }
  }

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
  return "Tap SPACE to conduct.";
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
      { x: 155, labelX: 155, eggs: [{ cx: 108, cy: 155, rx: 22, ry: 32 }, { cx: 155, cy: 146, rx: 25, ry: 36 }, { cx: 202, cy: 155, rx: 22, ry: 32 }] },
      { x: 315, labelX: 315, eggs: [{ cx: 268, cy: 148, rx: 22, ry: 32 }, { cx: 315, cy: 140, rx: 25, ry: 36 }, { cx: 362, cy: 148, rx: 22, ry: 32 }] },
      { x: 525, labelX: 525, eggs: [{ cx: 478, cy: 148, rx: 22, ry: 32 }, { cx: 525, cy: 140, rx: 25, ry: 36 }, { cx: 572, cy: 148, rx: 22, ry: 32 }] },
      { x: 685, labelX: 685, eggs: [{ cx: 638, cy: 155, rx: 22, ry: 32 }, { cx: 685, cy: 146, rx: 25, ry: 36 }, { cx: 732, cy: 155, rx: 22, ry: 32 }] },
    ];

    piece.sections.forEach((sec, idx) => {
      const pos = positions[idx] || positions[0];
      sectionsSvg += `
        <g id="section-${sec.id}" class="instrument-section" data-section-id="${sec.id}">
          <g class="section-debug-hud">
            <rect x="${pos.labelX - 80}" y="32" width="160" height="52" rx="6" class="debug-vel-pill" />
            <text x="${pos.labelX}" y="49" text-anchor="middle" class="debug-vel-main">v: —</text>
            <text x="${pos.labelX}" y="63" text-anchor="middle" class="debug-vel-decomp">Raw — ➔ Macro —</text>
            <text x="${pos.labelX}" y="75" text-anchor="middle" class="debug-vel-history">History: —</text>
          </g>
          ${pos.eggs.map((e, ei) => `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" class="musician ${sec.id} egg-${ei}" />`).join("")}
          <text x="${pos.labelX}" y="202" text-anchor="middle" class="section-label">${sec.name}</text>
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
          <g class="section-debug-hud">
            <rect x="${centerX - 48}" y="32" width="96" height="52" rx="6" class="debug-vel-pill" />
            <text x="${centerX}" y="49" text-anchor="middle" class="debug-vel-main" style="font-size:12px;">v: —</text>
            <text x="${centerX}" y="63" text-anchor="middle" class="debug-vel-decomp" style="font-size:8.5px;">Raw —</text>
            <text x="${centerX}" y="75" text-anchor="middle" class="debug-vel-history" style="font-size:8px;">—</text>
          </g>
          <ellipse cx="${centerX - 24}" cy="${cy + 6}" rx="16" ry="24" class="musician ${sec.id} egg-0" />
          <ellipse cx="${centerX}" cy="${cy}" rx="18" ry="28" class="musician ${sec.id} egg-1" />
          <ellipse cx="${centerX + 24}" cy="${cy + 6}" rx="16" ry="24" class="musician ${sec.id} egg-2" />
          <text x="${centerX}" y="202" text-anchor="middle" class="section-label" style="font-size: 10.5px;">${sec.name}</text>
        </g>
      `;
    });
  }

  silhouetteContainer.innerHTML = `
    <svg viewBox="0 0 840 230" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <!-- Conductor podium & Baton (Center) -->
      <g id="conductor-group" class="conductor-group">
        <rect x="410" y="65" width="60" height="10" rx="5" class="podium" />
        <ellipse cx="440" cy="50" rx="19" ry="24" class="conductor" />
        <line id="baton-line" x1="450" y1="42" x2="495" y2="10" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="baton" />
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

// Map tracking the last 3 velocities for each section
const sectionVelocityHistory = new Map<string, number[]>();

// ── Experience setup ──────────────────────────────────────────────────────────

const controller = new ExperienceController({
  onStateChange: (state: ExperienceState) => {
    const pausedBeat = controller.getPausedBeat();
    promptEl.textContent = getPromptText(state, pausedBeat, controller.getInputSource());

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
  onInputSourceChange: (source: InputSource) => {
    updateInputSourceButtons(source);
  },
  onBeat: () => {
    flashBeat();
    swingBaton();
    updateBpmGaugeUI();
  },
  onDynamicChange: (level: DynamicLevel) => {
    updateDynamicLadderUI(level);
  },
  onAccentArmed: (armed: boolean) => {
    dynamicLadderContainer?.classList.toggle("accent-armed", armed);
  },
  onAccentFlash: () => {
    stageEl.classList.remove("accent-flash");
    void stageEl.offsetWidth; // force DOM reflow
    stageEl.classList.add("accent-flash");
    setTimeout(() => stageEl.classList.remove("accent-flash"), 380);
  },
  onNoteVisual: (event) => {
    setTimeout(() => {
      const section = channelToSectionMap.get(event.channel) ||
                      trackNameToSectionMap.get(String(event.trackId).toUpperCase()) ||
                      document.querySelector(".instrument-section");
      if (!section) return;

      const eggs = section.querySelectorAll<SVGElement>(".musician");
      const eggIndex = Math.abs(event.midiNote) % Math.max(1, eggs.length);
      const targetEgg = eggs[eggIndex] || eggs[0];

      if (event.type === "noteOn") {
        section.classList.add("playing");
        if (targetEgg) targetEgg.classList.add("playing");

        // Update Section Velocity Debug HUD (stays visible until next note updates it)
        const sectionKey = section.id || section.dataset.sectionId || "section";
        let history = sectionVelocityHistory.get(sectionKey);
        if (!history) {
          history = [];
          sectionVelocityHistory.set(sectionKey, history);
        }
        history.unshift(event.velocity);
        if (history.length > 3) history.pop();

        const mainText = section.querySelector<SVGTextElement>(".debug-vel-main");
        const decompText = section.querySelector<SVGTextElement>(".debug-vel-decomp");
        const histText = section.querySelector<SVGTextElement>(".debug-vel-history");

        const d = event.decomp;
        if (mainText) {
          mainText.textContent = `v: ${event.velocity} (${d.dynamicLevel} ×${d.dynMultiplier.toFixed(2)})`;
        }
        if (decompText) {
          const deltaStr = d.macroDelta >= 0 ? `+${d.macroDelta}` : `${d.macroDelta}`;
          const macroStr = d.macroEnabled ? `Macro ${d.macro} (${deltaStr})` : `Raw ${d.raw}`;
          decompText.textContent = `Raw ${d.raw} ➔ ${macroStr}`;
        }
        if (histText) {
          histText.textContent = `History: ${history.join(" • ")}`;
        }
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

// ── Input Source Controls ───────────────────────────────────────────────────

const inputBtnKeyboard = document.getElementById("input-btn-keyboard") as HTMLButtonElement;
const inputBtnCamera = document.getElementById("input-btn-camera") as HTMLButtonElement;
const spaceKeyHint = document.getElementById("space-key-hint") as HTMLElement;

function updateInputSourceButtons(source: InputSource): void {
  inputBtnKeyboard?.classList.toggle("active", source === "keyboard");
  inputBtnCamera?.classList.toggle("active", source === "camera");
  stageEl.classList.toggle("camera-mode-active", source === "camera");
  document.body.classList.toggle("camera-mode-active", source === "camera");

  if (spaceKeyHint) {
    if (source === "camera") {
      spaceKeyHint.innerHTML = `<span class="key" style="border-color:#5cd87e; color:#5cd87e; background:rgba(52,199,89,0.08); box-shadow:0 0 12px rgba(52,199,89,0.2);">📷 MOTION ACTIVE • TAP SPACE FOR BEATS</span>`;
    } else {
      spaceKeyHint.innerHTML = `<span class="key">SPACE</span>`;
    }
  }

  const pausedBeat = controller.getPausedBeat();
  promptEl.textContent = getPromptText(controller.getState(), pausedBeat, source);
}

async function setInputSource(source: InputSource): Promise<void> {
  try {
    await controller.setInputSource(source);
    updateInputSourceButtons(source);
  } catch (err) {
    console.error("Failed to switch input source:", err);
    updateInputSourceButtons("keyboard");
  }
}

inputBtnKeyboard?.addEventListener("click", () => setInputSource("keyboard"));
inputBtnCamera?.addEventListener("click", () => setInputSource("camera"));

// ── Time Input / Tempo Mode Controls ─────────────────────────────────────────

const modeBtnA = document.getElementById("mode-btn-a") as HTMLButtonElement;
const modeBtnB = document.getElementById("mode-btn-b") as HTMLButtonElement;
const modeBtnC = document.getElementById("mode-btn-c") as HTMLButtonElement;
const modeBtnD = document.getElementById("mode-btn-d") as HTMLButtonElement;
const modeBtnE = document.getElementById("mode-btn-e") as HTMLButtonElement;

function updateModeButtons(mode: TempoMode): void {
  modeBtnA?.classList.toggle("active", mode === "balanced");
  modeBtnB?.classList.toggle("active", mode === "instant");
  modeBtnC?.classList.toggle("active", mode === "autoplay");
  modeBtnD?.classList.toggle("active", mode === "inertial");
  modeBtnE?.classList.toggle("active", mode === "gestural");
}

function setMode(mode: TempoMode): void {
  controller.setTempoMode(mode);
  updateModeButtons(mode);
  const pausedBeat = controller.getPausedBeat();
  promptEl.textContent = getPromptText(controller.getState(), pausedBeat, controller.getInputSource());
}

modeBtnA?.addEventListener("click", () => setMode("balanced"));
modeBtnB?.addEventListener("click", () => setMode("instant"));
modeBtnC?.addEventListener("click", () => setMode("autoplay"));
modeBtnD?.addEventListener("click", () => setMode("inertial"));
modeBtnE?.addEventListener("click", () => setMode("gestural"));

// ── Horizontal BPM Speedometer Gauge ──────────────────────────────────────────

const markerOrchestra = document.getElementById("bpm-marker-orchestra") as HTMLElement;
const markerIndicated = document.getElementById("bpm-marker-indicated") as HTMLElement;
const valOrchestraBpm = document.getElementById("val-orchestra-bpm") as HTMLElement;
const valIndicatedBpm = document.getElementById("val-indicated-bpm") as HTMLElement;

function bpmToPercent(bpm: number): number {
  const minBpm = 40;
  const maxBpm = 220;
  const clamped = Math.max(minBpm, Math.min(maxBpm, bpm));
  return ((clamped - minBpm) / (maxBpm - minBpm)) * 100;
}

function updateBpmGaugeUI(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clockState = (controller as any).clock?.getState?.();
  const orchestraBpm = clockState?.bpm || 0;
  const indicatedBpm = controller.getIndicatedBpm() || orchestraBpm || 0;

  if (orchestraBpm > 0) {
    if (valOrchestraBpm) valOrchestraBpm.textContent = `${orchestraBpm.toFixed(0)} BPM`;
    if (markerOrchestra) markerOrchestra.style.left = `${bpmToPercent(orchestraBpm)}%`;
  } else {
    if (valOrchestraBpm) valOrchestraBpm.textContent = `— BPM`;
  }

  if (indicatedBpm > 0) {
    if (valIndicatedBpm) valIndicatedBpm.textContent = `${indicatedBpm.toFixed(0)} BPM`;
    if (markerIndicated) markerIndicated.style.left = `${bpmToPercent(indicatedBpm)}%`;
  } else {
    if (valIndicatedBpm) valIndicatedBpm.textContent = `— BPM`;
  }
}

// ── Orchestral Dynamics & Vertical Dynamic Ladder ───────────────────────────

const dynamicLadderContainer = document.getElementById("dynamic-ladder-container") as HTMLElement;
const dynamicSteps = document.querySelectorAll<HTMLButtonElement>(".dynamic-step");

function updateDynamicLadderUI(level: DynamicLevel): void {
  dynamicSteps.forEach(btn => {
    const isMatch = btn.dataset.dynamic === level;
    btn.classList.toggle("active", isMatch);
  });

  if (level === "fff") {
    dynamicLadderContainer?.classList.add("overburn");
  } else {
    dynamicLadderContainer?.classList.remove("overburn");
  }

  // Update stage ambient dynamic classes
  const allLevels: DynamicLevel[] = ["pp", "p", "mp", "mf", "f", "ff", "fff"];
  allLevels.forEach(d => stageEl.classList.remove(`dynamic-${d}`));
  stageEl.classList.add(`dynamic-${level}`);
}

// Click on dynamic ladder buttons
dynamicSteps.forEach(btn => {
  btn.addEventListener("click", () => {
    const dyn = btn.dataset.dynamic as DynamicLevel;
    if (dyn) {
      if (controller.getDynamicLevel() === dyn) {
        // Clicking active dynamic level toggles Accent burst for next beat
        controller.armAccent();
      } else {
        controller.setDynamicLevel(dyn);
      }
    }
  });
});

// Mouse wheel scroll to adjust orchestral dynamics
let wheelAccumulator = 0;
window.addEventListener("wheel", (e) => {
  // If user is scrolling inside a modal list, allow normal scrolling
  if ((e.target as HTMLElement)?.closest(".modal-body")) return;

  e.preventDefault();
  wheelAccumulator += e.deltaY;
  if (wheelAccumulator <= -35) {
    controller.stepDynamicLevel(1); // Louder
    wheelAccumulator = 0;
  } else if (wheelAccumulator >= 35) {
    controller.stepDynamicLevel(-1); // Softer
    wheelAccumulator = 0;
  }
}, { passive: false });

// Keyboard shortcuts: C (toggle input source), T (toggle tempo mode), 1-5 (modes), P (pause), ↑/↓ (dynamics), → (accent burst)
window.addEventListener("keydown", (e) => {
  if (versionModal.style.display === "flex" || repertoireModal.style.display === "flex") return;

  if (e.code === "KeyC" && !e.repeat) {
    const current = controller.getInputSource();
    setInputSource(current === "keyboard" ? "camera" : "keyboard");
  } else if (e.code === "KeyT" && !e.repeat) {
    const current = controller.getTempoMode();
    const modes: TempoMode[] = ["balanced", "instant", "autoplay", "inertial", "gestural"];
    const nextIdx = (modes.indexOf(current) + 1) % modes.length;
    setMode(modes[nextIdx]);
  } else if (e.code === "Digit1" && !e.repeat) {
    setMode("balanced");
  } else if (e.code === "Digit2" && !e.repeat) {
    setMode("instant");
  } else if (e.code === "Digit3" && !e.repeat) {
    setMode("autoplay");
  } else if (e.code === "Digit4" && !e.repeat) {
    setMode("inertial");
  } else if (e.code === "Digit5" && !e.repeat) {
    setMode("gestural");
  } else if (e.code === "KeyP" && !e.repeat) {
    controller.togglePause();
  } else if (e.code === "ArrowRight" && !e.repeat) {
    e.preventDefault();
    controller.armAccent();
  } else if (e.code === "ArrowUp") {
    e.preventDefault();
    controller.stepDynamicLevel(1);
  } else if (e.code === "ArrowDown") {
    e.preventDefault();
    controller.stepDynamicLevel(-1);
  }
});

// Initialize UI to starting dynamic level (mf)
updateDynamicLadderUI(controller.getDynamicLevel());

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
          <div class="piece-card-composer">${piece.composer} — ${piece.movement} (${piece.year}) • <span style="color:#ffd56b">${piece.conductMode || "Standard"}</span></div>
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
    subtitleEl.textContent = `${piece.composer} — ${piece.movement} • ${piece.conductMode || ""}`;
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

loadRepertoireCatalog().then(() => {
  const initialPiece = controller.getCurrentPiece();
  titleEl.textContent = initialPiece.title;
  subtitleEl.textContent = `${initialPiece.composer} — ${initialPiece.movement} • ${initialPiece.conductMode || ""}`;
  renderOrchestraStage(initialPiece);

  controller.load().then(() => {
    loadingEl.style.display = "none";
    stageEl.style.display = "flex";
    
    // Continuous smooth update loop for BPM gauge
    function gaugeRenderLoop(): void {
      updateBpmGaugeUI();
      requestAnimationFrame(gaugeRenderLoop);
    }
    gaugeRenderLoop();
  }).catch(err => {
    loadingEl.innerHTML = `<p class="error">Failed to load: ${err.message}</p>`;
  });
});
