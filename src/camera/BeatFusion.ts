/**
 * BeatFusion.ts
 *
 * Fuses candidate beats from multiple hands into a unified beat observation.
 *
 * Key responsibilities:
 *   - Two-hand fusion: when left and right hands both produce a candidate within ~75ms,
 *     they merge into a single beat with high confidence (1.0).
 *   - Single-hand passthrough: works seamlessly when conducting with only one hand.
 *   - Global refractory period: prevents double-emissions across all hands.
 */

import type { BeatObservation } from "../clock/clockTypes";
import type { CandidateBeat } from "./HandBeatDetector";

export interface BeatFusionConfig {
  /** Time window in ms to merge near-simultaneous beats from two hands (~75ms). */
  fusionWindowMs: number;
  /** Global refractory period in ms across all hands (~135ms). */
  globalRefractoryMs: number;
}

export const DEFAULT_FUSION_CONFIG: BeatFusionConfig = {
  fusionWindowMs: 75,
  globalRefractoryMs: 135,
};

export class BeatFusion {
  private config: BeatFusionConfig;
  private lastEmittedTimeMs: number = 0;
  private pendingCandidate: CandidateBeat | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private callbacks: Array<(beat: BeatObservation, details?: { x: number; y: number; handCount: number }) => void> = [];

  constructor(config?: Partial<BeatFusionConfig>) {
    this.config = { ...DEFAULT_FUSION_CONFIG, ...config };
  }

  onFusedBeat(callback: (beat: BeatObservation, details?: { x: number; y: number; handCount: number }) => void): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Submits a candidate beat from a hand into the fusion pipeline.
   */
  submitCandidate(candidate: CandidateBeat, totalTrackedHands: number = 1): void {
    // Check global refractory
    if (candidate.timestampMs - this.lastEmittedTimeMs < this.config.globalRefractoryMs) {
      return;
    }

    if (totalTrackedHands <= 1) {
      // Single hand tracking: emit immediately
      this.emit(candidate.timestampMs, candidate.confidence, 1, candidate.x, candidate.y);
      return;
    }

    if (!this.pendingCandidate) {
      // Store candidate and wait briefly for the second hand
      this.pendingCandidate = candidate;
      this.pendingTimer = setTimeout(() => {
        if (this.pendingCandidate) {
          const c = this.pendingCandidate;
          this.pendingCandidate = null;
          this.pendingTimer = null;
          this.emit(c.timestampMs, c.confidence, 1, c.x, c.y);
        }
      }, this.config.fusionWindowMs);
      return;
    }

    // A candidate is already pending from another hand
    if (this.pendingCandidate.handIndex !== candidate.handIndex) {
      // Two hands agree within the fusion window! Merge them into a single beat
      const p = this.pendingCandidate;
      this.pendingCandidate = null;
      if (this.pendingTimer) {
        clearTimeout(this.pendingTimer);
        this.pendingTimer = null;
      }

      // Confidence-weighted timestamp
      const totalConf = p.confidence + candidate.confidence;
      const fusedTime = totalConf > 0
        ? (p.timestampMs * p.confidence + candidate.timestampMs * candidate.confidence) / totalConf
        : p.timestampMs;

      const fusedConf = Math.min(1.0, Math.max(p.confidence, candidate.confidence) + 0.15);
      const avgX = (p.x + candidate.x) / 2;
      const avgY = (p.y + candidate.y) / 2;

      this.emit(fusedTime, fusedConf, 2, avgX, avgY);
    }
  }

  private emit(timestampMs: number, confidence: number, handCount: number, x: number, y: number): void {
    if (timestampMs - this.lastEmittedTimeMs < this.config.globalRefractoryMs) {
      return;
    }
    this.lastEmittedTimeMs = timestampMs;

    const obs: BeatObservation = {
      source: "camera",
      timestampMs,
      confidence,
    };

    this.callbacks.forEach(cb => {
      try {
        cb(obs, { x, y, handCount });
      } catch (err) {
        console.warn("BeatFusion callback error:", err);
      }
    });
  }

  reset(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.pendingCandidate = null;
    this.lastEmittedTimeMs = 0;
  }
}
