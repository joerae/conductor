/**
 * DynamicsEstimator.ts
 *
 * Estimates orchestral dynamic levels from the broad vertical posture of one or two hands.
 *
 * Key design principles (Section 9 of CONDUCTOR_CAMERA_IMPLEMENTATION.md):
 *   - Continuous broad hand height mapping: hands higher = louder, hands lower = softer.
 *   - Heavy low-pass filtering (time constant ~650ms) to reject instantaneous beat strokes
 *     and prevent volume pumping.
 *   - Works seamlessly with either 1 hand, 2 hands (averaged), or smooth hold during tracking dropouts.
 */

import type { DynamicLevel } from "../audio/dynamicsTypes";
import type { DynamicsObservation, HandSample } from "./cameraTypes";

export interface DynamicsEstimatorConfig {
  /** Time constant for exponential low-pass filtering in ms (~650ms). */
  timeConstantMs: number;
  /** Conductor-space Y corresponding to quietest level (0.0 = bottom). */
  minY: number;
  /** Conductor-space Y corresponding to loudest level (1.0 = top). */
  maxY: number;
  /** Time to hold last dynamics before slowly decaying toward neutral (ms). */
  dropoutHoldMs: number;
  /** Neutral resting conductor-space Y (~0.50 = mf). */
  neutralY: number;
}

export const DEFAULT_DYNAMICS_CONFIG: DynamicsEstimatorConfig = {
  timeConstantMs: 650,
  minY: 0.15,
  maxY: 0.85,
  dropoutHoldMs: 1200,
  neutralY: 0.50,
};

export class DynamicsEstimator {
  private config: DynamicsEstimatorConfig;
  private smoothedY: number;
  private lastTimestampMs: number = 0;
  private lastVisibleTimestampMs: number = 0;
  private currentObservation: DynamicsObservation;
  private callbacks: Set<(dyn: DynamicsObservation) => void> = new Set();

  constructor(config?: Partial<DynamicsEstimatorConfig>) {
    this.config = { ...DEFAULT_DYNAMICS_CONFIG, ...config };
    this.smoothedY = this.config.neutralY;

    this.currentObservation = {
      timestampMs: performance.now(),
      value: 0.5,
      smoothedY: this.config.neutralY,
      level: "mf",
      handCount: 0,
      confidence: 0,
    };
  }

  onDynamics(callback: (dyn: DynamicsObservation) => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  getObservation(): DynamicsObservation {
    return { ...this.currentObservation };
  }

  reset(initialNeutralY: number = this.config.neutralY): void {
    this.smoothedY = initialNeutralY;
    this.lastTimestampMs = 0;
    this.lastVisibleTimestampMs = 0;
    const value = this.computeNormalizedValue(this.smoothedY);
    const level = this.valueToDynamicLevel(value);

    this.currentObservation = {
      timestampMs: performance.now(),
      value,
      smoothedY: this.smoothedY,
      level,
      handCount: 0,
      confidence: 0,
    };
  }

  /**
   * Updates dynamics estimation from incoming hand samples.
   */
  update(samples: HandSample[], timestampMs: number = performance.now()): DynamicsObservation {
    if (this.lastTimestampMs === 0) {
      this.lastTimestampMs = timestampMs;
    }
    const deltaMs = Math.max(1, Math.min(250, timestampMs - this.lastTimestampMs));
    this.lastTimestampMs = timestampMs;

    let targetY = this.smoothedY;
    let handCount = samples.length;
    let confidence = 0;

    if (samples.length === 1) {
      targetY = samples[0].conductorPoint.y;
      confidence = samples[0].confidence;
      this.lastVisibleTimestampMs = timestampMs;
    } else if (samples.length >= 2) {
      targetY = (samples[0].conductorPoint.y + samples[1].conductorPoint.y) / 2;
      confidence = Math.min(1.0, (samples[0].confidence + samples[1].confidence) / 1.6);
      this.lastVisibleTimestampMs = timestampMs;
    } else {
      // 0 hands visible: hold posture, then slowly decay toward neutral
      const timeSinceVisible = timestampMs - this.lastVisibleTimestampMs;
      if (this.lastVisibleTimestampMs > 0 && timeSinceVisible > this.config.dropoutHoldMs) {
        targetY = this.config.neutralY;
      }
      confidence = 0;
    }

    // Exponential moving average filter: alpha = 1 - exp(-dt / tau)
    const alpha = 1 - Math.exp(-deltaMs / this.config.timeConstantMs);
    this.smoothedY = this.smoothedY + alpha * (targetY - this.smoothedY);
    this.smoothedY = Math.max(0, Math.min(1, this.smoothedY));

    const value = this.computeNormalizedValue(this.smoothedY);
    const level = this.valueToDynamicLevel(value);

    this.currentObservation = {
      timestampMs,
      value,
      smoothedY: Math.round(this.smoothedY * 1000) / 1000,
      level,
      handCount,
      confidence: Math.round(confidence * 100) / 100,
    };

    this.callbacks.forEach(cb => {
      try {
        cb(this.currentObservation);
      } catch (err) {
        console.warn("Dynamics callback error:", err);
      }
    });

    return this.currentObservation;
  }

  private computeNormalizedValue(y: number): number {
    const range = this.config.maxY - this.config.minY;
    if (range <= 0) return 0.5;
    const norm = (y - this.config.minY) / range;
    return Math.max(0, Math.min(1, Math.round(norm * 1000) / 1000));
  }

  /**
   * Maps normalized dynamics value [0, 1] to musical dynamic markings.
   */
  private valueToDynamicLevel(value: number): DynamicLevel {
    if (value < 0.14) return "pp";
    if (value < 0.28) return "p";
    if (value < 0.44) return "mp";
    if (value < 0.60) return "mf";
    if (value < 0.78) return "f";
    if (value < 0.92) return "ff";
    return "fff";
  }
}
