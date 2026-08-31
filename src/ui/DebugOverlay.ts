/**
 * DebugOverlay.ts
 *
 * Real-time diagnostic overlay for the Conductor experience.
 * Shows the internal state of ConductorClock, ScoreTransport, and Scheduler.
 *
 * Toggle visibility with the D key (hidden by default).
 *
 * Exposes all telemetry listed in design doc §10:
 *   - Inferred BPM
 *   - Beat period
 *   - Predicted next beat time
 *   - Phase error (ms)
 *   - Tap accepted/rejected + reason
 *   - Conductor confidence
 *   - Score beat position
 *   - Scheduler horizon and queued event count
 *   - AudioContext base/output latency
 */

import type { ClockState, TapRejectionReason } from "../clock/clockTypes";

interface DebugSnapshot {
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
}

export class DebugOverlay {
  private container: HTMLElement;
  private visible: boolean = false;
  private snapshot: DebugSnapshot = {
    bpm: 0, periodMs: 500, nextBeatAudioTime: 0, phaseErrorMs: 0,
    confidence: 0, acceptedBeatCount: 0, lastTapStatus: "—",
    scoreBeat: 0, schedulerHorizon: 0, schedulerCommitted: 0,
    audioLatencyMs: 0, audioOutputLatencyMs: 0,
  };

  constructor() {
    this.container = this.createContainer();
    document.body.appendChild(this.container);

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyD" && !e.repeat) {
        this.toggle();
      }
    });

    // Render loop
    this.renderLoop();
  }

  // ── Update methods (called by ExperienceController) ─────────────────────

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
    this.container.innerHTML = `
      <div class="debug-title">DEBUG (D to hide)</div>
      <table class="debug-table">
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
      background: rgba(0,0,0,0.85);
      color: #a0f0a0;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 12px;
      padding: 12px 16px;
      border-radius: 8px;
      border: 1px solid rgba(100,200,100,0.3);
      min-width: 240px;
      backdrop-filter: blur(8px);
    `;
    return el;
  }
}
