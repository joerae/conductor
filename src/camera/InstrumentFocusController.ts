/**
 * InstrumentFocusController.ts
 *
 * Implements Camera Instrument Focus Mode:
 * 1. Enters focus mode upon detecting a held Pointing_Up gesture.
 * 2. Uses index fingertip with generous hitboxes & debounce for section hover.
 * 3. Pinches (thumb + index) to grab and select an instrument section.
 * 4. Continuously modulates section focus (0.0 to 1.0) via two-hand separation.
 * 5. Suppresses camera beats and global dynamics during focus manipulation.
 * 6. Smoothly and forgivingly exits focus mode when pointing/manipulation stops.
 */

import type { HandSample } from "./cameraTypes";
import {
  HAND_LANDMARK_INDICES,
  getNormalizedPinchDistance,
} from "./cameraTypes";
import type { PieceSection } from "../score/repertoire";

export type FocusModeState = "idle" | "pointing" | "hovering" | "grabbed";

export interface FocusTelemetry {
  isActive: boolean;
  state: FocusModeState;
  hoveredSectionId: string | null;
  grabbedSectionId: string | null;
  sectionFocus: number; // 0.0 to 1.0
  pointerScreenPoint: { x: number; y: number } | null; // [0, 1] in mirrored screen coordinates
  pointingHandIndex: number | null;
  pinchDistanceRatio: number;
}

export interface FocusCallbacks {
  onStateChange?: (telemetry: FocusTelemetry) => void;
  onHoverChange?: (sectionId: string | null) => void;
  onGrabChange?: (sectionId: string | null) => void;
  onFocusAmountChange?: (sectionId: string, amount: number) => void;
}

export class InstrumentFocusController {
  private isActive = false;
  private state: FocusModeState = "idle";
  private hoveredSectionId: string | null = null;
  private grabbedSectionId: string | null = null;
  private sectionFocus = 0.0; // [0, 1]

  private pointingStartTime = 0;
  private candidateHoverSectionId: string | null = null;
  private candidateHoverStartTime = 0;
  private lastActiveInteractionTime = 0;
  private pointingHandIndex: number | null = null;
  private pointerScreenPoint: { x: number; y: number } | null = null;
  private currentPinchRatio = 1.0;

  private readonly ENTER_HOLD_MS = 280; // ~280ms held pointing to enter
  private readonly HOVER_STABLE_MS = 80;  // 80ms stable target to prevent flicker
  private readonly EXIT_IDLE_MS = 600;   // 600ms no pointing/pinch to exit gracefully
  private readonly PINCH_GRAB_THRESHOLD = 0.40;
  private readonly PINCH_RELEASE_THRESHOLD = 0.58;

  private callbacks: FocusCallbacks;

  constructor(callbacks?: FocusCallbacks) {
    this.callbacks = callbacks ?? {};
  }

  setCallbacks(callbacks: FocusCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  isFocusModeActive(): boolean {
    return this.isActive;
  }

  shouldSuppressBeats(): boolean {
    return this.isActive;
  }

  shouldSuppressGlobalDynamics(): boolean {
    return this.isActive;
  }

  getState(): FocusModeState {
    return this.state;
  }

  getHoveredSectionId(): string | null {
    return this.hoveredSectionId;
  }

  getGrabbedSectionId(): string | null {
    return this.grabbedSectionId;
  }

  getSectionFocus(): number {
    return this.sectionFocus;
  }

  getTelemetry(): FocusTelemetry {
    return {
      isActive: this.isActive,
      state: this.state,
      hoveredSectionId: this.hoveredSectionId,
      grabbedSectionId: this.grabbedSectionId,
      sectionFocus: this.sectionFocus,
      pointerScreenPoint: this.pointerScreenPoint,
      pointingHandIndex: this.pointingHandIndex,
      pinchDistanceRatio: this.currentPinchRatio,
    };
  }

  /**
   * Resets focus mode state completely.
   */
  reset(): void {
    const wasActive = this.isActive;
    this.isActive = false;
    this.state = "idle";
    this.hoveredSectionId = null;
    this.grabbedSectionId = null;
    this.sectionFocus = 0.0;
    this.pointingStartTime = 0;
    this.pointingHandIndex = null;
    this.pointerScreenPoint = null;
    this.candidateHoverSectionId = null;

    if (wasActive) {
      this.emitTelemetry();
    }
  }

  /**
   * Updates focus state for the current video frame.
   *
   * @param samples Tracked hand samples from HandTracker
   * @param sections PieceSection definitions for current piece
   * @param now Current timestamp in ms
   * @param mirror Whether camera preview is mirrored (default true)
   */
  update(
    samples: HandSample[],
    sections: PieceSection[],
    now: number = performance.now(),
    mirror: boolean = true
  ): FocusTelemetry {
    if (samples.length === 0 || sections.length === 0) {
      if (this.isActive) {
        if (now - this.lastActiveInteractionTime > this.EXIT_IDLE_MS) {
          this.exitFocusMode();
        }
      }
      return this.getTelemetry();
    }

    // 1. Find candidate pointing hand
    let pointingSample: HandSample | null = null;
    for (const s of samples) {
      if (s.gesture === "Pointing_Up") {
        pointingSample = s;
        break;
      }
    }

    // If currently grabbed, also allow the grabbed hand to continue pinch even if gesture changes from Pointing_Up to pinch
    let isPinching = false;
    let pinchHand: HandSample | null = null;

    for (const s of samples) {
      const pinchDist = getNormalizedPinchDistance(s.landmarks);
      if (pinchDist < this.PINCH_GRAB_THRESHOLD || (this.grabbedSectionId && pinchDist < this.PINCH_RELEASE_THRESHOLD)) {
        isPinching = true;
        pinchHand = s;
        this.currentPinchRatio = pinchDist;
        break;
      }
    }

    const activeHand = pointingSample || (this.grabbedSectionId ? pinchHand : null);

    // ── Phase A: Entering Focus Mode ─────────────────────────────────────────
    if (!this.isActive) {
      if (pointingSample) {
        if (this.pointingStartTime === 0) {
          this.pointingStartTime = now;
        } else if (now - this.pointingStartTime >= this.ENTER_HOLD_MS) {
          // Stable pointing held long enough -> enter Focus Mode
          this.isActive = true;
          this.state = "hovering";
          this.lastActiveInteractionTime = now;
          this.pointingHandIndex = pointingSample.handIndex;
          this.emitTelemetry();
        }
      } else {
        this.pointingStartTime = 0;
      }
      if (!this.isActive) {
        return this.getTelemetry();
      }
    }

    // ── Active in Focus Mode ──────────────────────────────────────────────────
    if (activeHand) {
      this.lastActiveInteractionTime = now;
      this.pointingHandIndex = activeHand.handIndex;

      // Extract index fingertip in screen space (mirrored)
      const indexTip = activeHand.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP] || activeHand.conductingPoint;
      const screenX = mirror ? (1.0 - indexTip.x) : indexTip.x;
      const screenY = indexTip.y;
      this.pointerScreenPoint = { x: screenX, y: screenY };

      // ── Phase B: Fingertip Hover & Nearest Section Selection ────────────────
      if (!this.grabbedSectionId) {
        const closestSection = this.findClosestSection(screenX, screenY, sections);

        if (closestSection && closestSection !== this.candidateHoverSectionId) {
          this.candidateHoverSectionId = closestSection;
          this.candidateHoverStartTime = now;
        }

        // Apply stable hover debounce
        if (
          this.candidateHoverSectionId &&
          now - this.candidateHoverStartTime >= this.HOVER_STABLE_MS &&
          this.hoveredSectionId !== this.candidateHoverSectionId
        ) {
          this.hoveredSectionId = this.candidateHoverSectionId;
          this.callbacks.onHoverChange?.(this.hoveredSectionId);
          this.emitTelemetry();
        }

        // ── Phase C: Pinch to Grab Section ───────────────────────────────────
        if (this.hoveredSectionId && isPinching) {
          this.grabbedSectionId = this.hoveredSectionId;
          this.state = "grabbed";
          this.callbacks.onGrabChange?.(this.grabbedSectionId);
          this.emitTelemetry();
        }
      } else {
        // ── Phase D: Section Grabbed & Two-Hand Focus Manipulation ─────────────
        if (!isPinching) {
          // Release grab when pinch opened
          const prevGrabbed = this.grabbedSectionId;
          this.grabbedSectionId = null;
          this.state = "hovering";
          if (prevGrabbed) {
            this.callbacks.onFocusAmountChange?.(prevGrabbed, 0.0);
          }
          this.callbacks.onGrabChange?.(null);
          this.emitTelemetry();
        } else {
          // Continuously compute two-hand separation
          let rawFocus = 0.0;

          if (samples.length >= 2) {
            const s0 = samples[0];
            const s1 = samples[1];
            // Compute horizontal span between the two hands in conductor space
            const handSpan = Math.abs(s0.conductorPoint.x - s1.conductorPoint.x);

            // Neutral span: hands close together (~0.18) -> focus 0.0
            // Expanded span: hands wide apart (~0.62) -> focus 1.0
            const MIN_SPAN = 0.18;
            const MAX_SPAN = 0.62;
            const norm = (handSpan - MIN_SPAN) / (MAX_SPAN - MIN_SPAN);
            rawFocus = Math.max(0.0, Math.min(1.0, norm));
          } else {
            // Single-hand fallback: distance of pointer from neutral center
            const distFromCenter = Math.abs(screenX - 0.5);
            rawFocus = Math.max(0.0, Math.min(1.0, (distFromCenter - 0.08) / 0.36));
          }

          // Smooth focus modulation (exponential moving average)
          this.sectionFocus = this.sectionFocus * 0.78 + rawFocus * 0.22;
          this.callbacks.onFocusAmountChange?.(this.grabbedSectionId, this.sectionFocus);
          this.emitTelemetry();
        }
      }
    } else {
      // No active hand pointing or pinching
      if (now - this.lastActiveInteractionTime > this.EXIT_IDLE_MS) {
        this.exitFocusMode();
      }
    }

    return this.getTelemetry();
  }

  /**
   * Forgivingly maps pointer (screenX, screenY) to the nearest piece section.
   */
  private findClosestSection(
    screenX: number,
    screenY: number,
    sections: PieceSection[]
  ): string | null {
    if (sections.length === 0) return null;

    // Distribute sections across the top horizontal arc of the camera view [0.10, 0.90]
    const count = sections.length;
    let closestId: string | null = null;
    let minDistance = Infinity;

    sections.forEach((sec, idx) => {
      // Target position for section center in normalized screen space
      const targetX = 0.12 + ((idx + 0.5) / count) * 0.76;
      const targetY = 0.22; // Upper area of camera frame

      // Horizontal distance has primary weight; vertical distance has secondary weight
      const dx = screenX - targetX;
      const dy = (screenY - targetY) * 0.75;
      const dist = Math.hypot(dx, dy);

      if (dist < minDistance) {
        minDistance = dist;
        closestId = sec.id;
      }
    });

    // Generous hit threshold: within 0.45 distance
    if (minDistance <= 0.45) {
      return closestId;
    }

    return null;
  }

  private exitFocusMode(): void {
    this.isActive = false;
    this.state = "idle";
    const prevGrabbed = this.grabbedSectionId;
    this.hoveredSectionId = null;
    this.grabbedSectionId = null;
    this.pointerScreenPoint = null;
    this.pointingHandIndex = null;
    this.sectionFocus = 0.0;

    if (prevGrabbed) {
      this.callbacks.onGrabChange?.(null);
      this.callbacks.onFocusAmountChange?.(prevGrabbed, 0.0);
    }
    this.callbacks.onHoverChange?.(null);
    this.emitTelemetry();
  }

  private emitTelemetry(): void {
    this.callbacks.onStateChange?.(this.getTelemetry());
  }
}
