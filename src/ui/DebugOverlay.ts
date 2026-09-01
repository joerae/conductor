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
 *   - Conductor Jitter & Stability telemetry (latest jitter ms/%, rolling avg jitter, stability state)
 *   - Interactive Jitter Deadband Protection Slider (0.0% raw to 15.0% heavy stability)
 *   - Dynamic Modeling telemetry (dynamic marking, velocity factor, LPF cutoff, shelf gain, reverb %)
 *   - Interactive A/B DSP Bypass Checkboxes (toggle velocity scaling, filter bus, reverb scaling, attack shaping, limiter, score compression)
 *   - Interactive Macro Dynamics Smoothing Ratio Slider (0.00 flat to 1.00 raw)
 *   - Step-by-step note velocity breakdown
 *   - Dedicated Pause / Resume button
 *   - Rock-solid fixed width layout with zero jitter
 */

import type { ClockState, TapRejectionReason } from "../clock/clockTypes";
import type { DynamicsTelemetry, DSPBypassFlags, VelocityDecomposition } from "../audio/dynamicsTypes";

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
  isPaused: boolean;
  lastDecomp?: VelocityDecomposition;
  lastDecompTrack?: string;

  // Jitter & Stability Telemetry
  tempoDeadband: number;
  lastJitterMs: number;
  lastJitterPercent: number;
  averageJitterMs: number;
  averageJitterPercent: number;
  jitterStatus: "steady" | "accelerando" | "rallentando" | "coasting" | "calibrating";
}

export class DebugOverlay {
  private container: HTMLElement;
  private visible: boolean = false;
  private onDSPToggle?: (flag: keyof DSPBypassFlags, enabled: boolean) => void;
  private onTogglePause?: () => void;
  private onMacroRatioChange?: (ratio: number) => void;
  private onCameraDynamicsModeChange?: (mode: "spread" | "height") => void;
  private onBeatSoundToggle?: (enabled: boolean) => void;
  private onTempoDeadbandChange?: (ratio: number) => void;

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
    tempoDeadband: 0.055,
    lastJitterMs: 0,
    lastJitterPercent: 0,
    averageJitterMs: 0,
    averageJitterPercent: 0,
    jitterStatus: "calibrating",
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
    onTempoDeadbandChange?: (ratio: number) => void
  ) {
    this.onDSPToggle = onDSPToggle;
    this.onTogglePause = onTogglePause;
    this.onMacroRatioChange = onMacroRatioChange;
    this.onCameraDynamicsModeChange = onCameraDynamicsModeChange;
    this.onBeatSoundToggle = onBeatSoundToggle;
    this.onTempoDeadbandChange = onTempoDeadbandChange;
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
      "pause-btn",
      "decomp-track",
      "decomp-raw",
      "decomp-macro",
      "decomp-dyn",
      "decomp-final",
      "decomp-formula",
      "macro-ratio-val",
      "cam-h0",
      "cam-h1",
      "cam-last-beat",
      "cam-beat-log",
      "jitter-last",
      "jitter-avg",
      "jitter-status",
      "jitter-deadband-val",
      "jitter-deadband-window",
    ];

    keys.forEach((key) => {
      const el = document.getElementById(`dbg-${key}`);
      if (el) this.elements[key] = el;
    });

    // Wire up A/B DSP checkboxes
    const checkboxes = this.container.querySelectorAll<HTMLInputElement>("input[data-dsp-flag]");
    checkboxes.forEach((cb) => {
      cb.addEventListener("change", () => {
        const flag = cb.dataset.dspFlag as keyof DSPBypassFlags;
        if (flag && this.onDSPToggle) {
          this.onDSPToggle(flag, cb.checked);
        }
      });
    });

    // Wire up Camera Dynamics Mode radio buttons
    const dynModeRadios = this.container.querySelectorAll<HTMLInputElement>("input[name='dbg-camera-dyn-mode']");
    dynModeRadios.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked && this.onCameraDynamicsModeChange) {
          this.onCameraDynamicsModeChange(radio.value as "spread" | "height");
        }
      });
    });

    // Wire up Audible Beat Cue (Instant Cymbal) toggle
    const beatSoundCb = this.container.querySelector<HTMLInputElement>("#dbg-beat-sound-cb");
    beatSoundCb?.addEventListener("change", () => {
      if (this.onBeatSoundToggle) {
        this.onBeatSoundToggle(beatSoundCb.checked);
      }
    });

    // Pause button in header
    const pauseBtn = document.getElementById("dbg-pause-btn");
    pauseBtn?.addEventListener("click", () => {
      if (this.onTogglePause) {
        this.onTogglePause();
      }
    });

    // Macro Dynamics Smoothing Slider
    const macroSlider = document.getElementById("dbg-macro-slider") as HTMLInputElement;
    macroSlider?.addEventListener("input", () => {
      const ratio = parseFloat(macroSlider.value);
      this.snapshot.dynamics.macroRatio = ratio;
      this.updateMacroLabel(ratio);
      if (this.onMacroRatioChange) {
        this.onMacroRatioChange(ratio);
      }
    });

    // Jitter Deadband Slider
    const deadbandSlider = document.getElementById("dbg-deadband-slider") as HTMLInputElement;
    deadbandSlider?.addEventListener("input", () => {
      const ratio = parseFloat(deadbandSlider.value);
      this.snapshot.tempoDeadband = ratio;
      this.updateDeadbandLabel(ratio, this.snapshot.periodMs);
      if (this.onTempoDeadbandChange) {
        this.onTempoDeadbandChange(ratio);
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

  updateTempoMode(mode: "balanced" | "instant" | "autoplay" | "inertial" | "gestural"): void {
    this.snapshot.tempoMode =
      mode === "balanced"
        ? "A (Balanced PLL)"
        : mode === "instant"
          ? "B (Instant / Dime)"
          : mode === "autoplay"
            ? "C (Autoplay ⚡)"
            : mode === "inertial"
              ? "D (Coast & Steer 📷)"
              : "E (Gesture / Accelerando 🪄)";
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

  updateDynamics(dynamics: DynamicsTelemetry): void {
    this.snapshot.dynamics = dynamics;
    const checkboxes = this.container.querySelectorAll<HTMLInputElement>("input[data-dsp-flag]");
    checkboxes.forEach((cb) => {
      const flag = cb.dataset.dspFlag as keyof DSPBypassFlags;
      if (flag && flag in dynamics.bypassFlags) {
        cb.checked = dynamics.bypassFlags[flag];
      }
    });

    const slider = document.getElementById("dbg-macro-slider") as HTMLInputElement;
    if (slider && Math.abs(parseFloat(slider.value) - dynamics.macroRatio) > 0.01) {
      slider.value = String(dynamics.macroRatio);
      this.updateMacroLabel(dynamics.macroRatio);
    }
  }

  private beatLogLines: string[] = [];
  private lastLoggedBeatTime: number = 0;

  updateCameraTelemetry(telemetry: import("../camera/cameraTypes").CameraTelemetry): void {
    if (!this.elements["cam-h0"]) return;

    if (telemetry.beatDebug && telemetry.beatDebug.length > 0) {
      telemetry.beatDebug.forEach(h => {
        const el = h.handIndex === 0 ? this.elements["cam-h0"] : this.elements["cam-h1"];
        if (el) {
          const arrow = h.direction === "DOWN" ? "⬇️ DOWN" : h.direction === "UP" ? "⬆️ UP" : h.direction === "RECOVERING" ? "🔄 RECOVERING" : "⏹ IDLE";
          const vyColor = h.currentVy < 0 ? "#ff8888" : h.currentVy > 0 ? "#88ff88" : "#888";
          el.innerHTML = `<strong>${arrow}</strong> | Y: ${h.currentY.toFixed(2)} | Vy: <span style="color:${vyColor}">${h.currentVy >= 0 ? "+" : ""}${h.currentVy.toFixed(2)}</span> | Pk: ${h.peakY.toFixed(2)} Tr: ${h.troughY.toFixed(2)}`;
        }
      });
    }

    if (telemetry.lastBeat && this.elements["cam-last-beat"]) {
      const b = telemetry.lastBeat;
      const typeLabel = b.direction === "apex" ? "⬆️ TOP APEX" : "⬇️ BOTTOM TROUGH";
      const typeColor = b.direction === "apex" ? "#6be7ff" : "#ffd56b";
      this.elements["cam-last-beat"].innerHTML = `<strong style="color:${typeColor}">${typeLabel}</strong> (H${b.handIndex}, ΔY: ${b.amplitude.toFixed(2)})`;
    }

    if (telemetry.lastBeat && (!this.lastLoggedBeatTime || telemetry.lastBeat.timeMs > this.lastLoggedBeatTime)) {
      this.lastLoggedBeatTime = telemetry.lastBeat.timeMs;
      const b = telemetry.lastBeat;
      const logEl = this.elements["cam-beat-log"];
      if (logEl) {
        const icon = b.direction === "apex" ? "⬆️ Apex" : "⬇️ Trough";
        const timeSec = (b.timeMs / 1000).toFixed(2);
        const line = `[${timeSec}s] Hand ${b.handIndex} ${icon} (ΔY: ${b.amplitude.toFixed(2)})`;
        this.beatLogLines.unshift(line);
        if (this.beatLogLines.length > 6) this.beatLogLines.pop();
        logEl.innerHTML = this.beatLogLines.map(l => `<div>${l}</div>`).join("");
      }
    }
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

  // ── Private ─────────────────────────────────────────────────────────────

  private updateMacroLabel(ratio: number): void {
    if (this.elements["macro-ratio-val"]) {
      const desc =
        ratio === 0
          ? "0.00 (Flat Authority)"
          : ratio <= 0.25
            ? `${ratio.toFixed(2)} (Heavy Smooth)`
            : ratio <= 0.50
              ? `${ratio.toFixed(2)} (Moderate Balanced)`
              : ratio <= 0.80
                ? `${ratio.toFixed(2)} (Light Smooth)`
                : `${ratio.toFixed(2)} (Raw Score MIDI)`;
      this.elements["macro-ratio-val"].textContent = desc;
    }
  }

  private updateDeadbandLabel(ratio: number, periodMs: number): void {
    if (this.elements["jitter-deadband-val"]) {
      const msAtPeriod = (periodMs * ratio).toFixed(0);
      const desc =
        ratio === 0
          ? "0.0% (Raw Tracking — No Deadband)"
          : ratio <= 0.035
            ? `${(ratio * 100).toFixed(1)}% (±${msAtPeriod}ms — Light Filter)`
            : ratio <= 0.075
              ? `${(ratio * 100).toFixed(1)}% (±${msAtPeriod}ms — Balanced Steady)`
              : `${(ratio * 100).toFixed(1)}% (±${msAtPeriod}ms — Heavy Stability)`;
      this.elements["jitter-deadband-val"].textContent = desc;
    }
  }

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

    if (this.elements["pause-btn"]) {
      this.elements["pause-btn"].textContent = s.isPaused ? "▶ Resume Playback" : "⏸ Pause Orchestra";
      this.elements["pause-btn"].style.background = s.isPaused ? "#ffd56b" : "rgba(255, 213, 107, 0.15)";
      this.elements["pause-btn"].style.color = s.isPaused ? "#0c1018" : "#ffd56b";
    }

    if (this.elements["dyn-level"]) this.elements["dyn-level"].innerHTML = dynamicLabel;
    if (this.elements["vel-scale"]) {
      this.elements["vel-scale"].innerHTML = `× ${d.velocityMultiplier.toFixed(2)} (${flags.velocityScaling ? "Active" : "<span style='color:#ff8888'>Bypassed</span>"
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

    // Velocity breakdown decomposition display
    if (s.lastDecomp) {
      const dec = s.lastDecomp;
      if (this.elements["decomp-track"]) this.elements["decomp-track"].textContent = s.lastDecompTrack || "Section";
      if (this.elements["decomp-raw"]) this.elements["decomp-raw"].textContent = String(dec.raw);
      if (this.elements["decomp-macro"]) {
        const deltaStr = dec.macroDelta >= 0 ? `+${dec.macroDelta}` : `${dec.macroDelta}`;
        this.elements["decomp-macro"].innerHTML = dec.macroEnabled
          ? `${dec.macro} <span style="color:#7cc5ff">(${deltaStr})</span>`
          : `${dec.raw} <span style="color:#888">(bypassed)</span>`;
      }
      if (this.elements["decomp-dyn"]) {
        this.elements["decomp-dyn"].textContent = `${dec.dynamicLevel} (×${dec.dynMultiplier.toFixed(2)})`;
      }
      if (this.elements["decomp-final"]) {
        this.elements["decomp-final"].innerHTML = `<strong style="color:#ffd56b; font-size:13px;">${dec.final}</strong>`;
      }
      if (this.elements["decomp-formula"]) {
        const macroStr = dec.macroEnabled ? `${dec.macro} [Δ ${dec.macroDelta >= 0 ? "+" : ""}${dec.macroDelta}]` : `${dec.raw}`;
        this.elements["decomp-formula"].innerHTML = `Raw ${dec.raw} ➔ Macro ${macroStr} ➔ ${dec.dynamicLevel} (×${dec.dynMultiplier.toFixed(2)}) ➔ <strong>v: ${dec.final}</strong>`;
      }
    }

    // Jitter & Stability telemetry display
    const jitterMs = s.lastJitterMs;
    const jitterPct = s.lastJitterPercent;
    const avgJitterMs = s.averageJitterMs;
    const avgJitterPct = s.averageJitterPercent;
    const deadbandRatio = s.tempoDeadband;
    const deadbandMs = s.periodMs * deadbandRatio;
    const status = s.jitterStatus;

    this.updateDeadbandLabel(deadbandRatio, s.periodMs);

    if (this.elements["jitter-last"]) {
      const sign = jitterMs >= 0 ? "+" : "";
      const color = Math.abs(jitterMs) <= deadbandMs ? "#a0f0a0" : jitterMs < 0 ? "#7cc5ff" : "#ffd56b";
      this.elements["jitter-last"].innerHTML = `<span style="color:${color}">${sign}${jitterMs.toFixed(1)} ms (${sign}${jitterPct.toFixed(1)}%)</span>`;
    }

    if (this.elements["jitter-avg"]) {
      const avgColor = avgJitterMs <= deadbandMs ? "#a0f0a0" : "#ffd56b";
      this.elements["jitter-avg"].innerHTML = `<span style="color:${avgColor}">±${avgJitterMs.toFixed(1)} ms (${avgJitterPct.toFixed(1)}%)</span>`;
    }

    if (this.elements["jitter-status"]) {
      let statusHtml = `<span style="color:#a0f0a0; font-weight:700;">● STEADY (IN DEADBAND)</span>`;
      if (status === "accelerando") {
        statusHtml = `<span style="color:#7cc5ff; font-weight:700;">▲ STEERING (ACCELERANDO)</span>`;
      } else if (status === "rallentando") {
        statusHtml = `<span style="color:#ffd56b; font-weight:700;">▼ STEERING (RALLENTANDO)</span>`;
      } else if (status === "coasting") {
        statusHtml = `<span style="color:#888888; font-weight:700;">○ COASTING</span>`;
      } else if (status === "calibrating") {
        statusHtml = `<span style="color:#ffd56b; font-weight:700;">⋯ CALIBRATING (TAP 2)</span>`;
      }
      this.elements["jitter-status"].innerHTML = statusHtml;
    }

    if (this.elements["jitter-deadband-window"]) {
      this.elements["jitter-deadband-window"].textContent = `±${deadbandMs.toFixed(1)} ms (±${(deadbandRatio * 100).toFixed(1)}%)`;
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
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <span class="debug-title" style="margin:0; font-size:12px;">DIAGNOSTICS & A/B DSP</span>
        <button id="dbg-pause-btn" style="
          background: rgba(255, 213, 107, 0.15);
          color: #ffd56b;
          border: 1px solid rgba(255, 213, 107, 0.5);
          border-radius: 4px;
          padding: 4px 10px;
          font-family: inherit;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        ">⏸ Pause Orchestra</button>
      </div>

      <!-- Conductor Jitter & Stability Diagnostics -->
      <div class="debug-section-header" title="Real-time analysis of your stroke consistency, timing jitter, and deadband protection">CONDUCTOR JITTER & STABILITY</div>
      
      <!-- Interactive Jitter Deadband Protection Slider -->
      <div style="
        margin: 4px 0 8px 0;
        padding: 6px 8px;
        background: rgba(255, 255, 255, 0.04);
        border-radius: 4px;
        border: 1px solid rgba(255, 213, 107, 0.2);
      " title="Adjust the Jitter Protection Deadband: Within this threshold, the orchestra maintains a rock-solid BPM without micro-adjusting. Outside this threshold, consistent beats smoothly steer tempo.">
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:10.5px; margin-bottom:4px;">
          <span style="color:#d0f0d0;">Jitter Deadband:</span>
          <span id="dbg-jitter-deadband-val" style="color:#ffd56b; font-weight:700;">5.5% (±55ms @ 60BPM)</span>
        </div>
        <input type="range" id="dbg-deadband-slider" min="0" max="0.15" step="0.005" value="0.055" style="
          width: 100%;
          accent-color: #ffd56b;
          cursor: pointer;
          height: 4px;
          margin: 4px 0;
        " title="Drag to adjust jitter deadband between 0.0% (raw micro-tracking) and 15.0% (heavy stability)">
        <div style="display:flex; justify-content:space-between; font-size:8.5px; color:#888888;">
          <span>0.0% (Raw)</span>
          <span>5.5% (Balanced)</span>
          <span>15.0% (Heavy)</span>
        </div>
      </div>

      <table class="debug-table">
        <tr title="Timing deviation of your most recent conducted beat from the established pulse">
          <td>Latest Jitter</td>
          <td id="dbg-jitter-last">0.0 ms (0.0%)</td>
        </tr>
        <tr title="Rolling average absolute timing jitter across your last 8 conducted strokes">
          <td>Avg Jitter (Last 8)</td>
          <td id="dbg-jitter-avg">±0.0 ms (0.0%)</td>
        </tr>
        <tr title="Current stability state: whether beats are within the deadband or actively steering tempo">
          <td>Stability State</td>
          <td id="dbg-jitter-status" style="color:#a0f0a0">● STEADY (IN DEADBAND)</td>
        </tr>
        <tr title="Current deadband tolerance window where tempo micro-adjustments are absorbed">
          <td>Deadband Window</td>
          <td id="dbg-jitter-deadband-window">±27.5 ms (±5.5%)</td>
        </tr>
      </table>

      <!-- Note Velocity Scaler Breakdown -->
      <div class="debug-section-header" style="margin-top: 10px;" title="Live velocity decomposition pipeline for the most recently scheduled note voice">NOTE VELOCITY SCALER BREAKDOWN</div>
      <table class="debug-table">
        <tr title="The orchestral instrument section executing this note"><td>Active Instrument</td><td id="dbg-decomp-track">—</td></tr>
        <tr title="Original velocity value (0–127) as authored in the MIDI score file"><td>1. Raw Score Velocity</td><td id="dbg-decomp-raw">—</td></tr>
        <tr title="Score velocity after centering and smoothing extreme terraced swings (e.g. forte theme vs piano theme) around baseline 72"><td>2. Macro Smoothing</td><td id="dbg-decomp-macro">—</td></tr>
        <tr title="Active dynamic level (pp to fff) and its proportional scaling multiplier applied by your baton"><td>3. Dynamic Tier Scaling</td><td id="dbg-decomp-dyn">—</td></tr>
        <tr title="Final computed MIDI velocity (10–127) sent to the WebAudioFont synthesizer wavetable"><td>4. Final Synthesized Velocity</td><td id="dbg-decomp-final">—</td></tr>
      </table>
      <div id="dbg-decomp-formula" title="Mathematical transformation: Raw Score Velocity ➔ Macro Smoothed Base ➔ Conductor Tier Multiplier ➔ Synthesized Output" style="
        background: rgba(0,0,0,0.45);
        padding: 5px 8px;
        border-radius: 4px;
        font-size: 10px;
        color: #ffd56b;
        margin-top: 6px;
        border-left: 2px solid #ffd56b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-sizing: border-box;
      ">Play notes to inspect velocity calculation formula</div>
      
      <!-- Dynamics Telemetry -->
      <div class="debug-section-header" style="margin-top: 10px;" title="Current acoustic parameters computed by the Hybrid Dynamic Modeling DSP engine">ORCHESTRAL DYNAMICS</div>
      <table class="debug-table">
        <tr title="The currently selected conductor dynamic level (pp, p, mp, mf, f, ff, fff)"><td>Dynamic Level</td><td id="dbg-dyn-level">mf</td></tr>
        <tr title="Proportional velocity factor scaling note volume and sample timbre (0.30x in pp up to 1.55x in fff)"><td>Velocity Scale</td><td id="dbg-vel-scale">× 1.00</td></tr>
        <tr title="Master Low-Pass Filter cutoff frequency. Darkens soft dynamics and brightens forte dynamics"><td>LPF Cutoff</td><td id="dbg-lpf-cutoff">14.0 kHz</td></tr>
        <tr title="High-Shelf Filter boost/cut gain (+3.5 dB in fff down to -5.0 dB in pp)"><td>High-Shelf Boost</td><td id="dbg-shelf-gain">0.0 dB</td></tr>
        <tr title="Reverb send wet mix percentage into the 1.8s concert hall convolution acoustic model"><td>Reverb Wet Send</td><td id="dbg-reverb-wet">18%</td></tr>
        <tr title="Per-voice attack transient ramp duration (2ms punch in forte to 18ms soft swell in piano)"><td>Attack Time</td><td id="dbg-attack-time">8 ms</td></tr>
      </table>

      <!-- Interactive A/B DSP Toggles & Macro Slider -->
      <div class="debug-section-header" style="margin-top: 10px;" title="Interactive A/B toggles to audition individual DSP modules on/off in real-time">A/B DSP & MACRO CONTROLS</div>
      <div class="debug-toggles-grid">
        <label class="debug-checkbox-label" title="Toggle proportional note velocity scaling across dynamic tiers (pp through fff)">
          <input type="checkbox" data-dsp-flag="velocityScaling" checked>
          <span>Velocity Scaling</span>
        </label>
        <label class="debug-checkbox-label" title="Toggle score macro-dynamics compression. When enabled, compresses baked-in MIDI swings so the conductor commands the volume">
          <input type="checkbox" data-dsp-flag="scoreCompression" checked>
          <span>Score Macro Dynamics Smoothing</span>
        </label>

        <!-- Interactive Macro Dynamics Smoothing Slider -->
        <div style="
          margin: 4px 0;
          padding: 6px 8px;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 4px;
          border: 1px solid rgba(255, 213, 107, 0.2);
        " title="Adjust the strength of Score Macro Smoothing: 0.00 = completely flat (100% conductor authority), 1.00 = raw MIDI score dynamics">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:10.5px; margin-bottom:4px;">
            <span style="color:#d0f0d0;">Macro Smoothing Ratio:</span>
            <span id="dbg-macro-ratio-val" style="color:#ffd56b; font-weight:700;">0.24 (Heavy Smooth)</span>
          </div>
          <input type="range" id="dbg-macro-slider" min="0" max="1" step="0.05" value="0.24" style="
            width: 100%;
            accent-color: #ffd56b;
            cursor: pointer;
            height: 4px;
            margin: 4px 0;
          " title="Drag to adjust macro smoothing ratio between 0.0 (flat) and 1.0 (raw MIDI)">
          <div style="display:flex; justify-content:space-between; font-size:8.5px; color:#888888;">
            <span>0.0 (Flat)</span>
            <span>0.24 (Active)</span>
            <span>1.0 (Raw MIDI)</span>
          </div>
        </div>

        <label class="debug-checkbox-label" title="Toggle dynamic Low-Pass Filter and High-Shelf EQ across dynamic tiers">
          <input type="checkbox" data-dsp-flag="timbreFilter" checked>
          <span>Timbre Filter (LPF/Shelf)</span>
        </label>
        <label class="debug-checkbox-label" title="Toggle dynamic concert hall reverb wet send expansion (bloom in forte, intimate in piano)">
          <input type="checkbox" data-dsp-flag="reverbScaling" checked>
          <span>Dynamic Reverb Bloom</span>
        </label>
        <label class="debug-checkbox-label" title="Toggle per-voice dynamic attack envelope shaping (2ms fast bite vs 18ms soft swell)">
          <input type="checkbox" data-dsp-flag="attackEnvelope">
          <span>Dynamic Attack Envelope</span>
        </label>
        <label class="debug-checkbox-label" title="Toggle safety brickwall limiter (-1.0 dBFS) to prevent any DAC clipping">
          <input type="checkbox" data-dsp-flag="safetyLimiter" checked>
          <span>Safety Limiter (-1dB)</span>
        </label>
      </div>

      <!-- Camera Dynamics Sensing Mode Selector -->
      <div class="debug-section-header" style="margin-top: 10px;" title="Select which gesture modality drives the orchestral dynamic ladder in Camera Mode">CAMERA DYNAMICS SENSING MODE</div>
      <div style="
        display: flex;
        flex-direction: column;
        gap: 6px;
        background: rgba(255, 255, 255, 0.04);
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid rgba(255, 213, 107, 0.2);
        margin-top: 4px;
      ">
        <label class="debug-checkbox-label" style="margin:0; cursor:pointer;" title="Two-Hand Spread / Aperture: Pulling hands apart = Louder (ff/fff). Bringing hands close together = Softer (p/pp). Hand height is completely ignored!">
          <input type="radio" name="dbg-camera-dyn-mode" value="spread" checked style="accent-color:#ffd56b; margin-right:6px;">
          <span><strong>Two-Hand Spread</strong> (Default: Expanding / Contracting)</span>
        </label>
        <label class="debug-checkbox-label" style="margin:0; cursor:pointer;" title="Vertical Hand Height: Raising hands high = Louder (ff/fff). Lowering hands down = Softer (p/pp). Hand distance/spread is completely ignored!">
          <input type="radio" name="dbg-camera-dyn-mode" value="height" style="accent-color:#ffd56b; margin-right:6px;">
          <span><strong>Vertical Hand Height</strong> (Raising / Lowering)</span>
        </label>
      </div>

      <!-- Camera & Beat Detection Auditory Tools -->
      <div class="debug-section-header" style="margin-top: 10px;" title="Immediate auditory feedback when beats are triggered">BEAT AUDITORY DIAGNOSTICS</div>
      <div style="
        display: flex;
        flex-direction: column;
        gap: 6px;
        background: rgba(255, 255, 255, 0.04);
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid rgba(255, 213, 107, 0.2);
        margin-top: 4px;
      ">
        <label class="debug-checkbox-label" style="margin:0; cursor:pointer;" title="Play an instant orchestral crash cymbal cue the exact millisecond a beat is detected from the camera or keyboard">
          <input type="checkbox" id="dbg-beat-sound-cb" checked style="accent-color:#ffd56b; margin-right:6px;">
          <span><strong>🥁 Make Sound on Beat</strong> (Instant Cymbal Cue)</span>
        </label>
      </div>

      <!-- Camera Kinematics & Beat Event Diagnostics -->
      <div class="debug-section-header" style="margin-top: 10px;" title="Real-time motion tracking and ictus turnaround detection data from the webcam">CAMERA KINEMATICS & BEAT LOG</div>
      <table class="debug-table">
        <tr title="Hand 0 motion state, vertical position Y (0=low, 1=high), velocity Vy (units/sec), and turnaround extremas">
          <td>Hand 0 (Right/Lead)</td>
          <td id="dbg-cam-h0" style="color:#ffd56b; font-size:10px;">Waiting for camera…</td>
        </tr>
        <tr title="Hand 1 motion state, vertical position Y (0=low, 1=high), velocity Vy (units/sec), and turnaround extremas">
          <td>Hand 1 (Left)</td>
          <td id="dbg-cam-h1" style="color:#6be7ff; font-size:10px;">—</td>
        </tr>
        <tr title="Most recent detected beat event with timestamp, inflection type, and gesture amplitude">
          <td>Last Beat Detected</td>
          <td id="dbg-cam-last-beat">—</td>
        </tr>
      </table>

      <!-- Rolling Beat Event Log -->
      <div style="margin-top:6px;">
        <div style="font-size:10px; color:#888; margin-bottom:3px;">Recent Beat Inflections Log:</div>
        <div id="dbg-cam-beat-log" style="
          background: rgba(0,0,0,0.5);
          border: 1px solid rgba(255,213,107,0.2);
          border-radius: 4px;
          padding: 5px 7px;
          font-size: 9.5px;
          max-height: 80px;
          overflow-y: auto;
          font-family: monospace;
          color: #ddd;
          line-height: 1.4;
        ">No beats detected yet. Move hand in front of camera.</div>
      </div>

      <!-- Clock & Transport Telemetry -->
      <div class="debug-section-header" style="margin-top: 10px;" title="Telemetry from the Phase-Locked Loop (PLL) Conductor Clock and look-ahead scheduler">TEMPO & SCHEDULER</div>
      <table class="debug-table">
        <tr title="Conductor tempo input mode: Mode A (Balanced PLL), Mode B (Instant/Dime), Mode C (Autoplay), Mode D (Coast & Steer)"><td>Mode</td><td id="dbg-tempo-mode" style="color:#ffd56b">A (Balanced PLL)</td></tr>
        <tr title="Estimated tempo in beats per minute calculated from your conducting gestures"><td>BPM</td><td id="dbg-bpm">0.0</td></tr>
        <tr title="Period between musical beats in milliseconds"><td>Period</td><td id="dbg-period">500.0 ms</td></tr>
        <tr title="Predicted audio timestamp of the next downbeat in Web Audio seconds"><td>Next beat (audio)</td><td id="dbg-next-beat">0.000 s</td></tr>
        <tr title="Phase error between expected beat timing and actual conductor gesture tap"><td>Phase error</td><td id="dbg-phase-error">0.0 ms</td></tr>
        <tr title="Conductor Clock PLL tracking confidence level based on tempo consistency"><td>Confidence</td><td id="dbg-confidence">0%</td></tr>
        <tr title="Total count of accepted conducting gestures in current performance"><td>Beats accepted</td><td id="dbg-beats-accepted">0</td></tr>
        <tr title="Status of the most recent conductor tap (Accepted vs Rejected for double-tap/range)"><td>Last tap</td><td id="dbg-last-tap">—</td></tr>
        <tr title="Current fractional beat cursor location in the musical score"><td>Score beat</td><td id="dbg-score-beat">0.00</td></tr>
        <tr title="Look-ahead scheduling horizon into future audio time"><td>Sched horizon</td><td id="dbg-sched-horizon">0.000 s</td></tr>
        <tr title="Total score note events committed to Web Audio synthesis"><td>Sched committed</td><td id="dbg-sched-committed">0</td></tr>
        <tr title="Hardware audio input/processing base latency"><td>Base latency</td><td id="dbg-base-lat">0.0 ms</td></tr>
        <tr title="Audio output buffer DAC latency"><td>Output latency</td><td id="dbg-out-lat">0.0 ms</td></tr>
      </table>
    `;

    return el;
  }
}
