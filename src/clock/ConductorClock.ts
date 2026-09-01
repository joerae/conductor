/**
 * ConductorClock.ts
 *
 * Beat follower and predicted pulse tracker with four operating modes:
 *   - Mode A (Balanced): Blends tempo with inertia over ~3-4 beats, absorbing finger jitter.
 *   - Mode B (Instant / On a Dime): Super-responsive to deliberate tempo cuts and accelerandos.
 *   - Mode C (Autoplay): Tap Space twice to set pulse, plays continuously at tempo without stopping.
 *   - Mode D (Inertial / Predicted Conducting): Designed for sparse conducting pulses (e.g. 2 score
 *     beats per conducted pulse), seamlessly maintaining tempo through missed beats / gesture gaps,
 *     distinguishing phase error vs tempo change, and smoothly re-anchoring when conducting resumes.
 */

import type { BeatObservation, ClockState, TapRejectionReason } from "./clockTypes";

// ─── Tuning constants ────────────────────────────────────────────────────────

/**
 * Blend factor for tempo updates in Mode A. Higher = follows deliberate changes faster
 * but is more sensitive to jitter. 0.35 gives a smooth, natural response.
 */
const TEMPO_GAIN = 0.35;

/**
 * Fraction of phase error applied to correct the predicted beat time and transport phase.
 */
const PHASE_GAIN = 0.40;

/** Minimum accepted BPM for conducted pulses (allows slow half-note conducting down to 40 score BPM). */
const BPM_MIN = 20;

/** Maximum accepted BPM. */
const BPM_MAX = 280;

/** Guard against accidental keyboard bounce or sensor noise. */
const DOUBLE_TAP_GUARD_MS = 80;

/** Stop after this many silent beat periods in human conducting modes A and B. */
const STOP_AFTER_PERIODS = 3.0;

// ─── Types ───────────────────────────────────────────────────────────────────

export type TempoMode = "balanced" | "instant" | "autoplay" | "inertial";

export type ClockEventType = "beat" | "rejected" | "stopped";

export type ClockEvent =
  | { type: "beat"; state: ClockState; beatNumber: number }
  | { type: "rejected"; reason: TapRejectionReason; timestampMs: number }
  | { type: "stopped" };

type Listener = (event: ClockEvent) => void;

export type ConductorClockConfig = {
  getAudioTime: () => number;
  tempoGain?: number;
  phaseGain?: number;
  initialMode?: TempoMode;
};

// ─── ConductorClock ──────────────────────────────────────────────────────────

export class ConductorClock {
  private readonly getAudioTime: () => number;
  private readonly tempoGain: number;
  private readonly phaseGain: number;
  private mode: TempoMode = "balanced";

  // Internal state
  private periodMs: number = 500;          // Default 120 BPM until calibrated
  private lastAcceptedTapMs: number = -1;  // performance.now() timestamp of last accepted tap
  private prevIntervalMs: number = 500;
  private nextBeatAudioTime: number = -1;  // Predicted AudioContext time of next beat (seconds)
  private acceptedBeatCount: number = 0;
  private phaseErrorMs: number = 0;
  private phaseCorrectionSec: number = 0;
  private confidence: number = 0;

  private listeners: Listener[] = [];
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private autoplayTimer: ReturnType<typeof setTimeout> | null = null;
  private inertialTimer: ReturnType<typeof setTimeout> | null = null;
  private inertialFreeWheelCount: number = 0;

  constructor(config: ConductorClockConfig) {
    this.getAudioTime = config.getAudioTime;
    this.tempoGain = config.tempoGain ?? TEMPO_GAIN;
    this.phaseGain = config.phaseGain ?? PHASE_GAIN;
    this.mode = config.initialMode ?? "balanced";
  }

  /** Set the tempo following mode: 'balanced', 'instant', 'autoplay', or 'inertial' */
  setTempoMode(mode: TempoMode): void {
    const prevMode = this.mode;
    this.mode = mode;

    if (this.isRunning()) {
      if (mode === "autoplay" && prevMode !== "autoplay") {
        this.cancelStopTimer();
        this.cancelInertialLoop();
        this.startAutoplayLoop();
      } else if (mode === "inertial" && prevMode !== "inertial") {
        this.cancelAutoplayLoop();
        this.cancelStopTimer();
        this.startInertialLoop();
      } else if (mode !== "autoplay" && mode !== "inertial") {
        this.cancelAutoplayLoop();
        this.cancelInertialLoop();
        this.scheduleStopTimer();
      }
    }
  }

  getTempoMode(): TempoMode {
    return this.mode;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Submit a beat observation. Accepts or rejects it, updates state, emits event.
   */
  acceptObservation(obs: BeatObservation): void {
    const nowMs = obs.timestampMs;
    const audioNow = this.getAudioTime();

    // ── First tap: record timestamp and wait for a second tap to establish period.
    if (this.lastAcceptedTapMs < 0) {
      this.lastAcceptedTapMs = nowMs;
      this.acceptedBeatCount = 1;
      this.confidence = 0.1;
      return;
    }

    const elapsedMs = nowMs - this.lastAcceptedTapMs;

    // ── Reject: double-tap (keyboard bounce or sensor bounce)
    if (elapsedMs < DOUBLE_TAP_GUARD_MS) {
      this.emit({ type: "rejected", reason: "double_tap", timestampMs: nowMs });
      return;
    }

    // ── Mode D (Inertial / Predicted Sparse Conducting Pulses) ────────────────
    if (this.mode === "inertial") {
      if (this.acceptedBeatCount === 1) {
        // Second tap: establish initial conducting pulse period
        const impliedBpm = 60000 / elapsedMs;
        if (impliedBpm < BPM_MIN || impliedBpm > BPM_MAX) {
          if (impliedBpm < BPM_MIN) {
            this.lastAcceptedTapMs = nowMs;
            this.acceptedBeatCount = 1;
            this.confidence = 0.1;
          }
          this.emit({ type: "rejected", reason: "out_of_range", timestampMs: nowMs });
          return;
        }

        this.periodMs = elapsedMs;
        this.prevIntervalMs = elapsedMs;
        this.phaseErrorMs = 0;
        this.phaseCorrectionSec = 0;
        this.lastAcceptedTapMs = nowMs;
        this.acceptedBeatCount = 2;
        this.confidence = 0.6;
        this.inertialFreeWheelCount = 0;

        const periodSec = this.periodMs / 1000;
        this.nextBeatAudioTime = audioNow + periodSec;
        this.emit({ type: "beat", state: this.getState(), beatNumber: 2 });
        this.startInertialLoop();
        return;
      }

      // Mode D running: associate observation with most plausible predicted pulse
      const pulsesElapsed = Math.max(1, Math.round(elapsedMs / this.periodMs));
      const impliedIntervalMs = elapsedMs / pulsesElapsed;
      const impliedBpm = 60000 / impliedIntervalMs;

      if (impliedBpm < BPM_MIN || impliedBpm > BPM_MAX) {
        if (impliedBpm < BPM_MIN) {
          this.lastAcceptedTapMs = nowMs;
          this.acceptedBeatCount = 1;
          this.confidence = 0.1;
          this.cancelInertialLoop();
        }
        this.emit({ type: "rejected", reason: "out_of_range", timestampMs: nowMs });
        return;
      }

      // Predicted timestamp for the N-th pulse
      const predictedTimeMs = this.lastAcceptedTapMs + pulsesElapsed * this.periodMs;
      let phaseErrorMs = nowMs - predictedTimeMs;
      const maxPhaseError = this.periodMs * 0.5;
      phaseErrorMs = Math.max(-maxPhaseError, Math.min(maxPhaseError, phaseErrorMs));

      const isGap = pulsesElapsed >= 2;

      if (isGap) {
        // Re-entry after a gap (conductor was shaping dynamics / pausing beats):
        // Correct phase towards observed beat, anchor pulse timeline, keep tempo stable.
        const phaseCorrectionMs = phaseErrorMs * 0.40;
        this.phaseCorrectionSec = phaseCorrectionMs / 1000;
        // Subtle drift absorption if implied interval is very close
        if (Math.abs(impliedIntervalMs - this.periodMs) / this.periodMs < 0.12) {
          this.periodMs = this.periodMs * 0.92 + impliedIntervalMs * 0.08;
        }
      } else {
        // Consecutive beat (pulsesElapsed === 1)
        const phaseCorrectionMs = phaseErrorMs * 0.35;
        this.phaseCorrectionSec = phaseCorrectionMs / 1000;

        // Smooth high-inertia tempo update
        this.periodMs = this.periodMs * 0.75 + elapsedMs * 0.25;
      }

      this.phaseErrorMs = phaseErrorMs;
      this.lastAcceptedTapMs = nowMs;
      this.acceptedBeatCount += pulsesElapsed;
      this.inertialFreeWheelCount = 0;
      this.confidence = Math.min(1.0, this.confidence + 0.15);

      const periodSec = this.periodMs / 1000;
      this.nextBeatAudioTime = audioNow + periodSec + this.phaseCorrectionSec;

      this.emit({ type: "beat", state: this.getState(), beatNumber: this.acceptedBeatCount });
      this.startInertialLoop();
      return;
    }

    // ── Modes A, B, C Handling ────────────────────────────────────────────────
    let intervalMs = elapsedMs;

    // Reject: outside plausible BPM range
    const impliedBpm = 60000 / intervalMs;
    if (impliedBpm < BPM_MIN || impliedBpm > BPM_MAX) {
      if (impliedBpm < BPM_MIN) {
        this.lastAcceptedTapMs = nowMs;
        this.acceptedBeatCount = 1;
        this.confidence = 0.1;
        this.cancelAutoplayLoop();
        this.cancelInertialLoop();
      }
      this.emit({ type: "rejected", reason: "out_of_range", timestampMs: nowMs });
      return;
    }

    this.cancelStopTimer();

    // Compute phase error
    let phaseErrorMs = 0;
    if (this.nextBeatAudioTime > 0 && this.acceptedBeatCount >= 2) {
      phaseErrorMs = (audioNow - this.nextBeatAudioTime) * 1000;
      const maxPhaseError = this.periodMs * 0.5;
      phaseErrorMs = Math.max(-maxPhaseError, Math.min(maxPhaseError, phaseErrorMs));
    }

    if (this.mode === "autoplay") {
      this.periodMs = intervalMs;
      this.prevIntervalMs = intervalMs;
      this.phaseCorrectionSec = 0;
    } else if (this.mode === "instant") {
      if (this.acceptedBeatCount === 1) {
        this.periodMs = intervalMs;
        this.prevIntervalMs = intervalMs;
      } else {
        this.periodMs = intervalMs * 0.85 + this.prevIntervalMs * 0.15;
        this.prevIntervalMs = intervalMs;
      }
      const phaseCorrectionMs = phaseErrorMs * 0.85;
      this.phaseCorrectionSec = phaseCorrectionMs / 1000;
    } else {
      // Mode A: Balanced PLL
      if (this.acceptedBeatCount === 1) {
        this.periodMs = intervalMs;
        this.prevIntervalMs = intervalMs;
      } else {
        this.periodMs = this.periodMs * (1 - this.tempoGain) + intervalMs * this.tempoGain;
      }
      const phaseCorrectionMs = phaseErrorMs * this.phaseGain;
      this.phaseCorrectionSec = phaseCorrectionMs / 1000;
    }

    this.phaseErrorMs = phaseErrorMs;
    this.lastAcceptedTapMs = nowMs;
    this.acceptedBeatCount++;
    this.confidence = Math.min(1.0, this.confidence + 0.15);

    const periodSec = this.periodMs / 1000;
    this.nextBeatAudioTime = audioNow + periodSec + this.phaseCorrectionSec;

    this.emit({ type: "beat", state: this.getState(), beatNumber: this.acceptedBeatCount });

    if (this.mode === "autoplay") {
      this.startAutoplayLoop();
    } else {
      this.scheduleStopTimer();
    }
  }

  /** Current clock state snapshot. */
  getState(): ClockState {
    return {
      periodMs: this.periodMs,
      bpm: 60000 / this.periodMs,
      nextBeatAudioTime: this.nextBeatAudioTime,
      phaseErrorMs: this.phaseErrorMs,
      phaseCorrectionSec: this.phaseCorrectionSec,
      confidence: this.confidence,
      acceptedBeatCount: this.acceptedBeatCount,
    };
  }

  /**
   * Predicted AudioContext time (seconds) of the next beat.
   */
  predictNextBeatAudioTime(): number {
    return this.nextBeatAudioTime;
  }

  /**
   * True if the clock has received at least two taps and has a valid period.
   */
  isRunning(): boolean {
    return this.acceptedBeatCount >= 2;
  }

  /**
   * Subscribe to clock events. Returns an unsubscribe function.
   */
  on(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /** Reset the clock to its initial state. */
  reset(): void {
    this.cancelStopTimer();
    this.cancelAutoplayLoop();
    this.cancelInertialLoop();
    this.lastAcceptedTapMs = -1;
    this.nextBeatAudioTime = -1;
    this.acceptedBeatCount = 0;
    this.phaseErrorMs = 0;
    this.phaseCorrectionSec = 0;
    this.confidence = 0;
    this.inertialFreeWheelCount = 0;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private emit(event: ClockEvent): void {
    this.listeners.forEach(l => l(event));
  }

  /**
   * In Autoplay mode, generates continuous periodic beat events on every periodMs.
   */
  private startAutoplayLoop(): void {
    this.cancelAutoplayLoop();
    if (this.mode !== "autoplay" || this.acceptedBeatCount < 2) return;

    const scheduleNext = () => {
      this.autoplayTimer = setTimeout(() => {
        if (this.mode !== "autoplay" || this.acceptedBeatCount < 2) return;

        const audioNow = this.getAudioTime();
        const periodSec = this.periodMs / 1000;
        this.nextBeatAudioTime = audioNow + periodSec;
        this.acceptedBeatCount++;

        this.emit({
          type: "beat",
          state: this.getState(),
          beatNumber: this.acceptedBeatCount,
        });

        scheduleNext();
      }, this.periodMs);
    };

    scheduleNext();
  }

  private cancelAutoplayLoop(): void {
    if (this.autoplayTimer !== null) {
      clearTimeout(this.autoplayTimer);
      this.autoplayTimer = null;
    }
  }

  /**
   * In Mode D (Inertial / Predicted Conducting), carries the tempo forward through missed beats
   * without halting, allowing steer & release conducting.
   */
  private startInertialLoop(): void {
    this.cancelInertialLoop();
    if (this.mode !== "inertial" || this.acceptedBeatCount < 2) return;

    const scheduleNext = () => {
      this.inertialTimer = setTimeout(() => {
        if (this.mode !== "inertial" || this.acceptedBeatCount < 2) return;

        this.inertialFreeWheelCount++;
        // If conductor has not conducted for 64 pulses (~60-120 seconds), gently halt
        if (this.inertialFreeWheelCount > 64) {
          this.reset();
          this.emit({ type: "stopped" });
          return;
        }

        const audioNow = this.getAudioTime();
        const periodSec = this.periodMs / 1000;
        this.nextBeatAudioTime = audioNow + periodSec;
        this.acceptedBeatCount++;
        this.confidence = Math.max(0.40, this.confidence - 0.015);

        this.emit({
          type: "beat",
          state: this.getState(),
          beatNumber: this.acceptedBeatCount,
        });

        scheduleNext();
      }, this.periodMs);
    };

    scheduleNext();
  }

  private cancelInertialLoop(): void {
    if (this.inertialTimer !== null) {
      clearTimeout(this.inertialTimer);
      this.inertialTimer = null;
    }
  }

  private scheduleStopTimer(): void {
    this.cancelStopTimer();
    if (this.mode === "autoplay" || this.mode === "inertial") return;

    this.stopTimer = setTimeout(() => {
      this.reset();
      this.emit({ type: "stopped" });
    }, this.periodMs * STOP_AFTER_PERIODS);
  }

  private cancelStopTimer(): void {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }
}
