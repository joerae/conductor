/**
 * HandBeatDetector.ts
 *
 * Permissive ictus beat detector operating independently on each hand.
 *
 * Detection Rules:
 *   1. Bottom Turnarounds Only: Detects beats strictly at the physical trough
 *      (transition from downward descent to upward ascent). Apex / upbeat turnarounds
 *      are ignored to minimize false positives.
 *   2. Recovery Requirement: After a beat is detected, the hand enters a RECOVERING
 *      state and must travel upward by at least `recoveryThreshold` before it becomes
 *      eligible to arm another downward ictus. Small resting wobbles and expressive gestures
 *      near the bottom cannot trigger repeated false beats.
 *   3. Preserved Trough Timestamp: The exact timestamp when the hand reached the trough
 *      extrema is preserved as the candidate beat timestamp.
 *   4. Multi-Hand Permissiveness: Tracks each hand independently so either hand or
 *      alternating hands can conduct seamlessly.
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
  /** Minimum downward velocity to arm a stroke (default ~0.20). */
  minStrokeVelocity: number;
  /** Minimum stroke displacement distance to qualify as a beat (default ~0.030). */
  minStrokeAmplitude: number;
  /** Minimum reversal distance to confirm turnaround (default ~0.012). */
  turnaroundThreshold: number;
  /** Minimum upward recovery displacement required before re-arming a new stroke (default ~0.035). */
  recoveryThreshold: number;
  /** Per-hand refractory period in ms between beats (default ~100ms, allows 300+ BPM). */
  refractoryMs: number;
  /** Maximum duration of a stroke phase before timing out in ms (default ~900ms). */
  maxStrokeDurationMs: number;
}

export const DEFAULT_DETECTOR_CONFIG: BeatDetectorConfig = {
  minStrokeVelocity: 0.20,
  minStrokeAmplitude: 0.030,
  turnaroundThreshold: 0.012,
  recoveryThreshold: 0.035,
  refractoryMs: 100,
  maxStrokeDurationMs: 900,
};

export type MotionDirection = "DOWN" | "RECOVERING" | "UP" | "IDLE";

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
  recoveryStartY: number;
  peakDownwardVy: number;
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
   * Processes a motion sample for a given hand and returns a candidate beat if a bottom turnaround is detected.
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
        recoveryStartY: sample.y,
        peakDownwardVy: 0,
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
    } else if (tracker.direction === "UP" || tracker.direction === "RECOVERING") {
      if (y > tracker.peakY) {
        tracker.peakY = y;
        tracker.peakTimeMs = now;
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
            timestampMs: tracker.troughTimeMs || now, // Exact trough timestamp preserved
            confidence: Math.round(confidence * 100) / 100,
            amplitude: Math.round(strokeAmplitude * 1000) / 1000,
            peakVelocity: Math.round(tracker.peakDownwardVy * 100) / 100,
            direction: "trough",
            x: sample.x,
            y: tracker.troughY,
          };

          // Enter RECOVERING state: must move upward by recoveryThreshold before arming next stroke
          tracker.direction = "RECOVERING";
          tracker.recoveryStartY = tracker.troughY;
          tracker.lastBeatType = "trough";
          tracker.lastBeatTimeMs = now;
          tracker.peakY = y;
          tracker.peakTimeMs = now;
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

    // 2. RECOVERING (Post-beat upward rebound requirement)
    if (tracker.direction === "RECOVERING") {
      const upwardTravel = y - tracker.recoveryStartY;
      if (upwardTravel >= this.config.recoveryThreshold) {
        // Hand has recovered upward sufficiently; now eligible for next downward stroke
        tracker.direction = "UP";
        tracker.peakY = Math.max(tracker.peakY, y);
        tracker.strokeStartTimeMs = now;
      } else if (now - tracker.strokeStartTimeMs > this.config.maxStrokeDurationMs) {
        tracker.direction = "IDLE";
      }
      return null;
    }

    // 3. Moving UPWARD (or holding at top)
    if (tracker.direction === "UP") {
      if (y > tracker.peakY) {
        tracker.peakY = y;
        tracker.peakTimeMs = now;
      }

      // Arm new downward stroke when hand descends from top with sufficient velocity
      if (vy < -this.config.minStrokeVelocity && (tracker.peakY - y) >= 0.008) {
        tracker.direction = "DOWN";
        tracker.strokeStartTimeMs = now;
        tracker.troughY = y;
        tracker.troughTimeMs = now;
        tracker.peakDownwardVy = Math.abs(vy);
      } else if (now - tracker.strokeStartTimeMs > this.config.maxStrokeDurationMs) {
        tracker.direction = "IDLE";
      }

      return null;
    }

    // 4. IDLE: Arm initial DOWN or UP motion
    if (tracker.direction === "IDLE") {
      if (vy < -this.config.minStrokeVelocity) {
        tracker.direction = "DOWN";
        tracker.strokeStartTimeMs = now;
        tracker.peakY = y;
        tracker.troughY = y;
        tracker.troughTimeMs = now;
        tracker.peakDownwardVy = Math.abs(vy);
      } else if (vy > this.config.minStrokeVelocity) {
        tracker.direction = "UP";
        tracker.strokeStartTimeMs = now;
        tracker.troughY = y;
        tracker.peakY = y;
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
