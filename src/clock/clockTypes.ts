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
  /**
   * Confidence in the current estimate [0, 1].
   * Falls after missed beats, rises with consistent tapping.
   */
  confidence: number;
  /** How many beats have been accepted since the clock started. */
  acceptedBeatCount: number;
};

/**
 * Reasons a tap can be rejected by the input filter.
 */
export type TapRejectionReason =
  | "double_tap"       // Tap interval < DOUBLE_TAP_GUARD_MS
  | "out_of_range"     // Inferred BPM outside [BPM_MIN, BPM_MAX]
  | "not_started";     // Clock hasn't received its first tap yet (used internally)
