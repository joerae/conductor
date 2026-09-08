/**
 * gesturalTempoMath.ts
 *
 * Geometric and statistical calculations for Mode E camera-driven tempo modulation.
 * Supports Classic (Vertical Height) and Flipped (Horizontal Span) axis mappings.
 */

import type { HandSample } from "../camera/cameraTypes";

export type CameraAxisMapping = "flipped" | "classic"; // "flipped" = Width is Tempo, Height is Volume (DEFAULT)

/**
 * Calculates a tempo multiplier (0.35x - 1.65x) based on hand positions in the camera frame.
 */
export function calculateGesturalTempoMultiplier(
  samples: HandSample[],
  mapping: CameraAxisMapping,
  handYHistory?: Map<number, number[]>
): number {
  if (samples.length === 0) return 1.0;
  let tempoMultiplier = 1.0;

  if (mapping === "flipped") {
    // ── FLIPPED: Horizontal Span (Width) modulates Tempo ──
    // Spreading hands apart -> Accelerando (up to 1.65x piece BPM)
    // Bringing hands together -> Rallentando (down to 0.35x piece BPM)
    if (samples.length >= 2) {
      const s0 = samples[0];
      const s1 = samples[1];
      const centerSpan = Math.abs(s0.conductorPoint.x - s1.conductorPoint.x);

      let avgHandSize = 0.10;
      if (s0.landmarks && s1.landmarks && s0.landmarks.length >= 5 && s1.landmarks.length >= 5) {
        const xs0 = s0.landmarks.map(p => p.x);
        const xs1 = s1.landmarks.map(p => p.x);
        const size0 = Math.max(...xs0) - Math.min(...xs0);
        const size1 = Math.max(...xs1) - Math.min(...xs1);
        avgHandSize = (size0 + size1) / 2;
      }

      const touchingSpan = Math.max(0.04, avgHandSize * 0.95);
      const neutralSpan = touchingSpan + 0.18 + avgHandSize * 0.35;
      const maxSpan = neutralSpan + 0.26 + avgHandSize * 0.40;
      const DEADBAND = 0.03;

      if (centerSpan > neutralSpan + DEADBAND) {
        const norm = Math.min(
          1.0,
          (centerSpan - (neutralSpan + DEADBAND)) / Math.max(0.05, maxSpan - (neutralSpan + DEADBAND))
        );
        tempoMultiplier = 1.0 + 0.65 * norm;
      } else if (centerSpan < neutralSpan - DEADBAND) {
        const norm = Math.min(
          1.0,
          ((neutralSpan - DEADBAND) - centerSpan) / Math.max(0.05, (neutralSpan - DEADBAND) - touchingSpan)
        );
        tempoMultiplier = 1.0 - 0.65 * norm;
      } else {
        tempoMultiplier = 1.0;
      }
    } else if (samples.length === 1) {
      const dx = Math.abs(samples[0].conductorPoint.x - 0.50);
      if (dx > 0.25) {
        tempoMultiplier = 1.0 + 0.65 * Math.min(1.0, (dx - 0.25) / 0.25);
      } else if (dx < 0.10) {
        tempoMultiplier = 1.0 - 0.65 * Math.min(1.0, (0.10 - dx) / 0.10);
      } else {
        tempoMultiplier = 1.0;
      }
    }
  } else {
    // ── CLASSIC (DEFAULT): Vertical Height (Y) modulates Tempo ──
    // Raising hands up -> Accelerando (up to 1.65x piece BPM)
    // Lowering hands down -> Rallentando (down to 0.35x piece BPM)
    let effectiveY: number;
    if (samples.length >= 2) {
      const stats = samples.map(s => {
        const hist = handYHistory?.get(s.handIndex) ?? [s.conductorPoint.y];
        const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
        const variance = hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length;
        return { y: s.conductorPoint.y, mean, variance };
      });

      const [h0, h1] = stats;
      const h0Beating = h0.variance > 0.0006 && h0.variance > 2.0 * h1.variance;
      const h1Beating = h1.variance > 0.0006 && h1.variance > 2.0 * h0.variance;

      if (h0Beating && !h1Beating) {
        effectiveY = h1.mean;
      } else if (h1Beating && !h0Beating) {
        effectiveY = h0.mean;
      } else {
        effectiveY = (h0.mean + h1.mean) / 2;
      }
    } else {
      const hist = handYHistory?.get(samples[0].handIndex) ?? [samples[0].conductorPoint.y];
      effectiveY = hist.reduce((a, b) => a + b, 0) / hist.length;
    }

    const NEUTRAL_Y = 0.40;
    const DEADBAND = 0.03;

    if (effectiveY > NEUTRAL_Y + DEADBAND) {
      const norm = Math.min(1.0, (effectiveY - (NEUTRAL_Y + DEADBAND)) / (0.85 - (NEUTRAL_Y + DEADBAND)));
      tempoMultiplier = 1.0 + 0.65 * norm;
    } else if (effectiveY < NEUTRAL_Y - DEADBAND) {
      const norm = Math.min(1.0, ((NEUTRAL_Y - DEADBAND) - effectiveY) / ((NEUTRAL_Y - DEADBAND) - 0.10));
      tempoMultiplier = 1.0 - 0.65 * norm;
    } else {
      tempoMultiplier = 1.0;
    }
  }

  return tempoMultiplier;
}
