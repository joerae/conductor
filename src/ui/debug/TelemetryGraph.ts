/**
 * TelemetryGraph.ts
 *
 * Real-time telemetry monitoring, kinematics tracking, and live diagnostic
 * tables for the Conductor debug overlay.
 */

import type { DynamicsTelemetry, VelocityDecomposition } from "../../audio/dynamicsTypes";
import type { CameraTelemetry } from "../../camera/cameraTypes";

export interface DebugSnapshot {
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

  // Audio Engine & Scheduler Performance Diagnostics
  activeVoicesCount: number;
  pendingCleanupCount: number;
  channelBusCount: number;
  fontEnvelopesCount: number;
  automationRequestsPerSec: number;
  schedTickMs: number;
  schedEventsExamined: number;
  schedLateEvents: number;
}

export interface ScoreVisualizerDebugTelemetry {
  isEnabled: boolean;
  isVisible: boolean;
  sectionId: string | null;
  notesCount: number;
  left: number;
  top: number;
  width: number;
  height: number;
  display: string;
  hasVisibleClass: boolean;
  zIndex: string;
}

export class TelemetryGraph {
  private beatLogLines: string[] = [];
  private lastLoggedBeatTime: number = 0;

  renderJitterTelemetryHtml(): string {
    return `
      <!-- Conductor Jitter & Stability Diagnostics -->
      <div class="debug-section-header" title="Real-time analysis of your stroke consistency, timing jitter, and deadband protection">CONDUCTOR JITTER & STABILITY</div>
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
    `;
  }

  renderVelocityDecompHtml(): string {
    return `
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
    `;
  }

  renderDynamicsTelemetryHtml(): string {
    return `
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
    `;
  }

  renderScoreVisualizerDiagnosticsHtml(): string {
    return `
      <!-- Spotlight Score Visualizer Diagnostics -->
      <div class="debug-section-header" style="margin-top: 10px;" title="Real-time rendering, pixel placement, and z-index ordering of the spotlight score visualizer">SPOTLIGHT SCORE VISUALIZER DIAGNOSTICS</div>
      <table class="debug-table">
        <tr title="Feature flag status (enabled or disabled via S key or checkbox)">
          <td>Feature Flag (S key)</td>
          <td id="dbg-score-flag" style="color:#ffd56b;">Enabled (ON)</td>
        </tr>
        <tr title="Targeted orchestra instrument section">
          <td>Target Section</td>
          <td id="dbg-score-sec">—</td>
        </tr>
        <tr title="Total notes extracted for this section in current score">
          <td>Section Notes</td>
          <td id="dbg-score-notes">0 notes</td>
        </tr>
        <tr title="Exact computed screen coordinate pixel placement (left, top, width, height)">
          <td>Pixel Placement</td>
          <td id="dbg-score-pos">—</td>
        </tr>
        <tr title="CSS position, stacking context, and z-index ordering">
          <td>Z-Index &amp; Stacking</td>
          <td id="dbg-score-z">z-index: 120 (position: fixed)</td>
        </tr>
        <tr title="Current DOM visibility state and display property">
          <td>DOM Visibility</td>
          <td id="dbg-score-state">hidden</td>
        </tr>
      </table>
    `;
  }

  renderCameraKinematicsHtml(): string {
    return `
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
    `;
  }

  renderClockTransportHtml(): string {
    return `
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
        <tr title="Currently ringing active WebAudioFont voice gain nodes"><td>Active voices</td><td id="dbg-voices-active">0</td></tr>
        <tr title="Pending audio voice nodes scheduled for fade/cleanup"><td>Pending cleanups</td><td id="dbg-voices-cleanup">0</td></tr>
        <tr title="Channel spatial stereo sub-buses"><td>Channel buses</td><td id="dbg-channel-buses">0</td></tr>
        <tr title="WebAudioFont internal envelope gain and buffer source nodes"><td>Font envelopes</td><td id="dbg-font-envelopes">0</td></tr>
        <tr title="AudioParam automation requests in the last second"><td>DSP automation req/s</td><td id="dbg-auto-reqs">0 /s</td></tr>
        <tr title="Execution duration of the most recent scheduler tick"><td>Sched tick duration</td><td id="dbg-sched-tick">0.0 ms</td></tr>
        <tr title="Number of score events examined in lookahead on last tick"><td>Sched examined/tick</td><td id="dbg-sched-examined">0</td></tr>
        <tr title="Number of score events scheduled with audioTime in the past"><td>Sched late events</td><td id="dbg-sched-late">0</td></tr>
      </table>
    `;
  }

  cacheElements(container: HTMLElement): Record<string, HTMLElement> {
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
      "decomp-track",
      "decomp-raw",
      "decomp-macro",
      "decomp-dyn",
      "decomp-final",
      "decomp-formula",
      "cam-h0",
      "cam-h1",
      "cam-last-beat",
      "cam-beat-log",
      "jitter-last",
      "jitter-avg",
      "jitter-status",
      "jitter-deadband-window",
      "voices-active",
      "voices-cleanup",
      "channel-buses",
      "font-envelopes",
      "auto-reqs",
      "sched-tick",
      "sched-examined",
      "sched-late",
      "score-flag",
      "score-sec",
      "score-notes",
      "score-pos",
      "score-z",
      "score-state",
    ];

    const elements: Record<string, HTMLElement> = {};
    keys.forEach((key) => {
      const el = container.querySelector<HTMLElement>(`#dbg-${key}`);
      if (el) elements[key] = el;
    });
    return elements;
  }

  render(snapshot: DebugSnapshot, elements: Record<string, HTMLElement>): void {
    const s = snapshot;
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

    if (elements["dyn-level"]) elements["dyn-level"].innerHTML = dynamicLabel;
    if (elements["vel-scale"]) {
      elements["vel-scale"].innerHTML = `× ${d.velocityMultiplier.toFixed(2)} (${flags.velocityScaling ? "Active" : "<span style='color:#ff8888'>Bypassed</span>"})`;
    }
    if (elements["lpf-cutoff"]) {
      elements["lpf-cutoff"].textContent = `${(d.filterCutoffHz / 1000).toFixed(1)} kHz`;
    }
    if (elements["shelf-gain"]) {
      elements["shelf-gain"].textContent = `${d.highShelfGainDb >= 0 ? "+" : ""}${d.highShelfGainDb.toFixed(1)} dB`;
    }
    if (elements["reverb-wet"]) {
      elements["reverb-wet"].textContent = `${(d.reverbWet * 100).toFixed(0)}%`;
    }
    if (elements["attack-time"]) {
      elements["attack-time"].textContent = `${(d.attackTimeSec * 1000).toFixed(0)} ms`;
    }

    // Velocity breakdown decomposition display
    if (s.lastDecomp) {
      const dec = s.lastDecomp;
      if (elements["decomp-track"]) elements["decomp-track"].textContent = s.lastDecompTrack || "Section";
      if (elements["decomp-raw"]) elements["decomp-raw"].textContent = String(dec.raw);
      if (elements["decomp-macro"]) {
        const deltaStr = dec.macroDelta >= 0 ? `+${dec.macroDelta}` : `${dec.macroDelta}`;
        elements["decomp-macro"].innerHTML = dec.macroEnabled
          ? `${dec.macro} <span style="color:#7cc5ff">(${deltaStr})</span>`
          : `${dec.raw} <span style="color:#888">(bypassed)</span>`;
      }
      if (elements["decomp-dyn"]) {
        elements["decomp-dyn"].textContent = `${dec.dynamicLevel} (×${dec.dynMultiplier.toFixed(2)})`;
      }
      if (elements["decomp-final"]) {
        elements["decomp-final"].innerHTML = `<strong style="color:#ffd56b; font-size:13px;">${dec.final}</strong>`;
      }
      if (elements["decomp-formula"]) {
        const macroStr = dec.macroEnabled ? `${dec.macro} [Δ ${dec.macroDelta >= 0 ? "+" : ""}${dec.macroDelta}]` : `${dec.raw}`;
        elements["decomp-formula"].innerHTML = `Raw ${dec.raw} ➔ Macro ${macroStr} ➔ ${dec.dynamicLevel} (×${dec.dynMultiplier.toFixed(2)}) ➔ <strong>v: ${dec.final}</strong>`;
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

    if (elements["jitter-last"]) {
      const sign = jitterMs >= 0 ? "+" : "";
      const color = Math.abs(jitterMs) <= deadbandMs ? "#a0f0a0" : jitterMs < 0 ? "#7cc5ff" : "#ffd56b";
      elements["jitter-last"].innerHTML = `<span style="color:${color}">${sign}${jitterMs.toFixed(1)} ms (${sign}${jitterPct.toFixed(1)}%)</span>`;
    }

    if (elements["jitter-avg"]) {
      const avgColor = avgJitterMs <= deadbandMs ? "#a0f0a0" : "#ffd56b";
      elements["jitter-avg"].innerHTML = `<span style="color:${avgColor}">±${avgJitterMs.toFixed(1)} ms (${avgJitterPct.toFixed(1)}%)</span>`;
    }

    if (elements["jitter-status"]) {
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
      elements["jitter-status"].innerHTML = statusHtml;
    }

    if (elements["jitter-deadband-window"]) {
      elements["jitter-deadband-window"].textContent = `±${deadbandMs.toFixed(1)} ms (±${(deadbandRatio * 100).toFixed(1)}%)`;
    }

    if (elements["tempo-mode"]) elements["tempo-mode"].textContent = s.tempoMode;
    if (elements["bpm"]) elements["bpm"].textContent = s.bpm.toFixed(1);
    if (elements["period"]) elements["period"].textContent = `${s.periodMs.toFixed(1)} ms`;
    if (elements["next-beat"]) elements["next-beat"].textContent = `${s.nextBeatAudioTime.toFixed(3)} s`;
    if (elements["phase-error"]) elements["phase-error"].textContent = `${s.phaseErrorMs.toFixed(1)} ms`;
    if (elements["confidence"]) elements["confidence"].textContent = `${(s.confidence * 100).toFixed(0)}%`;
    if (elements["beats-accepted"]) elements["beats-accepted"].textContent = String(s.acceptedBeatCount);
    if (elements["last-tap"]) elements["last-tap"].textContent = s.lastTapStatus;
    if (elements["score-beat"]) elements["score-beat"].textContent = s.scoreBeat.toFixed(2);
    if (elements["sched-horizon"]) elements["sched-horizon"].textContent = `${s.schedulerHorizon.toFixed(3)} s`;
    if (elements["sched-committed"]) elements["sched-committed"].textContent = String(s.schedulerCommitted);
    if (elements["base-lat"]) elements["base-lat"].textContent = `${s.audioLatencyMs.toFixed(1)} ms`;
    if (elements["out-lat"]) elements["out-lat"].textContent = `${s.audioOutputLatencyMs.toFixed(1)} ms`;

    // Audio Engine & Scheduler Performance Diagnostics
    if (elements["voices-active"]) elements["voices-active"].textContent = String(s.activeVoicesCount);
    if (elements["voices-cleanup"]) elements["voices-cleanup"].textContent = String(s.pendingCleanupCount);
    if (elements["channel-buses"]) elements["channel-buses"].textContent = String(s.channelBusCount);
    if (elements["font-envelopes"]) elements["font-envelopes"].textContent = String(s.fontEnvelopesCount);
    if (elements["auto-reqs"]) elements["auto-reqs"].textContent = `${s.automationRequestsPerSec} /s`;
    if (elements["sched-tick"]) elements["sched-tick"].textContent = `${s.schedTickMs.toFixed(2)} ms`;
    if (elements["sched-examined"]) elements["sched-examined"].textContent = String(s.schedEventsExamined);
    if (elements["sched-late"]) elements["sched-late"].textContent = String(s.schedLateEvents);
  }

  updateCameraTelemetry(
    telemetry: CameraTelemetry,
    elements: Record<string, HTMLElement>
  ): void {
    if (!elements["cam-h0"]) return;

    if (telemetry.beatDebug && telemetry.beatDebug.length > 0) {
      telemetry.beatDebug.forEach(h => {
        const el = h.handIndex === 0 ? elements["cam-h0"] : elements["cam-h1"];
        if (el) {
          const arrow = h.direction === "DOWN" ? "⬇️ DOWN" : h.direction === "UP" ? "⬆️ UP" : h.direction === "RECOVERING" ? "🔄 RECOVERING" : "⏹ IDLE";
          const vyColor = h.currentVy < 0 ? "#ff8888" : h.currentVy > 0 ? "#88ff88" : "#888";
          el.innerHTML = `<strong>${arrow}</strong> | Y: ${h.currentY.toFixed(2)} | Vy: <span style="color:${vyColor}">${h.currentVy >= 0 ? "+" : ""}${h.currentVy.toFixed(2)}</span> | Pk: ${h.peakY.toFixed(2)} Tr: ${h.troughY.toFixed(2)}`;
        }
      });
    }

    if (telemetry.lastBeat && elements["cam-last-beat"]) {
      const b = telemetry.lastBeat;
      const typeLabel = b.direction === "apex" ? "⬆️ TOP APEX" : "⬇️ BOTTOM TROUGH";
      const typeColor = b.direction === "apex" ? "#6be7ff" : "#ffd56b";
      elements["cam-last-beat"].innerHTML = `<strong style="color:${typeColor}">${typeLabel}</strong> (H${b.handIndex}, ΔY: ${b.amplitude.toFixed(2)})`;
    }

    if (telemetry.lastBeat && (!this.lastLoggedBeatTime || telemetry.lastBeat.timeMs > this.lastLoggedBeatTime)) {
      this.lastLoggedBeatTime = telemetry.lastBeat.timeMs;
      const b = telemetry.lastBeat;
      const logEl = elements["cam-beat-log"];
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

  updateScoreVisualizerTelemetry(
    telemetry: ScoreVisualizerDebugTelemetry,
    elements: Record<string, HTMLElement>
  ): void {
    if (elements["score-flag"]) {
      elements["score-flag"].textContent = telemetry.isEnabled ? "Enabled (ON)" : "Disabled (OFF)";
      elements["score-flag"].style.color = telemetry.isEnabled ? "#ffd56b" : "#888888";
    }
    if (elements["score-sec"]) {
      elements["score-sec"].textContent = telemetry.sectionId ? telemetry.sectionId.toUpperCase() : "—";
    }
    if (elements["score-notes"]) {
      elements["score-notes"].textContent = `${telemetry.notesCount} notes`;
    }
    if (elements["score-pos"]) {
      elements["score-pos"].textContent = telemetry.isVisible
        ? `X: ${telemetry.left}px, Y: ${telemetry.top}px (${telemetry.width}×${telemetry.height}px)`
        : "— (hidden)";
    }
    if (elements["score-z"]) {
      elements["score-z"].textContent = telemetry.zIndex;
    }
    if (elements["score-state"]) {
      elements["score-state"].innerHTML = telemetry.isVisible
        ? `<strong style="color:#5cd87e;">VISIBLE</strong> (display: ${telemetry.display})`
        : `<span style="color:#888888;">hidden (display: ${telemetry.display})</span>`;
    }
  }
}
