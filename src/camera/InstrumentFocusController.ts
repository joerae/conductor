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

  private tempoMode: string = "gestural";
  private isEnabled: boolean = true; // Feature flag (Default: ON)
  private callbacks: FocusCallbacks;

  constructor(callbacks?: FocusCallbacks) {
    this.callbacks = callbacks ?? {};
  }

  setTempoMode(mode: string): void {
    this.tempoMode = mode;
  }

  getTempoMode(): string {
    return this.tempoMode;
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled && this.isActive) {
      this.reset();
    }
  }

  getEnabled(): boolean {
    return this.isEnabled;
  }

  isFocusModeActive(): boolean {
    return this.isEnabled && this.isActive;
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
    if (!this.isEnabled) {
      if (this.isActive) this.reset();
      return this.getTelemetry();
    }

    if (samples.length === 0 || sections.length === 0) {
      if (this.isActive) {
        if (now - this.lastActiveInteractionTime > this.EXIT_IDLE_MS) {
          this.exitFocusMode();
        }
      }
      return this.getTelemetry();
    }

    // Helper: Checks if two hands are held together pointing straight upwards (Steeple / Prayer Pose 🙏)
    const isTwoHandsTogetherPointingUp = (sampleList: HandSample[]): boolean => {
      if (sampleList.length < 2) return false;
      const s0 = sampleList[0];
      const s1 = sampleList[1];
      if (!s0.landmarks || !s1.landmarks || s0.landmarks.length < 21 || s1.landmarks.length < 21) return false;

      const w0 = s0.landmarks[HAND_LANDMARK_INDICES.WRIST];
      const w1 = s1.landmarks[HAND_LANDMARK_INDICES.WRIST];
      const m0 = s0.landmarks[HAND_LANDMARK_INDICES.MIDDLE_FINGER_MCP];
      const m1 = s1.landmarks[HAND_LANDMARK_INDICES.MIDDLE_FINGER_MCP];
      const t0 = s0.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP];
      const t1 = s1.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP];
      const p0 = s0.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_PIP];
      const p1 = s1.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_PIP];

      if (!w0 || !w1 || !m0 || !m1 || !t0 || !t1 || !p0 || !p1) return false;

      // 1. Both hands must be held vertically upright (knuckles above wrists)
      const isUpright0 = w0.y - m0.y > 0.035 && Math.abs(m0.x - w0.x) < (w0.y - m0.y) * 0.75;
      const isUpright1 = w1.y - m1.y > 0.035 && Math.abs(m1.x - w1.x) < (w1.y - m1.y) * 0.75;
      if (!isUpright0 || !isUpright1) return false;

      // 2. Both index fingertips must point upwards (tip above pip & wrist)
      const tipUp0 = t0.y < p0.y - 0.012 && t0.y < w0.y - 0.06;
      const tipUp1 = t1.y < p1.y - 0.012 && t1.y < w1.y - 0.06;
      if (!tipUp0 || !tipUp1) return false;

      // 3. Hands must be close together / touching (horizontal proximity)
      const wristDistX = Math.abs(w0.x - w1.x);
      const tipDistX = Math.abs(t0.x - t1.x);
      const mcpDistX = Math.abs(m0.x - m1.x);

      const isTouchingOrClose = (wristDistX < 0.28 || mcpDistX < 0.24) && tipDistX < 0.20;
      return isTouchingOrClose;
    };

    // Helper: Checks strictly vertical "Finger Up" orientation for single-hand entry
    const isStrictlyVerticalPointingUp = (sample: HandSample): boolean => {
      const tip = sample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP];
      const pip = sample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_PIP];
      const mcp = sample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_MCP];
      const wrist = sample.landmarks[HAND_LANDMARK_INDICES.WRIST];
      const middleMcp = sample.landmarks[HAND_LANDMARK_INDICES.MIDDLE_FINGER_MCP];

      if (!tip || !pip || !mcp || !wrist || !middleMcp) return true;

      // 1. Index finger itself must point strictly vertical upwards (<22 deg from vertical)
      const fingerDy = pip.y - tip.y; // Positive if tip is above pip in image space
      const fingerDx = Math.abs(tip.x - pip.x);
      if (fingerDy < 0.030 || fingerDx > fingerDy * 0.38) {
        return false;
      }

      // 2. Entire hand / palm axis (wrist -> middle knuckle) must be held vertically upright
      const palmDy = wrist.y - middleMcp.y; // Positive if knuckles are above wrist
      const palmDx = Math.abs(middleMcp.x - wrist.x);
      if (palmDy < 0.035 || palmDx > palmDy * 0.42) {
        return false;
      }

      return true;
    };

    // 1. Find candidate pointing hand
    let pointingSample: HandSample | null = null;
    let isEntryTriggered = false;

    if (this.isActive) {
      // Once spotlight mode is active, allow sweeping across any angle with either hand
      for (const s of samples) {
        if (s.gesture === "Pointing_Up") {
          pointingSample = s;
          break;
        }
      }
      if (!pointingSample && isTwoHandsTogetherPointingUp(samples)) {
        pointingSample = samples[0].conductorPoint.y >= samples[1].conductorPoint.y ? samples[0] : samples[1];
      }
    } else {
      // In all modes (Beat Mode & Expressive): Two Hands Held Together Pointing Up (Steeple / Prayer Pose 🙏) triggers entry!
      const hasTwoHandsTogether = isTwoHandsTogetherPointingUp(samples);
      if (hasTwoHandsTogether) {
        isEntryTriggered = true;
        pointingSample = samples[0].conductorPoint.y >= samples[1].conductorPoint.y ? samples[0] : samples[1];
      } else if (this.tempoMode === "gestural") {
        // ONLY in Expressive (Mode E) gestural mode: Single-hand strictly vertical "Finger Up" can also trigger entry.
        // In Beat conducting modes (Inertial/Balanced/Instant), single-hand points are ignored on entry to prevent beat-stroke conflicts!
        for (const s of samples) {
          if (s.gesture === "Pointing_Up" && isStrictlyVerticalPointingUp(s)) {
            pointingSample = s;
            isEntryTriggered = true;
            break;
          }
        }
      }
    }

    // ── Phase A: Entering Spotlight Mode ─────────────────────────────────────
    if (!this.isActive) {
      if (isEntryTriggered && pointingSample) {
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

      // ── Phase B: Free Ray Cast & Section Intersection ─────────────────────────
      const closestSection = this.findClosestSection(screenX, screenY, pointingSample, sections, mirror);

      if (closestSection !== this.candidateHoverSectionId) {
        this.candidateHoverSectionId = closestSection;
        this.candidateHoverStartTime = now;
      }

      // Fast, stable debounce for section intersection
      if (
        this.candidateHoverSectionId !== null &&
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
      } else if (this.candidateHoverSectionId === null && this.grabbedSectionId !== null) {
        // Ray pointing into open space: freely aim without locking onto a section
        const prevGrabbed = this.grabbedSectionId;
        this.hoveredSectionId = null;
        this.grabbedSectionId = null;
        this.sectionFocus = 0.0;
        this.state = "hovering";

        if (prevGrabbed) {
          this.callbacks.onFocusAmountChange?.(prevGrabbed, 0.0);
        }
        this.callbacks.onHoverChange?.(null);
        this.callbacks.onGrabChange?.(null);
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
   * Casts a ray from the pointing fingertip in the direction of the finger and detects section intersection
   * along the bottom baseline of the egg-shaped instrument containers.
   */
  private findClosestSection(
    screenX: number,
    screenY: number,
    sample: HandSample,
    sections: PieceSection[],
    mirror: boolean = true
  ): string | null {
    if (sections.length === 0) return null;

    // Calculate pointing ray direction from PIP/MCP to TIP
    const pip = sample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_PIP] || sample.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_MCP];

    // If DOM is available, test collision directly along the bottom baseline of the instrument containers
    if (typeof document !== "undefined") {
      const canvasEl = document.getElementById("camera-canvas");
      if (canvasEl) {
        const canvasRect = canvasEl.getBoundingClientRect();
        const tipScreenX = canvasRect.left + screenX * canvasRect.width;
        const tipScreenY = canvasRect.top + screenY * canvasRect.height;

        let pipScreenX = tipScreenX;
        let pipScreenY = tipScreenY + 20;
        if (pip) {
          const pipNormX = mirror ? (1.0 - pip.x) : pip.x;
          pipScreenX = canvasRect.left + pipNormX * canvasRect.width;
          pipScreenY = canvasRect.top + pip.y * canvasRect.height;
        }

        const dirX = tipScreenX - pipScreenX;
        const dirY = tipScreenY - pipScreenY;

        if (dirY < -2) {
          const firstSecEl = document.getElementById(`section-${sections[0].id}`) || document.querySelector(".instrument-section");
          if (firstSecEl) {
            const firstRect = firstSecEl.getBoundingClientRect();
            // Baseline along the bottom of the egg containers
            const targetBaselineY = firstRect.top + firstRect.height * 0.78;

            const t = (tipScreenY - targetBaselineY) / (-dirY);
            const hitScreenX = tipScreenX + dirX * t;

            for (const sec of sections) {
              const secEl = document.getElementById(`section-${sec.id}`);
              if (secEl) {
                const secRect = secEl.getBoundingClientRect();
                const pad = secRect.width * 0.12;
                if (hitScreenX >= secRect.left - pad && hitScreenX <= secRect.right + pad) {
                  return sec.id;
                }
              }
            }
            return null;
          }
        }
      }
    }

    // Fallback for headless environments or unit tests
    let projectedX = screenX;
    if (pip) {
      const pipX = mirror ? (1.0 - pip.x) : pip.x;
      const pipY = pip.y;
      const dirX = screenX - pipX;
      const dirY = screenY - pipY;
      const len = Math.hypot(dirX, dirY);
      if (len > 0.001 && dirY < -0.01) {
        const t = screenY / (-dirY);
        projectedX = screenX + dirX * t;
      }
    }

    // Check which section the ray intersects
    const count = sections.length;
    const secWidth = 0.76 / count;
    let closestId: string | null = null;
    let minDiff = Infinity;

    sections.forEach((sec, idx) => {
      const targetX = 0.12 + ((idx + 0.5) / count) * 0.76;
      const diff = Math.abs(projectedX - targetX);

      // Ray must intersect within the section's active span
      if (diff <= secWidth * 0.62 && diff < minDiff) {
        minDiff = diff;
        closestId = sec.id;
      }
    });

    return closestId;
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
