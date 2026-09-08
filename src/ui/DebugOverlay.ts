/**
 * DebugOverlay.ts
 *
 * Real-time diagnostic overlay for the Conductor experience.
 * Shows the internal state of ConductorClock, ScoreTransport, Scheduler,
 * and the Hybrid Dynamic Modeling DSP Engine.
 *
 * Toggle visibility with the D key (hidden by default).
 */

import type { ClockState, TapRejectionReason } from "../clock/clockTypes";
import type { TempoMode } from "../clock/ConductorClock";
import type { DynamicsTelemetry, DSPBypassFlags, VelocityDecomposition } from "../audio/dynamicsTypes";
import type { CameraTelemetry } from "../camera/cameraTypes";
import { FeatureFlagPanel } from "./debug/FeatureFlagPanel";
import { TelemetryGraph } from "./debug/TelemetryGraph";
import type { DebugSnapshot, ScoreVisualizerDebugTelemetry } from "./debug/TelemetryGraph";

export class DebugOverlay {
  private container: HTMLElement;
  private visible: boolean = false;
  private featureFlagPanel: FeatureFlagPanel = new FeatureFlagPanel();
  private telemetryGraph: TelemetryGraph = new TelemetryGraph();

  // Cached DOM elements for live text updates without innerHTML thrashing
  private elements: Record<string, HTMLElement> = {};

  private snapshot: DebugSnapshot = {
    tempoMode: "E (Gesture / Accelerando 🪄)",
    bpm: 0,
    periodMs: 500,
    nextBeatAudioTime: 0,
    phaseErrorMs: 0,
    confidence: 0,
    acceptedBeatCount: 0,
    lastTapStatus: "—",
    scoreBeat: 0,
    schedulerHorizon: 0,
    schedulerCommitted: 0,
    audioLatencyMs: 0,
    audioOutputLatencyMs: 0,
    isPaused: false,
    tempoDeadband: 0.04,
    lastJitterMs: 0,
    lastJitterPercent: 0,
    averageJitterMs: 0,
    averageJitterPercent: 0,
    jitterStatus: "calibrating",
    activeVoicesCount: 0,
    pendingCleanupCount: 0,
    channelBusCount: 0,
    fontEnvelopesCount: 0,
    automationRequestsPerSec: 0,
    schedTickMs: 0,
    schedEventsExamined: 0,
    schedLateEvents: 0,
    dynamics: {
      level: "mf",
      velocityMultiplier: 1.0,
      filterCutoffHz: 14000,
      highShelfGainDb: 0.0,
      reverbWet: 0.18,
      attackTimeSec: 0.008,
      macroRatio: 0.45,
      bypassFlags: {
        velocityScaling: true,
        timbreFilter: true,
        reverbScaling: true,
        attackEnvelope: true,
        safetyLimiter: true,
        scoreCompression: true,
      },
    },
  };

  constructor(
    onDSPToggle?: (flag: keyof DSPBypassFlags, enabled: boolean) => void,
    onTogglePause?: () => void,
    onMacroRatioChange?: (ratio: number) => void,
    onCameraDynamicsModeChange?: (mode: "spread" | "height") => void,
    onBeatSoundToggle?: (enabled: boolean) => void,
    onTempoDeadbandChange?: (ratio: number) => void,
    onTempoModeChange?: (mode: "balanced" | "instant" | "autoplay" | "inertial" | "gestural") => void,
    onAutoplayInTempo?: () => void,
    onThumbsUpVFXToggle?: (enabled: boolean) => void,
    onFocusModeToggle?: (enabled: boolean) => void,
    onScoreVisualizerToggle?: (enabled: boolean) => void
  ) {
    this.container = this.createContainer();
    document.body.appendChild(this.container);

    // Cache elements for live text updates
    this.elements = this.telemetryGraph.cacheElements(this.container);

    // Bind controls and callbacks
    this.featureFlagPanel.bindControls(this.container, {
      onDSPToggle,
      onTogglePause,
      onMacroRatioChange: (ratio) => {
        this.snapshot.dynamics.macroRatio = ratio;
        onMacroRatioChange?.(ratio);
      },
      onCameraDynamicsModeChange,
      onBeatSoundToggle,
      onTempoDeadbandChange: (ratio) => {
        this.snapshot.tempoDeadband = ratio;
        onTempoDeadbandChange?.(ratio);
      },
      onTempoModeChange,
      onAutoplayInTempo,
      onThumbsUpVFXToggle,
      onFocusModeToggle,
      onScoreVisualizerToggle,
    });

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyD" && !e.repeat) {
        this.toggle();
      }
    });

    // Start efficient RAF loop that only mutates text
    this.renderLoop();
  }

  // ── Update methods (called by ExperienceController) ─────────────────────

  updateTempoMode(mode: TempoMode): void {
    this.snapshot.tempoMode =
      mode === "balanced"
        ? "A (Balanced PLL)"
        : mode === "instant"
          ? "B (Instant / Dime)"
          : mode === "autoplay"
            ? "C (Autoplay ⚡)"
            : mode === "inertial"
              ? "Beat (Cut Time 🥁)"
              : mode === "magic"
                ? "Magic Finger (Laser 👆)"
                : "Expressive (Gesture 🪄)";

    this.featureFlagPanel.updateTempoMode(mode);
  }

  updateClock(state: ClockState): void {
    this.snapshot.bpm = state.bpm;
    this.snapshot.periodMs = state.periodMs;
    this.snapshot.nextBeatAudioTime = state.nextBeatAudioTime;
    this.snapshot.phaseErrorMs = state.phaseErrorMs;
    this.snapshot.confidence = state.confidence;
    this.snapshot.acceptedBeatCount = state.acceptedBeatCount;
    if (state.tempoDeadband !== undefined) this.snapshot.tempoDeadband = state.tempoDeadband;
    if (state.lastJitterMs !== undefined) this.snapshot.lastJitterMs = state.lastJitterMs;
    if (state.lastJitterPercent !== undefined) this.snapshot.lastJitterPercent = state.lastJitterPercent;
    if (state.averageJitterMs !== undefined) this.snapshot.averageJitterMs = state.averageJitterMs;
    if (state.averageJitterPercent !== undefined) this.snapshot.averageJitterPercent = state.averageJitterPercent;
    if (state.jitterStatus !== undefined) this.snapshot.jitterStatus = state.jitterStatus;
  }

  updateTapAccepted(): void {
    this.snapshot.lastTapStatus = "✓ ACCEPTED";
  }

  updateTapRejected(reason: TapRejectionReason): void {
    const labels: Record<TapRejectionReason, string> = {
      double_tap: "✗ REJECTED (double tap)",
      out_of_range: "✗ REJECTED (out of range)",
      not_started: "✗ REJECTED (not started)",
    };
    this.snapshot.lastTapStatus = labels[reason];
  }

  updateScore(beat: number): void {
    this.snapshot.scoreBeat = beat;
  }

  updateScheduler(horizon: number, committed: number): void {
    this.snapshot.schedulerHorizon = horizon;
    this.snapshot.schedulerCommitted = committed;
  }

  updateAudioLatency(baseLatency: number, outputLatency: number): void {
    this.snapshot.audioLatencyMs = baseLatency * 1000;
    this.snapshot.audioOutputLatencyMs = outputLatency * 1000;
  }

  updateAudioDiagnostics(
    diag: import("../audio/AudioEngine").AudioDiagnostics,
    schedDiag?: import("../scheduler/Scheduler").SchedulerDiagnostics
  ): void {
    this.snapshot.activeVoicesCount = diag.activeVoicesCount;
    this.snapshot.pendingCleanupCount = diag.pendingCleanupCount;
    this.snapshot.channelBusCount = diag.channelBusCount;
    this.snapshot.fontEnvelopesCount = diag.fontEnvelopesCount;
    this.snapshot.automationRequestsPerSec = diag.automationRequestsPerSec;
    if (schedDiag) {
      this.snapshot.schedTickMs = schedDiag.lastTickDurationMs;
      this.snapshot.schedEventsExamined = schedDiag.eventsExaminedLastTick;
      this.snapshot.schedLateEvents = schedDiag.lateEventCount;
    }
  }

  updateDynamics(dynamics: DynamicsTelemetry): void {
    this.snapshot.dynamics = dynamics;
    this.featureFlagPanel.updateDynamics(dynamics);
  }

  updateCameraTelemetry(telemetry: CameraTelemetry): void {
    this.telemetryGraph.updateCameraTelemetry(telemetry, this.elements);
  }

  updatePauseState(isPaused: boolean): void {
    this.snapshot.isPaused = isPaused;
  }

  updateLastNoteDecomp(decomp: VelocityDecomposition, trackId: string): void {
    this.snapshot.lastDecomp = decomp;
    this.snapshot.lastDecompTrack = trackId;
  }

  isVisible(): boolean {
    return this.visible;
  }

  setScoreVisualizerCheckbox(enabled: boolean): void {
    this.featureFlagPanel.setScoreVisualizerCheckbox(enabled);
  }

  updateScoreVisualizerTelemetry(telemetry: ScoreVisualizerDebugTelemetry): void {
    this.telemetryGraph.updateScoreVisualizerTelemetry(telemetry, this.elements);
  }

  setOnRerunTutorial(callback: () => void): void {
    this.featureFlagPanel.setOnRerunTutorial(callback);
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private toggle(): void {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? "block" : "none";
    document.body.classList.toggle("debug-mode-active", this.visible);
  }

  private renderLoop(): void {
    if (this.visible) this.render();
    requestAnimationFrame(() => this.renderLoop());
  }

  private render(): void {
    this.featureFlagPanel.updatePauseButton(this.snapshot.isPaused);
    this.featureFlagPanel.updateDeadbandLabel(this.snapshot.tempoDeadband, this.snapshot.periodMs);
    this.telemetryGraph.render(this.snapshot, this.elements);
  }

  private createContainer(): HTMLElement {
    const el = document.createElement("div");
    el.id = "debug-overlay";
    el.style.cssText = `
      display: none;
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 9999;
      background: rgba(10, 14, 22, 0.96);
      color: #a0f0a0;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 11.5px;
      padding: 14px 18px;
      border-radius: 10px;
      border: 1px solid rgba(255, 213, 107, 0.35);
      width: 390px;
      min-width: 390px;
      max-width: 390px;
      box-sizing: border-box;
      backdrop-filter: blur(12px);
      box-shadow: 0 12px 36px rgba(0,0,0,0.75);
      max-height: 92vh;
      overflow-y: auto;
      overflow-x: hidden;
    `;

    el.innerHTML = `
      ${this.featureFlagPanel.renderHeaderHtml()}
      ${this.featureFlagPanel.renderModesHtml()}
      ${this.telemetryGraph.renderJitterTelemetryHtml()}
      ${this.featureFlagPanel.renderJitterDeadbandSliderHtml()}
      ${this.telemetryGraph.renderVelocityDecompHtml()}
      ${this.telemetryGraph.renderDynamicsTelemetryHtml()}
      ${this.featureFlagPanel.renderDspControlsHtml()}
      ${this.featureFlagPanel.renderCameraAxesHtml()}
      ${this.featureFlagPanel.renderBeatAuditoryHtml()}
      ${this.featureFlagPanel.renderMagicFingerHtml()}
      ${this.telemetryGraph.renderScoreVisualizerDiagnosticsHtml()}
      ${this.telemetryGraph.renderCameraKinematicsHtml()}
      ${this.telemetryGraph.renderClockTransportHtml()}
    `;

    return el;
  }
}
