/**
 * magicFingerActive.ts
 *
 * Active slider control processing for Tempo (right vertical gauge)
 * and Dynamics (left vertical gauge or bottom ribbon).
 */

import type { HandSample } from "./cameraTypes";
import type { PieceSection } from "../score/repertoire";
import type { ScreenRect, InstrumentSectionTarget } from "./magicFingerGeometry";
import { getTargetedInstrumentSection } from "./magicFingerGeometry";
import { isClosingFistGesture } from "./magicFingerMotion";
import {
  MAGIC_FINGER_TUNING,
  getTrackBounds,
  type HoldLockTracker,
  resetHoldLockTracker,
  updateHoldToLock,
  type VerticalGaugeState,
  processVerticalGaugeControl,
  tempoValueMapper,
  verticalDynamicsValueMapper,
  processHorizontalRibbonControl,
} from "./magicFingerGauges";
import type {
  MagicFingerState,
  MagicFingerRay,
  MagicFingerLockInEvent,
} from "./MagicFingerController";

export interface ProcessActiveTargetContext {
  activeTarget: "tempo" | "dynamics";
  pointingSample: HandSample;
  startX: number;
  startY: number;
  rayDirX: number;
  rayDirY: number;
  svgRect: ScreenRect;
  tempoTrackRect: ScreenRect | null;
  dynamicsTrackRect: ScreenRect | null;
  instrumentSections: InstrumentSectionTarget[];
  sections: PieceSection[];
  now: number;
  tempoGaugeState: VerticalGaugeState;
  dynamicsGaugeState: VerticalGaugeState;
  holdLockTracker: HoldLockTracker;
  lastValidInBoundsBpm: number;
  lastValidInBoundsDynamic: number;
  defaultEndX: number;
  defaultEndY: number;
}

export interface ProcessActiveTargetResult {
  releasedThisFrame: boolean;
  activeTarget: "tempo" | "dynamics" | null;
  state: MagicFingerState;
  liveBpm: number | null;
  liveDynamic: number | null;
  lastBpm?: number;
  lastDynamic?: number;
  lastValidInBoundsBpm: number;
  lastValidInBoundsDynamic: number;
  tempoGaugeState: VerticalGaugeState;
  dynamicsGaugeState: VerticalGaugeState;
  holdLockTracker: HoldLockTracker;
  endX: number;
  endY: number;
  lastHitScreenX: number | null;
  lastHitScreenY: number | null;
  rayTargetType: MagicFingerRay["targetType"];
  isLockedIn: boolean;
  lockedTarget: "tempo" | "dynamics" | null;
  lockedValue: number | null;
  lockInEvent: MagicFingerLockInEvent | null;
}

export function processActiveTarget(ctx: ProcessActiveTargetContext): ProcessActiveTargetResult {
  const {
    activeTarget,
    pointingSample,
    startX,
    startY,
    rayDirX,
    rayDirY,
    svgRect,
    tempoTrackRect,
    dynamicsTrackRect,
    instrumentSections,
    sections,
    now,
    defaultEndX,
    defaultEndY,
  } = ctx;

  let releasedThisFrame = false;
  let currentActiveTarget: "tempo" | "dynamics" | null = activeTarget;
  let state: MagicFingerState = activeTarget === "tempo" ? "tempo_acquired" : "dynamics_acquired";
  let liveBpm: number | null = null;
  let liveDynamic: number | null = null;
  let lastBpm: number | undefined;
  let lastDynamic: number | undefined;
  let lastValidInBoundsBpm = ctx.lastValidInBoundsBpm;
  let lastValidInBoundsDynamic = ctx.lastValidInBoundsDynamic;
  let tempoGaugeState = { ...ctx.tempoGaugeState };
  let dynamicsGaugeState = { ...ctx.dynamicsGaugeState };
  let holdLockTracker = { ...ctx.holdLockTracker };
  let endX = defaultEndX;
  let endY = defaultEndY;
  let lastHitScreenX: number | null = null;
  let lastHitScreenY: number | null = null;
  let rayTargetType: MagicFingerRay["targetType"] = activeTarget;
  let isLockedIn = false;
  let lockedTarget: "tempo" | "dynamics" | null = null;
  let lockedValue: number | null = null;
  let lockInEvent: MagicFingerLockInEvent | null = null;

  if (activeTarget === "tempo" && tempoTrackRect) {
    const trackBounds = getTrackBounds(tempoTrackRect, svgRect);
    const isClosingFist = isClosingFistGesture(pointingSample);

    let isAimingAtOrchestra = false;
    if (rayDirY < -0.45 && rayDirX < 0.25) {
      const targetSection = getTargetedInstrumentSection(
        rayDirX,
        rayDirY,
        startX,
        startY,
        svgRect,
        instrumentSections,
        sections
      );
      isAimingAtOrchestra = Boolean(targetSection);
    }

    const res = processVerticalGaugeControl({
      startX,
      startY,
      rayDirX,
      rayDirY,
      trackBounds,
      side: "right",
      pad: MAGIC_FINGER_TUNING.TEMPO_RELEASE_PAD_PX,
      now,
      state: tempoGaugeState,
      isClosingFist,
      isAimingAtOrchestra,
      valueMapper: tempoValueMapper,
    });

    tempoGaugeState = res.state;

    if (res.shouldRelease) {
      currentActiveTarget = null;
      state = "pointing";
      lastBpm = lastValidInBoundsBpm;
      releasedThisFrame = true;
      tempoGaugeState = { smoothedHitY: null, lastHitY: null, lastHitTime: 0, outOfBoundsFrames: 0 };
      resetHoldLockTracker(holdLockTracker);
    } else {
      const newBpm = res.value;
      lastValidInBoundsBpm = newBpm;
      lastBpm = newBpm;
      liveBpm = newBpm;

      endX = res.endX;
      endY = res.endY;
      lastHitScreenX = endX;
      lastHitScreenY = endY;
      rayTargetType = "tempo";
      state = "tempo_acquired";

      const holdRes = updateHoldToLock(
        holdLockTracker,
        newBpm,
        MAGIC_FINGER_TUNING.HOLD_VALUE_TOLERANCE_BPM,
        now
      );

      if (holdRes.isLocked) {
        isLockedIn = true;
        lockedTarget = "tempo";
        lockedValue = newBpm;
        currentActiveTarget = null;
        state = "idle";
        lockInEvent = {
          target: "tempo",
          value: newBpm,
          screenX: endX,
          screenY: endY,
          timestamp: now,
          source: "hold",
        };
        resetHoldLockTracker(holdLockTracker);
      }
    }
  } else if (activeTarget === "dynamics" && dynamicsTrackRect) {
    const isVertical = dynamicsTrackRect.height > dynamicsTrackRect.width;
    const trackBounds = getTrackBounds(dynamicsTrackRect, svgRect);
    const isClosingFist = isClosingFistGesture(pointingSample);

    if (isVertical) {
      let isAimingAtOrchestra = false;
      if (rayDirY < -0.45 && rayDirX > -0.25) {
        const targetSection = getTargetedInstrumentSection(
          rayDirX,
          rayDirY,
          startX,
          startY,
          svgRect,
          instrumentSections,
          sections
        );
        isAimingAtOrchestra = Boolean(targetSection);
      }

      const res = processVerticalGaugeControl({
        startX,
        startY,
        rayDirX,
        rayDirY,
        trackBounds,
        side: "left",
        pad: MAGIC_FINGER_TUNING.DYNAMICS_RELEASE_PAD_PX,
        now,
        state: dynamicsGaugeState,
        isClosingFist,
        isAimingAtOrchestra,
        valueMapper: verticalDynamicsValueMapper,
      });

      dynamicsGaugeState = res.state;

      if (res.shouldRelease) {
        currentActiveTarget = null;
        state = "pointing";
        lastDynamic = lastValidInBoundsDynamic;
        releasedThisFrame = true;
        dynamicsGaugeState = { smoothedHitY: null, lastHitY: null, lastHitTime: 0, outOfBoundsFrames: 0 };
        resetHoldLockTracker(holdLockTracker);
      } else {
        const continuousVal = res.value;
        lastValidInBoundsDynamic = continuousVal;
        lastDynamic = continuousVal;
        liveDynamic = continuousVal;

        endX = res.endX;
        endY = res.endY;
        lastHitScreenX = endX;
        lastHitScreenY = endY;
        rayTargetType = "dynamics";
        state = "dynamics_acquired";

        const holdRes = updateHoldToLock(
          holdLockTracker,
          continuousVal,
          MAGIC_FINGER_TUNING.HOLD_VALUE_TOLERANCE_DYN,
          now
        );

        if (holdRes.isLocked) {
          isLockedIn = true;
          lockedTarget = "dynamics";
          lockedValue = continuousVal;
          currentActiveTarget = null;
          state = "idle";
          lockInEvent = {
            target: "dynamics",
            value: continuousVal,
            screenX: endX,
            screenY: endY,
            timestamp: now,
            source: "hold",
          };
          resetHoldLockTracker(holdLockTracker);
        }
      }
    } else {
      const res = processHorizontalRibbonControl({
        startX,
        startY,
        rayDirX,
        rayDirY,
        trackBounds,
        pad: MAGIC_FINGER_TUNING.DYNAMICS_RELEASE_PAD_PX,
      });

      if (res.shouldRelease) {
        currentActiveTarget = null;
        state = "pointing";
        lastDynamic = lastValidInBoundsDynamic;
        releasedThisFrame = true;
        resetHoldLockTracker(holdLockTracker);
      } else {
        const continuousVal = res.value;
        lastValidInBoundsDynamic = continuousVal;
        lastDynamic = continuousVal;
        liveDynamic = continuousVal;

        endX = res.endX;
        endY = res.endY;
        rayTargetType = "dynamics";
        state = "dynamics_acquired";

        const holdRes = updateHoldToLock(
          holdLockTracker,
          continuousVal,
          MAGIC_FINGER_TUNING.HOLD_VALUE_TOLERANCE_DYN,
          now
        );

        if (holdRes.isLocked) {
          isLockedIn = true;
          lockedTarget = "dynamics";
          lockedValue = continuousVal;
          currentActiveTarget = null;
          state = "idle";
          lockInEvent = {
            target: "dynamics",
            value: continuousVal,
            screenX: endX,
            screenY: endY,
            timestamp: now,
            source: "hold",
          };
          resetHoldLockTracker(holdLockTracker);
        }
      }
    }
  }

  return {
    releasedThisFrame,
    activeTarget: currentActiveTarget,
    state,
    liveBpm,
    liveDynamic,
    lastBpm,
    lastDynamic,
    lastValidInBoundsBpm,
    lastValidInBoundsDynamic,
    tempoGaugeState,
    dynamicsGaugeState,
    holdLockTracker,
    endX,
    endY,
    lastHitScreenX,
    lastHitScreenY,
    rayTargetType,
    isLockedIn,
    lockedTarget,
    lockedValue,
    lockInEvent,
  };
}
