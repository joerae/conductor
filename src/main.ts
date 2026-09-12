/**
 * main.ts — Conductor entry point
 * Lightweight orchestrator: wires ExperienceController to the DOM, modals, and input shortcuts.
 */

import { ExperienceController } from "./experience/ExperienceController";
import type { InputSource } from "./experience/ExperienceController";
import type { TempoMode } from "./clock/ConductorClock";
import { getPieceById, REPERTOIRE } from "./score/repertoire";
import type { DynamicLevel } from "./audio/dynamicsTypes";
import { NoteVisualManager } from "./ui/NoteVisualManager";
import { SpotlightScoreVisualizer } from "./ui/SpotlightScoreVisualizer";
import { WarmupManager } from "./warmup/WarmupManager";
import { OrchestraStage } from "./ui/orchestraStage";
import { queryAppElements, AppUiManager } from "./ui/appBindings";
import { VersionModal } from "./ui/versionModal";
import { RepertoireModal } from "./ui/repertoireModal";
import { setupKeyboardShortcuts } from "./input/keyboardShortcuts";
import { bootstrapConductorApp } from "./experience/appBootstrap";
import "./style.css";

// ── App DOM & UI Managers ───────────────────────────────────────────────────

const elements = queryAppElements();
const uiManager = new AppUiManager(elements);
const orchestraStage = new OrchestraStage(elements.silhouetteContainer);
const noteVisualManager = new NoteVisualManager();

export function clearAllNoteVisuals(): void {
  noteVisualManager.clearAll();
}

let spotlightScoreVisualizer: SpotlightScoreVisualizer | null = null;
let warmupManager: WarmupManager | null = null;
let demoBpm: number | undefined;
let demoContinuous: number | undefined;
let demoDynamicLevel: DynamicLevel | undefined;

// ── Experience Controller ───────────────────────────────────────────────────

const controller = new ExperienceController({
  onStateChange: (state) => {
    uiManager.handleStateChange(state, controller, clearAllNoteVisuals);
  },
  onInputSourceChange: (source) => {
    uiManager.updateInputSourceButtons(source, controller);
  },
  onCameraAxisMappingChange: () => {
    uiManager.updateControlHints(controller);
  },
  onFistCutoffChange: (isCutoff) => {
    uiManager.handleCutoffChange(isCutoff, controller);
  },
  onFermataChange: (isFermata) => {
    uiManager.handleFermataChange(isFermata, controller);
  },
  onLoveModeChange: (isLove) => {
    uiManager.handleLoveModeChange(isLove, controller);
  },
  onPartyModeChange: (isParty) => {
    uiManager.handlePartyModeChange(isParty, controller);
  },
  onFocusChange: (telemetry) => {
    uiManager.handleFocusChange(telemetry, controller, spotlightScoreVisualizer);
  },
  onBeat: () => {
    uiManager.flashBeat();
    uiManager.swingBaton();
    uiManager.updateBpmGaugeUI(controller);
  },
  onDynamicChange: (level) => {
    uiManager.updateDynamicLadderUI(level, controller);
  },
  onAccentArmed: (armed) => {
    uiManager.setAccentArmed(armed);
  },
  onAccentFlash: () => {
    uiManager.flashAccent();
  },
  onNoteVisual: (event) => {
    noteVisualManager.handleNoteVisual(event, {
      getSection: (channel, trackId) => orchestraStage.getSection(channel, trackId),
      getMusicianEgg: (section, midiNote) => orchestraStage.getMusicianEgg(section as HTMLElement, midiNote),
      onVelocityHistory: (section, velocity, decomp) => {
        orchestraStage.updateVelocityHistory(section as HTMLElement, velocity, decomp);
      },
    });
  },
  onAudioReady: (audioCtx) => {
    if (warmupManager) {
      warmupManager.startWarmupAudio(audioCtx);
    }
  },
  onMagicFinger: (telemetry) => {
    uiManager.handleMagicFinger(telemetry, controller);
  },
  onCameraMotionSample: (sample) => {
    if (elements.stageEl.classList.contains("stage-warming-up")) {
      warmupManager?.handleLiveSample(sample);
      if (sample.tempoBpm) {
        demoBpm = sample.tempoBpm;
      }
      if (sample.dynamicContinuous !== undefined && sample.dynamicLevel) {
        demoContinuous = sample.dynamicContinuous;
        demoDynamicLevel = sample.dynamicLevel as DynamicLevel;
      }
      if (sample.isHandsRaised && warmupManager?.isReadyToExit()) {
        exitWarmupAndStartConducting();
      }
    } else {
      if (sample.tempoBpm !== undefined) {
        if (controller.getTempoMode() === "magic") {
          uiManager.updateBpmGaugeUI(controller, sample.tempoBpm);
        } else if (controller.getState() === "playing") {
          uiManager.updateBpmGaugeUI(controller);
        } else {
          uiManager.updateBpmGaugeUI(controller, sample.tempoBpm);
        }
      }
      if (sample.dynamicContinuous !== undefined) {
        uiManager.updateAnalogueDynamicUI(controller, sample.dynamicContinuous, sample.dynamicLevel);
      }
    }
  },
});

// ── Visualizer & Modals ─────────────────────────────────────────────────────

spotlightScoreVisualizer = new SpotlightScoreVisualizer({
  getMidiScore: () => controller.getMidiScore(),
  getTransport: () => controller.getTransport(),
  getCurrentPiece: () => controller.getCurrentPiece() || getPieceById(controller.getCurrentPieceId()) || REPERTOIRE[0],
});

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

const compactDetailsButton = document.getElementById("compact-details-btn");
compactDetailsButton?.addEventListener("click", () => {
  const stage = document.getElementById("stage");
  if (!stage) return;

  const isOpen = stage.classList.toggle("compact-details-open");
  compactDetailsButton.setAttribute("aria-expanded", String(isOpen));
  compactDetailsButton.textContent = isOpen ? "Less info" : "Help & info";
});

const versionModal = new VersionModal();
versionModal.loadVersionInfo();

const repertoireModal = new RepertoireModal(controller, async (pieceId) => {
  await switchPiece(pieceId);
});

// ── Actions & Mode Toggles ──────────────────────────────────────────────────

async function setInputSource(source: InputSource): Promise<void> {
  try {
    await controller.setInputSource(source);
    uiManager.updateInputSourceButtons(source, controller);
  } catch (err) {
    console.error("Failed to switch input source:", err);
    uiManager.updateInputSourceButtons("keyboard", controller);
  }
}

function setTempoMode(mode: TempoMode): void {
  controller.setTempoMode(mode);
  uiManager.updateModeButtons(mode, controller);
  if (mode === "magic" && controller.getInputSource() === "camera") {
    uiManager.updateInputSourceButtons("camera", controller);
  }
}

async function switchPiece(pieceId: string): Promise<void> {
  clearAllNoteVisuals();
  spotlightScoreVisualizer?.hide();
  if (elements.loadingEl) elements.loadingEl.style.display = "flex";
  try {
    await controller.loadPiece(pieceId);
    const piece = controller.getCurrentPiece();
    elements.titleEl.textContent = piece.title;
    elements.subtitleEl.textContent = `${piece.composer} — ${piece.movement} • ${piece.conductMode || ""}`;
    orchestraStage.renderPiece(piece, clearAllNoteVisuals);
  } catch (err) {
    console.error("Failed to switch piece", err);
  } finally {
    if (elements.loadingEl) elements.loadingEl.style.display = "none";
  }
}

// ── Warm Up Lifecycle ───────────────────────────────────────────────────────

function exitWarmupAndStartConducting(): void {
  if (!elements.stageEl.classList.contains("stage-warming-up")) return;
  demoBpm = undefined;
  demoContinuous = undefined;
  demoDynamicLevel = undefined;
  elements.stageEl.classList.remove("stage-warming-up");
  const piece = controller.getCurrentPiece() || getPieceById(controller.getCurrentPieceId()) || REPERTOIRE[0];
  orchestraStage.renderPiece(piece, clearAllNoteVisuals);
  controller.startConducting();
  uiManager.updateControlHints(controller);
}

function createWarmupManager(): WarmupManager {
  return new WarmupManager({
    onStartConducting: () => {
      exitWarmupAndStartConducting();
    },
    onContinueKeyboard: () => {
      void controller.setInputSource("keyboard");
      uiManager.updateControlHints(controller);
    },
    onRetryCamera: () => {
      void controller.setInputSource("camera");
      uiManager.updateControlHints(controller);
    },
    getCameraAxisMapping: () => controller.getCameraAxisMapping(),
    onTempoDemonstration: (bpm) => {
      demoBpm = bpm;
      uiManager.updateBpmGaugeUI(controller, bpm, bpm);
    },
    onDynamicsDemonstration: (level, continuous) => {
      demoDynamicLevel = level as DynamicLevel;
      demoContinuous = continuous;
      uiManager.updateAnalogueDynamicUI(controller, continuous, level);
      uiManager.updateDynamicLadderUI(level as DynamicLevel, controller);
    },
  });
}

function wireWarmupAudioEvents(): void {
  if (!warmupManager) return;
  const player = warmupManager.getAudioPlayer();
  player.onNotePlay = () => {
    orchestraStage.pulseWarmupViolin();
  };
}

function rerunWarmup(): void {
  if (!elements.cameraHeroSlot) return;
  elements.stageEl.classList.add("stage-warming-up");
  orchestraStage.renderWarmup(clearAllNoteVisuals);
  if (!warmupManager) {
    warmupManager = createWarmupManager();
  }
  const audioCtx = controller.getAudioEngine().getAudioContext() ?? undefined;
  warmupManager.replayWarmup(elements.cameraHeroSlot, audioCtx);
  wireWarmupAudioEvents();
}

controller.getDebugOverlay()?.setOnRerunTutorial(() => {
  rerunWarmup();
});

// ── Event & Shortcut Binding ────────────────────────────────────────────────

uiManager.bindEventListeners({
  controller,
  onSetInputSource: (source) => void setInputSource(source),
  onSetMode: (mode) => setTempoMode(mode),
  onRestart: () => {
    clearAllNoteVisuals();
    controller.restart();
  },
  onOpenRepertoire: () => repertoireModal.open(),
  onRerunWarmup: () => rerunWarmup(),
});

setupKeyboardShortcuts({
  controller,
  isModalOpen: () => versionModal.isOpen() || repertoireModal.isOpen(),
  closeModals: () => {
    versionModal.close();
    repertoireModal.close();
  },
  onToggleInputSource: () => {
    const current = controller.getInputSource();
    void setInputSource(current === "keyboard" ? "camera" : "keyboard");
  },
  onSetTempoMode: (mode) => setTempoMode(mode),
  onToggleScoreVisualizer: () => {
    const next = !controller.isScoreVisualizerActive();
    controller.setScoreVisualizerEnabled(next);
    spotlightScoreVisualizer?.setEnabled(next);
    if (spotlightScoreVisualizer) {
      controller.getDebugOverlay()?.updateScoreVisualizerTelemetry(spotlightScoreVisualizer.getDebugTelemetry());
    }
  },
  onRerunWarmup: () => rerunWarmup(),
  onWarmupSpacebar: () => {
    if (elements.stageEl.classList.contains("stage-warming-up")) {
      const isReady = warmupManager?.getCoordinator().getState().isReady;
      if (isReady) {
        exitWarmupAndStartConducting();
      }
    }
  },
  onUnlockAudio: () => {
    controller.resumeAudio().then(() => {
      const audioCtx = controller.getAudioEngine().getAudioContext();
      if (audioCtx && warmupManager) {
        warmupManager.startWarmupAudio(audioCtx);
      }
    }).catch(() => {});
  },
});

uiManager.updateDynamicLadderUI(controller.getDynamicLevel(), controller);

// ── Bootstrap Application ───────────────────────────────────────────────────

function startGaugeRenderLoop(): void {
  function gaugeRenderLoop(): void {
    if (elements.stageEl.classList.contains("stage-warming-up")) {
      uiManager.updateBpmGaugeUI(controller, demoBpm, demoBpm);
      uiManager.updateAnalogueDynamicUI(controller, demoContinuous, demoDynamicLevel);
      if (demoDynamicLevel) {
        uiManager.updateDynamicLadderUI(demoDynamicLevel, controller);
      }
    } else {
      uiManager.updateBpmGaugeUI(controller);
      uiManager.updateAnalogueDynamicUI(controller);
    }
    requestAnimationFrame(gaugeRenderLoop);
  }
  gaugeRenderLoop();
}

bootstrapConductorApp({
  controller,
  elements,
  uiManager,
  orchestraStage,
  clearAllNoteVisuals,
  startGaugeRenderLoop,
  createWarmupManager,
  wireWarmupAudioEvents,
  onWarmupManagerCreated: (manager) => {
    warmupManager = manager;
  },
}).catch((err) => {
  console.error("Conductor app bootstrap failed:", err);
});
