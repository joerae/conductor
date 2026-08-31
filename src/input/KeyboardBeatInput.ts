/**
 * KeyboardBeatInput.ts
 *
 * Listens for Space Bar presses and emits BeatObservations.
 * This is the Phase 0 and Phase 1 primary input method.
 * The system is designed so that this can be swapped for CameraBeatInput
 * without changing any downstream code.
 *
 * Key behaviours:
 *   - Space Bar keydown (not keyup) is the trigger, for lowest latency.
 *   - Key repeat is suppressed (held-down key should not fire multiple beats).
 *   - Produces performance.now() timestamps, NOT AudioContext time.
 *     The ConductorClock is responsible for converting to audio time.
 */

import type { BeatInputProvider } from "./BeatInputProvider";
import type { BeatObservation } from "../clock/clockTypes";

export class KeyboardBeatInput implements BeatInputProvider {
  private callbacks: Array<(beat: BeatObservation) => void> = [];
  private boundHandler: ((e: KeyboardEvent) => void) | null = null;

  start(): void {
    if (this.boundHandler) return; // Already started
    this.boundHandler = this.handleKeydown.bind(this);
    window.addEventListener("keydown", this.boundHandler);
  }

  stop(): void {
    if (this.boundHandler) {
      window.removeEventListener("keydown", this.boundHandler);
      this.boundHandler = null;
    }
  }

  onBeat(callback: (beat: BeatObservation) => void): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter(cb => cb !== callback);
    };
  }

  private handleKeydown(e: KeyboardEvent): void {
    // Only Space Bar
    if (e.code !== "Space") return;
    // Suppress key-repeat (held key)
    if (e.repeat) return;
    // Prevent page scrolling
    e.preventDefault();

    const obs: BeatObservation = {
      source: "keyboard",
      timestampMs: performance.now(),
      confidence: 1.0,
    };
    this.callbacks.forEach(cb => cb(obs));
  }
}
