/**
 * magicFingerMotion.ts
 *
 * Hand selection, gesture analysis (pointing, fist-curl, hand-shake),
 * and ray direction smoothing routines for Magic Finger Mode.
 */

import type { HandSample } from "./cameraTypes";
import { HAND_LANDMARK_INDICES } from "./cameraTypes";

/**
 * Detects deliberate hand shake (sliding window) to trigger gesture lock-in.
 */
export function isHandShaking(points: Array<{ x: number; y: number; time: number }>): boolean {
  if (points.length < 5) return false;
  const duration = points[points.length - 1].time - points[0].time;
  if (duration < 80 || duration > 360) return false;

  let xReversals = 0;
  let prevDx = 0;
  let yReversals = 0;
  let prevDy = 0;
  let totalDist = 0;
  let minX = points[0].x, maxX = points[0].x;
  let minY = points[0].y, maxY = points[0].y;

  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    totalDist += Math.hypot(dx, dy);

    minX = Math.min(minX, points[i].x);
    maxX = Math.max(maxX, points[i].x);
    minY = Math.min(minY, points[i].y);
    maxY = Math.max(maxY, points[i].y);

    if (Math.abs(dx) > 0.015) {
      if (prevDx !== 0 && ((dx > 0 && prevDx < 0) || (dx < 0 && prevDx > 0))) {
        xReversals++;
      }
      prevDx = dx;
    }
    if (Math.abs(dy) > 0.015) {
      if (prevDy !== 0 && ((dy > 0 && prevDy < 0) || (dy < 0 && prevDy > 0))) {
        yReversals++;
      }
      prevDy = dy;
    }
  }

  const excursionX = maxX - minX;
  const excursionY = maxY - minY;

  // A deliberate fist-shake has at least 3 direction reversals (shake back, forth, back, forth)
  // Horizontal shake is the primary natural shake gesture that does not conflict with vertical tempo adjustments
  const isHorizontalShake = xReversals >= 3 && excursionX >= 0.025;
  const isMultiAxisShake = xReversals >= 2 && yReversals >= 2 && (excursionX + excursionY) >= 0.05;
  return (isHorizontalShake || isMultiAxisShake) && totalDist >= 0.06;
}

/**
 * Updates sliding window motion history for detected hands and evaluates if any hand is shaking.
 */
export function updateMotionHistoryAndCheckShake(
  historyMap: Map<number, Array<{ x: number; y: number; time: number }>>,
  samples: HandSample[],
  now: number
): boolean {
  for (const s of samples) {
    if (!s.landmarks || s.landmarks.length < 21) continue;
    const pt = s.landmarks[0] || s.conductorPoint;
    let hist = historyMap.get(s.handIndex);
    if (!hist) {
      hist = [];
      historyMap.set(s.handIndex, hist);
    }
    hist.push({ x: pt.x, y: pt.y, time: now });
    const cutoff = now - 320;
    while (hist.length > 0 && hist[0].time < cutoff) {
      hist.shift();
    }
  }

  for (const hist of historyMap.values()) {
    if (isHandShaking(hist)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks for fist curl / collapsing finger extension to safely release gauge control.
 */
export function isClosingFistGesture(sample: HandSample): boolean {
  if (!sample.landmarks || sample.landmarks.length < 21) return false;
  const tip = sample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP];
  const mcp = sample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_MCP];
  const wrist = sample.landmarks[HAND_LANDMARK_INDICES.WRIST];
  const middleMcp = sample.landmarks[HAND_LANDMARK_INDICES.MIDDLE_FINGER_MCP];
  if (tip && mcp && wrist && middleMcp) {
    const handScale = Math.max(0.04, Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y));
    const extension = Math.hypot(tip.x - mcp.x, tip.y - mcp.y) / handScale;
    return extension < 0.48;
  }
  return false;
}

/**
 * Arbitrates between multiple candidate pointing hands based on active target and ray direction.
 */
export function selectPointingHand(
  candidateSamples: HandSample[],
  activeTarget: "tempo" | "dynamics" | null,
  lastPointingHandIndex: number | null,
  isMirrored: boolean
): HandSample | null {
  if (candidateSamples.length === 0) return null;
  if (candidateSamples.length === 1) return candidateSamples[0];

  const getMetrics = (s: HandSample) => {
    const tip = s.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP];
    const pip = s.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_PIP] || s.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_MCP];
    const screenX = isMirrored ? (1.0 - tip.x) : tip.x;
    const tipY = tip.y;
    const rawDirX = isMirrored ? -(tip.x - pip.x) : (tip.x - pip.x);
    const rawDirY = tip.y - pip.y;
    return { s, screenX, tipY, rawDirX, rawDirY };
  };

  const metrics = candidateSamples.map(getMetrics);

  // If actively controlling or pointing towards Tempo (right edge): select finger closest to right edge (max screenX)
  if (activeTarget === "tempo") {
    metrics.sort((a, b) => b.screenX - a.screenX);
    return metrics[0].s;
  }
  // If actively controlling or pointing towards Dynamics (left edge): select finger closest to left edge (min screenX)
  else if (activeTarget === "dynamics") {
    metrics.sort((a, b) => a.screenX - b.screenX);
    return metrics[0].s;
  } else {
    const rightward = metrics.filter(m => m.rawDirX > 0.10);
    const leftward = metrics.filter(m => m.rawDirX < -0.10);
    const upward = metrics.filter(m => m.rawDirY < -0.10);

    if (rightward.length > 0 && leftward.length === 0) {
      // Pointing towards Tempo (right edge): select the finger closest to the right edge
      rightward.sort((a, b) => b.screenX - a.screenX);
      return rightward[0].s;
    } else if (leftward.length > 0 && rightward.length === 0) {
      // Pointing towards Dynamics (left edge): select the finger closest to the left edge
      leftward.sort((a, b) => a.screenX - b.screenX);
      return leftward[0].s;
    } else if (upward.length > 0) {
      // Pointing towards Orchestra (top edge): select the finger closest to the top (lowest tipY / highest hand)
      upward.sort((a, b) => a.tipY - b.tipY);
      return upward[0].s;
    } else {
      // General fallback: maintain previous pointing hand if still pointing
      const prev = metrics.find(m => m.s.handIndex === lastPointingHandIndex);
      if (prev) {
        return prev.s;
      } else {
        metrics.sort((a, b) => a.tipY - b.tipY);
        return metrics[0].s;
      }
    }
  }
}

/**
 * Calculates start position and normalized direction vector for the pointing laser in SVG overlay space.
 */
export function extractFingertipCoordinates(
  sample: HandSample,
  canvasRect: { left: number; top: number; width: number; height: number },
  svgRect: { left: number; top: number },
  isMirrored: boolean
): { startX: number; startY: number; unitX: number; unitY: number } {
  const tip = sample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP];
  const pip = sample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_PIP];

  const tipScreenNormX = Math.max(0, Math.min(1, isMirrored ? 1.0 - tip.x : tip.x));
  const clampedTipY = Math.max(0, Math.min(1, tip.y));
  const pipScreenNormX = pip ? Math.max(0, Math.min(1, isMirrored ? 1.0 - pip.x : pip.x)) : tipScreenNormX;
  const pipScreenNormY = pip ? Math.max(0, Math.min(1, pip.y)) : clampedTipY + 0.05;

  const startX = (canvasRect.left - svgRect.left) + tipScreenNormX * canvasRect.width;
  const startY = (canvasRect.top - svgRect.top) + clampedTipY * canvasRect.height;

  const rawDirX = (tipScreenNormX - pipScreenNormX) * canvasRect.width;
  const rawDirY = (clampedTipY - pipScreenNormY) * canvasRect.height;
  const rawLen = Math.hypot(rawDirX, rawDirY);
  let unitX = 0;
  let unitY = -1;
  if (rawLen > 0.001) {
    unitX = rawDirX / rawLen;
    unitY = rawDirY / rawLen;
  }

  return { startX, startY, unitX, unitY };
}

/**
 * Adaptive angular-velocity-sensitive direction smoother.
 */
export class AdaptiveRaySmoother {
  private smoothedUnitX: number = 0;
  private smoothedUnitY: number = -1;
  private hasSmoothedDir: boolean = false;

  reset(): void {
    this.smoothedUnitX = 0;
    this.smoothedUnitY = -1;
    this.hasSmoothedDir = false;
  }

  smooth(unitX: number, unitY: number): { dirX: number; dirY: number } {
    const targetAngle = Math.atan2(unitY, unitX);
    if (!this.hasSmoothedDir) {
      this.smoothedUnitX = unitX;
      this.smoothedUnitY = unitY;
      this.hasSmoothedDir = true;
    } else {
      const currentAngle = Math.atan2(this.smoothedUnitY, this.smoothedUnitX);
      let diff = targetAngle - currentAngle;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      while (diff > Math.PI) diff -= 2 * Math.PI;

      const angularSpeed = Math.abs(diff);
      const speedFactor = Math.min(1.0, Math.max(0, (angularSpeed - 0.015) / 0.105));
      const alpha = 0.20 + speedFactor * 0.45;

      const newAngle = currentAngle + alpha * diff;
      this.smoothedUnitX = Math.cos(newAngle);
      this.smoothedUnitY = Math.sin(newAngle);
    }
    return { dirX: this.smoothedUnitX, dirY: this.smoothedUnitY };
  }

  getDirection(): { dirX: number; dirY: number } {
    return { dirX: this.smoothedUnitX, dirY: this.smoothedUnitY };
  }
}
