/**
 * MagicFingerController.ts
 *
 * Dedicated interaction coordinator for Magic Finger Mode (☝️ Magic Finger).
 * Coordinates real-time conducting via laser pointer across three target zones:
 * 1. Instrument sections above camera (instant spotlight)
 * 2. Tempo gauge to the right (vertical slider 40-220 BPM with safe acquisition)
 * 3. Dynamics ribbon (vertical slider left, or horizontal slider bottom with safe acquisition)
 */

import type { HandSample } from "./cameraTypes";
import { isPointingGesture } from "./cameraTypes";
import type { PieceSection } from "../score/repertoire";

import {
  type ScreenRect,
  type InstrumentSectionTarget,
  type MagicFingerGeometryProvider,
  DefaultDOMGeometryProvider,
  doesRayIntersectBox,
  getTargetedInstrumentSection,
} from "./magicFingerGeometry";

import {
  isHandShaking,
  updateMotionHistoryAndCheckShake,
  isClosingFistGesture,
  selectPointingHand,
  extractFingertipCoordinates,
  AdaptiveRaySmoother,
} from "./magicFingerMotion";

import {
  MAGIC_FINGER_TUNING,
  type TrackBounds,
  getTrackBounds,
  type HoldLockTracker,
  resetHoldLockTracker,
  type VerticalGaugeState,
} from "./magicFingerGauges";

import {
  evaluateLockedInRearming,
  createShakeLockDimmedRay,
} from "./magicFingerLock";

import { processActiveTarget } from "./magicFingerActive";
import { processAcquisition } from "./magicFingerAcquisition";

// Re-export for full backward compatibility
export {
  type ScreenRect,
  type InstrumentSectionTarget,
  type MagicFingerGeometryProvider,
  DefaultDOMGeometryProvider,
  doesRayIntersectBox,
  getTargetedInstrumentSection,
  isHandShaking,
  isClosingFistGesture,
  selectPointingHand,
  extractFingertipCoordinates,
  AdaptiveRaySmoother,
  MAGIC_FINGER_TUNING,
  type TrackBounds,
  getTrackBounds,
  evaluateLockedInRearming,
  createShakeLockDimmedRay,
};

export type MagicFingerState =
  | "idle"
  | "pointing"
  | "tempo_acquired"
  | "dynamics_acquired"
  | "instrument_targeted";

export interface MagicFingerRay {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  unitX: number;
  unitY: number;
  isActive: boolean;
  isAcquired: boolean;
  targetType: "tempo" | "dynamics" | "instrument" | "open" | null;
  isDimmed?: boolean;
}

export interface MagicFingerLockInEvent {
  target: "tempo" | "dynamics";
  value: number;
  screenX: number;
  screenY: number;
  timestamp: number;
  source: "shake" | "hold";
}

export interface MagicFingerTelemetry {
  isActive: boolean;
  state: MagicFingerState;
  pointingHandIndex: number | null;
  hoverTarget: "tempo" | "dynamics" | "instrument" | null;
  activeTarget: "tempo" | "dynamics" | null;
  targetedSectionId: string | null;
  liveBpm: number | null;
  liveDynamic: number | null;
  ray: MagicFingerRay | null;
  isLockedIn?: boolean;
  lockInEvent?: MagicFingerLockInEvent | null;
  chargeProgress?: number;
  chargeTarget?: "tempo" | "dynamics" | null;
}

export interface MagicFingerCallbacks {
  onBpmChange?: (bpm: number) => void;
  onDynamicChange?: (dynamicContinuous: number) => void;
  onSpotlightChange?: (sectionId: string | null) => void;
  onLockIn?: (event: MagicFingerLockInEvent) => void;
  onTelemetry?: (telemetry: MagicFingerTelemetry) => void;
}

export class MagicFingerController {
  private geometry: MagicFingerGeometryProvider;
  private callbacks: MagicFingerCallbacks;

  // Interaction State
  private state: MagicFingerState = "idle";
  private activeTarget: "tempo" | "dynamics" | null = null;
  private hoverTarget: "tempo" | "dynamics" | "instrument" | null = null;
  private targetedSectionId: string | null = null;

  // Values preserved across releases
  private lastBpm: number = 100;
  private lastDynamic: number = 0.5;
  private lastValidInBoundsBpm: number = 100;
  private lastValidInBoundsDynamic: number = 0.5;

  // Dwell acquisition state
  private hoverStartTime: number = 0;
  private currentHoverTarget: "tempo" | "dynamics" | null = null;
  private lastPointingHandIndex: number | null = null;

  // Ray direction smoothing
  private raySmoother: AdaptiveRaySmoother = new AdaptiveRaySmoother();

  // Gauge vertical trajectory state
  private tempoGaugeState: VerticalGaugeState = {
    smoothedHitY: null,
    lastHitY: null,
    lastHitTime: 0,
    outOfBoundsFrames: 0,
  };
  private dynamicsGaugeState: VerticalGaugeState = {
    smoothedHitY: null,
    lastHitY: null,
    lastHitTime: 0,
    outOfBoundsFrames: 0,
  };

  // Lock-in state & repointing protection
  private isLockedIn: boolean = false;
  private lockedTarget: "tempo" | "dynamics" | null = null;
  private lockedValue: number | null = null;
  private lastHitScreenX: number | null = null;
  private lastHitScreenY: number | null = null;

  // Hold-to-lock tracker
  private holdLockTracker: HoldLockTracker = {
    holdSteadyStartTime: 0,
    holdSteadyValue: null,
    chargeProgress: 0,
  };

  // Hand motion tracking for shake detection (sliding window)
  private handMotionHistory: Map<number, Array<{ x: number; y: number; time: number }>> = new Map();

  // Known repertoire piece sections
  private sections: PieceSection[] = [];

  constructor(
    geometry?: MagicFingerGeometryProvider,
    callbacks?: MagicFingerCallbacks
  ) {
    this.geometry = geometry || new DefaultDOMGeometryProvider();
    this.callbacks = callbacks || {};
  }

  setCallbacks(callbacks: MagicFingerCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  setGeometryProvider(geometry: MagicFingerGeometryProvider): void {
    this.geometry = geometry;
  }

  setSections(sections: PieceSection[]): void {
    this.sections = sections;
  }

  isLockInActive(): boolean {
    return this.isLockedIn;
  }

  getLockedTarget(): "tempo" | "dynamics" | null {
    return this.lockedTarget;
  }

  getState(): MagicFingerState {
    return this.state;
  }

  getActiveTarget(): "tempo" | "dynamics" | null {
    return this.activeTarget;
  }

  getTargetedSectionId(): string | null {
    return this.targetedSectionId;
  }

  getLastBpm(): number {
    return this.lastBpm;
  }

  getLastDynamic(): number {
    return this.lastDynamic;
  }

  setInitialBpm(bpm: number): void {
    if (bpm > 0) {
      this.lastBpm = bpm;
      this.lastValidInBoundsBpm = bpm;
    }
  }

  reset(suggestedBpm?: number): void {
    this.state = "idle";
    this.activeTarget = null;
    this.hoverTarget = null;
    this.currentHoverTarget = null;
    this.hoverStartTime = 0;
    this.targetedSectionId = null;
    this.raySmoother.reset();
    this.lastPointingHandIndex = null;
    this.tempoGaugeState = { smoothedHitY: null, lastHitY: null, lastHitTime: 0, outOfBoundsFrames: 0 };
    this.dynamicsGaugeState = { smoothedHitY: null, lastHitY: null, lastHitTime: 0, outOfBoundsFrames: 0 };
    this.isLockedIn = false;
    this.lockedTarget = null;
    this.lastHitScreenX = null;
    this.lastHitScreenY = null;
    resetHoldLockTracker(this.holdLockTracker);
    this.handMotionHistory.clear();
    if (suggestedBpm && suggestedBpm > 0) {
      this.lastBpm = suggestedBpm;
      this.lastValidInBoundsBpm = suggestedBpm;
    } else {
      this.lastValidInBoundsBpm = this.lastBpm;
    }
    this.lastValidInBoundsDynamic = this.lastDynamic;
    this.callbacks.onSpotlightChange?.(null);
  }

  update(options: {
    samples: HandSample[];
    indicatedBpm: number;
    continuousDynamic: number;
    isMirrored?: boolean;
    nowMs?: number;
  }): MagicFingerTelemetry {
    const { samples, indicatedBpm, continuousDynamic, isMirrored = true, nowMs } = options;
    const now = nowMs ?? (typeof performance !== "undefined" ? performance.now() : Date.now());

    this.lastBpm = indicatedBpm;
    this.lastDynamic = continuousDynamic;

    let lockInEvent: MagicFingerLockInEvent | null = null;

    // 0. Update motion history for shake detection
    const isAnyHandShaking = updateMotionHistoryAndCheckShake(this.handMotionHistory, samples, now);

    if (this.activeTarget !== null && isAnyHandShaking && MAGIC_FINGER_TUNING.SHAKE_LOCK_ENABLED) {
      const lockedTarget = this.activeTarget;
      const lockedValue = lockedTarget === "tempo" ? this.lastBpm : this.lastDynamic;
      const hitX = this.lastHitScreenX ?? (lockedTarget === "tempo" ? 500 : 50);
      const hitY = this.lastHitScreenY ?? 250;
      const lockEvent: MagicFingerLockInEvent = {
        target: lockedTarget,
        value: lockedValue,
        screenX: hitX,
        screenY: hitY,
        timestamp: now,
        source: "shake",
      };

      this.isLockedIn = true;
      this.lockedTarget = lockedTarget;
      this.lockedValue = lockedValue;
      this.activeTarget = null;
      this.state = "idle";
      this.hoverTarget = null;
      this.currentHoverTarget = null;
      this.hoverStartTime = 0;
      resetHoldLockTracker(this.holdLockTracker);
      this.handMotionHistory.clear();

      this.callbacks.onLockIn?.(lockEvent);

      const lockedDimmedRay = createShakeLockDimmedRay(lockedTarget, hitX, hitY);
      const telemetry: MagicFingerTelemetry = {
        isActive: false,
        state: "idle",
        pointingHandIndex: null,
        hoverTarget: null,
        activeTarget: null,
        targetedSectionId: null,
        liveBpm: this.lastBpm,
        liveDynamic: this.lastDynamic,
        ray: lockedDimmedRay,
        isLockedIn: true,
        lockInEvent: lockEvent,
        chargeProgress: 0,
        chargeTarget: null,
      };
      this.callbacks.onTelemetry?.(telemetry);
      return telemetry;
    }

    // 1. Gather all candidate pointing hands
    const candidateSamples = samples.filter(
      s => s.gesture && isPointingGesture(s.gesture) && s.landmarks && s.landmarks.length >= 21
    );

    if (candidateSamples.length === 0) {
      this.isLockedIn = false;
      this.lockedTarget = null;
      this.lockedValue = null;
      resetHoldLockTracker(this.holdLockTracker);
    }

    const pointingSample = selectPointingHand(
      candidateSamples,
      this.activeTarget,
      this.lastPointingHandIndex,
      isMirrored
    );

    this.lastPointingHandIndex = pointingSample ? pointingSample.handIndex : null;

    if (!pointingSample || !pointingSample.landmarks || pointingSample.landmarks.length < 21) {
      const wasSpotlighted = this.targetedSectionId !== null;
      this.state = "idle";
      this.activeTarget = null;
      this.hoverTarget = null;
      this.currentHoverTarget = null;
      this.hoverStartTime = 0;
      resetHoldLockTracker(this.holdLockTracker);
      this.targetedSectionId = null;
      this.raySmoother.reset();
      this.lastPointingHandIndex = null;
      this.tempoGaugeState = { smoothedHitY: null, lastHitY: null, lastHitTime: 0, outOfBoundsFrames: 0 };
      this.dynamicsGaugeState = { smoothedHitY: null, lastHitY: null, lastHitTime: 0, outOfBoundsFrames: 0 };
      this.isLockedIn = false;
      this.lockedTarget = null;
      this.lockedValue = null;

      if (wasSpotlighted) {
        this.callbacks.onSpotlightChange?.(null);
      }

      const telemetry: MagicFingerTelemetry = {
        isActive: false,
        state: "idle",
        pointingHandIndex: null,
        hoverTarget: null,
        activeTarget: null,
        targetedSectionId: null,
        liveBpm: null,
        liveDynamic: null,
        ray: null,
        isLockedIn: false,
        lockInEvent: null,
      };

      this.callbacks.onTelemetry?.(telemetry);
      return telemetry;
    }

    // Geometry rects
    const canvasRect = this.geometry.getCanvasRect();
    const svgRect = this.geometry.getSvgOverlayRect();
    const tempoTrackRect = this.geometry.getTempoTrackRect();
    const dynamicsTrackRect = this.geometry.getDynamicsTrackRect();
    const tempoContainerRect = this.geometry.getTempoContainerRect ? this.geometry.getTempoContainerRect() : tempoTrackRect;
    const dynamicsContainerRect = this.geometry.getDynamicsContainerRect ? this.geometry.getDynamicsContainerRect() : dynamicsTrackRect;
    const instrumentSections = this.geometry.getInstrumentSections();

    if (!canvasRect || !svgRect) {
      const fallbackTelemetry: MagicFingerTelemetry = {
        isActive: true,
        state: "pointing",
        pointingHandIndex: pointingSample.handIndex,
        hoverTarget: null,
        activeTarget: null,
        targetedSectionId: null,
        liveBpm: null,
        liveDynamic: null,
        ray: null,
      };
      this.callbacks.onTelemetry?.(fallbackTelemetry);
      return fallbackTelemetry;
    }

    const { startX, startY, unitX, unitY } = extractFingertipCoordinates(
      pointingSample,
      canvasRect,
      svgRect,
      isMirrored
    );

    const { dirX: rayDirX, dirY: rayDirY } = this.raySmoother.smooth(unitX, unitY);

    // Locked-in evaluation
    if (this.isLockedIn && this.lockedTarget !== null) {
      const lockEval = evaluateLockedInRearming({
        lockedTarget: this.lockedTarget,
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
        sections: this.sections,
      });

      if (lockEval.shouldRearm) {
        this.isLockedIn = false;
        this.lockedTarget = null;
        this.lockedValue = null;
        resetHoldLockTracker(this.holdLockTracker);
      } else {
        const telemetry: MagicFingerTelemetry = {
          isActive: false,
          state: "idle",
          pointingHandIndex: pointingSample.handIndex,
          hoverTarget: null,
          activeTarget: null,
          targetedSectionId: null,
          liveBpm: this.lockedTarget === "tempo" ? this.lockedValue : this.lastBpm,
          liveDynamic: this.lockedTarget === "dynamics" ? this.lockedValue : this.lastDynamic,
          ray: lockEval.dimmedRay,
          isLockedIn: true,
          lockInEvent: null,
          chargeProgress: 0,
          chargeTarget: null,
        };
        this.callbacks.onTelemetry?.(telemetry);
        return telemetry;
      }
    }

    let endX = startX + rayDirX * MAGIC_FINGER_TUNING.RAY_FREE_DISTANCE_PX;
    let endY = startY + rayDirY * MAGIC_FINGER_TUNING.RAY_FREE_DISTANCE_PX;
    let rayTargetType: MagicFingerRay["targetType"] = "open";
    this.hoverTarget = null;
    let liveBpm: number | null = null;
    let liveDynamic: number | null = null;
    let releasedThisFrame = false;

    // 1. Active Target Processing
    if (this.activeTarget !== null) {
      const activeRes = processActiveTarget({
        activeTarget: this.activeTarget,
        pointingSample,
        startX,
        startY,
        rayDirX,
        rayDirY,
        svgRect,
        tempoTrackRect,
        dynamicsTrackRect,
        instrumentSections,
        sections: this.sections,
        now,
        tempoGaugeState: this.tempoGaugeState,
        dynamicsGaugeState: this.dynamicsGaugeState,
        holdLockTracker: this.holdLockTracker,
        lastValidInBoundsBpm: this.lastValidInBoundsBpm,
        lastValidInBoundsDynamic: this.lastValidInBoundsDynamic,
        defaultEndX: endX,
        defaultEndY: endY,
      });

      releasedThisFrame = activeRes.releasedThisFrame;
      this.activeTarget = activeRes.activeTarget;
      this.state = activeRes.state;
      this.lastValidInBoundsBpm = activeRes.lastValidInBoundsBpm;
      this.lastValidInBoundsDynamic = activeRes.lastValidInBoundsDynamic;
      this.tempoGaugeState = activeRes.tempoGaugeState;
      this.dynamicsGaugeState = activeRes.dynamicsGaugeState;
      this.holdLockTracker = activeRes.holdLockTracker;
      endX = activeRes.endX;
      endY = activeRes.endY;
      this.lastHitScreenX = activeRes.lastHitScreenX;
      this.lastHitScreenY = activeRes.lastHitScreenY;
      rayTargetType = activeRes.rayTargetType;
      liveBpm = activeRes.liveBpm;
      liveDynamic = activeRes.liveDynamic;

      if (activeRes.lastBpm !== undefined) {
        this.lastBpm = activeRes.lastBpm;
        this.callbacks.onBpmChange?.(this.lastBpm);
      }
      if (activeRes.lastDynamic !== undefined) {
        this.lastDynamic = activeRes.lastDynamic;
        this.callbacks.onDynamicChange?.(this.lastDynamic);
      }

      if (activeRes.isLockedIn) {
        this.isLockedIn = true;
        this.lockedTarget = activeRes.lockedTarget;
        this.lockedValue = activeRes.lockedValue;
        lockInEvent = activeRes.lockInEvent;
        if (lockInEvent) {
          this.callbacks.onLockIn?.(lockInEvent);
        }
      }
    }

    // 2. Acquisition & Targeting
    if (this.activeTarget === null && !this.isLockedIn) {
      const acqRes = processAcquisition({
        startX,
        startY,
        rayDirX,
        rayDirY,
        svgRect,
        tempoTrackRect,
        dynamicsTrackRect,
        instrumentSections,
        sections: this.sections,
        indicatedBpm,
        continuousDynamic,
        currentHoverTarget: this.currentHoverTarget,
        hoverStartTime: this.hoverStartTime,
        releasedThisFrame,
        targetedSectionId: this.targetedSectionId,
        defaultEndX: endX,
        defaultEndY: endY,
        now,
      });

      this.activeTarget = acqRes.activeTarget;
      this.state = acqRes.state;
      this.hoverTarget = acqRes.hoverTarget;
      this.currentHoverTarget = acqRes.currentHoverTarget;
      this.hoverStartTime = acqRes.hoverStartTime;
      this.targetedSectionId = acqRes.targetedSectionId;
      endX = acqRes.endX;
      endY = acqRes.endY;
      if (acqRes.lastHitScreenX !== null) this.lastHitScreenX = acqRes.lastHitScreenX;
      if (acqRes.lastHitScreenY !== null) this.lastHitScreenY = acqRes.lastHitScreenY;
      rayTargetType = acqRes.rayTargetType;
      liveBpm = acqRes.liveBpm;
      liveDynamic = acqRes.liveDynamic;

      if (acqRes.sectionChangedTo !== undefined) {
        this.callbacks.onSpotlightChange?.(acqRes.sectionChangedTo);
      }

      if (acqRes.tempoAcquired) {
        this.lastBpm = acqRes.tempoAcquired.bpm;
        this.lastValidInBoundsBpm = this.lastBpm;
        this.tempoGaugeState = {
          smoothedHitY: null,
          lastHitY: acqRes.tempoAcquired.lastHitY,
          lastHitTime: now,
          outOfBoundsFrames: 0,
        };
        this.holdLockTracker = {
          holdSteadyStartTime: now,
          holdSteadyValue: this.lastBpm,
          chargeProgress: 0,
        };
        this.callbacks.onBpmChange?.(this.lastBpm);
      }

      if (acqRes.dynamicsAcquired) {
        this.lastDynamic = acqRes.dynamicsAcquired.dynamic;
        this.lastValidInBoundsDynamic = this.lastDynamic;
        this.dynamicsGaugeState = {
          smoothedHitY: null,
          lastHitY: acqRes.dynamicsAcquired.lastHitY,
          lastHitTime: now,
          outOfBoundsFrames: 0,
        };
        this.holdLockTracker = {
          holdSteadyStartTime: now,
          holdSteadyValue: this.lastDynamic,
          chargeProgress: 0,
        };
        this.callbacks.onDynamicChange?.(this.lastDynamic);
      }
    }

    if (this.hoverTarget === null) {
      this.currentHoverTarget = null;
      this.hoverStartTime = 0;
    }

    const isAcquired = this.activeTarget !== null || this.state === "instrument_targeted" || this.hoverTarget === "instrument";

    const ray: MagicFingerRay = {
      startX,
      startY,
      endX,
      endY,
      unitX: rayDirX,
      unitY: rayDirY,
      isActive: true,
      isAcquired,
      targetType: rayTargetType,
      isDimmed: this.isLockedIn,
    };

    const telemetry: MagicFingerTelemetry = {
      isActive: !this.isLockedIn,
      state: this.state,
      pointingHandIndex: pointingSample.handIndex,
      hoverTarget: this.hoverTarget,
      activeTarget: this.activeTarget,
      targetedSectionId: this.targetedSectionId,
      liveBpm,
      liveDynamic,
      ray,
      isLockedIn: this.isLockedIn,
      lockInEvent,
      chargeProgress: this.holdLockTracker.chargeProgress,
      chargeTarget: this.holdLockTracker.chargeProgress > 0 ? (this.activeTarget as "tempo" | "dynamics") : null,
    };

    this.callbacks.onTelemetry?.(telemetry);
    return telemetry;
  }
}
