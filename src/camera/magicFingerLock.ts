/**
 * magicFingerLock.ts
 *
 * Lock-in state evaluation, boundary rearming checks,
 * and locked laser ray generation for Magic Finger Mode.
 */

import type { ScreenRect, InstrumentSectionTarget } from "./magicFingerGeometry";
import { doesRayIntersectBox, getTargetedInstrumentSection } from "./magicFingerGeometry";
import type { PieceSection } from "../score/repertoire";
import { MAGIC_FINGER_TUNING } from "./magicFingerGauges";
import type { MagicFingerRay } from "./MagicFingerController";

export interface LockedStateEvaluationParams {
  lockedTarget: "tempo" | "dynamics";
  startX: number;
  startY: number;
  rayDirX: number;
  rayDirY: number;
  svgRect: ScreenRect;
  tempoContainerRect: ScreenRect | null;
  dynamicsContainerRect: ScreenRect | null;
  tempoTrackRect: ScreenRect | null;
  dynamicsTrackRect: ScreenRect | null;
  instrumentSections: InstrumentSectionTarget[];
  sections: PieceSection[];
}

export interface LockedStateResult {
  shouldRearm: boolean;
  dimmedRay: MagicFingerRay;
}

/**
 * Evaluates whether a locked-in pointer has rearmed by pointing to an instrument
 * section, across to the opposite control side, or upward clear of the locked box.
 */
export function evaluateLockedInRearming(params: LockedStateEvaluationParams): LockedStateResult {
  const {
    lockedTarget,
    startX,
    startY,
    rayDirX,
    rayDirY,
    svgRect,
    tempoContainerRect,
    dynamicsContainerRect,
    tempoTrackRect,
    dynamicsTrackRect,
    instrumentSections,
    sections,
  } = params;

  const lockedContainerRect = lockedTarget === "tempo" ? tempoContainerRect : dynamicsContainerRect;
  const lockedTrackRect = lockedTarget === "tempo" ? tempoTrackRect : dynamicsTrackRect;

  let isAimingAtLockedBox = false;
  let isWithinTrackBounds = false;
  let trackCenterX = startX;
  let trackHitY: number | null = null;

  if (lockedContainerRect) {
    const box = {
      left: lockedContainerRect.left - svgRect.left,
      right: lockedContainerRect.right - svgRect.left,
      top: lockedContainerRect.top - svgRect.top,
      bottom: lockedContainerRect.bottom - svgRect.top,
    };
    isAimingAtLockedBox = doesRayIntersectBox(startX, startY, rayDirX, rayDirY, box, 10);
  }

  if (lockedTrackRect) {
    const trackLeft = lockedTrackRect.left - svgRect.left;
    const trackRight = lockedTrackRect.right - svgRect.left;
    const trackTop = lockedTrackRect.top - svgRect.top;
    const trackBottom = lockedTrackRect.bottom - svgRect.top;
    trackCenterX = (trackLeft + trackRight) / 2;

    if (Math.abs(rayDirX) > 0.02) {
      const t = (trackCenterX - startX) / rayDirX;
      if (t > 0) {
        const hitY = startY + rayDirY * t;
        if (hitY >= trackTop && hitY <= trackBottom) {
          isWithinTrackBounds = true;
          trackHitY = hitY;
        }
      }
    }
  }

  const isTotallyClearOfLockedBox = !isAimingAtLockedBox;

  const targetedInstrument = isTotallyClearOfLockedBox
    ? getTargetedInstrumentSection(
        rayDirX,
        rayDirY,
        startX,
        startY,
        svgRect,
        instrumentSections,
        sections
      )
    : null;
  const pointingUpToOrchestra = Boolean(targetedInstrument);

  const pointingAcross = isTotallyClearOfLockedBox && (
    lockedTarget === "tempo"
      ? (dynamicsTrackRect ? (startX + rayDirX * 360 < (dynamicsTrackRect.right - svgRect.left) + 40) : rayDirX < -0.15)
      : (tempoTrackRect ? (startX + rayDirX * 360 > (tempoTrackRect.left - svgRect.left) - 40) : rayDirX > 0.15)
  );

  const pointingUpClearOfBox = isTotallyClearOfLockedBox && rayDirY < -0.20;

  const shouldRearm = pointingUpToOrchestra || pointingAcross || pointingUpClearOfBox;

  let lockedEndX = startX + rayDirX * MAGIC_FINGER_TUNING.RAY_FREE_DISTANCE_PX;
  let lockedEndY = startY + rayDirY * MAGIC_FINGER_TUNING.RAY_FREE_DISTANCE_PX;

  if (isWithinTrackBounds && trackHitY !== null) {
    lockedEndX = trackCenterX;
    lockedEndY = trackHitY;
  }

  const dimmedRay: MagicFingerRay = {
    startX,
    startY,
    endX: lockedEndX,
    endY: lockedEndY,
    unitX: rayDirX,
    unitY: rayDirY,
    isActive: true,
    isAcquired: isWithinTrackBounds,
    targetType: isWithinTrackBounds ? lockedTarget : "open",
    isDimmed: true,
  };

  return { shouldRearm, dimmedRay };
}

/**
 * Creates a dimmed ray when lock-in is freshly triggered via shake.
 */
export function createShakeLockDimmedRay(
  lockedTarget: "tempo" | "dynamics",
  hitX: number,
  hitY: number
): MagicFingerRay {
  return {
    startX: lockedTarget === "tempo" ? hitX - 100 : hitX + 100,
    startY: hitY,
    endX: hitX,
    endY: hitY,
    unitX: lockedTarget === "tempo" ? 1 : -1,
    unitY: 0,
    isActive: true,
    isAcquired: true,
    targetType: lockedTarget,
    isDimmed: true,
  };
}
