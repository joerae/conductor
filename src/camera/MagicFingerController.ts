/**
 * MagicFingerController.ts
 *
 * Dedicated interaction controller for Magic Finger Mode (☝️ Magic Finger).
 * Controls real-time conducting via laser pointer across three target zones:
 * 1. Instrument sections above camera (instant spotlight)
 * 2. Tempo gauge to the right (vertical slider 40-220 BPM with safe acquisition)
 * 3. Dynamics ribbon below camera (horizontal slider 0.0-1.0 continuous with safe acquisition)
 */

import type { HandSample } from "./cameraTypes";
import { HAND_LANDMARK_INDICES, isPointingGesture } from "./cameraTypes";
import { percentToBpm } from "../ui/bpmGauge";
import type { PieceSection } from "../score/repertoire";

export const MAGIC_FINGER_TUNING = {
  TEMPO_CAPTURE_BPM_DELTA: 35,
  TEMPO_RELEASE_PAD_PX: 50,
  DYNAMICS_CAPTURE_DELTA: 0.25,
  DYNAMICS_RELEASE_PAD_PX: 50,
  DWELL_ACQUIRE_MS: 280,
  SMOOTHING_ALPHA: 0.40,
  RAY_FREE_DISTANCE_PX: 360,
  UPWARD_FLICK_SPEED_PX_PER_SEC: 350,
  HOLD_STEADY_TIME_MS: 595,
  HOLD_CHARGE_DURATION_MS: 600,
  HOLD_VALUE_TOLERANCE_BPM: 6.4,
  HOLD_VALUE_TOLERANCE_DYN: 0.056,
  HOLD_LOCK_ENABLED: true,
  SHAKE_LOCK_ENABLED: true,
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

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface InstrumentSectionTarget {
  id: string;
  rect: ScreenRect;
}

export interface MagicFingerGeometryProvider {
  getCanvasRect(): ScreenRect | null;
  getSvgOverlayRect(): ScreenRect | null;
  getTempoTrackRect(): ScreenRect | null;
  getDynamicsTrackRect(): ScreenRect | null;
  getInstrumentSections(): InstrumentSectionTarget[];
}

export class DefaultDOMGeometryProvider implements MagicFingerGeometryProvider {
  getCanvasRect(): ScreenRect | null {
    if (typeof document === "undefined") return null;
    const el = document.getElementById("camera-canvas") || document.querySelector(".camera-canvas");
    return el ? el.getBoundingClientRect() : null;
  }
  getSvgOverlayRect(): ScreenRect | null {
    if (typeof document === "undefined") return null;
    const el = document.getElementById("stage-spotlight-ray-overlay");
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && el.parentElement) {
      return el.parentElement.getBoundingClientRect();
    }
    return rect;
  }
  getTempoTrackRect(): ScreenRect | null {
    if (typeof document === "undefined") return null;
    const el = document.querySelector<HTMLElement>(".bpm-gauge-track");
    return el ? el.getBoundingClientRect() : null;
  }
  getDynamicsTrackRect(): ScreenRect | null {
    if (typeof document === "undefined") return null;
    const verticalEl = document.getElementById("dynamic-vertical-analogue-track");
    if (verticalEl && verticalEl.offsetParent !== null) {
      return verticalEl.getBoundingClientRect();
    }
    const el = document.getElementById("dynamic-analogue-track");
    return el ? el.getBoundingClientRect() : null;
  }
  getInstrumentSections(): InstrumentSectionTarget[] {
    if (typeof document === "undefined") return [];
    const sections: InstrumentSectionTarget[] = [];
    const els = document.querySelectorAll<HTMLElement>(".instrument-section");
    els.forEach(el => {
      const dataId = el.getAttribute("data-section-id");
      const id = dataId || el.id.replace(/^section-/, "");
      sections.push({ id, rect: el.getBoundingClientRect() });
    });
    return sections;
  }
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

  // State
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
  private smoothedUnitX: number = 0;
  private smoothedUnitY: number = -1;
  private hasSmoothedDir: boolean = false;

  // Tracking speed along gauge to detect upward flick exits
  private lastHitY: number | null = null;
  private lastHitTime: number = 0;

  // Lock-in state & repointing protection
  private isLockedIn: boolean = false;
  private lockedTarget: "tempo" | "dynamics" | null = null;
  private lockedValue: number | null = null;
  private lastHitScreenX: number | null = null;
  private lastHitScreenY: number | null = null;

  // Hold-to-lock state
  private holdSteadyStartTime: number = 0;
  private holdSteadyValue: number | null = null;
  private chargeProgress: number = 0;

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

  /**
   * Reset all acquired state on mode change or deactivation.
   */
  reset(): void {
    this.state = "idle";
    this.activeTarget = null;
    this.hoverTarget = null;
    this.currentHoverTarget = null;
    this.hoverStartTime = 0;
    this.targetedSectionId = null;
    this.hasSmoothedDir = false;
    this.lastPointingHandIndex = null;
    this.lastHitY = null;
    this.lastHitTime = 0;
    this.isLockedIn = false;
    this.lockedTarget = null;
    this.lastHitScreenX = null;
    this.lastHitScreenY = null;
    this.handMotionHistory.clear();
    this.lastValidInBoundsBpm = this.lastBpm;
    this.lastValidInBoundsDynamic = this.lastDynamic;
    this.callbacks.onSpotlightChange?.(null);
  }

  private isHandShaking(points: Array<{ x: number; y: number; time: number }>): boolean {
    if (points.length < 4) return false;
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
    const hasReversals = (xReversals >= 2 && excursionX >= 0.03) || (yReversals >= 2 && excursionY >= 0.03);
    return hasReversals && totalDist >= 0.05;
  }

  private getTargetedInstrumentSection(
    rayDirX: number,
    rayDirY: number,
    startX: number,
    startY: number,
    svgRect: ScreenRect,
    instrumentSections: InstrumentSectionTarget[]
  ): { sectionId: string; projectedHitX: number; projectedHitY: number } | null {
    if (rayDirY >= -0.10) return null;

    let effectiveSections: InstrumentSectionTarget[] = instrumentSections;
    if (effectiveSections.length === 0 && this.sections.length > 0) {
      const count = this.sections.length;
      const totalW = svgRect.width || 1000;
      effectiveSections = this.sections.map((sec, idx) => {
        const secW = (totalW * 0.76) / count;
        const left = (svgRect.left || 0) + totalW * 0.12 + idx * secW;
        return {
          id: sec.id,
          rect: {
            left,
            right: left + secW,
            top: (svgRect.top || 0) + 10,
            bottom: (svgRect.top || 0) + 120,
            width: secW,
            height: 110,
          },
        };
      });
    }

    if (effectiveSections.length === 0) return null;

    let targetBaselineY = 60;
    if (effectiveSections[0]) {
      const firstRect = effectiveSections[0].rect;
      targetBaselineY = (firstRect.top - svgRect.top) + firstRect.height * 0.78;
    }

    const rayDist = (startY - targetBaselineY) / (-rayDirY);
    const projectedHitX = startX + rayDirX * rayDist;
    const projectedHitY = startY + rayDirY * rayDist;

    let bestSectionId: string | null = null;
    let minDistance = Infinity;

    for (const sec of effectiveSections) {
      const secLeft = sec.rect.left - svgRect.left;
      const secRight = sec.rect.right - svgRect.left;
      const secCenterX = (secLeft + secRight) / 2;

      // Generous hit testing pad (15% on each side)
      const padX = (secRight - secLeft) * 0.15;
      if (projectedHitX >= secLeft - padX && projectedHitX <= secRight + padX) {
        const dist = Math.abs(projectedHitX - secCenterX);
        if (dist < minDistance) {
          minDistance = dist;
          bestSectionId = sec.id;
        }
      }
    }

    if (bestSectionId) {
      const numIdx = parseInt(bestSectionId, 10);
      if (!isNaN(numIdx) && this.sections[numIdx]) {
        bestSectionId = this.sections[numIdx].id;
      }
      return { sectionId: bestSectionId, projectedHitX, projectedHitY };
    }

    return null;
  }

  /**
   * Main per-frame update loop.
   */
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
    for (const s of samples) {
      if (!s.landmarks || s.landmarks.length < 21) continue;
      const pt = s.landmarks[0] || s.conductorPoint;
      let hist = this.handMotionHistory.get(s.handIndex);
      if (!hist) {
        hist = [];
        this.handMotionHistory.set(s.handIndex, hist);
      }
      hist.push({ x: pt.x, y: pt.y, time: now });
      const cutoff = now - 320;
      while (hist.length > 0 && hist[0].time < cutoff) {
        hist.shift();
      }
    }

    // Check if either hand is shaking to trigger lock-in
    let isAnyHandShaking = false;
    for (const hist of this.handMotionHistory.values()) {
      if (this.isHandShaking(hist)) {
        isAnyHandShaking = true;
        break;
      }
    }

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
      this.holdSteadyStartTime = 0;
      this.holdSteadyValue = null;
      this.chargeProgress = 0;
      this.handMotionHistory.clear();

      this.callbacks.onLockIn?.(lockEvent);

      const lockedDimmedRay: MagicFingerRay = {
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
      // Pulling finger in clears lock-in so user can point again!
      this.isLockedIn = false;
      this.lockedTarget = null;
      this.lockedValue = null;
      this.holdSteadyStartTime = 0;
      this.holdSteadyValue = null;
      this.chargeProgress = 0;
    }

    let pointingSample: HandSample | null = null;

    if (candidateSamples.length === 1) {
      pointingSample = candidateSamples[0];
    } else if (candidateSamples.length > 1) {
      // Multiple pointing hands detected: apply directional emergent finger switching
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
      if (this.activeTarget === "tempo") {
        metrics.sort((a, b) => b.screenX - a.screenX);
        pointingSample = metrics[0].s;
      }
      // If actively controlling or pointing towards Dynamics (left edge): select finger closest to left edge (min screenX)
      else if (this.activeTarget === "dynamics") {
        metrics.sort((a, b) => a.screenX - b.screenX);
        pointingSample = metrics[0].s;
      }
      else {
        const rightward = metrics.filter(m => m.rawDirX > 0.10);
        const leftward = metrics.filter(m => m.rawDirX < -0.10);
        const upward = metrics.filter(m => m.rawDirY < -0.10);

        if (rightward.length > 0 && leftward.length === 0) {
          // Pointing towards Tempo (right edge): select the finger closest to the right edge
          rightward.sort((a, b) => b.screenX - a.screenX);
          pointingSample = rightward[0].s;
        } else if (leftward.length > 0 && rightward.length === 0) {
          // Pointing towards Dynamics (left edge): select the finger closest to the left edge
          leftward.sort((a, b) => a.screenX - b.screenX);
          pointingSample = leftward[0].s;
        } else if (upward.length > 0) {
          // Pointing towards Orchestra (top edge): select the finger closest to the top (lowest tipY / highest hand)
          upward.sort((a, b) => a.tipY - b.tipY);
          pointingSample = upward[0].s;
        } else {
          // General fallback: maintain previous pointing hand if still pointing
          const prev = metrics.find(m => m.s.handIndex === this.lastPointingHandIndex);
          if (prev) {
            pointingSample = prev.s;
          } else {
            metrics.sort((a, b) => a.tipY - b.tipY);
            pointingSample = metrics[0].s;
          }
        }
      }
    }

    this.lastPointingHandIndex = pointingSample ? pointingSample.handIndex : null;

    // If finger is retracted, release everything immediately and hide laser
    if (!pointingSample || !pointingSample.landmarks || pointingSample.landmarks.length < 21) {
      const wasSpotlighted = this.targetedSectionId !== null;
      this.state = "idle";
      this.activeTarget = null;
      this.hoverTarget = null;
      this.currentHoverTarget = null;
      this.hoverStartTime = 0;
      this.holdSteadyStartTime = 0;
      this.holdSteadyValue = null;
      this.chargeProgress = 0;
      this.targetedSectionId = null;
      this.hasSmoothedDir = false;
      this.lastPointingHandIndex = null;
      this.lastHitY = null;
      this.lastHitTime = 0;
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
    const instrumentSections = this.geometry.getInstrumentSections();

    // Fallback if DOM geometry is unavailable
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

    // Fingertip & Knuckle coordinates
    const tip = pointingSample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP];
    const pip = pointingSample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_PIP] ||
                pointingSample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_MCP];

    const tipScreenNormX = Math.max(0, Math.min(1, isMirrored ? 1.0 - tip.x : tip.x));
    const clampedTipY = Math.max(0, Math.min(1, tip.y));
    const pipScreenNormX = pip ? Math.max(0, Math.min(1, isMirrored ? 1.0 - pip.x : pip.x)) : tipScreenNormX;
    const pipScreenNormY = pip ? Math.max(0, Math.min(1, pip.y)) : clampedTipY + 0.05;

    // Start coordinates in SVG space
    const startX = (canvasRect.left - svgRect.left) + tipScreenNormX * canvasRect.width;
    const startY = (canvasRect.top - svgRect.top) + clampedTipY * canvasRect.height;

    // Raw ray direction vector in screen pixels
    const rawDirX = (tipScreenNormX - pipScreenNormX) * canvasRect.width;
    const rawDirY = (clampedTipY - pipScreenNormY) * canvasRect.height;
    const rawLen = Math.hypot(rawDirX, rawDirY);

    let unitX = 0;
    let unitY = -1;
    if (rawLen > 0.001) {
      unitX = rawDirX / rawLen;
      unitY = rawDirY / rawLen;
    }

    // Apply smoothing to ray direction
    if (!this.hasSmoothedDir) {
      this.smoothedUnitX = unitX;
      this.smoothedUnitY = unitY;
      this.hasSmoothedDir = true;
    } else {
      const alpha = MAGIC_FINGER_TUNING.SMOOTHING_ALPHA;
      const currentAngle = Math.atan2(this.smoothedUnitY, this.smoothedUnitX);
      const targetAngle = Math.atan2(unitY, unitX);
      const diff = ((targetAngle - currentAngle + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      const newAngle = currentAngle + alpha * diff;
      this.smoothedUnitX = Math.cos(newAngle);
      this.smoothedUnitY = Math.sin(newAngle);
    }

    const rayDirX = this.smoothedUnitX;
    const rayDirY = this.smoothedUnitY;

    // ── EVALUATE LOCKED-IN STATE & ZONE REARMING ────────────────────────────
    if (this.isLockedIn) {
      // 1. Check if pointer clearly aims outside the locked control zone:
      // A) Pointing up to orchestra / instruments:
      // Rearm ONLY IF ACTUALLY POINTING AT AN ORCHESTRA INSTRUMENT SECTION!
      // Simply pointing high along the gauge (e.g. at 200 BPM or fff) will project outside the instrument bounds and stay locked.
      const targetedInstrument = this.getTargetedInstrumentSection(
        rayDirX,
        rayDirY,
        startX,
        startY,
        svgRect,
        instrumentSections
      );
      const pointingUpToOrchestra = Boolean(targetedInstrument);

      // B) Pointing across to opposite control side:
      const pointingAcross = this.lockedTarget === "tempo"
        ? (dynamicsTrackRect ? (startX + rayDirX * 360 < (dynamicsTrackRect.right - svgRect.left) + 40) : rayDirX < -0.15)
        : (tempoTrackRect ? (startX + rayDirX * 360 > (tempoTrackRect.left - svgRect.left) - 40) : rayDirX > 0.15);

      if (pointingUpToOrchestra || pointingAcross) {
        // REARM! Pointer has exited the locked control zone into another zone
        this.isLockedIn = false;
        this.lockedTarget = null;
        this.lockedValue = null;
        this.holdSteadyStartTime = 0;
        this.holdSteadyValue = null;
        this.chargeProgress = 0;
      } else {
        // Still pointing within the locked control zone:
        // Value remains strictly frozen, laser is kept in darker/dimmed inactive state
        const targetRect = this.lockedTarget === "tempo" ? tempoTrackRect : dynamicsTrackRect;
        let lockedEndX = startX;
        let lockedEndY = startY;

        if (targetRect) {
          const trackLeft = targetRect.left - svgRect.left;
          const trackRight = targetRect.right - svgRect.left;
          const trackTop = targetRect.top - svgRect.top;
          const trackBottom = targetRect.bottom - svgRect.top;
          const trackCenterX = (trackLeft + trackRight) / 2;
          lockedEndX = trackCenterX;
          if (Math.abs(rayDirX) > 0.02) {
            const t = (trackCenterX - startX) / rayDirX;
            lockedEndY = Math.max(trackTop, Math.min(trackBottom, startY + rayDirY * t));
          } else {
            lockedEndY = Math.max(trackTop, Math.min(trackBottom, startY));
          }
        }

        const dimmedRay: MagicFingerRay = {
          startX,
          startY,
          endX: lockedEndX,
          endY: lockedEndY,
          unitX: rayDirX,
          unitY: rayDirY,
          isActive: true,
          isAcquired: true,
          targetType: this.lockedTarget,
          isDimmed: true,
        };

        const telemetry: MagicFingerTelemetry = {
          isActive: false,
          state: "idle",
          pointingHandIndex: pointingSample.handIndex,
          hoverTarget: null,
          activeTarget: null,
          targetedSectionId: null,
          liveBpm: this.lockedTarget === "tempo" ? this.lockedValue : this.lastBpm,
          liveDynamic: this.lockedTarget === "dynamics" ? this.lockedValue : this.lastDynamic,
          ray: dimmedRay,
          isLockedIn: true,
          lockInEvent: null,
          chargeProgress: 0,
          chargeTarget: null,
        };
        this.callbacks.onTelemetry?.(telemetry);
        return telemetry;
      }
    }

    // Default ray endpoint in open space
    let endX = startX + rayDirX * MAGIC_FINGER_TUNING.RAY_FREE_DISTANCE_PX;
    let endY = startY + rayDirY * MAGIC_FINGER_TUNING.RAY_FREE_DISTANCE_PX;
    let rayTargetType: MagicFingerRay["targetType"] = "open";

    this.hoverTarget = null;
    let liveBpm: number | null = null;
    let liveDynamic: number | null = null;

    let releasedThisFrame = false;

    // ── 1. ACTIVE TARGET PROCESSING (If already acquired) ─────────────────────
    if (this.activeTarget === "tempo" && tempoTrackRect) {
      const tempoTrackLeft = tempoTrackRect.left - svgRect.left;
      const tempoTrackRight = tempoTrackRect.right - svgRect.left;
      const tempoTrackTop = tempoTrackRect.top - svgRect.top;
      const tempoTrackBottom = tempoTrackRect.bottom - svgRect.top;
      const tempoTrackCenterX = (tempoTrackLeft + tempoTrackRight) / 2;
      const tempoTrackHeight = Math.max(1, tempoTrackBottom - tempoTrackTop);

      // Project ray onto vertical line of tempo gauge
      let hitY = startY;
      if (Math.abs(rayDirX) > 0.02) {
        const t = (tempoTrackCenterX - startX) / rayDirX;
        hitY = startY + rayDirY * t;
      } else {
        hitY = startY;
      }

      // Track vertical speed along the gauge (positive when moving upward towards top)
      const prevHitY = this.lastHitY ?? hitY;
      const dt = this.lastHitTime > 0 ? Math.max(1, now - this.lastHitTime) : 33;
      const upwardSpeedPxPerSec = ((prevHitY - hitY) / dt) * 1000;
      this.lastHitY = hitY;
      this.lastHitTime = now;

      // Check for fist curl / collapsing finger extension
      let isClosingFist = false;
      if (pointingSample.landmarks && pointingSample.landmarks.length >= 21) {
        const tip = pointingSample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP];
        const mcp = pointingSample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_MCP];
        const wrist = pointingSample.landmarks[HAND_LANDMARK_INDICES.WRIST];
        const middleMcp = pointingSample.landmarks[HAND_LANDMARK_INDICES.MIDDLE_FINGER_MCP];
        if (tip && mcp && wrist && middleMcp) {
          const handScale = Math.max(0.04, Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y));
          const extension = Math.hypot(tip.x - mcp.x, tip.y - mcp.y) / handScale;
          if (extension < 0.72) {
            isClosingFist = true;
          }
        }
      }

      // Detect upward flick exit to orchestra:
      // 1. Ray turned inward away from right edge towards orchestra / center stage
      const turnedInwardToOrchestra = rayDirX < 0.08;
      // 2. Ray flicked upward rapidly near the top of the gauge
      const isRapidUpwardFlick = upwardSpeedPxPerSec > MAGIC_FINGER_TUNING.UPWARD_FLICK_SPEED_PX_PER_SEC && hitY < tempoTrackTop + 50;
      // 3. Ray moved above the top of the gauge
      const isAboveGauge = hitY < tempoTrackTop;

      const pad = MAGIC_FINGER_TUNING.TEMPO_RELEASE_PAD_PX;
      const projectedX = (Math.abs(rayDirX) > 0.02)
        ? tempoTrackCenterX
        : startX + rayDirX * MAGIC_FINGER_TUNING.RAY_FREE_DISTANCE_PX;

      const isOutsideBounds =
        projectedX < tempoTrackLeft - pad ||
        projectedX > tempoTrackRight + pad ||
        hitY > tempoTrackBottom + pad;

      if (turnedInwardToOrchestra || isRapidUpwardFlick || isAboveGauge || isOutsideBounds || isClosingFist) {
        // Release tempo control immediately without committing max/out-of-bounds or dropped fist-curl BPM!
        this.activeTarget = null;
        this.state = "pointing";
        this.lastBpm = this.lastValidInBoundsBpm;
        this.callbacks.onBpmChange?.(this.lastValidInBoundsBpm);
        releasedThisFrame = true;
        this.lastHitY = null;
        this.lastHitTime = 0;
        this.holdSteadyStartTime = 0;
        this.holdSteadyValue = null;
        this.chargeProgress = 0;
      } else {
        // Control tempo continuously within track bounds
        const clampedY = Math.max(tempoTrackTop, Math.min(tempoTrackBottom, hitY));
        const pct = ((tempoTrackBottom - clampedY) / tempoTrackHeight) * 100;
        const newBpm = Math.round(percentToBpm(pct));

        this.lastValidInBoundsBpm = newBpm;
        this.lastBpm = newBpm;
        liveBpm = newBpm;
        this.callbacks.onBpmChange?.(newBpm);

        endX = tempoTrackCenterX;
        endY = clampedY;
        this.lastHitScreenX = endX;
        this.lastHitScreenY = endY;
        rayTargetType = "tempo";
        this.state = "tempo_acquired";

        // Hold-to-lock logic for tempo
        if (MAGIC_FINGER_TUNING.HOLD_LOCK_ENABLED) {
          if (this.holdSteadyValue === null || Math.abs(newBpm - this.holdSteadyValue) > MAGIC_FINGER_TUNING.HOLD_VALUE_TOLERANCE_BPM) {
            this.holdSteadyStartTime = now;
            this.holdSteadyValue = newBpm;
            this.chargeProgress = 0;
          } else {
            const steadyDuration = now - this.holdSteadyStartTime;
            if (steadyDuration >= MAGIC_FINGER_TUNING.HOLD_STEADY_TIME_MS) {
              const chargeElapsed = steadyDuration - MAGIC_FINGER_TUNING.HOLD_STEADY_TIME_MS;
              this.chargeProgress = Math.min(1.0, chargeElapsed / Math.max(1, MAGIC_FINGER_TUNING.HOLD_CHARGE_DURATION_MS));
              if (this.chargeProgress >= 1.0) {
                // Lock in!
                this.isLockedIn = true;
                this.lockedTarget = "tempo";
                this.lockedValue = newBpm;
                this.activeTarget = null;
                this.state = "idle";
                lockInEvent = {
                  target: "tempo",
                  value: newBpm,
                  screenX: endX,
                  screenY: endY,
                  timestamp: now,
                  source: "hold",
                };
                this.callbacks.onLockIn?.(lockInEvent);
                this.holdSteadyStartTime = 0;
                this.holdSteadyValue = null;
                this.chargeProgress = 0;
              }
            } else {
              this.chargeProgress = 0;
            }
          }
        }
      }
    } else if (this.activeTarget === "dynamics" && dynamicsTrackRect) {
      const isVertical = dynamicsTrackRect.height > dynamicsTrackRect.width;
      const dynTrackLeft = dynamicsTrackRect.left - svgRect.left;
      const dynTrackRight = dynamicsTrackRect.right - svgRect.left;
      const dynTrackTop = dynamicsTrackRect.top - svgRect.top;
      const dynTrackBottom = dynamicsTrackRect.bottom - svgRect.top;
      const dynTrackCenterX = (dynTrackLeft + dynTrackRight) / 2;
      const dynTrackCenterY = (dynTrackTop + dynTrackBottom) / 2;
      const dynTrackWidth = Math.max(1, dynTrackRight - dynTrackLeft);
      const dynTrackHeight = Math.max(1, dynTrackBottom - dynTrackTop);
      const pad = MAGIC_FINGER_TUNING.DYNAMICS_RELEASE_PAD_PX;

      // Check for fist curl / collapsing finger extension
      let isClosingFist = false;
      if (pointingSample.landmarks && pointingSample.landmarks.length >= 21) {
        const tip = pointingSample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP];
        const mcp = pointingSample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_MCP];
        const wrist = pointingSample.landmarks[HAND_LANDMARK_INDICES.WRIST];
        const middleMcp = pointingSample.landmarks[HAND_LANDMARK_INDICES.MIDDLE_FINGER_MCP];
        if (tip && mcp && wrist && middleMcp) {
          const handScale = Math.max(0.04, Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y));
          const extension = Math.hypot(tip.x - mcp.x, tip.y - mcp.y) / handScale;
          if (extension < 0.72) {
            isClosingFist = true;
          }
        }
      }

      if (isVertical) {
        // Project ray onto vertical line of left dynamics gauge
        let hitY = startY;
        if (Math.abs(rayDirX) > 0.02) {
          const t = (dynTrackCenterX - startX) / rayDirX;
          hitY = startY + rayDirY * t;
        } else {
          hitY = startY;
        }

        // Track vertical speed along the gauge (positive when moving upward towards top)
        const prevHitY = this.lastHitY ?? hitY;
        const dt = this.lastHitTime > 0 ? Math.max(1, now - this.lastHitTime) : 33;
        const upwardSpeedPxPerSec = ((prevHitY - hitY) / dt) * 1000;
        this.lastHitY = hitY;
        this.lastHitTime = now;

        // Detect upward flick exit to orchestra:
        // 1. Ray turned inward away from left edge towards orchestra / center stage
        const turnedInwardToOrchestra = rayDirX > -0.08;
        // 2. Ray flicked upward rapidly near the top of the gauge
        const isRapidUpwardFlick = upwardSpeedPxPerSec > MAGIC_FINGER_TUNING.UPWARD_FLICK_SPEED_PX_PER_SEC && hitY < dynTrackTop + 50;
        // 3. Ray moved above the top of the gauge
        const isAboveGauge = hitY < dynTrackTop;

        const projectedX = (Math.abs(rayDirX) > 0.02)
          ? dynTrackCenterX
          : startX + rayDirX * MAGIC_FINGER_TUNING.RAY_FREE_DISTANCE_PX;

        const isOutsideBounds =
          projectedX < dynTrackLeft - pad ||
          projectedX > dynTrackRight + pad ||
          hitY > dynTrackBottom + pad;

        if (turnedInwardToOrchestra || isRapidUpwardFlick || isAboveGauge || isOutsideBounds || isClosingFist) {
          // Release dynamics control immediately without committing dropped fist-curl dynamic!
          this.activeTarget = null;
          this.state = "pointing";
          this.lastDynamic = this.lastValidInBoundsDynamic;
          this.callbacks.onDynamicChange?.(this.lastValidInBoundsDynamic);
          releasedThisFrame = true;
          this.lastHitY = null;
          this.lastHitTime = 0;
          this.holdSteadyStartTime = 0;
          this.holdSteadyValue = null;
          this.chargeProgress = 0;
        } else {
          // Control continuous dynamics: Top is 1.0 (fff), Bottom is 0.0 (pp)
          const clampedY = Math.max(dynTrackTop, Math.min(dynTrackBottom, hitY));
          const continuousVal = Math.max(0, Math.min(1, (dynTrackBottom - clampedY) / dynTrackHeight));

          this.lastValidInBoundsDynamic = continuousVal;
          this.lastDynamic = continuousVal;
          liveDynamic = continuousVal;
          this.callbacks.onDynamicChange?.(continuousVal);

          endX = dynTrackCenterX;
          endY = clampedY;
          this.lastHitScreenX = endX;
          this.lastHitScreenY = endY;
          rayTargetType = "dynamics";
          this.state = "dynamics_acquired";

          // Hold-to-lock logic for dynamics (vertical)
          if (MAGIC_FINGER_TUNING.HOLD_LOCK_ENABLED) {
            if (this.holdSteadyValue === null || Math.abs(continuousVal - this.holdSteadyValue) > MAGIC_FINGER_TUNING.HOLD_VALUE_TOLERANCE_DYN) {
              this.holdSteadyStartTime = now;
              this.holdSteadyValue = continuousVal;
              this.chargeProgress = 0;
            } else {
              const steadyDuration = now - this.holdSteadyStartTime;
              if (steadyDuration >= MAGIC_FINGER_TUNING.HOLD_STEADY_TIME_MS) {
                const chargeElapsed = steadyDuration - MAGIC_FINGER_TUNING.HOLD_STEADY_TIME_MS;
                this.chargeProgress = Math.min(1.0, chargeElapsed / Math.max(1, MAGIC_FINGER_TUNING.HOLD_CHARGE_DURATION_MS));
                if (this.chargeProgress >= 1.0) {
                  // Lock in!
                  this.isLockedIn = true;
                  this.lockedTarget = "dynamics";
                  this.lockedValue = continuousVal;
                  this.activeTarget = null;
                  this.state = "idle";
                  lockInEvent = {
                    target: "dynamics",
                    value: continuousVal,
                    screenX: endX,
                    screenY: endY,
                    timestamp: now,
                    source: "hold",
                  };
                  this.callbacks.onLockIn?.(lockInEvent);
                  this.holdSteadyStartTime = 0;
                  this.holdSteadyValue = null;
                  this.chargeProgress = 0;
                }
              } else {
                this.chargeProgress = 0;
              }
            }
          }
        }
      } else {
        // Project ray onto horizontal line of bottom dynamics ribbon
        let hitX = startX;
        if (Math.abs(rayDirY) > 0.02) {
          const t = (dynTrackCenterY - startY) / rayDirY;
          hitX = startX + rayDirX * t;
        } else {
          hitX = startX;
        }

        const isUpwardExit = rayDirY < -0.15;
        const projectedY = (Math.abs(rayDirY) > 0.02)
          ? dynTrackCenterY
          : startY + rayDirY * MAGIC_FINGER_TUNING.RAY_FREE_DISTANCE_PX;

        const isOutsidePaddedZone =
          hitX < dynTrackLeft - pad ||
          hitX > dynTrackRight + pad ||
          projectedY < dynTrackTop - pad ||
          projectedY > dynTrackBottom + pad ||
          rayDirY < -0.20; // clearly pointing upwards away

        if (isUpwardExit || isOutsidePaddedZone) {
          // Release dynamics control, preserve last valid in-bounds dynamic
          this.activeTarget = null;
          this.state = "pointing";
          this.lastDynamic = this.lastValidInBoundsDynamic;
          this.callbacks.onDynamicChange?.(this.lastValidInBoundsDynamic);
          releasedThisFrame = true;
          this.holdSteadyStartTime = 0;
          this.holdSteadyValue = null;
          this.chargeProgress = 0;
        } else {
          // Control continuous dynamics
          const clampedX = Math.max(dynTrackLeft, Math.min(dynTrackRight, hitX));
          const continuousVal = Math.max(0, Math.min(1, (clampedX - dynTrackLeft) / dynTrackWidth));

          this.lastValidInBoundsDynamic = continuousVal;
          this.lastDynamic = continuousVal;
          liveDynamic = continuousVal;
          this.callbacks.onDynamicChange?.(continuousVal);

          endX = clampedX;
          endY = dynTrackCenterY;
          rayTargetType = "dynamics";
          this.state = "dynamics_acquired";

          // Hold-to-lock logic for dynamics (horizontal)
          if (MAGIC_FINGER_TUNING.HOLD_LOCK_ENABLED) {
            if (this.holdSteadyValue === null || Math.abs(continuousVal - this.holdSteadyValue) > MAGIC_FINGER_TUNING.HOLD_VALUE_TOLERANCE_DYN) {
              this.holdSteadyStartTime = now;
              this.holdSteadyValue = continuousVal;
              this.chargeProgress = 0;
            } else {
              const steadyDuration = now - this.holdSteadyStartTime;
              if (steadyDuration >= MAGIC_FINGER_TUNING.HOLD_STEADY_TIME_MS) {
                const chargeElapsed = steadyDuration - MAGIC_FINGER_TUNING.HOLD_STEADY_TIME_MS;
                this.chargeProgress = Math.min(1.0, chargeElapsed / Math.max(1, MAGIC_FINGER_TUNING.HOLD_CHARGE_DURATION_MS));
                if (this.chargeProgress >= 1.0) {
                  // Lock in!
                  this.isLockedIn = true;
                  this.lockedTarget = "dynamics";
                  this.lockedValue = continuousVal;
                  this.activeTarget = null;
                  this.state = "idle";
                  lockInEvent = {
                    target: "dynamics",
                    value: continuousVal,
                    screenX: endX,
                    screenY: endY,
                    timestamp: now,
                    source: "hold",
                  };
                  this.callbacks.onLockIn?.(lockInEvent);
                  this.holdSteadyStartTime = 0;
                  this.holdSteadyValue = null;
                  this.chargeProgress = 0;
                }
              } else {
                this.chargeProgress = 0;
              }
            }
          }
        }
      }
    }

    // ── 2. ACQUISITION & TARGETING (When no slider is acquired) ───────────────
    if (this.activeTarget === null) {
      this.state = "pointing";

      // ── A. Check Safe Acquisition on Tempo Gauge (Right) ─────────────────────
      if (tempoTrackRect && rayDirX > 0.15 && !releasedThisFrame) {
        const tempoTrackLeft = tempoTrackRect.left - svgRect.left;
        const tempoTrackRight = tempoTrackRect.right - svgRect.left;
        const tempoTrackTop = tempoTrackRect.top - svgRect.top;
        const tempoTrackBottom = tempoTrackRect.bottom - svgRect.top;
        const tempoTrackCenterX = (tempoTrackLeft + tempoTrackRight) / 2;
        const tempoTrackHeight = Math.max(1, tempoTrackBottom - tempoTrackTop);

        const t = (tempoTrackCenterX - startX) / rayDirX;
        if (t > 0) {
          const hitY = startY + rayDirY * t;
          if (hitY >= tempoTrackTop - 45 && hitY <= tempoTrackBottom + 45) {
            const clampedY = Math.max(tempoTrackTop, Math.min(tempoTrackBottom, hitY));
            const pct = ((tempoTrackBottom - clampedY) / tempoTrackHeight) * 100;
            const hitBpm = percentToBpm(pct);

            this.hoverTarget = "tempo";
            endX = tempoTrackCenterX;
            endY = clampedY;
            rayTargetType = "tempo";

            if (this.currentHoverTarget !== "tempo") {
              this.currentHoverTarget = "tempo";
              this.hoverStartTime = now;
            }

            // Safe Acquisition check:
            // 1. Instant capture if within delta of current indicated marker
            // 2. Dwell capture: holding steady on gauge grabs control automatically!
            const bpmDiff = Math.abs(hitBpm - indicatedBpm);
            const isDwellHeld = (now - this.hoverStartTime) >= MAGIC_FINGER_TUNING.DWELL_ACQUIRE_MS;

            if (bpmDiff <= MAGIC_FINGER_TUNING.TEMPO_CAPTURE_BPM_DELTA || isDwellHeld) {
              this.activeTarget = "tempo";
              this.state = "tempo_acquired";
              this.lastBpm = Math.round(hitBpm);
              this.lastValidInBoundsBpm = this.lastBpm;
              this.lastHitY = clampedY;
              this.lastHitTime = now;
              this.lastHitScreenX = endX;
              this.lastHitScreenY = clampedY;
              liveBpm = this.lastBpm;
              this.callbacks.onBpmChange?.(this.lastBpm);
              this.currentHoverTarget = null;
              this.hoverStartTime = 0;
              this.holdSteadyStartTime = now;
              this.holdSteadyValue = this.lastBpm;
              this.chargeProgress = 0;
            }
          }
        }
      }

      // ── B. Check Safe Acquisition on Dynamics Ribbon ─────────────────────────
      if (this.activeTarget === null && dynamicsTrackRect && !releasedThisFrame) {
        const isVertical = dynamicsTrackRect.height > dynamicsTrackRect.width;
        const dynTrackLeft = dynamicsTrackRect.left - svgRect.left;
        const dynTrackRight = dynamicsTrackRect.right - svgRect.left;
        const dynTrackTop = dynamicsTrackRect.top - svgRect.top;
        const dynTrackBottom = dynamicsTrackRect.bottom - svgRect.top;
        const dynTrackCenterX = (dynTrackLeft + dynTrackRight) / 2;
        const dynTrackCenterY = (dynTrackTop + dynTrackBottom) / 2;
        const dynTrackWidth = Math.max(1, dynTrackRight - dynTrackLeft);
        const dynTrackHeight = Math.max(1, dynTrackBottom - dynTrackTop);

        if (isVertical && rayDirX < -0.15) {
          // Pointing LEFT towards left vertical dynamics gauge (no upward angle restriction)
          const t = (dynTrackCenterX - startX) / rayDirX;
          if (t > 0) {
            const hitY = startY + rayDirY * t;
            if (hitY >= dynTrackTop - 45 && hitY <= dynTrackBottom + 45) {
              const clampedY = Math.max(dynTrackTop, Math.min(dynTrackBottom, hitY));
              // Top is 1.0 (fff), Bottom is 0.0 (pp)
              const hitVal = Math.max(0, Math.min(1, (dynTrackBottom - clampedY) / dynTrackHeight));

              this.hoverTarget = "dynamics";
              endX = dynTrackCenterX;
              endY = clampedY;
              rayTargetType = "dynamics";

              if (this.currentHoverTarget !== "dynamics") {
                this.currentHoverTarget = "dynamics";
                this.hoverStartTime = now;
              }

              // Safe Acquisition check:
              // 1. Instant capture if within delta of current dynamic marker
              // 2. Dwell capture: holding steady on gauge grabs control!
              const dynDiff = Math.abs(hitVal - continuousDynamic);
              const isDwellHeld = (now - this.hoverStartTime) >= MAGIC_FINGER_TUNING.DWELL_ACQUIRE_MS;

              if (dynDiff <= MAGIC_FINGER_TUNING.DYNAMICS_CAPTURE_DELTA || isDwellHeld) {
                this.activeTarget = "dynamics";
                this.state = "dynamics_acquired";
                this.lastDynamic = hitVal;
                this.lastValidInBoundsDynamic = hitVal;
                this.lastHitY = clampedY;
                this.lastHitTime = now;
                this.lastHitScreenX = endX;
                this.lastHitScreenY = clampedY;
                liveDynamic = hitVal;
                this.callbacks.onDynamicChange?.(hitVal);
                this.currentHoverTarget = null;
                this.hoverStartTime = 0;
                this.holdSteadyStartTime = now;
                this.holdSteadyValue = hitVal;
                this.chargeProgress = 0;
              }
            }
          }
        } else if (!isVertical && rayDirY > 0.15) {
          // Pointing DOWN towards bottom horizontal dynamics ribbon
          const t = (dynTrackCenterY - startY) / rayDirY;
          if (t > 0) {
            const hitX = startX + rayDirX * t;
            if (hitX >= dynTrackLeft - 35 && hitX <= dynTrackRight + 35) {
              const clampedX = Math.max(dynTrackLeft, Math.min(dynTrackRight, hitX));
              const hitVal = (clampedX - dynTrackLeft) / dynTrackWidth;

              this.hoverTarget = "dynamics";
              endX = clampedX;
              endY = dynTrackCenterY;
              rayTargetType = "dynamics";

              if (this.currentHoverTarget !== "dynamics") {
                this.currentHoverTarget = "dynamics";
                this.hoverStartTime = now;
              }

              const dynDiff = Math.abs(hitVal - continuousDynamic);
              const isDwellHeld = (now - this.hoverStartTime) >= MAGIC_FINGER_TUNING.DWELL_ACQUIRE_MS;

              if (dynDiff <= MAGIC_FINGER_TUNING.DYNAMICS_CAPTURE_DELTA || isDwellHeld) {
                this.activeTarget = "dynamics";
                this.state = "dynamics_acquired";
                this.lastDynamic = hitVal;
                this.lastValidInBoundsDynamic = hitVal;
                liveDynamic = hitVal;
                this.callbacks.onDynamicChange?.(hitVal);
                this.currentHoverTarget = null;
                this.hoverStartTime = 0;
                this.holdSteadyStartTime = now;
                this.holdSteadyValue = hitVal;
                this.chargeProgress = 0;
              }
            }
          }
        }
      }

      // ── C. Check Instrument Sections (Top) ──────────────────────────────────
      const targetedInstrument = this.getTargetedInstrumentSection(
        rayDirX,
        rayDirY,
        startX,
        startY,
        svgRect,
        instrumentSections
      );

      if (this.activeTarget === null && targetedInstrument) {
        endX = targetedInstrument.projectedHitX;
        endY = targetedInstrument.projectedHitY;
        const bestSectionId = targetedInstrument.sectionId;

        this.hoverTarget = "instrument";
        this.state = "instrument_targeted";
        rayTargetType = "instrument";

        if (this.targetedSectionId !== bestSectionId) {
          this.targetedSectionId = bestSectionId;
          this.callbacks.onSpotlightChange?.(bestSectionId);
        }
      } else if (this.activeTarget === null && rayDirY < -0.10) {
        const rayDist = (startY - 60) / (-rayDirY);
        endX = startX + rayDirX * rayDist;
        endY = startY + rayDirY * rayDist;
        if (this.targetedSectionId !== null) {
          this.targetedSectionId = null;
          this.callbacks.onSpotlightChange?.(null);
        }
      } else if (this.targetedSectionId !== null) {
        this.targetedSectionId = null;
        this.callbacks.onSpotlightChange?.(null);
      }
    }

    if (this.hoverTarget === null) {
      this.currentHoverTarget = null;
      this.hoverStartTime = 0;
    }

    // Laser turns gold when acquired on tempo, dynamics, OR when targeting an instrument section!
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
      chargeProgress: this.chargeProgress,
      chargeTarget: this.chargeProgress > 0 ? (this.activeTarget as "tempo" | "dynamics") : null,
    };

    this.callbacks.onTelemetry?.(telemetry);
    return telemetry;
  }
}
