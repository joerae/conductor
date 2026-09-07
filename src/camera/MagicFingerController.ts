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

export const MAGIC_FINGER_TUNING = {
  TEMPO_CAPTURE_BPM_DELTA: 35,
  TEMPO_RELEASE_PAD_PX: 65,
  DYNAMICS_CAPTURE_DELTA: 0.25,
  DYNAMICS_RELEASE_PAD_PX: 60,
  DWELL_ACQUIRE_MS: 280,
  SMOOTHING_ALPHA: 0.40,
  RAY_FREE_DISTANCE_PX: 360,
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
      const id = el.id.replace(/^section-/, "");
      sections.push({ id, rect: el.getBoundingClientRect() });
    });
    return sections;
  }
}

export interface MagicFingerCallbacks {
  onBpmChange?: (bpm: number) => void;
  onDynamicChange?: (dynamicContinuous: number) => void;
  onSpotlightChange?: (sectionId: string | null) => void;
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

  // Dwell acquisition state
  private hoverStartTime: number = 0;
  private currentHoverTarget: "tempo" | "dynamics" | null = null;
  private lastPointingHandIndex: number | null = null;

  // Ray direction smoothing
  private smoothedUnitX: number = 0;
  private smoothedUnitY: number = -1;
  private hasSmoothedDir: boolean = false;

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
    this.callbacks.onSpotlightChange?.(null);
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

    // 1. Gather all candidate pointing hands
    const candidateSamples = samples.filter(
      s => s.gesture && isPointingGesture(s.gesture) && s.landmarks && s.landmarks.length >= 21
    );

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
      this.targetedSectionId = null;
      this.hasSmoothedDir = false;
      this.lastPointingHandIndex = null;

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
      this.smoothedUnitX = this.smoothedUnitX + alpha * (unitX - this.smoothedUnitX);
      this.smoothedUnitY = this.smoothedUnitY + alpha * (unitY - this.smoothedUnitY);
      const sLen = Math.hypot(this.smoothedUnitX, this.smoothedUnitY);
      if (sLen > 0.001) {
        this.smoothedUnitX /= sLen;
        this.smoothedUnitY /= sLen;
      }
    }

    const rayDirX = this.smoothedUnitX;
    const rayDirY = this.smoothedUnitY;

    // Default ray endpoint in open space
    let endX = startX + rayDirX * MAGIC_FINGER_TUNING.RAY_FREE_DISTANCE_PX;
    let endY = startY + rayDirY * MAGIC_FINGER_TUNING.RAY_FREE_DISTANCE_PX;
    let rayTargetType: MagicFingerRay["targetType"] = "open";

    this.hoverTarget = null;
    let liveBpm: number | null = null;
    let liveDynamic: number | null = null;

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

      // Check padded zone for release
      const pad = MAGIC_FINGER_TUNING.TEMPO_RELEASE_PAD_PX;
      const projectedX = (Math.abs(rayDirX) > 0.02)
        ? tempoTrackCenterX
        : startX + rayDirX * MAGIC_FINGER_TUNING.RAY_FREE_DISTANCE_PX;

      const isOutsidePaddedZone =
        projectedX < tempoTrackLeft - pad ||
        projectedX > tempoTrackRight + pad ||
        hitY < tempoTrackTop - pad ||
        hitY > tempoTrackBottom + pad ||
        rayDirX < -0.15; // clearly pointing away to the left

      if (isOutsidePaddedZone) {
        // Release tempo control, preserve last BPM
        this.activeTarget = null;
        this.state = "pointing";
      } else {
        // Control tempo continuously
        const clampedY = Math.max(tempoTrackTop, Math.min(tempoTrackBottom, hitY));
        const pct = ((tempoTrackBottom - clampedY) / tempoTrackHeight) * 100;
        const newBpm = Math.round(percentToBpm(pct));

        this.lastBpm = newBpm;
        liveBpm = newBpm;
        this.callbacks.onBpmChange?.(newBpm);

        endX = tempoTrackCenterX;
        endY = clampedY;
        rayTargetType = "tempo";
        this.state = "tempo_acquired";
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

      if (isVertical) {
        // Project ray onto vertical line of left dynamics gauge
        let hitY = startY;
        if (Math.abs(rayDirX) > 0.02) {
          const t = (dynTrackCenterX - startX) / rayDirX;
          hitY = startY + rayDirY * t;
        } else {
          hitY = startY;
        }

        const projectedX = (Math.abs(rayDirX) > 0.02)
          ? dynTrackCenterX
          : startX + rayDirX * MAGIC_FINGER_TUNING.RAY_FREE_DISTANCE_PX;

        const isOutsidePaddedZone =
          projectedX < dynTrackLeft - pad ||
          projectedX > dynTrackRight + pad ||
          hitY < dynTrackTop - pad ||
          hitY > dynTrackBottom + pad ||
          rayDirX > 0.15; // clearly pointing away to the right

        if (isOutsidePaddedZone) {
          // Release dynamics control, preserve last dynamic
          this.activeTarget = null;
          this.state = "pointing";
        } else {
          // Control continuous dynamics: Top is 1.0 (fff), Bottom is 0.0 (pp)
          const clampedY = Math.max(dynTrackTop, Math.min(dynTrackBottom, hitY));
          const continuousVal = Math.max(0, Math.min(1, (dynTrackBottom - clampedY) / dynTrackHeight));

          this.lastDynamic = continuousVal;
          liveDynamic = continuousVal;
          this.callbacks.onDynamicChange?.(continuousVal);

          endX = dynTrackCenterX;
          endY = clampedY;
          rayTargetType = "dynamics";
          this.state = "dynamics_acquired";
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

        const projectedY = (Math.abs(rayDirY) > 0.02)
          ? dynTrackCenterY
          : startY + rayDirY * MAGIC_FINGER_TUNING.RAY_FREE_DISTANCE_PX;

        const isOutsidePaddedZone =
          hitX < dynTrackLeft - pad ||
          hitX > dynTrackRight + pad ||
          projectedY < dynTrackTop - pad ||
          projectedY > dynTrackBottom + pad ||
          rayDirY < -0.20; // clearly pointing upwards away

        if (isOutsidePaddedZone) {
          // Release dynamics control, preserve last dynamic
          this.activeTarget = null;
          this.state = "pointing";
        } else {
          // Control continuous dynamics
          const clampedX = Math.max(dynTrackLeft, Math.min(dynTrackRight, hitX));
          const continuousVal = Math.max(0, Math.min(1, (clampedX - dynTrackLeft) / dynTrackWidth));

          this.lastDynamic = continuousVal;
          liveDynamic = continuousVal;
          this.callbacks.onDynamicChange?.(continuousVal);

          endX = clampedX;
          endY = dynTrackCenterY;
          rayTargetType = "dynamics";
          this.state = "dynamics_acquired";
        }
      }
    }

    // ── 2. ACQUISITION & TARGETING (When no slider is acquired) ───────────────
    if (this.activeTarget === null) {
      this.state = "pointing";

      // ── A. Check Safe Acquisition on Tempo Gauge (Right) ─────────────────────
      if (tempoTrackRect && rayDirX > 0.15) {
        const tempoTrackLeft = tempoTrackRect.left - svgRect.left;
        const tempoTrackRight = tempoTrackRect.right - svgRect.left;
        const tempoTrackTop = tempoTrackRect.top - svgRect.top;
        const tempoTrackBottom = tempoTrackRect.bottom - svgRect.top;
        const tempoTrackCenterX = (tempoTrackLeft + tempoTrackRight) / 2;
        const tempoTrackHeight = Math.max(1, tempoTrackBottom - tempoTrackTop);

        const t = (tempoTrackCenterX - startX) / rayDirX;
        if (t > 0) {
          const hitY = startY + rayDirY * t;
          if (hitY >= tempoTrackTop - 35 && hitY <= tempoTrackBottom + 35) {
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
              liveBpm = this.lastBpm;
              this.callbacks.onBpmChange?.(this.lastBpm);
              this.currentHoverTarget = null;
              this.hoverStartTime = 0;
            }
          }
        }
      }

      // ── B. Check Safe Acquisition on Dynamics Ribbon ─────────────────────────
      if (this.activeTarget === null && dynamicsTrackRect) {
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
          // Pointing LEFT towards left vertical dynamics gauge
          const t = (dynTrackCenterX - startX) / rayDirX;
          if (t > 0) {
            const hitY = startY + rayDirY * t;
            if (hitY >= dynTrackTop - 35 && hitY <= dynTrackBottom + 35) {
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
                liveDynamic = hitVal;
                this.callbacks.onDynamicChange?.(hitVal);
                this.currentHoverTarget = null;
                this.hoverStartTime = 0;
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
                liveDynamic = hitVal;
                this.callbacks.onDynamicChange?.(hitVal);
                this.currentHoverTarget = null;
                this.hoverStartTime = 0;
              }
            }
          }
        }
      }

      // ── C. Check Instrument Sections (Top) ──────────────────────────────────
      if (this.activeTarget === null && rayDirY < -0.10 && instrumentSections.length > 0) {
        let bestSectionId: string | null = null;
        let minDistance = Infinity;
        let bestTargetX = endX;
        let bestTargetY = endY;

        for (const sec of instrumentSections) {
          const secLeft = sec.rect.left - svgRect.left;
          const secRight = sec.rect.right - svgRect.left;
          const secTop = sec.rect.top - svgRect.top;
          const secBottom = sec.rect.bottom - svgRect.top;
          const secCenterX = (secLeft + secRight) / 2;
          const secCenterY = (secTop + secBottom) / 2;

          // Ray intersection with horizontal centerline of section
          const t = (secCenterY - startY) / rayDirY;
          if (t > 0) {
            const hitX = startX + rayDirX * t;
            // Pad width by 15% for generous hit testing
            const padX = (secRight - secLeft) * 0.15;
            if (hitX >= secLeft - padX && hitX <= secRight + padX) {
              const dist = Math.abs(hitX - secCenterX);
              if (dist < minDistance) {
                minDistance = dist;
                bestSectionId = sec.id;
                bestTargetX = secCenterX;
                bestTargetY = secCenterY;
              }
            }
          }
        }

        if (bestSectionId) {
          this.hoverTarget = "instrument";
          this.state = "instrument_targeted";
          endX = bestTargetX;
          endY = bestTargetY;
          rayTargetType = "instrument";

          if (this.targetedSectionId !== bestSectionId) {
            this.targetedSectionId = bestSectionId;
            this.callbacks.onSpotlightChange?.(bestSectionId);
          }
        } else if (this.targetedSectionId !== null) {
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

    const isAcquired = this.activeTarget !== null;

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
    };

    const telemetry: MagicFingerTelemetry = {
      isActive: true,
      state: this.state,
      pointingHandIndex: pointingSample.handIndex,
      hoverTarget: this.hoverTarget,
      activeTarget: this.activeTarget,
      targetedSectionId: this.targetedSectionId,
      liveBpm,
      liveDynamic,
      ray,
    };

    this.callbacks.onTelemetry?.(telemetry);
    return telemetry;
  }
}
