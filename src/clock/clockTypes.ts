/**
 * clockTypes.ts
 * Shared type definitions for the Conductor Clock subsystem.
 */

/**
 * A single observed beat from any input source.
 * The system is agnostic about whether the beat came from a keyboard or camera.
 */
export type BeatObservation = {
  source: "keyboard" | "camera";
  /** Performance.now() timestamp in milliseconds (wall clock, not AudioContext time). */
  timestampMs: number;
  /** Input confidence: 1.0 for keyboard, variable for camera. */
  confidence: number;
};

/**
 * The current internal state of the ConductorClock.
 * All times are in milliseconds unless suffixed with _s (seconds) or noted as audio time.
 */
export type ClockState = {
  /** Estimated beat period in milliseconds. */
  periodMs: number;
  /** Inferred BPM derived from periodMs. */
  bpm: number;
  /**
   * AudioContext time (seconds) of the next predicted beat.
   * This is a future time: events should be scheduled before it arrives.
   */
  nextBeatAudioTime: number;
  /** Phase correction accumulated since last tap, in milliseconds. */
  phaseErrorMs: number;
  /** Phase correction applied to alignment, in seconds. */
  phaseCorrectionSec?: number;
  /** Confidence in the current estimate [0, 1]. */
  confidence: number;
  /** How many beats have been accepted since the clock started. */
  acceptedBeatCount: number;

  // Jitter & Stability Telemetry
  /** Current jitter deadband ratio (e.g. 0.055 for 5.5%). */
  tempoDeadband?: number;
  /** Milliseconds difference between latest observed interval and established period. */
  lastJitterMs?: number;
  /** Percentage deviation of latest observed interval from established period. */
  lastJitterPercent?: number;
  /** Rolling average absolute jitter over recent beats in milliseconds. */
  averageJitterMs?: number;
  /** Rolling average absolute jitter as a percentage of established period. */
  averageJitterPercent?: number;
  /** High-level stability status of current conducting input. */
  jitterStatus?: "steady" | "accelerando" | "rallentando" | "coasting" | "calibrating";
};

/**
 * Reasons a tap can be rejected by the input filter.
 */
export type TapRejectionReason =
  | "double_tap"       // Tap interval < DOUBLE_TAP_GUARD_MS
  | "out_of_range"     // Inferred BPM outside [BPM_MIN, BPM_MAX]
  | "not_started";     // Clock hasn't received its first tap yet (used internally)
