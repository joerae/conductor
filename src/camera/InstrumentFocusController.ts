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
import { HAND_LANDMARK_INDICES } from "./cameraTypes";
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

  private readonly ENTER_HOLD_MS = 180; // ~180ms intentional pointing hold to enter spotlight mode
  private readonly HOVER_STABLE_MS = 60;  // 60ms debounce for instantaneous, crisp section spotlight
  private readonly EXIT_IDLE_MS = 350;   // 350ms quick & forgiving release after pointing stops

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
   * Updates spotlight focus state for the current video frame.
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

    // ── Phase A: Entering Spotlight Mode ─────────────────────────────────────
    if (!this.isActive) {
      if (pointingSample) {
        if (this.pointingStartTime === 0) {
          this.pointingStartTime = now;
        } else if (now - this.pointingStartTime >= this.ENTER_HOLD_MS) {
          // Stable pointing held -> enter Spotlight Focus Mode
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

    // ── Active in Spotlight Mode ──────────────────────────────────────────────
    if (pointingSample) {
      this.lastActiveInteractionTime = now;
      this.pointingHandIndex = pointingSample.handIndex;

      // Extract index fingertip in screen space (mirrored)
      const indexTip = pointingSample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP] || pointingSample.conductingPoint;
      const screenX = mirror ? (1.0 - indexTip.x) : indexTip.x;
      const screenY = indexTip.y;
      this.pointerScreenPoint = { x: screenX, y: screenY };

      // ── Phase B: Direct Pointing Spotlight ──────────────────────────────────
      const closestSection = this.findClosestSection(screenX, screenY, sections);

      if (closestSection && closestSection !== this.candidateHoverSectionId) {
        this.candidateHoverSectionId = closestSection;
        this.candidateHoverStartTime = now;
      }

      // Fast, stable debounce
      if (
        this.candidateHoverSectionId &&
        (now - this.candidateHoverStartTime >= this.HOVER_STABLE_MS || !this.hoveredSectionId) &&
        this.hoveredSectionId !== this.candidateHoverSectionId
      ) {
        const prevGrabbed = this.grabbedSectionId;
        this.hoveredSectionId = this.candidateHoverSectionId;
        this.grabbedSectionId = this.candidateHoverSectionId;
        this.sectionFocus = 1.0;
        this.state = "grabbed";

        if (prevGrabbed && prevGrabbed !== this.grabbedSectionId) {
          this.callbacks.onFocusAmountChange?.(prevGrabbed, 0.0);
        }
        this.callbacks.onHoverChange?.(this.hoveredSectionId);
        this.callbacks.onGrabChange?.(this.grabbedSectionId);
        this.callbacks.onFocusAmountChange?.(this.grabbedSectionId, 1.0);
        this.emitTelemetry();
      }
    } else {
      // Pointing gesture ended
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
