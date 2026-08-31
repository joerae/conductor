/**
 * DebugOverlay.ts
 *
 * Real-time diagnostic overlay for the Conductor experience.
 * Shows the internal state of ConductorClock, ScoreTransport, Scheduler,
 * and the Hybrid Dynamic Modeling DSP Engine.
 *
 * Toggle visibility with the D key (hidden by default).
 *
 * Exposes:
 *   - Clock & Transport telemetry (BPM, period, predicted beat, phase error, confidence)
 *   - Dynamic Modeling telemetry (dynamic marking, velocity factor, LPF cutoff, shelf gain, reverb %)
 *   - Interactive A/B DSP Bypass Checkboxes (toggle velocity scaling, filter bus, reverb scaling, attack shaping, limiter)
 */

import type { ClockState, TapRejectionReason } from "../clock/clockTypes";
import type { DynamicsTelemetry, DSPBypassFlags } from "../audio/dynamicsTypes";

interface DebugSnapshot {
  tempoMode: string;
  bpm: number;
  periodMs: number;
  nextBeatAudioTime: number;
  phaseErrorMs: number;
  confidence: number;
  acceptedBeatCount: number;
  lastTapStatus: string;
  scoreBeat: number;
  schedulerHorizon: number;
  schedulerCommitted: number;
  audioLatencyMs: number;
  audioOutputLatencyMs: number;
  dynamics: DynamicsTelemetry;
}

export class DebugOverlay {
  private container: HTMLElement;
  private visible: boolean = false;
  private onDSPToggle?: (flag: keyof DSPBypassFlags, enabled: boolean) => void;

  private snapshot: DebugSnapshot = {
    tempoMode: "A (Balanced PLL)",
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
    dynamics: {
      level: "mf",
      velocityMultiplier: 1.0,
      filterCutoffHz: 14000,
      highShelfGainDb: 0.0,
      reverbWet: 0.16,
      attackTimeSec: 0.008,
      bypassFlags: {
        velocityScaling: true,
        timbreFilter: true,
        reverbScaling: true,
        attackEnvelope: true,
        safetyLimiter: true,
      },
    },
  };

  constructor(onDSPToggle?: (flag: keyof DSPBypassFlags, enabled: boolean) => void) {
    this.onDSPToggle = onDSPToggle;
    this.container = this.createContainer();
    document.body.appendChild(this.container);

    // Delegate checkbox change events
    this.container.addEventListener("change", (e) => {
      const target = e.target as HTMLInputElement;
      if (target && target.dataset.dspFlag) {
        const flag = target.dataset.dspFlag as keyof DSPBypassFlags;
        const checked = target.checked;
        this.snapshot.dynamics.bypassFlags[flag] = checked;
        if (this.onDSPToggle) {
          this.onDSPToggle(flag, checked);
        }
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyD" && !e.repeat) {
        this.toggle();
      }
    });

    // Render loop
    this.renderLoop();
  }

  // ── Update methods (called by ExperienceController) ─────────────────────

  updateTempoMode(mode: "balanced" | "instant"): void {
    this.snapshot.tempoMode = mode === "balanced" ? "A (Balanced PLL)" : "B (Instant / Dime)";
  }

  updateClock(state: ClockState): void {
    this.snapshot.bpm = state.bpm;
    this.snapshot.periodMs = state.periodMs;
    this.snapshot.nextBeatAudioTime = state.nextBeatAudioTime;
    this.snapshot.phaseErrorMs = state.phaseErrorMs;
    this.snapshot.confidence = state.confidence;
    this.snapshot.acceptedBeatCount = state.acceptedBeatCount;
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

  updateDynamics(dynamics: DynamicsTelemetry): void {
    this.snapshot.dynamics = dynamics;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private toggle(): void {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? "block" : "none";
  }

  private renderLoop(): void {
    if (this.visible) this.render();
    requestAnimationFrame(() => this.renderLoop());
  }

  private render(): void {
    const s = this.snapshot;
    const d = s.dynamics;
    const flags = d.bypassFlags;

    const dynamicLabel = d.level === "ff"
      ? `<strong style="color:#ffd56b">ff ⚡ (Overburn)</strong>`
      : d.level === "f"
      ? `<strong style="color:#ffd56b">f (Forte)</strong>`
      : d.level === "mf"
      ? `<strong style="color:#a0f0a0">mf (Default)</strong>`
      : `<strong style="color:#7cc5ff">${d.level.toUpperCase()}</strong>`;

    this.container.innerHTML = `
      <div class="debug-title">DEBUG & A/B DSP (D to hide)</div>
      
      <!-- Dynamics Telemetry -->
      <div class="debug-section-header">ORCHESTRAL DYNAMICS</div>
      <table class="debug-table">
        <tr><td>Dynamic Level</td><td>${dynamicLabel}</td></tr>
        <tr><td>Velocity Scale</td><td>× ${d.velocityMultiplier.toFixed(2)} (${flags.velocityScaling ? "Active" : "<span style='color:#ff8888'>Bypassed</span>"})</td></tr>
        <tr><td>LPF Cutoff</td><td>${(d.filterCutoffHz / 1000).toFixed(1)} kHz</td></tr>
        <tr><td>High-Shelf Boost</td><td>${d.highShelfGainDb >= 0 ? "+" : ""}${d.highShelfGainDb.toFixed(1)} dB</td></tr>
        <tr><td>Reverb Wet Send</td><td>${(d.reverbWet * 100).toFixed(0)}%</td></tr>
        <tr><td>Attack Time</td><td>${(d.attackTimeSec * 1000).toFixed(0)} ms</td></tr>
      </table>

      <!-- Interactive A/B DSP Toggles -->
      <div class="debug-section-header" style="margin-top: 8px;">A/B DSP TOGGLES (Click to Test)</div>
      <div class="debug-toggles-grid">
        <label class="debug-checkbox-label">
          <input type="checkbox" data-dsp-flag="velocityScaling" ${flags.velocityScaling ? "checked" : ""}>
          <span>Velocity Scaling</span>
        </label>
        <label class="debug-checkbox-label">
          <input type="checkbox" data-dsp-flag="timbreFilter" ${flags.timbreFilter ? "checked" : ""}>
          <span>Timbre Filter (LPF/Shelf)</span>
        </label>
        <label class="debug-checkbox-label">
          <input type="checkbox" data-dsp-flag="reverbScaling" ${flags.reverbScaling ? "checked" : ""}>
          <span>Dynamic Reverb Bloom</span>
        </label>
        <label class="debug-checkbox-label">
          <input type="checkbox" data-dsp-flag="attackEnvelope" ${flags.attackEnvelope ? "checked" : ""}>
          <span>Dynamic Attack Envelope</span>
        </label>
        <label class="debug-checkbox-label">
          <input type="checkbox" data-dsp-flag="safetyLimiter" ${flags.safetyLimiter ? "checked" : ""}>
          <span>Safety Limiter (-1dB)</span>
        </label>
      </div>

      <!-- Clock & Transport Telemetry -->
      <div class="debug-section-header" style="margin-top: 8px;">TEMPO & SCHEDULER</div>
      <table class="debug-table">
        <tr><td>Mode</td><td style="color:#ffd56b">${s.tempoMode}</td></tr>
        <tr><td>BPM</td><td>${s.bpm.toFixed(1)}</td></tr>
        <tr><td>Period</td><td>${s.periodMs.toFixed(1)} ms</td></tr>
        <tr><td>Next beat (audio)</td><td>${s.nextBeatAudioTime.toFixed(3)} s</td></tr>
        <tr><td>Phase error</td><td>${s.phaseErrorMs.toFixed(1)} ms</td></tr>
        <tr><td>Confidence</td><td>${(s.confidence * 100).toFixed(0)}%</td></tr>
        <tr><td>Beats accepted</td><td>${s.acceptedBeatCount}</td></tr>
        <tr><td>Last tap</td><td>${s.lastTapStatus}</td></tr>
        <tr><td>Score beat</td><td>${s.scoreBeat.toFixed(2)}</td></tr>
        <tr><td>Sched horizon</td><td>${s.schedulerHorizon.toFixed(3)} s</td></tr>
        <tr><td>Sched committed</td><td>${s.schedulerCommitted}</td></tr>
        <tr><td>Base latency</td><td>${s.audioLatencyMs.toFixed(1)} ms</td></tr>
        <tr><td>Output latency</td><td>${s.audioOutputLatencyMs.toFixed(1)} ms</td></tr>
      </table>
    `;
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
      background: rgba(12, 16, 24, 0.92);
      color: #a0f0a0;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 11.5px;
      padding: 12px 16px;
      border-radius: 8px;
      border: 1px solid rgba(100, 200, 100, 0.35);
      min-width: 290px;
      max-width: 360px;
      backdrop-filter: blur(10px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
      max-height: 90vh;
      overflow-y: auto;
    `;
    return el;
  }
}
