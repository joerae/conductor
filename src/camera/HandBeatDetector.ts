/**
 * HandBeatDetector.ts
 *
 * Permissive, bidirectional ictus and apex beat detector operating independently on each hand.
 *
 * Detects musical beats at BOTH physical inflection turnarounds:
 *   1. Bottom Turnaround (Downbeat / Trough): Transition from downward descent to upward ascent.
 *   2. Top Turnaround (Upbeat / Apex): Transition from upward ascent to downward descent.
 *
 * A continuous bouncing gesture (down-up-down-up) produces two beats per cycle
 * (one at the lowest point, one at the apex), mirroring natural conducting and baton physics.
 */

import type { MotionSample } from "./HandMotionFilter";

export type BeatInflectionType = "trough" | "apex";

export interface CandidateBeat {
  handIndex: number;
  timestampMs: number;
  confidence: number;
  amplitude: number;
  peakVelocity: number;
  direction: BeatInflectionType;
  x: number;
  y: number;
}

export interface BeatDetectorConfig {
  /** Minimum downward/upward velocity to arm a stroke (default ~0.20). */
  minStrokeVelocity: number;
  /** Minimum stroke displacement distance to qualify as a beat (default ~0.030). */
  minStrokeAmplitude: number;
  /** Minimum reversal distance to confirm turnaround (default ~0.012). */
  turnaroundThreshold: number;
  /** Per-hand refractory period in ms between beats (default ~100ms, allows 300+ BPM). */
  refractoryMs: number;
  /** Maximum duration of a half-stroke before timing out in ms (default ~900ms). */
  maxStrokeDurationMs: number;
}

export const DEFAULT_DETECTOR_CONFIG: BeatDetectorConfig = {
  minStrokeVelocity: 0.20,
  minStrokeAmplitude: 0.030,
  turnaroundThreshold: 0.012,
  refractoryMs: 100,
  maxStrokeDurationMs: 900,
};

export type MotionDirection = "DOWN" | "UP" | "IDLE";

export interface HandTrackerDebug {
  handIndex: number;
  direction: MotionDirection;
  currentY: number;
  currentVy: number;
  peakY: number;
  troughY: number;
  lastBeatType?: BeatInflectionType;
  lastBeatTimeMs: number;
}

interface HandKinematicsTracker {
  direction: MotionDirection;
  strokeStartTimeMs: number;
  peakY: number;
  peakTimeMs: number;
  troughY: number;
  troughTimeMs: number;
  peakDownwardVy: number;
  peakUpwardVy: number;
  lastBeatType?: BeatInflectionType;
  lastBeatTimeMs: number;
  lastY: number;
  lastVy: number;
}

export class HandBeatDetector {
  private config: BeatDetectorConfig;
  private trackers: Map<number, HandKinematicsTracker> = new Map();

  constructor(config?: Partial<BeatDetectorConfig>) {
    this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config };
  }

  /**
   * Processes a motion sample for a given hand and returns a candidate beat if an ictus or apex is detected.
   */
  processSample(sample: MotionSample, handIndex: number): CandidateBeat | null {
    let tracker = this.trackers.get(handIndex);
    if (!tracker) {
      tracker = {
        direction: "IDLE",
        strokeStartTimeMs: sample.timestampMs,
        peakY: sample.y,
        peakTimeMs: sample.timestampMs,
        troughY: sample.y,
        troughTimeMs: sample.timestampMs,
        peakDownwardVy: 0,
        peakUpwardVy: 0,
        lastBeatTimeMs: 0,
        lastY: sample.y,
        lastVy: sample.vy,
      };
      this.trackers.set(handIndex, tracker);
    }

    const y = sample.y;
    const vy = sample.vy; // Negative = moving down in conductor space, Positive = moving up
    const now = sample.timestampMs;

    tracker.lastY = y;
    tracker.lastVy = vy;

    // Refractory guard
    const inRefractory = now - tracker.lastBeatTimeMs < this.config.refractoryMs;

    // ── Update Extremas ───────────────────────────────────────────────────────
    if (tracker.direction === "DOWN") {
      if (y < tracker.troughY) {
        tracker.troughY = y;
        tracker.troughTimeMs = now;
      }
      if (Math.abs(vy) > tracker.peakDownwardVy) {
        tracker.peakDownwardVy = Math.abs(vy);
      }
    } else if (tracker.direction === "UP") {
      if (y > tracker.peakY) {
        tracker.peakY = y;
        tracker.peakTimeMs = now;
      }
      if (vy > tracker.peakUpwardVy) {
        tracker.peakUpwardVy = vy;
      }
    } else {
      // IDLE
      tracker.peakY = Math.max(tracker.peakY, y);
      tracker.troughY = Math.min(tracker.troughY, y);
    }

    // ── Direction State Transitions & Turnaround Detection ──────────────────

    // 1. Moving DOWNWARD
    if (tracker.direction === "DOWN") {
      // Check for Bottom Turnaround (Downbeat / Trough):
      // The hand stopped descending and moved upward by turnaroundThreshold OR velocity has crossed positive
      const upwardRebound = y - tracker.troughY;
      const isReversingUpward = upwardRebound >= this.config.turnaroundThreshold || (vy > 0.08 && upwardRebound >= 0.006);

      if (isReversingUpward && !inRefractory) {
        const strokeAmplitude = tracker.peakY - tracker.troughY;

        if (strokeAmplitude >= this.config.minStrokeAmplitude) {
          // Valid Bottom Downbeat Beat!
          const ampRatio = Math.min(1.0, strokeAmplitude / (this.config.minStrokeAmplitude * 2.0));
          const velRatio = Math.min(1.0, tracker.peakDownwardVy / (this.config.minStrokeVelocity * 2.0));
          const confidence = Math.max(0.65, Math.min(1.0, 0.40 + 0.35 * ampRatio + 0.25 * velRatio));

          const candidate: CandidateBeat = {
            handIndex,
            timestampMs: tracker.troughTimeMs || now,
            confidence: Math.round(confidence * 100) / 100,
            amplitude: Math.round(strokeAmplitude * 1000) / 1000,
            peakVelocity: Math.round(tracker.peakDownwardVy * 100) / 100,
            direction: "trough",
            x: sample.x,
            y: tracker.troughY,
          };

          // Switch state to UP for next phase
          tracker.direction = "UP";
          tracker.lastBeatType = "trough";
          tracker.lastBeatTimeMs = now;
          tracker.peakY = y;
          tracker.peakTimeMs = now;
          tracker.peakUpwardVy = 0;
          tracker.strokeStartTimeMs = now;
          return candidate;
        } else {
          // Insufficient amplitude -> switch to UP without beat
          tracker.direction = "UP";
          tracker.peakY = y;
          tracker.strokeStartTimeMs = now;
        }
      }

      // Timeout check
      if (now - tracker.strokeStartTimeMs > this.config.maxStrokeDurationMs) {
        tracker.direction = "IDLE";
      }

      return null;
    }

    // 2. Moving UPWARD
    if (tracker.direction === "UP") {
      // Check for Top Turnaround (Upbeat / Apex):
      // The hand stopped ascending and moved downward by turnaroundThreshold OR velocity has crossed negative
      const downwardDrop = tracker.peakY - y;
      const isReversingDownward = downwardDrop >= this.config.turnaroundThreshold || (vy < -0.08 && downwardDrop >= 0.006);

      if (isReversingDownward && !inRefractory) {
        const strokeAmplitude = tracker.peakY - tracker.troughY;

        if (strokeAmplitude >= this.config.minStrokeAmplitude) {
          // Valid Top Apex Beat!
          const ampRatio = Math.min(1.0, strokeAmplitude / (this.config.minStrokeAmplitude * 2.0));
          const velRatio = Math.min(1.0, tracker.peakUpwardVy / (this.config.minStrokeVelocity * 2.0));
          const confidence = Math.max(0.65, Math.min(1.0, 0.40 + 0.35 * ampRatio + 0.25 * velRatio));

          const candidate: CandidateBeat = {
            handIndex,
            timestampMs: tracker.peakTimeMs || now,
            confidence: Math.round(confidence * 100) / 100,
            amplitude: Math.round(strokeAmplitude * 1000) / 1000,
            peakVelocity: Math.round(tracker.peakUpwardVy * 100) / 100,
            direction: "apex",
            x: sample.x,
            y: tracker.peakY,
          };

          // Switch state to DOWN for next phase
          tracker.direction = "DOWN";
          tracker.lastBeatType = "apex";
          tracker.lastBeatTimeMs = now;
          tracker.troughY = y;
          tracker.troughTimeMs = now;
          tracker.peakDownwardVy = 0;
          tracker.strokeStartTimeMs = now;
          return candidate;
        } else {
          // Insufficient amplitude -> switch to DOWN without beat
          tracker.direction = "DOWN";
          tracker.troughY = y;
          tracker.strokeStartTimeMs = now;
        }
      }

      // Timeout check
      if (now - tracker.strokeStartTimeMs > this.config.maxStrokeDurationMs) {
        tracker.direction = "IDLE";
      }

      return null;
    }

    // 3. IDLE: Arm initial DOWN or UP motion
    if (tracker.direction === "IDLE") {
      if (vy < -this.config.minStrokeVelocity) {
        tracker.direction = "DOWN";
        tracker.strokeStartTimeMs = now;
        tracker.peakY = y;
        tracker.troughY = y;
        tracker.peakDownwardVy = Math.abs(vy);
      } else if (vy > this.config.minStrokeVelocity) {
        tracker.direction = "UP";
        tracker.strokeStartTimeMs = now;
        tracker.troughY = y;
        tracker.peakY = y;
        tracker.peakUpwardVy = vy;
      }
    }

    return null;
  }

  getDebugSnapshot(): HandTrackerDebug[] {
    const result: HandTrackerDebug[] = [];
    this.trackers.forEach((tracker, handIndex) => {
      result.push({
        handIndex,
        direction: tracker.direction,
        currentY: Math.round(tracker.lastY * 100) / 100,
        currentVy: Math.round(tracker.lastVy * 100) / 100,
        peakY: Math.round(tracker.peakY * 100) / 100,
        troughY: Math.round(tracker.troughY * 100) / 100,
        lastBeatType: tracker.lastBeatType,
        lastBeatTimeMs: tracker.lastBeatTimeMs,
      });
    });
    return result;
  }

  reset(): void {
    this.trackers.clear();
  }
}
