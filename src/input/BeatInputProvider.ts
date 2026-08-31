/**
 * BeatInputProvider.ts
 * Abstract interface for any beat input source: keyboard, camera, MIDI pedal, etc.
 * The rest of the system must not care which source produced a beat.
 */

import type { BeatObservation } from "../clock/clockTypes";

export interface BeatInputProvider {
  /** Begin listening for beats. */
  start(): void;
  /** Stop listening and clean up. */
  stop(): void;
  /**
   * Register a callback to receive beat observations.
   * Returns an unsubscribe function.
   */
  onBeat(callback: (beat: BeatObservation) => void): () => void;
}
