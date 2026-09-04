/**
 * DynamicsEstimator.ts
 *
 * Estimates orchestral dynamic levels from camera hand tracking.
 * Supports two distinct, non-conflicting modes:
 *
 * 1. "spread" (DEFAULT):
 *    - Expanding & Contracting Gesture (Two-Hand Spread / Aperture).
 *    - Hand height is completely ignored.
 *    - Pulling hands apart (wide span) = louder (f -> ff -> fff).
 *    - Bringing hands close together (contracted span) = softer (mp -> p -> pp).
 *    - Tracks rate of change of hand separation with hysteresis to detect when
 *      the conductor is actively shaping dynamics (enabling beat suppression).
 *
 * 2. "height":
 *    - Vertical Hand Height.
 *    - Hand span / expansion is completely ignored.
 *    - Raising hand(s) high = louder, lowering hand(s) = softer.
 */

import type { DynamicLevel } from "../audio/dynamicsTypes";
import type { DynamicsObservation, HandSample } from "./cameraTypes";

export type CameraDynamicsMode = "spread" | "height";

export interface DynamicsEstimatorConfig {
  /** Dynamics sensing mode: "spread" (default) or "height". */
  mode: CameraDynamicsMode;
  /** Time constant for exponential low-pass filtering in ms (~400ms). */
  timeConstantMs: number;
  /** Time to hold last dynamics before slowly decaying toward neutral (ms). */
  dropoutHoldMs: number;

  // Rate of change & hysteresis parameters for dynamic gesture detection
  /** Minimum span velocity to engage active dynamics changing state (units/sec). */
  dynamicsEngageRate: number;
  /** Maximum span velocity to release active dynamics changing state (units/sec). */
  dynamicsReleaseRate: number;
  /** Time in ms that span velocity must remain below release rate before disengaging. */
  dynamicsSettleMs: number;

  // Parameters for "spread" mode
  minSpan: number;
  neutralSpan: number;
  maxSpan: number;

  // Parameters for "height" mode
  minY: number;
  neutralY: number;
  maxY: number;
}

export const DEFAULT_DYNAMICS_CONFIG: DynamicsEstimatorConfig = {
  mode: "spread",
  timeConstantMs: 400,
  dropoutHoldMs: 1400,

  // Gesture motion thresholds (conductor-space units/sec)
  dynamicsEngageRate: 0.18,
  dynamicsReleaseRate: 0.08,
  dynamicsSettleMs: 150,

  // Spread Mode (Hand distance: ~0.15 close, ~0.34 natural resting shoulder width, ~0.60 wide)
  minSpan: 0.15,
  neutralSpan: 0.34,
  maxSpan: 0.60,

  // Height Mode (Conductor Y: ~0.20 floor, ~0.50 neutral, ~0.80 ceiling)
  minY: 0.20,
  neutralY: 0.50,
  maxY: 0.80,
};

export class DynamicsEstimator {
  private config: DynamicsEstimatorConfig;
  private smoothedValue: number = 0.50;
  private lastTimestampMs: number = 0;
  private lastVisibleTimestampMs: number = 0;

  // Separation rate-of-change tracking
  private lastSpan: number = -1;
  private lastSpanTimestampMs: number = 0;
  private smoothedSpanVelocity: number = 0;
  private isActivelyChangingState: boolean = false;
  private belowReleaseSinceMs: number = 0;

  private currentObservation: DynamicsObservation;
  private callbacks: Set<(dyn: DynamicsObservation) => void> = new Set();

  constructor(config?: Partial<DynamicsEstimatorConfig>) {
    this.config = { ...DEFAULT_DYNAMICS_CONFIG, ...config };
    this.smoothedValue = 0.50;

    this.currentObservation = {
      timestampMs: performance.now(),
      value: 0.50,
      smoothedY: this.config.neutralY,
      level: "mf",
      handCount: 0,
      confidence: 0,
      isActivelyChanging: false,
    };
  }

  setMode(mode: CameraDynamicsMode): void {
    this.config.mode = mode;
  }

  getMode(): CameraDynamicsMode {
    return this.config.mode;
  }

  /** True when the conductor is actively expanding or contracting hands to change dynamics. */
  isActivelyChanging(): boolean {
    return this.isActivelyChangingState;
  }

  getSpanVelocity(): number {
    return Math.round(this.smoothedSpanVelocity * 1000) / 1000;
  }

  onDynamics(callback: (dyn: DynamicsObservation) => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  getObservation(): DynamicsObservation {
    return { ...this.currentObservation };
  }

  reset(): void {
    this.smoothedValue = 0.50;
    this.lastTimestampMs = 0;
    this.lastVisibleTimestampMs = 0;
    this.lastSpan = -1;
    this.lastSpanTimestampMs = 0;
    this.smoothedSpanVelocity = 0;
    this.isActivelyChangingState = false;
    this.belowReleaseSinceMs = 0;

    const level = this.valueToDynamicLevel(this.smoothedValue);

    this.currentObservation = {
      timestampMs: performance.now(),
      value: this.smoothedValue,
      smoothedY: this.config.neutralY,
      level,
      handCount: 0,
      confidence: 0,
      isActivelyChanging: false,
    };
  }

  /**
   * Updates dynamics estimation from incoming hand samples based on active mode.
   */
  update(samples: HandSample[], timestampMs: number = performance.now()): DynamicsObservation {
    if (this.lastTimestampMs === 0) {
      this.lastTimestampMs = timestampMs;
    }
    const deltaMs = Math.max(1, Math.min(250, timestampMs - this.lastTimestampMs));
    this.lastTimestampMs = timestampMs;

    let targetValue = this.smoothedValue;
    let handCount = samples.length;
    let confidence = 0;
    let reportingY = this.config.neutralY;

    if (this.config.mode === "spread") {
      // ── MODE 1: EXPANSION / CONTRACTION (SPREAD) ─────────────────────────
      if (samples.length >= 2) {
        const s0 = samples[0];
        const s1 = samples[1];

        // 1. Calculate physical hand scale (size on screen) from 21 landmarks
        let handSize0 = 0.10;
        let handSize1 = 0.10;
        let minX0 = s0.conductorPoint.x, maxX0 = s0.conductorPoint.x;
        let minX1 = s1.conductorPoint.x, maxX1 = s1.conductorPoint.x;

        if (s0.landmarks && s0.landmarks.length >= 10) {
          const xs = s0.landmarks.map(p => p.x);
          minX0 = Math.min(...xs);
          maxX0 = Math.max(...xs);
          const ys = s0.landmarks.map(p => p.y);
          handSize0 = Math.max(maxX0 - minX0, Math.max(...ys) - Math.min(...ys));
        }
        if (s1.landmarks && s1.landmarks.length >= 10) {
          const xs = s1.landmarks.map(p => p.x);
          minX1 = Math.min(...xs);
          maxX1 = Math.max(...xs);
          const ys = s1.landmarks.map(p => p.y);
          handSize1 = Math.max(maxX1 - minX1, Math.max(...ys) - Math.min(...ys));
        }

        const avgHandSize = (handSize0 + handSize1) / 2;

        // 2. Identify left vs right hand horizontally
        const isS0Left = (minX0 + maxX0) / 2 <= (minX1 + maxX1) / 2;
        const leftHandMaxX = isS0Left ? maxX0 : maxX1;
        const rightHandMinX = isS0Left ? minX1 : minX0;

        // 3. Compute inner edge-to-edge gap (distance between hands' closest edges)
        const innerGap = rightHandMinX - leftHandMaxX;

        // 4. Center-to-center horizontal span
        const centerSpan = Math.abs(s0.conductorPoint.x - s1.conductorPoint.x);

        // Track rate of change of hand separation (span velocity)
        if (this.lastSpan >= 0 && this.lastSpanTimestampMs > 0) {
          const dt = Math.max(0.005, (timestampMs - this.lastSpanTimestampMs) / 1000);
          const rawSpanVelocity = Math.abs(centerSpan - this.lastSpan) / dt;
          const velAlpha = 1 - Math.exp(-dt / 0.05); // fast responsiveness (~50ms time constant)
          this.smoothedSpanVelocity = this.smoothedSpanVelocity + velAlpha * (rawSpanVelocity - this.smoothedSpanVelocity);

          // Hysteresis logic
          if (this.smoothedSpanVelocity >= this.config.dynamicsEngageRate) {
            this.isActivelyChangingState = true;
            this.belowReleaseSinceMs = 0;
          } else if (this.smoothedSpanVelocity < this.config.dynamicsReleaseRate) {
            if (this.belowReleaseSinceMs === 0) {
              this.belowReleaseSinceMs = timestampMs;
            }
            if (timestampMs - this.belowReleaseSinceMs >= this.config.dynamicsSettleMs) {
              this.isActivelyChangingState = false;
            }
          }
        }

        this.lastSpan = centerSpan;
        this.lastSpanTimestampMs = timestampMs;

        // 5. Adaptive thresholds scaled to user's distance & hand size on camera:
        // When hands touch, center-to-center span is ~avgHandSize * 0.95.
        const touchingSpan = Math.max(0.04, avgHandSize * 0.95);
        const effectiveNeutralSpan = touchingSpan + 0.18 + avgHandSize * 0.35;
        const effectiveMaxSpan = effectiveNeutralSpan + 0.26 + avgHandSize * 0.40;

        if (innerGap <= 0.02 || centerSpan <= touchingSpan) {
          // Hands touching or very close together -> reliably reach pp (0.00 - 0.08)
          targetValue = 0.00;
        } else if (centerSpan <= effectiveNeutralSpan) {
          // Contracting gesture: bringing hands closer together drops smoothly through mp -> p -> pp
          const spanRange = Math.max(0.05, effectiveNeutralSpan - touchingSpan);
          const ratio = Math.max(0, Math.min(1, (centerSpan - touchingSpan) / spanRange));
          targetValue = 0.50 * ratio; // [0.00, 0.50]
        } else {
          // Expanding gesture: pulling hands apart climbs smoothly through f -> ff -> fff
          const spanRange = Math.max(0.05, effectiveMaxSpan - effectiveNeutralSpan);
          const ratio = Math.max(0, Math.min(1, (centerSpan - effectiveNeutralSpan) / spanRange));
          targetValue = 0.50 + 0.50 * ratio; // [0.50, 1.00]
        }

        reportingY = (s0.conductorPoint.y + s1.conductorPoint.y) / 2;
        confidence = Math.min(1.0, (s0.confidence + s1.confidence) / 1.6);
        this.lastVisibleTimestampMs = timestampMs;
      } else if (samples.length === 1) {
        // 1 hand visible in spread mode: distance from center modulates dynamics smoothly
        this.lastSpan = -1;
        this.smoothedSpanVelocity = 0;
        this.isActivelyChangingState = false;
        this.belowReleaseSinceMs = 0;

        const dx = Math.abs(samples[0].conductorPoint.x - 0.50);
        targetValue = Math.max(0.05, Math.min(1.0, (dx - 0.06) / 0.32));
        reportingY = samples[0].conductorPoint.y;
        confidence = samples[0].confidence * 0.8;
        this.lastVisibleTimestampMs = timestampMs;
      } else {
        // 0 hands visible: hold, then slowly drift back to neutral 0.50 (mf)
        this.lastSpan = -1;
        this.smoothedSpanVelocity = 0;
        this.isActivelyChangingState = false;
        this.belowReleaseSinceMs = 0;

        const timeSinceVisible = timestampMs - this.lastVisibleTimestampMs;
        if (this.lastVisibleTimestampMs > 0 && timeSinceVisible > this.config.dropoutHoldMs) {
          targetValue = 0.50;
        }
        confidence = 0;
      }
    } else {
      // ── MODE 2: VERTICAL HAND HEIGHT ─────────────────────────────────────
      this.lastSpan = -1;
      this.smoothedSpanVelocity = 0;
      this.isActivelyChangingState = false;
      this.belowReleaseSinceMs = 0;

      if (samples.length === 1) {
        reportingY = samples[0].conductorPoint.y;
        targetValue = this.heightToNormalizedValue(reportingY);
        confidence = samples[0].confidence;
        this.lastVisibleTimestampMs = timestampMs;
      } else if (samples.length >= 2) {
        reportingY = (samples[0].conductorPoint.y + samples[1].conductorPoint.y) / 2;
        targetValue = this.heightToNormalizedValue(reportingY);
        confidence = Math.min(1.0, (samples[0].confidence + samples[1].confidence) / 1.6);
        this.lastVisibleTimestampMs = timestampMs;
      } else {
        const timeSinceVisible = timestampMs - this.lastVisibleTimestampMs;
        if (this.lastVisibleTimestampMs > 0 && timeSinceVisible > this.config.dropoutHoldMs) {
          targetValue = 0.50;
        }
        confidence = 0;
      }
    }

    // Exponential moving average filter on the normalized dynamic value [0, 1]
    const alpha = 1 - Math.exp(-deltaMs / this.config.timeConstantMs);
    this.smoothedValue = this.smoothedValue + alpha * (targetValue - this.smoothedValue);
    this.smoothedValue = Math.max(0, Math.min(1, this.smoothedValue));

    const finalValue = Math.round(this.smoothedValue * 1000) / 1000;
    const level = this.valueToDynamicLevel(finalValue);

    this.currentObservation = {
      timestampMs,
      value: finalValue,
      smoothedY: Math.round(reportingY * 1000) / 1000,
      level,
      handCount,
      confidence: Math.round(confidence * 100) / 100,
      isActivelyChanging: this.isActivelyChangingState,
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

  private heightToNormalizedValue(y: number): number {
    const range = this.config.maxY - this.config.minY;
    if (range <= 0) return 0.50;
    const norm = (y - this.config.minY) / range;
    return Math.max(0, Math.min(1, norm));
  }

  /**
   * Maps normalized dynamics value [0, 1] to musical dynamic markings.
   */
  private valueToDynamicLevel(value: number): DynamicLevel {
    if (value < 0.16) return "pp";
    if (value < 0.28) return "p";
    if (value < 0.42) return "mp";
    if (value < 0.58) return "mf";
    if (value < 0.72) return "f";
    if (value < 0.86) return "ff";
    return "fff";
  }
}
