/**
 * magicFingerGauges.ts
 *
 * Vertical tempo/dynamics slider control, horizontal dynamics ribbon control,
 * safe dwell/delta acquisition checks, and hold-to-lock tracking.
 */

import { percentToBpm } from "../ui/bpmGauge";
import type { ScreenRect } from "./magicFingerGeometry";

export const MAGIC_FINGER_TUNING = {
  TEMPO_CAPTURE_BPM_DELTA: 35,
  TEMPO_RELEASE_PAD_PX: 100,
  DYNAMICS_CAPTURE_DELTA: 0.25,
  DYNAMICS_RELEASE_PAD_PX: 100,
  DWELL_ACQUIRE_MS: 280,
  SMOOTHING_ALPHA: 0.40,
  RAY_FREE_DISTANCE_PX: 360,
  UPWARD_FLICK_SPEED_PX_PER_SEC: 650,
  HOLD_STEADY_TIME_MS: 500,
  HOLD_CHARGE_DURATION_MS: 800,
  HOLD_VALUE_TOLERANCE_BPM: 6.5,
  HOLD_VALUE_TOLERANCE_DYN: 0.056,
  HOLD_LOCK_ENABLED: true,
  SHAKE_LOCK_ENABLED: true,
};

export interface TrackBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export function getTrackBounds(rect: ScreenRect, svgRect: ScreenRect): TrackBounds {
  const left = rect.left - svgRect.left;
  const right = rect.right - svgRect.left;
  const top = rect.top - svgRect.top;
  const bottom = rect.bottom - svgRect.top;
  return {
    left,
    right,
    top,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export interface HoldLockTracker {
  holdSteadyStartTime: number;
  holdSteadyValue: number | null;
  chargeProgress: number;
}

export function resetHoldLockTracker(tracker: HoldLockTracker): void {
  tracker.holdSteadyStartTime = 0;
  tracker.holdSteadyValue = null;
  tracker.chargeProgress = 0;
}

export function updateHoldToLock(
  tracker: HoldLockTracker,
  currentValue: number,
  tolerance: number,
  now: number
): { isLocked: boolean; chargeProgress: number } {
  if (!MAGIC_FINGER_TUNING.HOLD_LOCK_ENABLED) {
    return { isLocked: false, chargeProgress: 0 };
  }

  if (tracker.holdSteadyValue === null || Math.abs(currentValue - tracker.holdSteadyValue) > tolerance) {
    tracker.holdSteadyStartTime = now;
    tracker.holdSteadyValue = currentValue;
    tracker.chargeProgress = 0;
    return { isLocked: false, chargeProgress: 0 };
  }

  const steadyDuration = now - tracker.holdSteadyStartTime;
  if (steadyDuration >= MAGIC_FINGER_TUNING.HOLD_STEADY_TIME_MS) {
    const chargeElapsed = steadyDuration - MAGIC_FINGER_TUNING.HOLD_STEADY_TIME_MS;
    tracker.chargeProgress = Math.min(1.0, chargeElapsed / Math.max(1, MAGIC_FINGER_TUNING.HOLD_CHARGE_DURATION_MS));
    if (tracker.chargeProgress >= 1.0) {
      return { isLocked: true, chargeProgress: 1.0 };
    }
    return { isLocked: false, chargeProgress: tracker.chargeProgress };
  }

  tracker.chargeProgress = 0;
  return { isLocked: false, chargeProgress: 0 };
}

export interface VerticalGaugeState {
  smoothedHitY: number | null;
  lastHitY: number | null;
  lastHitTime: number;
  outOfBoundsFrames: number;
}

export interface VerticalGaugeResult {
  shouldRelease: boolean;
  hitY: number;
  clampedY: number;
  endX: number;
  endY: number;
  value: number;
  state: VerticalGaugeState;
}

/**
 * Shared vertical tracking math for both Tempo gauge (right) and Vertical Dynamics (left).
 */
export function processVerticalGaugeControl(params: {
  startX: number;
  startY: number;
  rayDirX: number;
  rayDirY: number;
  trackBounds: TrackBounds;
  side: "right" | "left";
  pad: number;
  now: number;
  state: VerticalGaugeState;
  isClosingFist: boolean;
  isAimingAtOrchestra: boolean;
  valueMapper: (clampedY: number, track: TrackBounds) => number;
}): VerticalGaugeResult {
  const {
    startX,
    startY,
    rayDirX,
    rayDirY,
    trackBounds,
    side,
    pad,
    now,
    state,
    isClosingFist,
    isAimingAtOrchestra,
    valueMapper,
  } = params;

  // Project ray onto vertical centerline of gauge
  let rawHitY = startY;
  if (Math.abs(rayDirX) > 0.02) {
    const t = (trackBounds.centerX - startX) / rayDirX;
    rawHitY = startY + rayDirY * t;
  }

  // Smooth hitY trajectory along gauge to eliminate distance-amplified vertical jitter
  let smoothedHitY = state.smoothedHitY;
  if (smoothedHitY === null) {
    smoothedHitY = rawHitY;
  } else {
    const hitDiff = Math.abs(rawHitY - smoothedHitY);
    const hitSpeedNorm = Math.min(1.0, hitDiff / 50);
    const hitAlpha = 0.28 + hitSpeedNorm * 0.42;
    smoothedHitY = smoothedHitY + hitAlpha * (rawHitY - smoothedHitY);
  }
  const hitY = smoothedHitY;

  // Track vertical speed along the gauge (positive when moving upward towards top)
  const prevHitY = state.lastHitY ?? hitY;
  const dt = state.lastHitTime > 0 ? Math.max(1, now - state.lastHitTime) : 33;
  const upwardSpeedPxPerSec = ((prevHitY - hitY) / dt) * 1000;

  // Exit conditions
  const isUpwardFlickExit =
    hitY < trackBounds.top - 25 &&
    upwardSpeedPxPerSec > MAGIC_FINGER_TUNING.UPWARD_FLICK_SPEED_PX_PER_SEC &&
    rayDirY < -0.35;

  const isWayAboveGauge = hitY < trackBounds.top - 25;
  const isWayBelowGauge = hitY > trackBounds.bottom + pad;

  const isPointingAway = side === "right" ? rayDirX < -0.05 : rayDirX > 0.05;

  const isOutOfBounds =
    isAimingAtOrchestra ||
    isUpwardFlickExit ||
    isWayAboveGauge ||
    isWayBelowGauge ||
    isPointingAway ||
    isClosingFist;

  let outOfBoundsFrames = isOutOfBounds ? state.outOfBoundsFrames + 1 : 0;
  const shouldRelease =
    isUpwardFlickExit || isClosingFist || isAimingAtOrchestra || outOfBoundsFrames >= 3;

  const clampedY = Math.max(trackBounds.top, Math.min(trackBounds.bottom, hitY));
  const value = valueMapper(clampedY, trackBounds);

  return {
    shouldRelease,
    hitY,
    clampedY,
    endX: trackBounds.centerX,
    endY: clampedY,
    value,
    state: {
      smoothedHitY,
      lastHitY: hitY,
      lastHitTime: now,
      outOfBoundsFrames,
    },
  };
}

export function tempoValueMapper(clampedY: number, track: TrackBounds): number {
  const pct = ((track.bottom - clampedY) / track.height) * 100;
  return Math.round(percentToBpm(pct));
}

export function verticalDynamicsValueMapper(clampedY: number, track: TrackBounds): number {
  return Math.max(0, Math.min(1, (track.bottom - clampedY) / track.height));
}

export interface HorizontalRibbonResult {
  shouldRelease: boolean;
  clampedX: number;
  endX: number;
  endY: number;
  value: number;
}

export function processHorizontalRibbonControl(params: {
  startX: number;
  startY: number;
  rayDirX: number;
  rayDirY: number;
  trackBounds: TrackBounds;
  pad: number;
}): HorizontalRibbonResult {
  const { startX, startY, rayDirX, rayDirY, trackBounds, pad } = params;

  let hitX = startX;
  if (Math.abs(rayDirY) > 0.02) {
    const t = (trackBounds.centerY - startY) / rayDirY;
    hitX = startX + rayDirX * t;
  }

  const isUpwardExit = rayDirY < -0.15;
  const projectedY =
    Math.abs(rayDirY) > 0.02
      ? trackBounds.centerY
      : startY + rayDirY * MAGIC_FINGER_TUNING.RAY_FREE_DISTANCE_PX;

  const isOutsidePaddedZone =
    hitX < trackBounds.left - pad ||
    hitX > trackBounds.right + pad ||
    projectedY < trackBounds.top - pad ||
    projectedY > trackBounds.bottom + pad ||
    rayDirY < -0.20;

  const shouldRelease = isUpwardExit || isOutsidePaddedZone;
  const clampedX = Math.max(trackBounds.left, Math.min(trackBounds.right, hitX));
  const continuousVal = Math.max(0, Math.min(1, (clampedX - trackBounds.left) / trackBounds.width));

  return {
    shouldRelease,
    clampedX,
    endX: clampedX,
    endY: trackBounds.centerY,
    value: continuousVal,
  };
}

/**
 * Checks safe acquisition for vertical sliders (Tempo or Vertical Dynamics).
 */
export function checkVerticalGaugeAcquisition(params: {
  startX: number;
  startY: number;
  rayDirX: number;
  rayDirY: number;
  trackBounds: TrackBounds;
  side: "right" | "left";
  currentValue: number;
  captureDelta: number;
  hoverStartTime: number;
  now: number;
  valueMapper: (clampedY: number, track: TrackBounds) => number;
}): { isHovering: boolean; isAcquired: boolean; hitValue: number; endX: number; endY: number } | null {
  const {
    startX,
    startY,
    rayDirX,
    rayDirY,
    trackBounds,
    side,
    currentValue,
    captureDelta,
    hoverStartTime,
    now,
    valueMapper,
  } = params;

  const isDirectionValid = side === "right" ? rayDirX > 0.15 : rayDirX < -0.15;
  if (!isDirectionValid) return null;

  const t = (trackBounds.centerX - startX) / rayDirX;
  if (t <= 0) return null;

  const hitY = startY + rayDirY * t;
  if (hitY < trackBounds.top || hitY > trackBounds.bottom + 20) return null;

  const clampedY = Math.max(trackBounds.top, Math.min(trackBounds.bottom, hitY));
  const hitValue = valueMapper(clampedY, trackBounds);

  const valDiff = Math.abs(hitValue - currentValue);
  const isDwellHeld = hoverStartTime > 0 && (now - hoverStartTime) >= MAGIC_FINGER_TUNING.DWELL_ACQUIRE_MS;
  const isAcquired = valDiff <= captureDelta || isDwellHeld;

  return {
    isHovering: true,
    isAcquired,
    hitValue,
    endX: trackBounds.centerX,
    endY: clampedY,
  };
}

/**
 * Checks safe acquisition for horizontal bottom dynamics ribbon.
 */
export function checkHorizontalRibbonAcquisition(params: {
  startX: number;
  startY: number;
  rayDirX: number;
  rayDirY: number;
  trackBounds: TrackBounds;
  currentValue: number;
  captureDelta: number;
  hoverStartTime: number;
  now: number;
}): { isHovering: boolean; isAcquired: boolean; hitValue: number; endX: number; endY: number } | null {
  const {
    startX,
    startY,
    rayDirX,
    rayDirY,
    trackBounds,
    currentValue,
    captureDelta,
    hoverStartTime,
    now,
  } = params;

  if (rayDirY <= 0.15) return null;

  const t = (trackBounds.centerY - startY) / rayDirY;
  if (t <= 0) return null;

  const hitX = startX + rayDirX * t;
  if (hitX < trackBounds.left - 35 || hitX > trackBounds.right + 35) return null;

  const clampedX = Math.max(trackBounds.left, Math.min(trackBounds.right, hitX));
  const hitVal = (clampedX - trackBounds.left) / trackBounds.width;

  const valDiff = Math.abs(hitVal - currentValue);
  const isDwellHeld = hoverStartTime > 0 && (now - hoverStartTime) >= MAGIC_FINGER_TUNING.DWELL_ACQUIRE_MS;
  const isAcquired = valDiff <= captureDelta || isDwellHeld;

  return {
    isHovering: true,
    isAcquired,
    hitValue: hitVal,
    endX: clampedX,
    endY: trackBounds.centerY,
  };
}
