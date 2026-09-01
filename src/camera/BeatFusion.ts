/**
 * BeatFusion.ts
 *
 * Zero-latency fusion of multi-hand candidate beats into unified beat observations.
 *
 * Emits candidate beats immediately with zero asynchronous timer lag.
 * If both hands produce candidate beats within the fusion window (e.g. 70ms),
 * the second candidate is fused and suppressed by the global refractory window.
 */

import type { BeatObservation } from "../clock/clockTypes";
import type { CandidateBeat } from "./HandBeatDetector";

export interface BeatFusionConfig {
  /** Time window in ms to treat candidate beats from both hands as a unison beat (~75ms). */
  fusionWindowMs: number;
  /** Global refractory period in ms across all hands (~120ms). */
  globalRefractoryMs: number;
}

export const DEFAULT_FUSION_CONFIG: BeatFusionConfig = {
  fusionWindowMs: 75,
  globalRefractoryMs: 120,
};

export interface BeatEventDetails {
  x: number;
  y: number;
  handCount: number;
  direction?: "trough" | "apex";
  amplitude?: number;
  handIndex?: number;
}

export class BeatFusion {
  private config: BeatFusionConfig;
  private lastEmittedTimeMs: number = 0;
  private lastCandidate: CandidateBeat | null = null;
  private callbacks: Array<(beat: BeatObservation, details: BeatEventDetails) => void> = [];

  constructor(config?: Partial<BeatFusionConfig>) {
    this.config = { ...DEFAULT_FUSION_CONFIG, ...config };
  }

  onFusedBeat(callback: (beat: BeatObservation, details: BeatEventDetails) => void): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Submits a candidate beat from a hand into the fusion pipeline.
   * Emits immediately without async timer delay.
   */
  submitCandidate(candidate: CandidateBeat, totalTrackedHands: number = 1): void {
    const timeSinceLast = candidate.timestampMs - this.lastEmittedTimeMs;

    // Check if this candidate is from the second hand in unison with recent candidate
    if (
      this.lastCandidate &&
      this.lastCandidate.handIndex !== candidate.handIndex &&
      timeSinceLast < this.config.fusionWindowMs
    ) {
      // Hands moved in unison; beat was already emitted on the first hand with zero lag!
      this.lastCandidate = candidate;
      return;
    }

    // Global refractory period
    if (timeSinceLast < this.config.globalRefractoryMs) {
      return;
    }

    this.lastEmittedTimeMs = candidate.timestampMs;
    this.lastCandidate = candidate;

    const obs: BeatObservation = {
      source: "camera",
      timestampMs: candidate.timestampMs,
      confidence: totalTrackedHands > 1 ? Math.min(1.0, candidate.confidence + 0.1) : candidate.confidence,
    };

    const details: BeatEventDetails = {
      x: candidate.x,
      y: candidate.y,
      handCount: totalTrackedHands,
      direction: candidate.direction,
      amplitude: candidate.amplitude,
      handIndex: candidate.handIndex,
    };

    this.callbacks.forEach(cb => {
      try {
        cb(obs, details);
      } catch (err) {
        console.warn("BeatFusion callback error:", err);
      }
    });
  }

  reset(): void {
    this.lastCandidate = null;
    this.lastEmittedTimeMs = 0;
  }
}
