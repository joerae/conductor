/**
 * main.ts — Conductor entry point
 * Instantiates ExperienceController and wires it to the DOM.
 */

import { ExperienceController } from "./experience/ExperienceController";
import type { ExperienceState, InputSource } from "./experience/ExperienceController";
import type { TempoMode } from "./clock/ConductorClock";
import { loadRepertoireCatalog, getPieceById, REPERTOIRE } from "./score/repertoire";
import type { PieceDefinition } from "./score/repertoire";
import type { DynamicLevel } from "./audio/dynamicsTypes";
import { NoteVisualManager } from "./ui/NoteVisualManager";
import { bpmToPercent, initBpmGaugeTicks } from "./ui/bpmGauge";
import { SpotlightScoreVisualizer } from "./ui/SpotlightScoreVisualizer";
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
          return "Playing! 👎 Thumb down for dramatic cutoff • ✌️✌️ Double Peace for Party Mode!";
        case "paused":
          return `Orchestra paused at beat ${pausedBeat.toFixed(1)}. Raise hands to resume.`;
        case "completed":
          return "Bravo! Masterpiece concluded. Raise hands to conduct again.";
      }
    }

    if (tempoMode === "inertial") {
      switch (state) {
        case "loading":
          return "Preparing orchestra and loading hand tracking AI model…";
        case "ready":
          return "Camera active. Conduct in 2 (1 stroke = 2 beats) to set the tempo!";
        case "preparing":
          return pausedBeat > 0
            ? `Resume conducting from beat ${pausedBeat.toFixed(1)} (cut time)…`
            : "Beat once more to establish tempo…";
        case "playing":
          return "Conducting in cut time (1 stroke = 2 beats). Steer tempo or coast freely.";
        case "paused":
          return `Orchestra paused at beat ${pausedBeat.toFixed(1)}. Conduct two beats to resume.`;
        case "completed":
          return "Bravo! Masterpiece concluded. Conduct again in cut time.";
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

  // Keyboard input source
  if (tempoMode === "gestural") {
    switch (state) {
      case "loading":
        return "Preparing the orchestra and instruments…";
      case "ready":
        return "Keyboard active. Press SPACE or P to begin, ← / → for tempo, ↑ / ↓ for volume.";
      case "preparing":
        return "Starting orchestra…";
      case "playing":
        return "Playing! Use ← / → for tempo (accelerando/rallentando), ↑ / ↓ for volume, P to pause.";
      case "paused":
        return `Orchestra paused at beat ${pausedBeat.toFixed(1)}. Press SPACE or P to resume.`;
      case "completed":
        return "Bravo! Masterpiece concluded. Press SPACE to conduct again.";
    }
  }

  switch (state) {
    case "loading":
      return "Preparing the orchestra and instruments…";
    case "ready":
      return "Tap SPACE twice to set the pulse (1 tap = 1 beat).";
    case "preparing":
      return pausedBeat > 0
        ? `Tap SPACE once more to resume from beat ${pausedBeat.toFixed(1)}…`
        : "Good — tap SPACE once more to begin…";
    case "playing":
      return "Orchestra is playing. Tap SPACE to steer the tempo (1 tap = 1 beat).";
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
let sectionMusicianEggsMap: Map<HTMLElement, SVGElement[]> = new Map();
let sectionTextMap: Map<HTMLElement, {
  mainText: SVGTextElement | null;
  decompText: SVGTextElement | null;
  histText: SVGTextElement | null;
}> = new Map();

function renderOrchestraStage(piece: PieceDefinition): void {
  clearAllNoteVisuals();
  channelToSectionMap.clear();
  trackNameToSectionMap.clear();
  sectionMusicianEggsMap.clear();
  sectionTextMap.clear();

  let sectionsSvg = "";

  if (piece.layout === "chamber_strings") {
    // 4 sections in spacious classical semi-circle
    const positions = [
      { x: 160, labelX: 160, eggs: [{ cx: 115, cy: 74, rx: 22, ry: 32 }, { cx: 160, cy: 65, rx: 25, ry: 36 }, { cx: 205, cy: 74, rx: 22, ry: 32 }] },
      { x: 380, labelX: 380, eggs: [{ cx: 335, cy: 68, rx: 22, ry: 32 }, { cx: 380, cy: 60, rx: 25, ry: 36 }, { cx: 425, cy: 68, rx: 22, ry: 32 }] },
      { x: 620, labelX: 620, eggs: [{ cx: 575, cy: 68, rx: 22, ry: 32 }, { cx: 620, cy: 60, rx: 25, ry: 36 }, { cx: 665, cy: 68, rx: 22, ry: 32 }] },
      { x: 840, labelX: 840, eggs: [{ cx: 795, cy: 74, rx: 22, ry: 32 }, { cx: 840, cy: 65, rx: 25, ry: 36 }, { cx: 885, cy: 74, rx: 22, ry: 32 }] },
    ];

    piece.sections.forEach((sec, idx) => {
      const pos = positions[idx] || positions[0];
      sectionsSvg += `
        <g id="section-${sec.id}" class="instrument-section" data-section-id="${sec.id}">
          <g class="section-debug-hud">
            <rect x="${pos.labelX - 75}" y="0" width="150" height="52" rx="6" class="debug-vel-pill" />
            <text x="${pos.labelX}" y="17" text-anchor="middle" class="debug-vel-main">v: —</text>
            <text x="${pos.labelX}" y="31" text-anchor="middle" class="debug-vel-decomp">Raw — ➔ Macro —</text>
            <text x="${pos.labelX}" y="43" text-anchor="middle" class="debug-vel-history">History: —</text>
          </g>
          ${pos.eggs.map((e, ei) => `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" class="musician ${sec.id} egg-${ei}" />`).join("")}
          <text x="${pos.labelX}" y="122" text-anchor="middle" class="section-label">${sec.name}</text>
        </g>
      `;
    });
  } else {
    // 7 sections for Full Symphony Orchestra with 140px clean breathing room
    const positions7 = [
      { centerX: 75,  cy: 74 },
      { centerX: 215, cy: 68 },
      { centerX: 355, cy: 62 },
      { centerX: 500, cy: 58 },
      { centerX: 645, cy: 62 },
      { centerX: 785, cy: 68 },
      { centerX: 925, cy: 74 },
    ];

    piece.sections.forEach((sec, idx) => {
      const p = positions7[idx] || { centerX: 75 + idx * 140, cy: 68 };
      const centerX = p.centerX;
      const cy = p.cy;

      sectionsSvg += `
        <g id="section-${sec.id}" class="instrument-section" data-section-id="${sec.id}">
          <g class="section-debug-hud">
            <rect x="${centerX - 55}" y="0" width="110" height="52" rx="6" class="debug-vel-pill" />
            <text x="${centerX}" y="17" text-anchor="middle" class="debug-vel-main" style="font-size:11.5px;">v: —</text>
            <text x="${centerX}" y="31" text-anchor="middle" class="debug-vel-decomp" style="font-size:8.5px;">Raw —</text>
            <text x="${centerX}" y="43" text-anchor="middle" class="debug-vel-history" style="font-size:8px;">—</text>
          </g>
          <ellipse cx="${centerX - 21}" cy="${cy + 6}" rx="15" ry="23" class="musician ${sec.id} egg-0" />
          <ellipse cx="${centerX}" cy="${cy}" rx="17" ry="27" class="musician ${sec.id} egg-1" />
          <ellipse cx="${centerX + 21}" cy="${cy + 6}" rx="15" ry="23" class="musician ${sec.id} egg-2" />
          <text x="${centerX}" y="122" text-anchor="middle" class="section-label" style="font-size: 10px; letter-spacing: 0.05em;">${sec.name}</text>
        </g>
      `;
    });
  }

  silhouetteContainer.innerHTML = `
    <svg viewBox="0 0 1000 140" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      ${sectionsSvg}
      <!-- Stage floor -->
      <rect x="20" y="134" width="960" height="4" rx="2" class="stage-floor" />
    </svg>
  `;

  // Build mapping from channel & trackName to DOM section and pre-cache SVG child nodes
  piece.sections.forEach(sec => {
    const el = document.getElementById(`section-${sec.id}`);
    if (el) {
      sec.channels.forEach(ch => channelToSectionMap.set(ch, el));
      if (sec.trackNames) {
        sec.trackNames.forEach(tn => trackNameToSectionMap.set(tn.toUpperCase(), el));
      }
      const eggs = Array.from(el.querySelectorAll<SVGElement>(".musician"));
      sectionMusicianEggsMap.set(el, eggs);

      sectionTextMap.set(el, {
        mainText: el.querySelector<SVGTextElement>(".debug-vel-main"),
        decompText: el.querySelector<SVGTextElement>(".debug-vel-decomp"),
        histText: el.querySelector<SVGTextElement>(".debug-vel-history"),
      });
    }
  });
}

// Map tracking the last 3 velocities for each section
const sectionVelocityHistory = new Map<string, number[]>();

// Track rendered focus UI state to prevent redundant DOM thrashing
let lastRenderedFocusActive = false;
let lastRenderedGrabbedSectionId: string | null = null;
let lastRenderedHoveredSectionId: string | null = null;

// Track visual session and active playing notes for reference counting
const noteVisualManager = new NoteVisualManager();
export function clearAllNoteVisuals(): void {
  noteVisualManager.clearAll();
}

let spotlightScoreVisualizer: SpotlightScoreVisualizer | null = null;

// ── Experience setup ──────────────────────────────────────────────────────────

const controller = new ExperienceController({
  onStateChange: (state: ExperienceState) => {
    const pausedBeat = controller.getPausedBeat();
    promptEl.textContent = getPromptText(state, pausedBeat, controller.getInputSource());

    const showControls = state !== "loading";
    restartBtn.style.display = showControls ? "inline-flex" : "none";
    switchPieceBtn.style.display = showControls ? "inline-flex" : "none";

    if (state === "completed") {
      restartBtn.innerHTML = "↺ Conduct Again";
    } else {
      restartBtn.innerHTML = "↺ Restart from Top";
    }

    if (debugHintEl) {
      debugHintEl.style.display = state === "ready" ? "inline" : "inline";
    }
    stageEl.dataset.state = state;

    // Reset visual highlights and pending timers when not playing
    if (state !== "playing") {
      clearAllNoteVisuals();
    }
  },
  onInputSourceChange: (source: InputSource) => {
    updateInputSourceButtons(source);
  },
  onCameraAxisMappingChange: () => {
    updateControlHints();
  },
  onFistCutoffChange: (isCutoff: boolean) => {
    const banner = document.getElementById("gesture-banner");
    const icon = document.getElementById("gesture-banner-icon");
    const text = document.getElementById("gesture-banner-text");
    if (banner && icon && text) {
      if (isCutoff) {
        banner.className = "gesture-banner cutoff";
        icon.textContent = "👎";
        text.textContent = "DRAMATIC CUTOFF • Release thumb to resume";
        banner.style.display = "flex";
        promptEl.textContent = "👎 Dramatic Cutoff! Release thumbs-down to resume playback.";
      } else {
        banner.style.display = "none";
        promptEl.textContent = getPromptText(controller.getState(), controller.getPausedBeat(), controller.getInputSource());
      }
    }
  },
  onFermataChange: (isFermata: boolean) => {
    const banner = document.getElementById("gesture-banner");
    const icon = document.getElementById("gesture-banner-icon");
    const text = document.getElementById("gesture-banner-text");
    if (banner && icon && text) {
      if (isFermata) {
        banner.className = "gesture-banner fermata";
        icon.textContent = "👍";
        text.textContent = "FERMATA • Holding note";
        banner.style.display = "flex";
        promptEl.textContent = "👍 Fermata active — sustaining note! Release thumb to continue.";
      } else {
        banner.style.display = "none";
        promptEl.textContent = getPromptText(controller.getState(), controller.getPausedBeat(), controller.getInputSource());
      }
    }
  },
  onLoveModeChange: (isLove: boolean) => {
    const loveBanner = document.getElementById("love-banner");
    if (isLove) {
      stageEl.classList.add("love-mode-active");
      if (loveBanner) loveBanner.style.display = "flex";
      promptEl.textContent = "🤟 Love Mode! Intimate Pianissimo (pp) with lush concert hall reverb!";
    } else {
      stageEl.classList.remove("love-mode-active");
      if (loveBanner) loveBanner.style.display = "none";
      promptEl.textContent = getPromptText(controller.getState(), controller.getPausedBeat(), controller.getInputSource());
    }
  },
  onPartyModeChange: (isParty: boolean) => {
    const partyBanner = document.getElementById("party-banner");
    if (isParty) {
      stageEl.classList.add("party-mode-active");
      if (partyBanner) partyBanner.style.display = "flex";
      promptEl.textContent = "✌️✌️ Party Mode!";
    } else {
      stageEl.classList.remove("party-mode-active");
      if (partyBanner) partyBanner.style.display = "none";
      promptEl.textContent = getPromptText(controller.getState(), controller.getPausedBeat(), controller.getInputSource());
    }
  },
  onFocusChange: (telemetry) => {
    // Only perform DOM mutations if rendered state actually changed
    if (
      telemetry.isActive === lastRenderedFocusActive &&
      telemetry.grabbedSectionId === lastRenderedGrabbedSectionId &&
      telemetry.hoveredSectionId === lastRenderedHoveredSectionId
    ) {
      return;
    }

    lastRenderedFocusActive = telemetry.isActive;
    lastRenderedGrabbedSectionId = telemetry.grabbedSectionId;
    lastRenderedHoveredSectionId = telemetry.hoveredSectionId;

    const currentPiece = getPieceById(controller.getCurrentPieceId()) || REPERTOIRE[0];

    if (telemetry.isActive) {
      stageEl.classList.add("focus-mode-active");

      // Background non-selected sections when one is spotlighted
      if (telemetry.grabbedSectionId) {
        stageEl.classList.add("has-grabbed-section");
      } else {
        stageEl.classList.remove("has-grabbed-section");
      }

      // Clear previous focus highlight classes
      document.querySelectorAll(".instrument-section").forEach(el => {
        el.classList.remove("focus-hover", "focus-grabbed");
      });

      // Highlight spotlighted section & update dynamic label
      if (telemetry.grabbedSectionId) {
        const grabbedEl = document.getElementById(`section-${telemetry.grabbedSectionId}`);
        if (grabbedEl) {
          grabbedEl.classList.add("focus-grabbed", "focus-hover");
          const labelEl = grabbedEl.querySelector(".section-label");
          const sec = currentPiece?.sections.find(s => s.id === telemetry.grabbedSectionId);
          if (labelEl && sec) {
            labelEl.textContent = `${sec.name} • SPOTLIGHT (f)`;
          }
        }
        spotlightScoreVisualizer?.show(telemetry.grabbedSectionId);
      } else if (telemetry.hoveredSectionId) {
        const hoveredEl = document.getElementById(`section-${telemetry.hoveredSectionId}`);
        if (hoveredEl) {
          hoveredEl.classList.add("focus-hover");
        }
        spotlightScoreVisualizer?.show(telemetry.hoveredSectionId);
      } else {
        spotlightScoreVisualizer?.hide();
      }

      // Restore normal labels for non-grabbed sections
      currentPiece?.sections.forEach(sec => {
        if (sec.id !== telemetry.grabbedSectionId) {
          const el = document.getElementById(`section-${sec.id}`);
          const labelEl = el?.querySelector(".section-label");
          if (labelEl) labelEl.textContent = sec.name;
        }
      });

      // Update prompt
      if (telemetry.grabbedSectionId) {
        const sec = currentPiece?.sections.find(s => s.id === telemetry.grabbedSectionId);
        promptEl.textContent = `✨ ${sec?.name} (Forte / Center Stage) • Point at another section or lower hand to restore ensemble balance`;
      } else {
        promptEl.textContent = "🪄 Point your index finger at any section to bring it forward in the mix";
      }
    } else {
      spotlightScoreVisualizer?.hide();
      stageEl.classList.remove("focus-mode-active", "has-grabbed-section");
      document.querySelectorAll(".instrument-section").forEach(el => {
        el.classList.remove("focus-hover", "focus-grabbed");
      });
      currentPiece?.sections.forEach(sec => {
        const el = document.getElementById(`section-${sec.id}`);
        const labelEl = el?.querySelector(".section-label");
        if (labelEl) labelEl.textContent = sec.name;
      });
      promptEl.textContent = getPromptText(controller.getState(), controller.getPausedBeat(), controller.getInputSource());
    }

    if (spotlightScoreVisualizer) {
      controller.getDebugOverlay()?.updateScoreVisualizerTelemetry(spotlightScoreVisualizer.getDebugTelemetry());
    }
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
    noteVisualManager.handleNoteVisual(event, {
      getSection: (channel, trackId) =>
        channelToSectionMap.get(channel) ||
        trackNameToSectionMap.get(String(trackId).toUpperCase()) ||
        document.querySelector(".instrument-section"),
      getMusicianEgg: (section, midiNote) => {
        const eggs = sectionMusicianEggsMap.get(section as HTMLElement) || Array.from(section.querySelectorAll<SVGElement>(".musician"));
        const eggIndex = Math.abs(midiNote) % Math.max(1, eggs.length);
        return eggs[eggIndex] || eggs[0] || null;
      },
      onVelocityHistory: (section, velocity, decomp) => {
        const sectionKey = (section as HTMLElement).dataset.sectionId || "sec";
        let history = sectionVelocityHistory.get(sectionKey);
        if (!history) {
          history = [];
          sectionVelocityHistory.set(sectionKey, history);
        }
        history.unshift(velocity);
        if (history.length > 3) history.pop();

        const textElements = sectionTextMap.get(section as HTMLElement);
        const mainText = textElements?.mainText || section.querySelector<SVGTextElement>(".debug-vel-main");
        const decompText = textElements?.decompText || section.querySelector<SVGTextElement>(".debug-vel-decomp");
        const histText = textElements?.histText || section.querySelector<SVGTextElement>(".debug-vel-history");

        if (mainText) {
          mainText.textContent = `v: ${velocity} (${decomp.dynamicLevel} ×${decomp.dynMultiplier.toFixed(2)})`;
        }
        if (decompText) {
          const deltaStr = decomp.macroDelta >= 0 ? `+${decomp.macroDelta}` : `${decomp.macroDelta}`;
          const macroStr = decomp.macroEnabled ? `Macro ${decomp.macro} (${deltaStr})` : `Raw ${decomp.raw}`;
          decompText.textContent = `Raw ${decomp.raw} ➔ ${macroStr}`;
        }
        if (histText) {
          histText.textContent = `History: ${history.join(" • ")}`;
        }
      },
    });
  },
});

spotlightScoreVisualizer = new SpotlightScoreVisualizer({
  getMidiScore: () => controller.getMidiScore(),
  getTransport: () => controller.getTransport(),
  getCurrentPiece: () => controller.getCurrentPiece() || getPieceById(controller.getCurrentPieceId()) || REPERTOIRE[0],
});

// Synchronize initial score visualizer state with controller feature flag
spotlightScoreVisualizer.setEnabled(controller.isScoreVisualizerActive());
if (spotlightScoreVisualizer) {
  controller.getDebugOverlay()?.updateScoreVisualizerTelemetry(spotlightScoreVisualizer.getDebugTelemetry());
}

window.addEventListener("resize", () => {
  spotlightScoreVisualizer?.updatePosition();
  if (spotlightScoreVisualizer) {
    controller.getDebugOverlay()?.updateScoreVisualizerTelemetry(spotlightScoreVisualizer.getDebugTelemetry());
  }
});

// ── Input Source Controls ───────────────────────────────────────────────────

const inputBtnKeyboard = document.getElementById("input-btn-keyboard") as HTMLButtonElement;
const inputBtnCamera = document.getElementById("input-btn-camera") as HTMLButtonElement;
const inputHintText = document.getElementById("input-hint-text") as HTMLElement;
const spaceKeyHint = document.getElementById("space-key-hint") as HTMLElement;

function updateControlHints(): void {
  const source = controller.getInputSource();
  const mode = controller.getTempoMode();
  const mapping = controller.getCameraAxisMapping();

  if (inputHintText) {
    inputHintText.innerHTML = source === "camera"
      ? `Press <strong>C</strong> for Keyboard`
      : `Press <strong>C</strong> for Camera`;
  }

  if (modeHintText) {
    if (source === "camera") {
      if (mode === "gestural") {
        if (mapping === "flipped") {
          modeHintText.innerHTML = `🪄 <strong>Expressive (Camera)</strong>: Width ↔ modulates Tempo • Height ↕ modulates Volume • Drop hands to stop`;
        } else {
          modeHintText.innerHTML = `🪄 <strong>Expressive (Camera)</strong>: Height ↕ modulates Tempo • Width ↔ modulates Volume • Drop hands to stop`;
        }
      } else if (mode === "inertial") {
        modeHintText.innerHTML = `🥁 <strong>Beat (Camera Cut Time)</strong>: Conduct strokes in 2 (1 stroke = 2 beats) • Steer tempo with hands • Coast freely`;
      } else if (mode === "autoplay") {
        modeHintText.innerHTML = `⚡ <strong>Autoplay (Debug)</strong>: Playing continuously in tempo`;
      } else {
        modeHintText.innerHTML = `⚙️ <strong>${String(mode).toUpperCase()} (Debug)</strong>: Move hands to conduct`;
      }
    } else {
      // Keyboard mode
      if (mode === "gestural") {
        modeHintText.innerHTML = `🪄 <strong>Expressive (Keyboard)</strong>: <strong>↑ / ↓</strong> adjust Target Tempo • <strong>← / →</strong> adjust Volume • <strong>\\</strong> Accent (&gt;) • <strong>SPACE / P</strong> Play/Pause`;
      } else if (mode === "inertial" || mode === "balanced" || mode === "instant") {
        modeHintText.innerHTML = `🥁 <strong>Beat (Keyboard)</strong>: Tap <strong>SPACE</strong> on every beat (1 tap = 1 beat) • <strong>← / →</strong> adjust Volume`;
      } else if (mode === "autoplay") {
        modeHintText.innerHTML = `⚡ <strong>Autoplay (Debug)</strong>: Playing continuously in tempo`;
      } else {
        modeHintText.innerHTML = `⚙️ <strong>${String(mode).toUpperCase()} (Debug)</strong>: Tap SPACE to conduct`;
      }
    }
  }

  const pausedBeat = controller.getPausedBeat();
  promptEl.textContent = getPromptText(controller.getState(), pausedBeat, source);
}

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

  updateControlHints();
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

const modeBtnE = document.getElementById("mode-btn-e") as HTMLButtonElement;
const modeBtnD = document.getElementById("mode-btn-d") as HTMLButtonElement;
const modeHintText = document.getElementById("mode-hint-text") as HTMLElement;

function updateModeButtons(mode: TempoMode): void {
  modeBtnE?.classList.toggle("active", mode === "gestural");
  modeBtnD?.classList.toggle("active", mode === "inertial");
  updateControlHints();
}

function setMode(mode: TempoMode): void {
  controller.setTempoMode(mode);
  updateModeButtons(mode);
}

modeBtnE?.addEventListener("click", () => setMode("gestural"));
modeBtnD?.addEventListener("click", () => setMode("inertial"));

// ── Vertical BPM Speedometer Gauge (Beside Camera) ───────────────────────────

const markerOrchestra = document.getElementById("bpm-marker-orchestra") as HTMLElement;
const markerIndicated = document.getElementById("bpm-marker-indicated") as HTMLElement;
const valOrchestraBpm = document.getElementById("val-orchestra-bpm") as HTMLElement;
const valIndicatedBpm = document.getElementById("val-indicated-bpm") as HTMLElement;


function updateBpmGaugeUI(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clockState = (controller as any).clock?.getState?.();
  const orchestraBpm = clockState?.bpm || 0;
  const indicatedBpm = controller.getIndicatedBpm() || orchestraBpm || 0;

  if (orchestraBpm > 0) {
    if (valOrchestraBpm) valOrchestraBpm.textContent = `${orchestraBpm.toFixed(0)}`;
    if (markerOrchestra) markerOrchestra.style.bottom = `${bpmToPercent(orchestraBpm)}%`;
  } else {
    if (valOrchestraBpm) valOrchestraBpm.textContent = `—`;
  }

  if (indicatedBpm > 0) {
    if (valIndicatedBpm) valIndicatedBpm.textContent = `${indicatedBpm.toFixed(0)}`;
    if (markerIndicated) markerIndicated.style.bottom = `${bpmToPercent(indicatedBpm)}%`;
  } else {
    if (valIndicatedBpm) valIndicatedBpm.textContent = `—`;
  }

  // BPM Green Zone: vertical ±20 BPM target band anchored to piece's nominal intended BPM
  const greenZone = document.getElementById("bpm-green-zone") as HTMLElement | null;
  if (greenZone) {
    const nominalBpm = controller.getNominalPieceBpm?.() || controller.getBasePieceBpm?.() || 0;
    if (nominalBpm > 0) {
      const loPercent = bpmToPercent(nominalBpm - 20);
      const hiPercent = bpmToPercent(nominalBpm + 20);
      greenZone.style.bottom = `${loPercent}%`;
      greenZone.style.height = `${hiPercent - loPercent}%`;
      greenZone.style.display = "block";
    } else {
      greenZone.style.display = "none";
    }
  }
}

// ── Orchestral Dynamics & Horizontal Dynamic Ribbon ─────────────────────────

const dynamicLadderContainer = document.getElementById("dynamic-ladder-container") as HTMLElement;
const dynamicSteps = document.querySelectorAll<HTMLButtonElement>(".dynamic-step");
const dynamicCurrentBadge = document.getElementById("dynamic-current-badge") as HTMLElement | null;

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

  // Update dynamic badge
  if (dynamicCurrentBadge) {
    const continuousVal = (controller as any).audioEngine?.getContinuousDynamic?.() ?? 0.5;
    const pct = Math.round(continuousVal * 100);
    dynamicCurrentBadge.textContent = `${level.toUpperCase()} (${pct}%)`;
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

// Keyboard shortcuts:
// C (toggle input source), T (toggle Expressive/Beat mode), 1-2 (modes), P (pause)
// ↑ / ↓ (Tempo in Expressive mode), ← / → (Dynamics in Expressive/Beat mode), \ (Accent burst)
window.addEventListener("keydown", (e) => {
  if (versionModal.style.display === "flex" || repertoireModal.style.display === "flex") return;

  if (e.code === "KeyC" && !e.repeat) {
    const current = controller.getInputSource();
    setInputSource(current === "keyboard" ? "camera" : "keyboard");
  } else if (e.code === "KeyT" && !e.repeat) {
    const current = controller.getTempoMode();
    const nextMode: TempoMode = current === "gestural" ? "inertial" : "gestural";
    setMode(nextMode);
  } else if (e.code === "Digit1" && !e.repeat) {
    setMode("gestural");
  } else if (e.code === "Digit2" && !e.repeat) {
    setMode("inertial");
  } else if (e.code === "KeyP" && !e.repeat) {
    controller.togglePause();
  } else if (e.code === "KeyS" && !e.repeat) {
    // S toggles the score visualizer feature flag
    const next = !controller.isScoreVisualizerActive();
    controller.setScoreVisualizerEnabled(next);
    spotlightScoreVisualizer?.setEnabled(next);
    if (spotlightScoreVisualizer) {
      controller.getDebugOverlay()?.updateScoreVisualizerTelemetry(spotlightScoreVisualizer.getDebugTelemetry());
    }
  } else if (e.code === "ArrowUp") {
    // Up arrow: increase target Tempo
    e.preventDefault();
    controller.nudgeGesturalBpm(5);
  } else if (e.code === "ArrowDown") {
    // Down arrow: decrease target Tempo
    e.preventDefault();
    controller.nudgeGesturalBpm(-5);
  } else if (e.code === "ArrowRight") {
    // Right arrow: step Dynamic louder
    e.preventDefault();
    controller.stepDynamicLevel(1);
  } else if (e.code === "ArrowLeft") {
    // Left arrow: step Dynamic softer
    e.preventDefault();
    controller.stepDynamicLevel(-1);
  } else if (e.code === "Backslash" && !e.repeat) {
    // \ always triggers accent burst
    e.preventDefault();
    controller.armAccent();
  }
});

// Initialize UI to starting dynamic level (mf)
updateDynamicLadderUI(controller.getDynamicLevel());

restartBtn.addEventListener("click", () => {
  clearAllNoteVisuals();
  controller.restart();
});
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
  clearAllNoteVisuals();
  spotlightScoreVisualizer?.hide();
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

// Unlock AudioContext on first user interaction (pointer or key)
const unlockAudio = () => {
  controller.resumeAudio().catch(() => {});
};
window.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("keydown", unlockAudio, { once: true });

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
    
    // Sync UI buttons & hint text with initial controller state (Camera + Mode E)
    updateInputSourceButtons(controller.getInputSource());
    updateModeButtons(controller.getTempoMode());
    initBpmGaugeTicks();

    // Continuous smooth update loop for BPM gauge & Analogue Dynamics Marker
    function gaugeRenderLoop(): void {
      updateBpmGaugeUI();
      updateAnalogueDynamicUI();
      requestAnimationFrame(gaugeRenderLoop);
    }
    gaugeRenderLoop();
  }).catch(err => {
    loadingEl.innerHTML = `<p class="error">Failed to load: ${err.message}</p>`;
  });
});

function updateAnalogueDynamicUI(): void {
  const analogueMarker = document.getElementById("dynamic-analogue-marker") as HTMLElement | null;
  const dynamicCurrentBadge = document.getElementById("dynamic-current-badge") as HTMLElement | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const continuousVal = (controller as any).audioEngine?.getContinuousDynamic?.() ?? 0.5;

  if (analogueMarker) {
    // Map continuousVal [0, 1] to horizontal percentage [4%, 96%] so marker glides smoothly along track
    const pct = Math.max(4, Math.min(96, continuousVal * 92 + 4));
    analogueMarker.style.left = `${pct}%`;
  }

  if (dynamicCurrentBadge) {
    const level = controller.getDynamicLevel();
    const pct = Math.round(continuousVal * 100);
    dynamicCurrentBadge.textContent = `${level.toUpperCase()} (${pct}%)`;
  }
}
