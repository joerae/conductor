/**
 * appBindings.ts
 *
 * Encapsulates DOM element lookups, HUD rendering, gauge visualizations,
 * and user interaction binding for the Conductor application shell.
 */

import type { ExperienceController, ExperienceState, InputSource } from "../experience/ExperienceController";
import type { TempoMode } from "../clock/ConductorClock";
import type { DynamicLevel } from "../audio/dynamicsTypes";
import type { MagicFingerTelemetry } from "../camera/MagicFingerController";
import type { FocusTelemetry } from "../camera/InstrumentFocusController";
import type { SpotlightScoreVisualizer } from "./SpotlightScoreVisualizer";
import { bpmToPercent } from "./bpmGauge";
import { getPromptText } from "./promptFormatter";
import { getPieceById, REPERTOIRE } from "../score/repertoire";

export interface AppElements {
  promptEl: HTMLElement;
  titleEl: HTMLElement;
  subtitleEl: HTMLElement;
  loadingEl: HTMLElement | null;
  stageEl: HTMLElement;
  beatFlashEl: HTMLElement;
  restartBtn: HTMLButtonElement;
  switchPieceBtn: HTMLButtonElement;
  debugHintEl: HTMLElement | null;
  silhouetteContainer: HTMLElement;
  cameraHeroSlot: HTMLElement | null;
  howToConductBtn: HTMLButtonElement | null;
  inputBtnKeyboard: HTMLButtonElement | null;
  inputBtnCamera: HTMLButtonElement | null;
  inputHintText: HTMLElement | null;
  spaceKeyHint: HTMLElement | null;
  modeBtnE: HTMLButtonElement | null;
  modeBtnD: HTMLButtonElement | null;
  modeBtnMagic: HTMLButtonElement | null;
  modeHintText: HTMLElement | null;
  markerOrchestra: HTMLElement | null;
  markerIndicated: HTMLElement | null;
  valOrchestraBpm: HTMLElement | null;
  valIndicatedBpm: HTMLElement | null;
  greenZone: HTMLElement | null;
  dynamicLadderContainer: HTMLElement | null;
  dynamicVerticalContainer: HTMLElement | null;
  dynamicSteps: NodeListOf<HTMLButtonElement>;
  dynamicCurrentBadge: HTMLElement | null;
  valVerticalDynamic: HTMLElement | null;
  analogueMarker: HTMLElement | null;
  verticalMarker: HTMLElement | null;
}

export function queryAppElements(): AppElements {
  return {
    promptEl: document.getElementById("prompt") as HTMLElement,
    titleEl: document.getElementById("piece-title") as HTMLElement,
    subtitleEl: document.getElementById("piece-subtitle") as HTMLElement,
    loadingEl: document.getElementById("loading-screen"),
    stageEl: document.getElementById("stage") as HTMLElement,
    beatFlashEl: document.getElementById("beat-flash") as HTMLElement,
    restartBtn: document.getElementById("restart-btn") as HTMLButtonElement,
    switchPieceBtn: document.getElementById("repertoire-switch-btn") as HTMLButtonElement,
    debugHintEl: document.getElementById("debug-hint"),
    silhouetteContainer: document.getElementById("orchestra-silhouette") as HTMLElement,
    cameraHeroSlot: document.getElementById("camera-hero-slot"),
    howToConductBtn: document.getElementById("how-to-conduct-btn") as HTMLButtonElement | null,
    inputBtnKeyboard: document.getElementById("input-btn-keyboard") as HTMLButtonElement | null,
    inputBtnCamera: document.getElementById("input-btn-camera") as HTMLButtonElement | null,
    inputHintText: document.getElementById("input-hint-text"),
    spaceKeyHint: document.getElementById("space-key-hint"),
    modeBtnE: document.getElementById("mode-btn-e") as HTMLButtonElement | null,
    modeBtnD: document.getElementById("mode-btn-d") as HTMLButtonElement | null,
    modeBtnMagic: document.getElementById("mode-btn-magic") as HTMLButtonElement | null,
    modeHintText: document.getElementById("mode-hint-text"),
    markerOrchestra: document.getElementById("bpm-marker-orchestra"),
    markerIndicated: document.getElementById("bpm-marker-indicated"),
    valOrchestraBpm: document.getElementById("val-orchestra-bpm"),
    valIndicatedBpm: document.getElementById("val-indicated-bpm"),
    greenZone: document.getElementById("bpm-green-zone"),
    dynamicLadderContainer: document.getElementById("dynamic-ladder-container"),
    dynamicVerticalContainer: document.getElementById("dynamic-vertical-gauge-container"),
    dynamicSteps: document.querySelectorAll<HTMLButtonElement>(".dynamic-step"),
    dynamicCurrentBadge: document.getElementById("dynamic-current-badge"),
    valVerticalDynamic: document.getElementById("val-vertical-dynamic"),
    analogueMarker: document.getElementById("dynamic-analogue-marker"),
    verticalMarker: document.getElementById("dynamic-vertical-analogue-marker"),
  };
}

export class AppUiManager {
  private lastRenderedFocusActive = false;
  private lastRenderedGrabbedSectionId: string | null = null;
  private lastRenderedHoveredSectionId: string | null = null;

  public elements: AppElements;

  constructor(elements: AppElements) {
    this.elements = elements;
  }

  flashBeat(): void {
    this.elements.beatFlashEl.classList.remove("flash");
    void this.elements.beatFlashEl.offsetWidth;
    this.elements.beatFlashEl.classList.add("flash");
  }

  swingBaton(): void {
    const baton = document.getElementById("baton-line");
    if (baton) {
      baton.classList.remove("swing");
      void baton.offsetWidth;
      baton.classList.add("swing");
    }
  }

  flashAccent(): void {
    this.elements.stageEl.classList.remove("accent-flash");
    void this.elements.stageEl.offsetWidth;
    this.elements.stageEl.classList.add("accent-flash");
    setTimeout(() => this.elements.stageEl.classList.remove("accent-flash"), 380);
  }

  setAccentArmed(armed: boolean): void {
    this.elements.dynamicLadderContainer?.classList.toggle("accent-armed", armed);
  }

  updateControlHints(controller: ExperienceController): void {
    const source = controller.getInputSource();
    const mode = controller.getTempoMode();
    const mapping = controller.getCameraAxisMapping();

    if (this.elements.inputHintText) {
      this.elements.inputHintText.innerHTML =
        source === "camera" ? `Press <strong>C</strong> for Keyboard` : `Press <strong>C</strong> for Camera`;
    }

    if (this.elements.modeHintText) {
      if (source === "camera") {
        if (mode === "gestural") {
          if (mapping === "flipped") {
            this.elements.modeHintText.innerHTML = `🪄 <strong>Expressive (Camera)</strong>: Width ↔ modulates Tempo • Height ↕ modulates Volume • Drop hands to stop`;
          } else {
            this.elements.modeHintText.innerHTML = `🪄 <strong>Expressive (Camera)</strong>: Height ↕ modulates Tempo • Width ↔ modulates Volume • Drop hands to stop`;
          }
        } else if (mode === "inertial") {
          this.elements.modeHintText.innerHTML = `🥁 <strong>Beat (Camera Cut Time)</strong>: Conduct strokes in 2 (1 stroke = 2 beats) • Steer tempo with hands • Coast freely`;
        } else if (mode === "magic") {
          this.elements.modeHintText.innerHTML = `👆 <strong>Magic Finger</strong>: Aim laser pointer at Tempo Gauge, Dynamics Ribbon, or Orchestra Sections`;
        } else if (mode === "autoplay") {
          this.elements.modeHintText.innerHTML = `⚡ <strong>Autoplay (Debug)</strong>: Playing continuously in tempo`;
        } else {
          this.elements.modeHintText.innerHTML = `⚙️ <strong>${String(mode).toUpperCase()} (Debug)</strong>: Move hands to conduct`;
        }
      } else {
        // Keyboard mode
        if (mode === "gestural") {
          this.elements.modeHintText.innerHTML = `🪄 <strong>Expressive (Keyboard)</strong>: <strong>↑ / ↓</strong> adjust Target Tempo • <strong>← / →</strong> adjust Volume • <strong>\\</strong> Accent (&gt;) • <strong>SPACE / P</strong> Play/Pause`;
        } else if (mode === "inertial" || mode === "balanced" || mode === "instant") {
          this.elements.modeHintText.innerHTML = `🥁 <strong>Beat (Keyboard)</strong>: Tap <strong>SPACE</strong> on every beat (1 tap = 1 beat) • <strong>← / →</strong> adjust Volume`;
        } else if (mode === "magic") {
          this.elements.modeHintText.innerHTML = `👆 <strong>Magic Finger</strong>: Switch to camera to use laser pointer control`;
        } else if (mode === "autoplay") {
          this.elements.modeHintText.innerHTML = `⚡ <strong>Autoplay (Debug)</strong>: Playing continuously in tempo`;
        } else {
          this.elements.modeHintText.innerHTML = `⚙️ <strong>${String(mode).toUpperCase()} (Debug)</strong>: Tap SPACE to conduct`;
        }
      }
    }

    const pausedBeat = controller.getPausedBeat();
    this.elements.promptEl.textContent = getPromptText(controller.getState(), pausedBeat, source, mode);
  }

  updateInputSourceButtons(source: InputSource, controller: ExperienceController): void {
    this.elements.inputBtnKeyboard?.classList.toggle("active", source === "keyboard");
    this.elements.inputBtnCamera?.classList.toggle("active", source === "camera");
    this.elements.stageEl.classList.toggle("camera-mode-active", source === "camera");
    document.body.classList.toggle("camera-mode-active", source === "camera");

    if (this.elements.spaceKeyHint) {
      if (source === "camera") {
        this.elements.spaceKeyHint.innerHTML = `<span class="key" style="border-color:#5cd87e; color:#5cd87e; background:rgba(52,199,89,0.08); box-shadow:0 0 12px rgba(52,199,89,0.2);">📷 MOTION ACTIVE • RAISE HANDS TO CONDUCT</span>`;
      } else {
        this.elements.spaceKeyHint.innerHTML = `<span class="key">SPACE</span>`;
      }
    }

    this.updateControlHints(controller);
  }

  updateModeButtons(mode: TempoMode, controller: ExperienceController): void {
    this.elements.modeBtnE?.classList.toggle("active", mode === "gestural");
    this.elements.modeBtnD?.classList.toggle("active", mode === "inertial");
    this.elements.modeBtnMagic?.classList.toggle("active", mode === "magic");
    this.elements.stageEl.classList.toggle("magic-mode-active", mode === "magic");
    this.updateControlHints(controller);
  }

  updateBpmGaugeUI(controller: ExperienceController, overrideIndicatedBpm?: number, overrideOrchestraBpm?: number): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clockState = (controller as any).clock?.getState?.();
    const orchestraBpm = overrideOrchestraBpm ?? (clockState?.bpm || 0);
    const indicatedBpm =
      overrideIndicatedBpm ??
      (controller.getIndicatedBpm() || orchestraBpm || controller.getNominalPieceBpm?.() || 0);

    if (orchestraBpm > 0) {
      if (this.elements.valOrchestraBpm) this.elements.valOrchestraBpm.textContent = `${orchestraBpm.toFixed(0)}`;
      if (this.elements.markerOrchestra) this.elements.markerOrchestra.style.bottom = `${bpmToPercent(orchestraBpm)}%`;
    } else {
      if (this.elements.valOrchestraBpm) this.elements.valOrchestraBpm.textContent = `—`;
    }

    const clampedIndicated = indicatedBpm > 0 ? Math.max(40, Math.min(220, indicatedBpm)) : 0;
    if (clampedIndicated > 0) {
      if (this.elements.valIndicatedBpm) this.elements.valIndicatedBpm.textContent = `${clampedIndicated.toFixed(0)}`;
      if (this.elements.markerIndicated) this.elements.markerIndicated.style.bottom = `${bpmToPercent(clampedIndicated)}%`;
    } else {
      if (this.elements.valIndicatedBpm) this.elements.valIndicatedBpm.textContent = `—`;
    }

    if (this.elements.greenZone) {
      const nominalBpm = controller.getNominalPieceBpm?.() || controller.getBasePieceBpm?.() || 0;
      if (nominalBpm > 0) {
        const loPercent = bpmToPercent(nominalBpm - 20);
        const hiPercent = bpmToPercent(nominalBpm + 20);
        this.elements.greenZone.style.bottom = `${loPercent}%`;
        this.elements.greenZone.style.height = `${hiPercent - loPercent}%`;
        this.elements.greenZone.style.display = "block";
      } else {
        this.elements.greenZone.style.display = "none";
      }
    }
  }

  updateDynamicLadderUI(level: DynamicLevel, controller: ExperienceController): void {
    this.elements.dynamicSteps.forEach(btn => {
      const isMatch = btn.dataset.dynamic === level;
      btn.classList.toggle("active", isMatch);
    });

    if (level === "fff") {
      this.elements.dynamicLadderContainer?.classList.add("overburn");
      this.elements.dynamicVerticalContainer?.classList.add("overburn");
    } else {
      this.elements.dynamicLadderContainer?.classList.remove("overburn");
      this.elements.dynamicVerticalContainer?.classList.remove("overburn");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const continuousVal = (controller as any).audioEngine?.getContinuousDynamic?.() ?? 0.5;
    const pct = Math.round(continuousVal * 100);
    const badgeText = `${level.toUpperCase()} (${pct}%)`;

    if (this.elements.dynamicCurrentBadge) {
      this.elements.dynamicCurrentBadge.textContent = badgeText;
    }
    if (this.elements.valVerticalDynamic) {
      this.elements.valVerticalDynamic.textContent = badgeText;
    }

    const allLevels: DynamicLevel[] = ["pp", "p", "mp", "mf", "f", "ff", "fff"];
    allLevels.forEach(d => this.elements.stageEl.classList.remove(`dynamic-${d}`));
    this.elements.stageEl.classList.add(`dynamic-${level}`);
  }

  updateAnalogueDynamicUI(controller: ExperienceController, overrideContinuous?: number, overrideLevel?: string): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const continuousVal = overrideContinuous ?? (controller as any).audioEngine?.getContinuousDynamic?.() ?? 0.5;

    if (this.elements.analogueMarker) {
      const pct = Math.max(4, Math.min(96, continuousVal * 92 + 4));
      this.elements.analogueMarker.style.left = `${pct}%`;
    }

    if (this.elements.verticalMarker) {
      const pct = Math.max(0, Math.min(100, continuousVal * 100));
      this.elements.verticalMarker.style.bottom = `${pct}%`;
    }

    const level = overrideLevel ?? controller.getDynamicLevel();
    const pct = Math.round(continuousVal * 100);
    const badgeText = `${level.toUpperCase()} (${pct}%)`;

    if (this.elements.dynamicCurrentBadge) {
      this.elements.dynamicCurrentBadge.textContent = badgeText;
    }
    if (this.elements.valVerticalDynamic) {
      this.elements.valVerticalDynamic.textContent = badgeText;
    }
  }

  handleStateChange(state: ExperienceState, controller: ExperienceController, onClearVisuals: () => void): void {
    const pausedBeat = controller.getPausedBeat();
    this.elements.promptEl.textContent = getPromptText(
      state,
      pausedBeat,
      controller.getInputSource(),
      controller.getTempoMode()
    );

    const showControls = state !== "loading";
    this.elements.restartBtn.style.display = showControls ? "inline-flex" : "none";
    this.elements.switchPieceBtn.style.display = showControls ? "inline-flex" : "none";

    if (state === "completed") {
      this.elements.restartBtn.innerHTML = "↺ Conduct Again";
    } else {
      this.elements.restartBtn.innerHTML = "↺ Restart from Top";
    }

    if (this.elements.debugHintEl) {
      this.elements.debugHintEl.style.display = "inline";
    }
    this.elements.stageEl.dataset.state = state;

    if (state !== "playing") {
      onClearVisuals();
    }
  }

  handleCutoffChange(isCutoff: boolean, controller: ExperienceController): void {
    const banner = document.getElementById("gesture-banner");
    const icon = document.getElementById("gesture-banner-icon");
    const text = document.getElementById("gesture-banner-text");
    if (banner && icon && text) {
      if (isCutoff) {
        banner.className = "gesture-banner cutoff";
        icon.textContent = "👎";
        text.textContent = "DRAMATIC CUTOFF • Release thumb to resume";
        banner.style.display = "flex";
        this.elements.promptEl.textContent = "👎 Dramatic Cutoff! Release thumbs-down to resume playback.";
      } else {
        banner.style.display = "none";
        this.elements.promptEl.textContent = getPromptText(
          controller.getState(),
          controller.getPausedBeat(),
          controller.getInputSource(),
          controller.getTempoMode()
        );
      }
    }
  }

  handleFermataChange(isFermata: boolean, controller: ExperienceController): void {
    const banner = document.getElementById("gesture-banner");
    const icon = document.getElementById("gesture-banner-icon");
    const text = document.getElementById("gesture-banner-text");
    if (banner && icon && text) {
      if (isFermata) {
        banner.className = "gesture-banner fermata";
        icon.textContent = "👍";
        text.textContent = "FERMATA • Holding note";
        banner.style.display = "flex";
        this.elements.promptEl.textContent = "👍 Fermata active — sustaining note! Release thumb to continue.";
      } else {
        banner.style.display = "none";
        this.elements.promptEl.textContent = getPromptText(
          controller.getState(),
          controller.getPausedBeat(),
          controller.getInputSource(),
          controller.getTempoMode()
        );
      }
    }
  }

  handleLoveModeChange(isLove: boolean, controller: ExperienceController): void {
    const loveBanner = document.getElementById("love-banner");
    if (isLove) {
      this.elements.stageEl.classList.add("love-mode-active");
      if (loveBanner) loveBanner.style.display = "flex";
      this.elements.promptEl.textContent = "🤟 Love Mode! Intimate Pianissimo (pp) with lush concert hall reverb!";
    } else {
      this.elements.stageEl.classList.remove("love-mode-active");
      if (loveBanner) loveBanner.style.display = "none";
      this.elements.promptEl.textContent = getPromptText(
        controller.getState(),
        controller.getPausedBeat(),
        controller.getInputSource(),
        controller.getTempoMode()
      );
    }
  }

  handlePartyModeChange(isParty: boolean, controller: ExperienceController): void {
    const partyBanner = document.getElementById("party-banner");
    if (isParty) {
      this.elements.stageEl.classList.add("party-mode-active");
      if (partyBanner) partyBanner.style.display = "flex";
      this.elements.promptEl.textContent = "✌️✌️ Party Mode!";
    } else {
      this.elements.stageEl.classList.remove("party-mode-active");
      if (partyBanner) partyBanner.style.display = "none";
      this.elements.promptEl.textContent = getPromptText(
        controller.getState(),
        controller.getPausedBeat(),
        controller.getInputSource(),
        controller.getTempoMode()
      );
    }
  }

  handleFocusChange(
    telemetry: FocusTelemetry,
    controller: ExperienceController,
    spotlightScoreVisualizer: SpotlightScoreVisualizer | null
  ): void {
    if (
      telemetry.isActive === this.lastRenderedFocusActive &&
      telemetry.grabbedSectionId === this.lastRenderedGrabbedSectionId &&
      telemetry.hoveredSectionId === this.lastRenderedHoveredSectionId
    ) {
      return;
    }

    this.lastRenderedFocusActive = telemetry.isActive;
    this.lastRenderedGrabbedSectionId = telemetry.grabbedSectionId;
    this.lastRenderedHoveredSectionId = telemetry.hoveredSectionId;

    const currentPiece = getPieceById(controller.getCurrentPieceId()) || REPERTOIRE[0];

    if (telemetry.isActive) {
      this.elements.stageEl.classList.add("focus-mode-active");

      if (telemetry.grabbedSectionId) {
        this.elements.stageEl.classList.add("has-grabbed-section");
      } else {
        this.elements.stageEl.classList.remove("has-grabbed-section");
      }

      document.querySelectorAll(".instrument-section").forEach(el => {
        el.classList.remove("focus-hover", "focus-grabbed");
      });

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

      currentPiece?.sections.forEach(sec => {
        if (sec.id !== telemetry.grabbedSectionId) {
          const el = document.getElementById(`section-${sec.id}`);
          const labelEl = el?.querySelector(".section-label");
          if (labelEl) labelEl.textContent = sec.name;
        }
      });

      if (telemetry.grabbedSectionId) {
        const sec = currentPiece?.sections.find(s => s.id === telemetry.grabbedSectionId);
        this.elements.promptEl.textContent = `✨ ${sec?.name} (Forte / Center Stage) • Point at another section or lower hand to restore ensemble balance`;
      } else {
        this.elements.promptEl.textContent = "🪄 Point your index finger at any section to bring it forward in the mix";
      }
    } else {
      spotlightScoreVisualizer?.hide();
      this.elements.stageEl.classList.remove("focus-mode-active", "has-grabbed-section");
      document.querySelectorAll(".instrument-section").forEach(el => {
        el.classList.remove("focus-hover", "focus-grabbed");
      });
      currentPiece?.sections.forEach(sec => {
        const el = document.getElementById(`section-${sec.id}`);
        const labelEl = el?.querySelector(".section-label");
        if (labelEl) labelEl.textContent = sec.name;
      });
      this.elements.promptEl.textContent = getPromptText(
        controller.getState(),
        controller.getPausedBeat(),
        controller.getInputSource(),
        controller.getTempoMode()
      );
    }

    if (spotlightScoreVisualizer) {
      controller.getDebugOverlay()?.updateScoreVisualizerTelemetry(spotlightScoreVisualizer.getDebugTelemetry());
    }
  }

  handleMagicFinger(telemetry: MagicFingerTelemetry, controller: ExperienceController): void {
    const targetType = telemetry.activeTarget || telemetry.hoverTarget || "open";
    const isAcquired = telemetry.ray?.isAcquired ?? false;

    const bpmGaugeEl = document.getElementById("bpm-gauge-container");
    if (bpmGaugeEl) {
      bpmGaugeEl.classList.toggle("magic-hover", targetType === "tempo" && !isAcquired);
      bpmGaugeEl.classList.toggle("magic-acquired", targetType === "tempo" && isAcquired);
    }

    const dynRibbonEl = document.getElementById("dynamic-ladder-container");
    const dynVerticalEl = document.getElementById("dynamic-vertical-gauge-container");
    const isDynTarget = targetType === "dynamics";
    if (dynRibbonEl) {
      dynRibbonEl.classList.toggle("magic-hover", isDynTarget && !isAcquired);
      dynRibbonEl.classList.toggle("magic-acquired", isDynTarget && isAcquired);
    }
    if (dynVerticalEl) {
      dynVerticalEl.classList.toggle("magic-hover", isDynTarget && !isAcquired);
      dynVerticalEl.classList.toggle("magic-acquired", isDynTarget && isAcquired);
    }

    if (telemetry.lockInEvent) {
      const targetEl =
        telemetry.lockInEvent.target === "tempo"
          ? document.querySelector(".bpm-needle.indicated-needle .needle-pip") || bpmGaugeEl
          : document.querySelector("#dynamic-analogue-marker .analogue-pip") || dynVerticalEl || dynRibbonEl;
      if (targetEl) {
        targetEl.classList.remove("sparkle-locked");
        void (targetEl as HTMLElement).offsetWidth;
        targetEl.classList.add("sparkle-locked");
        setTimeout(() => targetEl.classList.remove("sparkle-locked"), 850);
      }
    }

    if (controller.getTempoMode() === "magic") {
      if (telemetry.isLockedIn) {
        this.elements.promptEl.textContent = `✨ Locked In • Point away to continue or retract finger`;
      } else if (telemetry.chargeProgress && telemetry.chargeProgress > 0) {
        const pct = Math.round(telemetry.chargeProgress * 100);
        this.elements.promptEl.textContent = `⚡ Locking in (${pct}%) • Hold steady...`;
      } else if (isAcquired) {
        if (targetType === "tempo") {
          this.elements.promptEl.textContent = `👆 Adjusting Tempo (${telemetry.liveBpm ?? controller.getIndicatedBpm()} BPM) • Hold steady to lock • Point away to continue`;
        } else if (targetType === "dynamics") {
          const pct = Math.round((telemetry.liveDynamic ?? 0.5) * 100);
          this.elements.promptEl.textContent = `👆 Adjusting Dynamics (${pct}%) • Hold steady to lock • Point away to continue`;
        } else if (telemetry.targetedSectionId) {
          const piece =
            controller.getCurrentPiece() || getPieceById(controller.getCurrentPieceId()) || REPERTOIRE[0];
          const sec = piece?.sections?.find(s => s.id === telemetry.targetedSectionId);
          this.elements.promptEl.textContent = `✨ Spotlight: ${sec?.name || "Section"} (Forte / Center Stage) • Point away to restore ensemble balance`;
        }
      } else if (targetType !== "open") {
        this.elements.promptEl.textContent = `👆 Hovering over ${targetType === "tempo" ? "Tempo Gauge" : targetType === "dynamics" ? "Dynamics Gauge" : "Orchestra"} • Hold steady to grab`;
      } else {
        this.elements.promptEl.textContent = `👆 Magic Finger Active • Aim laser at Tempo Gauge, Dynamics Gauge, or Orchestra Sections`;
      }
    }
  }

  bindEventListeners(options: {
    onSetInputSource: (source: InputSource) => void;
    onSetMode: (mode: TempoMode) => void;
    onRestart: () => void;
    onOpenRepertoire: () => void;
    onRerunWarmup: () => void;
    controller: ExperienceController;
  }): void {
    const { onSetInputSource, onSetMode, onRestart, onOpenRepertoire, onRerunWarmup, controller } = options;

    this.elements.inputBtnKeyboard?.addEventListener("click", () => onSetInputSource("keyboard"));
    this.elements.inputBtnCamera?.addEventListener("click", () => onSetInputSource("camera"));

    this.elements.modeBtnE?.addEventListener("click", () => onSetMode("gestural"));
    this.elements.modeBtnD?.addEventListener("click", () => onSetMode("inertial"));
    this.elements.modeBtnMagic?.addEventListener("click", () => onSetMode("magic"));

    this.elements.restartBtn.addEventListener("click", onRestart);
    this.elements.switchPieceBtn.addEventListener("click", onOpenRepertoire);
    this.elements.howToConductBtn?.addEventListener("click", onRerunWarmup);

    this.elements.dynamicSteps.forEach(btn => {
      btn.addEventListener("click", () => {
        const dyn = btn.dataset.dynamic as DynamicLevel;
        if (dyn) {
          if (controller.getDynamicLevel() === dyn) {
            controller.armAccent();
          } else {
            controller.setDynamicLevel(dyn);
          }
        }
      });
    });
  }
}
