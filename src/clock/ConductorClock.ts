/**
 * ConductorClock.ts
 *
 * PLL-inspired beat follower.
 *
 * Simplified model based on Phase 0/1 playtesting:
 *   - If a beat is not received within STOP_AFTER_PERIODS × period, the clock
 *     stops and emits "stopped". The orchestra should halt immediately.
 *   - No coasting or gradual fade — stop is binary.
 *   - Tempo gain is higher so deliberate accelerandos and ritardandos
 *     are followed within 2–3 beats, not 8–10.
 *   - BPM range is wider so fast conducting doesn't get rejected.
 *
 * ── Tuning constants (all documented with rationale) ────────────────────────
 */

import type { BeatObservation, ClockState, TapRejectionReason } from "./clockTypes";

// ─── Tuning constants ────────────────────────────────────────────────────────

/**
 * Blend factor for tempo updates. Higher = follows deliberate changes faster
 * but is more sensitive to jitter. 0.35 gives a smooth, natural response:
 * a deliberate change is followed within ~3-4 beats without twitching on jitter.
 * Range: 0–1. Design doc suggests 0.25–0.40.
 */
const TEMPO_GAIN = 0.35;

/**
 * Fraction of phase error applied to correct the predicted beat time and transport phase.
 * Snaps the clock into phase with the conductor's ictus.
 * Range: 0–1. Design doc suggests 0.30–0.50.
 */
const PHASE_GAIN = 0.40;

/**
 * Minimum accepted BPM. Below this = implausible conducting speed.
 */
const BPM_MIN = 30;

/**
 * Maximum accepted BPM. Above this = implausible conducting speed.
 */
const BPM_MAX = 280;

/**
 * Reject a tap if it arrives less than this many ms after the previous accepted tap.
 * Guards against accidental double-taps from keyboard bounce.
 */
const DOUBLE_TAP_GUARD_MS = 80;

/**
 * If no tap arrives within this many periods after the last accepted tap,
 * the clock emits "stopped" and resets itself.
 * 3.0 = 3 full beat periods of tolerance before the orchestra pauses.
 * E.g. at 120 BPM (500ms period) → pauses after 1500ms of silence.
 */
const STOP_AFTER_PERIODS = 3.0;

// ─── Types ───────────────────────────────────────────────────────────────────

export type TempoMode = "balanced" | "instant";

export type ClockEventType = "beat" | "rejected" | "stopped";

export type ClockEvent =
  | { type: "beat"; state: ClockState; beatNumber: number }
  | { type: "rejected"; reason: TapRejectionReason; timestampMs: number }
  | { type: "stopped" };

type Listener = (event: ClockEvent) => void;

export type ConductorClockConfig = {
  /**
   * Returns AudioContext.currentTime (seconds).
   * Inject to keep ConductorClock audio-free in tests.
   */
  getAudioTime: () => number;
  /** Optional overrides for tuning constants. */
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

  constructor(config: ConductorClockConfig) {
    this.getAudioTime = config.getAudioTime;
    this.tempoGain = config.tempoGain ?? TEMPO_GAIN;
    this.phaseGain = config.phaseGain ?? PHASE_GAIN;
    this.mode = config.initialMode ?? "balanced";
  }

  /** Set the tempo following mode: 'balanced' (Mode A) or 'instant' (Mode B) */
  setTempoMode(mode: TempoMode): void {
    this.mode = mode;
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
      // No beat event yet — period is not yet established.
      return;
    }

    const intervalMs = nowMs - this.lastAcceptedTapMs;

    // ── Reject: double-tap (keyboard bounce, accidental repeat)
    if (intervalMs < DOUBLE_TAP_GUARD_MS) {
      this.emit({ type: "rejected", reason: "double_tap", timestampMs: nowMs });
      return;
    }

    // ── Reject: outside plausible BPM range
    const impliedBpm = 60000 / intervalMs;
    if (impliedBpm < BPM_MIN || impliedBpm > BPM_MAX) {
      if (impliedBpm < BPM_MIN) {
        // Conductor paused or took a long gap: treat this tap as a fresh preparatory tap (Tap 1)
        // so subsequent taps establish the new tempo immediately rather than being permanently locked out!
        this.lastAcceptedTapMs = nowMs;
        this.acceptedBeatCount = 1;
        this.confidence = 0.1;
      }
      this.emit({ type: "rejected", reason: "out_of_range", timestampMs: nowMs });
      return;
    }

    // ── Accept ──────────────────────────────────────────────────────────────

    // Cancel the stop timer — a tap arrived in time.
    this.cancelStopTimer();

    // Compute phase error: compare current audio time to the previously predicted next beat
    let phaseErrorMs = 0;
    if (this.nextBeatAudioTime > 0 && this.acceptedBeatCount >= 2) {
      phaseErrorMs = (audioNow - this.nextBeatAudioTime) * 1000;
      const maxPhaseError = this.periodMs * 0.5;
      phaseErrorMs = Math.max(-maxPhaseError, Math.min(maxPhaseError, phaseErrorMs));
    }

    if (this.mode === "instant") {
      // ── Mode B: Instant / On a Dime
      // Follows the latest 2 intervals directly so tempo changes instantaneously
      if (this.acceptedBeatCount === 1) {
        this.periodMs = intervalMs;
        this.prevIntervalMs = intervalMs;
      } else {
        // Fast responsive blend (85% latest gap + 15% previous gap)
        this.periodMs = intervalMs * 0.85 + this.prevIntervalMs * 0.15;
        this.prevIntervalMs = intervalMs;
      }
      // Instant phase synchronization
      const phaseCorrectionMs = phaseErrorMs * 0.85;
      this.phaseCorrectionSec = phaseCorrectionMs / 1000;
    } else {
      // ── Mode A: Balanced PLL
      // Blends tempo smoothly with momentum over 3-4 beats
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

    // Predict next beat in AudioContext time
    const periodSec = this.periodMs / 1000;
    this.nextBeatAudioTime = audioNow + periodSec + this.phaseCorrectionSec;

    this.emit({ type: "beat", state: this.getState(), beatNumber: this.acceptedBeatCount });

    // Schedule stop timer
    this.scheduleStopTimer();
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
   * Use this to anchor the score transport before the downbeat arrives.
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

  /** Reset the clock to its initial state (called automatically on stop). */
  reset(): void {
    this.cancelStopTimer();
    this.lastAcceptedTapMs = -1;
    this.nextBeatAudioTime = -1;
    this.acceptedBeatCount = 0;
    this.phaseErrorMs = 0;
    this.confidence = 0;
    // Note: we intentionally keep periodMs so a restart can use it as an initial guess.
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private emit(event: ClockEvent): void {
    this.listeners.forEach(l => l(event));
  }

  /**
   * Start a stop timer. If no tap arrives within STOP_AFTER_PERIODS × period,
   * the clock resets and emits "stopped". The experience controller should
   * halt the orchestra and return to the ready state.
   */
  private scheduleStopTimer(): void {
    this.cancelStopTimer();
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
