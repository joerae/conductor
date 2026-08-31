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
 *   - Interactive A/B DSP Bypass Checkboxes (toggle velocity scaling, filter bus, reverb scaling, attack shaping, limiter, score compression)
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

  // Cached DOM elements for live text updates without innerHTML thrashing
  private elements: Record<string, HTMLElement> = {};

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
        scoreCompression: true,
      },
    },
  };

  constructor(onDSPToggle?: (flag: keyof DSPBypassFlags, enabled: boolean) => void) {
    this.onDSPToggle = onDSPToggle;
    this.container = this.createContainer();
    document.body.appendChild(this.container);

    // Cache dynamic text targets
    const keys = [
      "dyn-level",
      "vel-scale",
      "lpf-cutoff",
      "shelf-gain",
      "reverb-wet",
      "attack-time",
      "tempo-mode",
      "bpm",
      "period",
      "next-beat",
      "phase-error",
      "confidence",
      "beats-accepted",
      "last-tap",
      "score-beat",
      "sched-horizon",
      "sched-committed",
      "base-lat",
      "out-lat",
    ];
    for (const key of keys) {
      const el = document.getElementById(`dbg-${key}`);
      if (el) this.elements[key] = el;
    }

    // Attach delegated change event handler once to persistent checkboxes
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

    // Start efficient RAF loop that only mutates text
    this.renderLoop();
  }

  // ── Update methods (called by ExperienceController) ─────────────────────

  updateTempoMode(mode: "balanced" | "instant" | "autoplay"): void {
    this.snapshot.tempoMode =
      mode === "balanced"
        ? "A (Balanced PLL)"
        : mode === "instant"
        ? "B (Instant / Dime)"
        : "C (Autoplay ⚡)";
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
    // Synchronize checkboxes if flags changed programmatically
    const checkboxes = this.container.querySelectorAll<HTMLInputElement>("input[data-dsp-flag]");
    checkboxes.forEach((cb) => {
      const flag = cb.dataset.dspFlag as keyof DSPBypassFlags;
      if (flag && flag in dynamics.bypassFlags) {
        cb.checked = dynamics.bypassFlags[flag];
      }
    });
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

    const dynamicLabel =
      d.level === "fff"
        ? `<strong style="color:#ff6b3d">fff ⚡ (Overburn)</strong>`
        : d.level === "ff"
        ? `<strong style="color:#ffd56b">ff (Fortissimo)</strong>`
        : d.level === "f"
        ? `<strong style="color:#ffd56b">f (Forte)</strong>`
        : d.level === "mf"
        ? `<strong style="color:#a0f0a0">mf (Default)</strong>`
        : `<strong style="color:#7cc5ff">${d.level.toUpperCase()}</strong>`;

    if (this.elements["dyn-level"]) this.elements["dyn-level"].innerHTML = dynamicLabel;
    if (this.elements["vel-scale"]) {
      this.elements["vel-scale"].innerHTML = `× ${d.velocityMultiplier.toFixed(2)} (${
        flags.velocityScaling ? "Active" : "<span style='color:#ff8888'>Bypassed</span>"
      })`;
    }
    if (this.elements["lpf-cutoff"]) {
      this.elements["lpf-cutoff"].textContent = `${(d.filterCutoffHz / 1000).toFixed(1)} kHz`;
    }
    if (this.elements["shelf-gain"]) {
      this.elements["shelf-gain"].textContent = `${d.highShelfGainDb >= 0 ? "+" : ""}${d.highShelfGainDb.toFixed(1)} dB`;
    }
    if (this.elements["reverb-wet"]) {
      this.elements["reverb-wet"].textContent = `${(d.reverbWet * 100).toFixed(0)}%`;
    }
    if (this.elements["attack-time"]) {
      this.elements["attack-time"].textContent = `${(d.attackTimeSec * 1000).toFixed(0)} ms`;
    }

    if (this.elements["tempo-mode"]) this.elements["tempo-mode"].textContent = s.tempoMode;
    if (this.elements["bpm"]) this.elements["bpm"].textContent = s.bpm.toFixed(1);
    if (this.elements["period"]) this.elements["period"].textContent = `${s.periodMs.toFixed(1)} ms`;
    if (this.elements["next-beat"]) this.elements["next-beat"].textContent = `${s.nextBeatAudioTime.toFixed(3)} s`;
    if (this.elements["phase-error"]) this.elements["phase-error"].textContent = `${s.phaseErrorMs.toFixed(1)} ms`;
    if (this.elements["confidence"]) this.elements["confidence"].textContent = `${(s.confidence * 100).toFixed(0)}%`;
    if (this.elements["beats-accepted"]) this.elements["beats-accepted"].textContent = String(s.acceptedBeatCount);
    if (this.elements["last-tap"]) this.elements["last-tap"].textContent = s.lastTapStatus;
    if (this.elements["score-beat"]) this.elements["score-beat"].textContent = s.scoreBeat.toFixed(2);
    if (this.elements["sched-horizon"]) this.elements["sched-horizon"].textContent = `${s.schedulerHorizon.toFixed(3)} s`;
    if (this.elements["sched-committed"]) this.elements["sched-committed"].textContent = String(s.schedulerCommitted);
    if (this.elements["base-lat"]) this.elements["base-lat"].textContent = `${s.audioLatencyMs.toFixed(1)} ms`;
    if (this.elements["out-lat"]) this.elements["out-lat"].textContent = `${s.audioOutputLatencyMs.toFixed(1)} ms`;
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
      background: rgba(12, 16, 24, 0.94);
      color: #a0f0a0;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 11.5px;
      padding: 12px 16px;
      border-radius: 8px;
      border: 1px solid rgba(100, 200, 100, 0.35);
      min-width: 300px;
      max-width: 380px;
      backdrop-filter: blur(10px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
      max-height: 90vh;
      overflow-y: auto;
    `;

    el.innerHTML = `
      <div class="debug-title">DEBUG & A/B DSP (D to hide)</div>
      
      <!-- Dynamics Telemetry -->
      <div class="debug-section-header">ORCHESTRAL DYNAMICS</div>
      <table class="debug-table">
        <tr><td>Dynamic Level</td><td id="dbg-dyn-level">mf</td></tr>
        <tr><td>Velocity Scale</td><td id="dbg-vel-scale">× 1.00</td></tr>
        <tr><td>LPF Cutoff</td><td id="dbg-lpf-cutoff">14.0 kHz</td></tr>
        <tr><td>High-Shelf Boost</td><td id="dbg-shelf-gain">0.0 dB</td></tr>
        <tr><td>Reverb Wet Send</td><td id="dbg-reverb-wet">16%</td></tr>
        <tr><td>Attack Time</td><td id="dbg-attack-time">8 ms</td></tr>
      </table>

      <!-- Interactive A/B DSP Toggles -->
      <div class="debug-section-header" style="margin-top: 8px;">A/B DSP TOGGLES (Click to Test)</div>
      <div class="debug-toggles-grid">
        <label class="debug-checkbox-label">
          <input type="checkbox" data-dsp-flag="velocityScaling" checked>
          <span>Velocity Scaling</span>
        </label>
        <label class="debug-checkbox-label">
          <input type="checkbox" data-dsp-flag="scoreCompression" checked>
          <span>Score Macro Dynamics Smoothing</span>
        </label>
        <label class="debug-checkbox-label">
          <input type="checkbox" data-dsp-flag="timbreFilter" checked>
          <span>Timbre Filter (LPF/Shelf)</span>
        </label>
        <label class="debug-checkbox-label">
          <input type="checkbox" data-dsp-flag="reverbScaling" checked>
          <span>Dynamic Reverb Bloom</span>
        </label>
        <label class="debug-checkbox-label">
          <input type="checkbox" data-dsp-flag="attackEnvelope" checked>
          <span>Dynamic Attack Envelope</span>
        </label>
        <label class="debug-checkbox-label">
          <input type="checkbox" data-dsp-flag="safetyLimiter" checked>
          <span>Safety Limiter (-1dB)</span>
        </label>
      </div>

      <!-- Clock & Transport Telemetry -->
      <div class="debug-section-header" style="margin-top: 8px;">TEMPO & SCHEDULER</div>
      <table class="debug-table">
        <tr><td>Mode</td><td id="dbg-tempo-mode" style="color:#ffd56b">A (Balanced PLL)</td></tr>
        <tr><td>BPM</td><td id="dbg-bpm">0.0</td></tr>
        <tr><td>Period</td><td id="dbg-period">500.0 ms</td></tr>
        <tr><td>Next beat (audio)</td><td id="dbg-next-beat">0.000 s</td></tr>
        <tr><td>Phase error</td><td id="dbg-phase-error">0.0 ms</td></tr>
        <tr><td>Confidence</td><td id="dbg-confidence">0%</td></tr>
        <tr><td>Beats accepted</td><td id="dbg-beats-accepted">0</td></tr>
        <tr><td>Last tap</td><td id="dbg-last-tap">—</td></tr>
        <tr><td>Score beat</td><td id="dbg-score-beat">0.00</td></tr>
        <tr><td>Sched horizon</td><td id="dbg-sched-horizon">0.000 s</td></tr>
        <tr><td>Sched committed</td><td id="dbg-sched-committed">0</td></tr>
        <tr><td>Base latency</td><td id="dbg-base-lat">0.0 ms</td></tr>
        <tr><td>Output latency</td><td id="dbg-out-lat">0.0 ms</td></tr>
      </table>
    `;

    return el;
  }
}
