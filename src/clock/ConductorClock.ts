/**
 * ConductorClock.ts
 *
 * PLL-inspired (Phase-Locked Loop) beat follower.
 * This is the core of the Conductor experience: it takes imperfect human
 * tap observations and produces a stable, predictive beat clock that
 * drives the audio scheduler.
 *
 * Design principles:
 *   - A tap is an observation, not an audio trigger.
 *   - The clock predicts the next beat before the player taps.
 *   - Natural jitter (~10–20 ms) should not make the orchestra wobble.
 *   - Deliberate tempo changes should become audible within 2–4 beats.
 *
 * All times in this class use two domains:
 *   - performance.now() / milliseconds — for tap timestamps from keyboard events
 *   - AudioContext.currentTime / seconds — for scheduling audio events
 *
 * The caller must supply a getAudioTime() function that returns the current
 * AudioContext time in seconds, allowing this class to stay audio-free in tests.
 */

import type { BeatObservation, ClockState, TapRejectionReason } from "./clockTypes";

// ─── Tuning constants (all documented with rationale) ──────────────────────

/**
 * Blend factor applied to the newly observed period when updating the running
 * period estimate. Lower = more stable (slow to follow tempo changes).
 * Higher = more responsive (but wobbles on jitter).
 * Range: 0–1. Design doc suggests 0.25–0.40.
 */
const TEMPO_GAIN = 0.30;

/**
 * Fraction of the phase error applied to correct the predicted beat time.
 * Prevents sudden jumps while still aligning the phase to the player.
 * Range: 0–1. Design doc suggests 0.30–0.50.
 */
const PHASE_GAIN = 0.40;

/** Minimum accepted BPM. Below this = probably an accidental pause. */
const BPM_MIN = 45;

/** Maximum accepted BPM. Above this = probably an accidental double tap. */
const BPM_MAX = 220;

/**
 * If two taps arrive within this window (ms), the second is rejected as a
 * double-tap. Set at the lower end of physical human reaction time.
 */
const DOUBLE_TAP_GUARD_MS = 80;

/**
 * If a tap interval is within this ratio of 2× the predicted period, we
 * infer the player missed one beat and divide the interval by 2.
 * E.g. 0.15 means "within 15% of 2× period".
 */
const MISSED_BEAT_RATIO_TOLERANCE = 0.15;

/**
 * After this many consecutive beats without input, the clock starts coasting
 * (continuing to predict beats without new observations). After COAST_BEATS
 * more beats, it emits a 'pause' event.
 */
const COAST_BEATS = 4;

/** After this many additional coasted beats, emit 'paused'. */
const PAUSE_AFTER_COAST_BEATS = 4;

/**
 * When a tap is received during coast/pause, we down-weight its influence
 * because the player may have been away and the interval is unreliable.
 */
const RETURN_FROM_COAST_GAIN = 0.15;

// ─── Types ─────────────────────────────────────────────────────────────────

export type ClockEventType =
  | "beat"        // A beat was accepted and the clock updated
  | "rejected"    // A tap was rejected (with reason)
  | "coasting"    // Input stopped, clock is predicting from inertia
  | "paused"      // Clock stopped after too many missed beats
  | "resumed";    // Clock resumed from paused state after new input

export type ClockEvent =
  | { type: "beat"; state: ClockState; beatNumber: number }
  | { type: "rejected"; reason: TapRejectionReason; timestampMs: number }
  | { type: "coasting"; missedBeats: number }
  | { type: "paused" }
  | { type: "resumed" };

type Listener = (event: ClockEvent) => void;

export type ConductorClockConfig = {
  /**
   * Returns AudioContext.currentTime (seconds).
   * Inject this to keep ConductorClock free of audio dependencies in tests.
   */
  getAudioTime: () => number;
  /**
   * Returns performance.now() equivalent.
   * Inject for deterministic testing.
   */
  getNow?: () => number;
  // Optional overrides for tuning constants
  tempoGain?: number;
  phaseGain?: number;
};

// ─── ConductorClock ────────────────────────────────────────────────────────

export class ConductorClock {
  // Injected dependencies
  private readonly getAudioTime: () => number;
  private readonly tempoGain: number;
  private readonly phaseGain: number;

  // Internal state
  private periodMs: number = 500;           // Default 120 BPM until calibrated
  private lastAcceptedTapMs: number = -1;   // performance.now() of last accepted tap
  private nextBeatAudioTime: number = -1;   // Predicted audio time of next beat
  private acceptedBeatCount: number = 0;
  private phaseErrorMs: number = 0;
  private confidence: number = 0;
  private missedBeats: number = 0;
  private isCoasting: boolean = false;
  private isPaused: boolean = false;
  private coastTimer: ReturnType<typeof setTimeout> | null = null;

  private listeners: Listener[] = [];

  constructor(config: ConductorClockConfig) {
    this.getAudioTime = config.getAudioTime;
    this.tempoGain = config.tempoGain ?? TEMPO_GAIN;
    this.phaseGain = config.phaseGain ?? PHASE_GAIN;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Submit a beat observation. The clock will either accept it (updating the
   * internal estimate) or reject it with a reason. Emits a ClockEvent.
   */
  acceptObservation(obs: BeatObservation): void {
    const nowMs = obs.timestampMs;
    const audioNow = this.getAudioTime();

    // ── First tap ever: just record the timestamp and wait for the second.
    if (this.lastAcceptedTapMs < 0) {
      this.lastAcceptedTapMs = nowMs;
      this.acceptedBeatCount = 1;
      this.confidence = 0.1;
      // Don't emit a beat event yet — we need two taps to establish a period.
      return;
    }

    const intervalMs = nowMs - this.lastAcceptedTapMs;

    // ── Reject: double tap guard
    if (intervalMs < DOUBLE_TAP_GUARD_MS) {
      this.emit({ type: "rejected", reason: "double_tap", timestampMs: nowMs });
      return;
    }

    // ── Infer missed beats
    // If the interval is close to 2× the current period, the player likely
    // missed one beat. Divide the interval rather than slamming the tempo.
    let beatSteps = 1;
    if (this.acceptedBeatCount > 1) {
      const twoX = this.periodMs * 2;
      if (Math.abs(intervalMs - twoX) / twoX < MISSED_BEAT_RATIO_TOLERANCE) {
        beatSteps = 2;
      }
    }

    const observedPeriod = intervalMs / beatSteps;
    const impliedBpm = 60000 / observedPeriod;

    // ── Reject: outside BPM range
    if (impliedBpm < BPM_MIN || impliedBpm > BPM_MAX) {
      this.emit({ type: "rejected", reason: "out_of_range", timestampMs: nowMs });
      return;
    }

    // ── Accept the tap ─────────────────────────────────────────────────
    this.cancelCoast();

    // Compute phase error: how far off was this tap from our prediction?
    const gain = this.isCoasting ? RETURN_FROM_COAST_GAIN : this.tempoGain;
    if (this.isCoasting || this.isPaused) {
      this.isCoasting = false;
      this.isPaused = false;
      this.missedBeats = 0;
      this.emit({ type: "resumed" });
    }

    let phaseErrorMs = 0;
    if (this.nextBeatAudioTime > 0) {
      // Convert audio time → ms for phase error computation
      const expectedMs = this.lastAcceptedTapMs + this.periodMs * beatSteps;
      phaseErrorMs = nowMs - expectedMs;
      // Clamp to ±period to avoid runaway correction
      phaseErrorMs = Math.max(-this.periodMs, Math.min(this.periodMs, phaseErrorMs));
    }

    // ── PLL update
    // Blend the running period with the new observation.
    this.periodMs = this.periodMs * (1 - gain) + observedPeriod * gain;
    // Correct phase: shift the next predicted beat time by a fraction of the error.
    const phaseCorrection = phaseErrorMs * this.phaseGain;

    // Update state
    this.phaseErrorMs = phaseErrorMs;
    this.lastAcceptedTapMs = nowMs;
    this.acceptedBeatCount++;

    // Rise confidence with consistent tapping, cap at 1.0
    this.confidence = Math.min(1.0, this.confidence + 0.15);

    // Predict next beat in audio time
    // The audio time of this tap + one period + phase correction
    const periodSec = this.periodMs / 1000;
    this.nextBeatAudioTime = audioNow + periodSec + phaseCorrection / 1000;

    this.emit({ type: "beat", state: this.getState(), beatNumber: this.acceptedBeatCount });

    // Schedule coast check
    this.scheduleCoastCheck();
  }

  /**
   * Returns the current clock state snapshot.
   */
  getState(): ClockState {
    return {
      periodMs: this.periodMs,
      bpm: 60000 / this.periodMs,
      nextBeatAudioTime: this.nextBeatAudioTime,
      phaseErrorMs: this.phaseErrorMs,
      confidence: this.confidence,
      acceptedBeatCount: this.acceptedBeatCount,
    };
  }

  /**
   * Predicted AudioContext time (seconds) of the next downbeat.
   * Call this before the beat arrives to schedule audio events ahead of time.
   */
  predictNextBeatAudioTime(): number {
    return this.nextBeatAudioTime;
  }

  /**
   * Advance the internal clock by one period (used when coasting).
   * Called by the scheduler loop, not by input events.
   */
  advanceBeat(): void {
    const periodSec = this.periodMs / 1000;
    this.nextBeatAudioTime += periodSec;
    this.missedBeats++;
    this.confidence = Math.max(0, this.confidence - 0.1);

    if (this.missedBeats === COAST_BEATS) {
      this.isCoasting = true;
      this.emit({ type: "coasting", missedBeats: this.missedBeats });
    }
    if (this.missedBeats >= COAST_BEATS + PAUSE_AFTER_COAST_BEATS) {
      this.isPaused = true;
      this.emit({ type: "paused" });
    }
  }

  /**
   * True if the clock has received at least two taps and has a valid period.
   */
  isRunning(): boolean {
    return this.acceptedBeatCount >= 2;
  }

  /**
   * True if the clock is coasting (no recent input but still predicting).
   */
  isCoastingNow(): boolean {
    return this.isCoasting;
  }

  /**
   * True if the clock has paused after too many missed beats.
   */
  isPausedNow(): boolean {
    return this.isPaused;
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
    this.cancelCoast();
    this.lastAcceptedTapMs = -1;
    this.nextBeatAudioTime = -1;
    this.acceptedBeatCount = 0;
    this.phaseErrorMs = 0;
    this.confidence = 0;
    this.missedBeats = 0;
    this.isCoasting = false;
    this.isPaused = false;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private emit(event: ClockEvent): void {
    this.listeners.forEach(l => l(event));
  }

  /**
   * Schedule a check that fires after 2 beat periods. If no new tap has
   * been received by then, start advancing the beat count (coasting).
   * This is a simplified approach — the Scheduler owns the precise timing loop.
   */
  private scheduleCoastCheck(): void {
    this.cancelCoast();
    const periodMs = this.periodMs;
    // Wait for 2 periods without input before starting to coast
    this.coastTimer = setTimeout(() => {
      if (!this.isPaused) {
        this.advanceBeat();
        // Continue checking
        this.scheduleCoastCheck();
      }
    }, periodMs * 2);
  }

  private cancelCoast(): void {
    if (this.coastTimer !== null) {
      clearTimeout(this.coastTimer);
      this.coastTimer = null;
    }
  }
}
