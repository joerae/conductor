/**
 * HandBeatDetector.ts
 *
 * Permissive ictus and inflection beat detector operating independently on each hand.
 *
 * Identifies a musical beat by analyzing the physical kinematics of a conducting stroke:
 *   1. Downward stroke phase: hand accelerates downward (vy < -threshold).
 *   2. Bottom inflection / turning point: downward motion decelerates and reverses (vy crosses toward 0 / positive).
 *   3. Amplitude verification: stroke distance (Ypeak - Ytrough) exceeds minimum gesture threshold.
 *   4. Refractory window: prevents double-triggering on rebounded bounces (~140ms).
 */

import type { MotionSample } from "./HandMotionFilter";

export interface CandidateBeat {
  handIndex: number;
  timestampMs: number;
  confidence: number;
  amplitude: number;
  peakVelocity: number;
  x: number;
  y: number;
}

export interface BeatDetectorConfig {
  /** Minimum downward velocity in conductor units/sec to arm the stroke (default ~0.35). */
  minDownwardVelocity: number;
  /** Minimum stroke height distance in conductor units (default ~0.045). */
  minStrokeAmplitude: number;
  /** Per-hand refractory period in ms (default ~140ms, allows up to 240+ BPM). */
  refractoryMs: number;
  /** Maximum duration of a downward stroke before timeout in ms (default ~800ms). */
  maxStrokeDurationMs: number;
}

export const DEFAULT_DETECTOR_CONFIG: BeatDetectorConfig = {
  minDownwardVelocity: 0.35,
  minStrokeAmplitude: 0.045,
  refractoryMs: 140,
  maxStrokeDurationMs: 800,
};

interface HandStrokeTracker {
  isArmed: boolean;
  strokeStartTimeMs: number;
  peakY: number;
  troughY: number;
  peakDownwardVy: number;
  lastBeatTimeMs: number;
}

export class HandBeatDetector {
  private config: BeatDetectorConfig;
  private trackers: Map<number, HandStrokeTracker> = new Map();
  private prevSamples: Map<number, MotionSample> = new Map();

  constructor(config?: Partial<BeatDetectorConfig>) {
    this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config };
  }

  /**
   * Processes a motion sample for a given hand and returns a candidate beat if an ictus is detected.
   */
  processSample(sample: MotionSample, handIndex: number): CandidateBeat | null {
    let tracker = this.trackers.get(handIndex);
    if (!tracker) {
      tracker = {
        isArmed: false,
        strokeStartTimeMs: 0,
        peakY: sample.y,
        troughY: sample.y,
        peakDownwardVy: 0,
        lastBeatTimeMs: 0,
      };
      this.trackers.set(handIndex, tracker);
    }

    const prev = this.prevSamples.get(handIndex);
    this.prevSamples.set(handIndex, sample);

    // Refractory guard
    if (sample.timestampMs - tracker.lastBeatTimeMs < this.config.refractoryMs) {
      return null;
    }

    const vy = sample.vy; // Negative = moving down in conductor space, Positive = moving up

    // ── Phase 1: Arming Downward Stroke ──────────────────────────────────────
    if (!tracker.isArmed) {
      if (vy < -this.config.minDownwardVelocity) {
        // Hand is moving downward with significant velocity
        tracker.isArmed = true;
        tracker.strokeStartTimeMs = sample.timestampMs;
        tracker.peakY = prev ? Math.max(prev.y, sample.y) : sample.y;
        tracker.troughY = sample.y;
        tracker.peakDownwardVy = Math.abs(vy);
      }
      return null;
    }

    // ── Phase 2: Downward Stroke in Progress ─────────────────────────────────
    // Stroke timeout check
    if (sample.timestampMs - tracker.strokeStartTimeMs > this.config.maxStrokeDurationMs) {
      tracker.isArmed = false;
      return null;
    }

    // Track lowest point reached and maximum downward velocity
    if (sample.y < tracker.troughY) {
      tracker.troughY = sample.y;
    }
    if (Math.abs(vy) > tracker.peakDownwardVy) {
      tracker.peakDownwardVy = Math.abs(vy);
    }

    // ── Phase 3: Bottom Inflection / Reversal Detection (The Ictus) ──────────
    // The ictus occurs when downward velocity decelerates sharply near the bottom
    // and reverses upward (vy >= -0.05 or positive).
    const isInflection = vy >= -0.05 || (prev && prev.vy < -0.20 && vy > prev.vy + 0.25);

    if (isInflection) {
      const strokeAmplitude = tracker.peakY - tracker.troughY;

      if (strokeAmplitude >= this.config.minStrokeAmplitude) {
        // Calculate confidence based on stroke clarity (amplitude and speed)
        const ampRatio = Math.min(1.0, strokeAmplitude / (this.config.minStrokeAmplitude * 2.5));
        const velRatio = Math.min(1.0, tracker.peakDownwardVy / (this.config.minDownwardVelocity * 2.0));
        const confidence = Math.max(0.60, Math.min(1.0, 0.40 + 0.35 * ampRatio + 0.25 * velRatio));

        const candidate: CandidateBeat = {
          handIndex,
          timestampMs: sample.timestampMs,
          confidence: Math.round(confidence * 100) / 100,
          amplitude: Math.round(strokeAmplitude * 1000) / 1000,
          peakVelocity: Math.round(tracker.peakDownwardVy * 100) / 100,
          x: sample.x,
          y: sample.y,
        };

        // Reset tracker and set refractory timestamp
        tracker.isArmed = false;
        tracker.lastBeatTimeMs = sample.timestampMs;
        return candidate;
      } else {
        // Below amplitude threshold -> disarm without emitting beat
        tracker.isArmed = false;
      }
    }

    return null;
  }

  reset(): void {
    this.trackers.clear();
    this.prevSamples.clear();
  }
}
