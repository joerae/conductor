/**
 * appBootstrap.ts
 *
 * Bootstraps the Conductor application on page load:
 * handles catalog loading, initial piece rendering, onboarding warmup vs returning user fast-path,
 * and loading progress reporting.
 */

import type { ExperienceController } from "./ExperienceController";
import type { AppElements, AppUiManager } from "../ui/appBindings";
import type { OrchestraStage } from "../ui/orchestraStage";
import type { WarmupManager } from "../warmup/WarmupManager";
import { loadRepertoireCatalog } from "../score/repertoire";
import { initBpmGaugeTicks } from "../ui/bpmGauge";
import { LoadingCoordinator } from "../warmup/LoadingCoordinator";

export interface AppBootstrapOptions {
  controller: ExperienceController;
  elements: AppElements;
  uiManager: AppUiManager;
  orchestraStage: OrchestraStage;
  clearAllNoteVisuals: () => void;
  startGaugeRenderLoop: () => void;
  createWarmupManager: () => WarmupManager;
  wireWarmupAudioEvents: () => void;
  onWarmupManagerCreated: (manager: WarmupManager) => void;
}

export async function bootstrapConductorApp(options: AppBootstrapOptions): Promise<void> {
  const {
    controller,
    elements,
    uiManager,
    orchestraStage,
    clearAllNoteVisuals,
    startGaugeRenderLoop,
    createWarmupManager,
    wireWarmupAudioEvents,
    onWarmupManagerCreated,
  } = options;

  await loadRepertoireCatalog();

  const initialPiece = controller.getCurrentPiece();
  elements.titleEl.textContent = initialPiece.title;
  elements.subtitleEl.textContent = `${initialPiece.composer} — ${initialPiece.movement} • ${initialPiece.conductMode || ""}`;

  const isWarmupEnabled = controller.isWarmupEnabled();
  const isReturningUser =
    typeof localStorage !== "undefined" && localStorage.getItem("conductor:onboarding-version") === "1";

  if (!isWarmupEnabled) {
    orchestraStage.renderPiece(initialPiece, clearAllNoteVisuals);
    elements.stageEl.style.display = "flex";
    elements.stageEl.classList.remove("stage-warming-up");
    if (elements.loadingEl) elements.loadingEl.style.display = "none";

    uiManager.updateInputSourceButtons(controller.getInputSource(), controller);
    uiManager.updateModeButtons(controller.getTempoMode(), controller);
    initBpmGaugeTicks();
    startGaugeRenderLoop();

    if (elements.cameraHeroSlot) {
      const coordinator = new LoadingCoordinator();
      const card = document.createElement("div");
      card.className = "initial-loading-card";
      card.innerHTML = `
        <div class="initial-loading-title">Loading Orchestra Assets</div>
        <div class="initial-loading-track">
          <div class="initial-loading-fill" style="width: 0%"></div>
        </div>
        <div class="initial-loading-meta">
          <span class="initial-loading-status">Preparing audio & score...</span>
          <span class="initial-loading-pct">0%</span>
        </div>
      `;
      elements.cameraHeroSlot.appendChild(card);
      const fillEl = card.querySelector<HTMLElement>(".initial-loading-fill");
      const statusEl = card.querySelector<HTMLElement>(".initial-loading-status");
      const pctEl = card.querySelector<HTMLElement>(".initial-loading-pct");

      coordinator.onStateChange((state) => {
        const pct = Math.min(100, Math.max(0, Math.round(state.progress)));
        if (fillEl) fillEl.style.width = `${pct}%`;
        if (statusEl && state.statusMessage) statusEl.textContent = state.statusMessage;
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (state.isReady) {
          card.classList.add("fade-out");
          setTimeout(() => card.remove(), 400);
        }
      });

      controller.loadWithCoordinator(coordinator).catch((err) => {
        console.error("Conductor loadWithCoordinator error:", err);
      });
    } else {
      controller.load().catch((err) => {
        console.error("Conductor fallback load error:", err);
      });
    }
  } else if (isReturningUser) {
    orchestraStage.renderPiece(initialPiece, clearAllNoteVisuals);
    elements.stageEl.style.display = "flex";
    elements.stageEl.classList.remove("stage-warming-up");
    if (elements.loadingEl) elements.loadingEl.style.display = "none";

    uiManager.updateInputSourceButtons(controller.getInputSource(), controller);
    uiManager.updateModeButtons(controller.getTempoMode(), controller);
    initBpmGaugeTicks();
    startGaugeRenderLoop();

    controller.load().catch((err) => {
      console.error("Conductor load error:", err);
    });
  } else {
    orchestraStage.renderWarmup(clearAllNoteVisuals);
    elements.stageEl.style.display = "flex";
    elements.stageEl.classList.add("stage-warming-up");
    if (elements.loadingEl) elements.loadingEl.style.display = "none";

    uiManager.updateInputSourceButtons(controller.getInputSource(), controller);
    uiManager.updateModeButtons(controller.getTempoMode(), controller);
    initBpmGaugeTicks();
    startGaugeRenderLoop();

    if (elements.cameraHeroSlot) {
      const warmupManager = createWarmupManager();
      onWarmupManagerCreated(warmupManager);
      const audioCtx = controller.getAudioEngine().getAudioContext() ?? undefined;
      warmupManager.mount(elements.cameraHeroSlot, audioCtx);
      wireWarmupAudioEvents();

      controller.loadWithCoordinator(warmupManager.getCoordinator()).catch((err) => {
        console.error("Conductor loadWithCoordinator error:", err);
      });
    } else {
      orchestraStage.renderPiece(initialPiece, clearAllNoteVisuals);
      elements.stageEl.classList.remove("stage-warming-up");
      controller.load().catch((err) => {
        console.error("Conductor fallback load error:", err);
      });
    }
  }
}
