/**
 * magicFingerAcquisition.ts
 *
 * Safe dwell & delta acquisition check orchestration for Tempo gauge,
 * Dynamics gauges, and orchestra instrument sections.
 */

import type { PieceSection } from "../score/repertoire";
import type { ScreenRect, InstrumentSectionTarget } from "./magicFingerGeometry";
import { getTargetedInstrumentSection } from "./magicFingerGeometry";
import {
  MAGIC_FINGER_TUNING,
  getTrackBounds,
  tempoValueMapper,
  verticalDynamicsValueMapper,
  checkVerticalGaugeAcquisition,
  checkHorizontalRibbonAcquisition,
} from "./magicFingerGauges";
import type {
  MagicFingerState,
  MagicFingerRay,
} from "./MagicFingerController";

export interface ProcessAcquisitionContext {
  startX: number;
  startY: number;
  rayDirX: number;
  rayDirY: number;
  svgRect: ScreenRect;
  tempoTrackRect: ScreenRect | null;
  dynamicsTrackRect: ScreenRect | null;
  instrumentSections: InstrumentSectionTarget[];
  sections: PieceSection[];
  indicatedBpm: number;
  continuousDynamic: number;
  currentHoverTarget: "tempo" | "dynamics" | null;
  hoverStartTime: number;
  releasedThisFrame: boolean;
  targetedSectionId: string | null;
  defaultEndX: number;
  defaultEndY: number;
  now: number;
}

export interface ProcessAcquisitionResult {
  activeTarget: "tempo" | "dynamics" | null;
  state: MagicFingerState;
  hoverTarget: "tempo" | "dynamics" | "instrument" | null;
  currentHoverTarget: "tempo" | "dynamics" | null;
  hoverStartTime: number;
  targetedSectionId: string | null;
  sectionChangedTo?: string | null;
  liveBpm: number | null;
  liveDynamic: number | null;
  lastBpm?: number;
  lastDynamic?: number;
  endX: number;
  endY: number;
  lastHitScreenX: number | null;
  lastHitScreenY: number | null;
  rayTargetType: MagicFingerRay["targetType"];
  tempoAcquired?: { lastHitY: number; bpm: number };
  dynamicsAcquired?: { lastHitY: number; dynamic: number };
}

export function processAcquisition(ctx: ProcessAcquisitionContext): ProcessAcquisitionResult {
  const {
    startX,
    startY,
    rayDirX,
    rayDirY,
    svgRect,
    tempoTrackRect,
    dynamicsTrackRect,
    instrumentSections,
    sections,
    indicatedBpm,
    continuousDynamic,
    releasedThisFrame,
    defaultEndX,
    defaultEndY,
    now,
  } = ctx;

  let activeTarget: "tempo" | "dynamics" | null = null;
  let state: MagicFingerState = "pointing";
  let hoverTarget: "tempo" | "dynamics" | "instrument" | null = null;
  let currentHoverTarget = ctx.currentHoverTarget;
  let hoverStartTime = ctx.hoverStartTime;
  let targetedSectionId = ctx.targetedSectionId;
  let sectionChangedTo: string | null | undefined;
  let liveBpm: number | null = null;
  let liveDynamic: number | null = null;
  let lastBpm: number | undefined;
  let lastDynamic: number | undefined;
  let endX = defaultEndX;
  let endY = defaultEndY;
  let lastHitScreenX: number | null = null;
  let lastHitScreenY: number | null = null;
  let rayTargetType: MagicFingerRay["targetType"] = "open";
  let tempoAcquired: { lastHitY: number; bpm: number } | undefined;
  let dynamicsAcquired: { lastHitY: number; dynamic: number } | undefined;

  // A. Check Safe Acquisition on Tempo Gauge (Right)
  if (tempoTrackRect && !releasedThisFrame) {
    const trackBounds = getTrackBounds(tempoTrackRect, svgRect);
    const tempoAcq = checkVerticalGaugeAcquisition({
      startX,
      startY,
      rayDirX,
      rayDirY,
      trackBounds,
      side: "right",
      currentValue: indicatedBpm,
      captureDelta: MAGIC_FINGER_TUNING.TEMPO_CAPTURE_BPM_DELTA,
      hoverStartTime: currentHoverTarget === "tempo" ? hoverStartTime : 0,
      now,
      valueMapper: tempoValueMapper,
    });

    if (tempoAcq) {
      hoverTarget = "tempo";
      endX = tempoAcq.endX;
      endY = tempoAcq.endY;
      rayTargetType = "tempo";

      if (currentHoverTarget !== "tempo") {
        currentHoverTarget = "tempo";
        hoverStartTime = now;
      }

      if (tempoAcq.isAcquired) {
        activeTarget = "tempo";
        state = "tempo_acquired";
        const hitBpm = Math.round(tempoAcq.hitValue);
        lastBpm = hitBpm;
        liveBpm = hitBpm;
        lastHitScreenX = endX;
        lastHitScreenY = tempoAcq.endY;
        currentHoverTarget = null;
        hoverStartTime = 0;
        tempoAcquired = { lastHitY: tempoAcq.endY, bpm: hitBpm };
      }
    }
  }

  // B. Check Safe Acquisition on Dynamics Ribbon
  if (activeTarget === null && dynamicsTrackRect && !releasedThisFrame) {
    const isVertical = dynamicsTrackRect.height > dynamicsTrackRect.width;
    const trackBounds = getTrackBounds(dynamicsTrackRect, svgRect);

    if (isVertical) {
      const dynAcq = checkVerticalGaugeAcquisition({
        startX,
        startY,
        rayDirX,
        rayDirY,
        trackBounds,
        side: "left",
        currentValue: continuousDynamic,
        captureDelta: MAGIC_FINGER_TUNING.DYNAMICS_CAPTURE_DELTA,
        hoverStartTime: currentHoverTarget === "dynamics" ? hoverStartTime : 0,
        now,
        valueMapper: verticalDynamicsValueMapper,
      });

      if (dynAcq) {
        hoverTarget = "dynamics";
        endX = dynAcq.endX;
        endY = dynAcq.endY;
        rayTargetType = "dynamics";

        if (currentHoverTarget !== "dynamics") {
          currentHoverTarget = "dynamics";
          hoverStartTime = now;
        }

        if (dynAcq.isAcquired) {
          activeTarget = "dynamics";
          state = "dynamics_acquired";
          lastDynamic = dynAcq.hitValue;
          liveDynamic = dynAcq.hitValue;
          lastHitScreenX = endX;
          lastHitScreenY = dynAcq.endY;
          currentHoverTarget = null;
          hoverStartTime = 0;
          dynamicsAcquired = { lastHitY: dynAcq.endY, dynamic: dynAcq.hitValue };
        }
      }
    } else {
      const ribbonAcq = checkHorizontalRibbonAcquisition({
        startX,
        startY,
        rayDirX,
        rayDirY,
        trackBounds,
        currentValue: continuousDynamic,
        captureDelta: MAGIC_FINGER_TUNING.DYNAMICS_CAPTURE_DELTA,
        hoverStartTime: currentHoverTarget === "dynamics" ? hoverStartTime : 0,
        now,
      });

      if (ribbonAcq) {
        hoverTarget = "dynamics";
        endX = ribbonAcq.endX;
        endY = ribbonAcq.endY;
        rayTargetType = "dynamics";

        if (currentHoverTarget !== "dynamics") {
          currentHoverTarget = "dynamics";
          hoverStartTime = now;
        }

        if (ribbonAcq.isAcquired) {
          activeTarget = "dynamics";
          state = "dynamics_acquired";
          lastDynamic = ribbonAcq.hitValue;
          liveDynamic = ribbonAcq.hitValue;
          currentHoverTarget = null;
          hoverStartTime = 0;
          dynamicsAcquired = { lastHitY: ribbonAcq.endY, dynamic: ribbonAcq.hitValue };
        }
      }
    }
  }

  // C. Check Instrument Sections (Top)
  const targetedInstrument = getTargetedInstrumentSection(
    rayDirX,
    rayDirY,
    startX,
    startY,
    svgRect,
    instrumentSections,
    sections
  );

  if (activeTarget === null && targetedInstrument) {
    endX = targetedInstrument.projectedHitX;
    endY = targetedInstrument.projectedHitY;
    const bestSectionId = targetedInstrument.sectionId;

    hoverTarget = "instrument";
    state = "instrument_targeted";
    rayTargetType = "instrument";

    if (targetedSectionId !== bestSectionId) {
      targetedSectionId = bestSectionId;
      sectionChangedTo = bestSectionId;
    }
  } else if (activeTarget === null && rayDirY < -0.10) {
    const rayDist = (startY - 60) / (-rayDirY);
    endX = startX + rayDirX * rayDist;
    endY = startY + rayDirY * rayDist;
    if (targetedSectionId !== null) {
      targetedSectionId = null;
      sectionChangedTo = null;
    }
  } else if (targetedSectionId !== null) {
    targetedSectionId = null;
    sectionChangedTo = null;
  }

  if (hoverTarget === null) {
    currentHoverTarget = null;
    hoverStartTime = 0;
  }

  return {
    activeTarget,
    state,
    hoverTarget,
    currentHoverTarget,
    hoverStartTime,
    targetedSectionId,
    sectionChangedTo,
    liveBpm,
    liveDynamic,
    lastBpm,
    lastDynamic,
    endX,
    endY,
    lastHitScreenX,
    lastHitScreenY,
    rayTargetType,
    tempoAcquired,
    dynamicsAcquired,
  };
}
