/**
 * instrumentFocusController.test.ts
 *
 * Unit tests for Camera Instrument Focus Mode:
 * - Pointing_Up gesture triggers entry into Focus Mode after intentional hold
 * - Fingertip hover with generous hitboxes & debounce
 * - Pinch grabs the highlighted section
 * - Two-hand separation modulates section focus continuously [0.0 ... 1.0]
 * - Exiting focus mode restores balance and resets state
 * - Beat and global dynamic suppression during focus mode
 */

import { describe, it, expect, vi } from "vitest";
import { InstrumentFocusController } from "../src/camera/InstrumentFocusController";
import type { HandSample, HandLandmark } from "../src/camera/cameraTypes";
import { HAND_LANDMARK_INDICES } from "../src/camera/cameraTypes";
import type { PieceSection } from "../src/score/repertoire";

const MOCK_SECTIONS: PieceSection[] = [
  { id: "violin1", name: "Violin I", channels: [0], programs: [48] },
  { id: "violin2", name: "Violin II", channels: [3], programs: [48] },
  { id: "viola", name: "Viola", channels: [1], programs: [48] },
  { id: "cello", name: "Cello / Bass", channels: [2], programs: [48] },
];

function createMockSample(options: {
  handIndex?: number;
  gesture?: string;
  indexTip?: { x: number; y: number };
  thumbTip?: { x: number; y: number };
  conductorX?: number;
  conductorY?: number;
}): HandSample {
  const landmarks: HandLandmark[] = new Array(21).fill(null).map(() => ({ x: 0.5, y: 0.8, z: 0 }));
  const indexTip = options.indexTip ?? { x: 0.5, y: 0.3 };
  const thumbTip = options.thumbTip ?? { x: indexTip.x - 0.05, y: indexTip.y + 0.15 }; // default open

  landmarks[HAND_LANDMARK_INDICES.WRIST] = { x: indexTip.x, y: Math.min(1.0, indexTip.y + 0.50), z: 0 };
  landmarks[HAND_LANDMARK_INDICES.MIDDLE_FINGER_MCP] = { x: indexTip.x, y: indexTip.y + 0.30, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_MCP] = { x: indexTip.x, y: indexTip.y + 0.30, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_PIP] = { x: indexTip.x, y: indexTip.y + 0.15, z: 0 };

  landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP] = { ...indexTip, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.THUMB_TIP] = { ...thumbTip, z: 0 };

  return {
    timestampMs: 1000,
    handIndex: options.handIndex ?? 0,
    handedness: "right",
    confidence: 0.95,
    landmarks,
    conductingPoint: indexTip,
    conductorPoint: {
      x: options.conductorX ?? 0.5,
      y: options.conductorY ?? 0.5,
    },
    gesture: (options.gesture as any) ?? "none",
    gestureScore: 0.95,
  };
}

describe("InstrumentFocusController (Spotlight Mode)", () => {
  it("enters spotlight mode when Pointing_Up is held for >180ms", () => {
    const controller = new InstrumentFocusController();
    const sample = createMockSample({ gesture: "Pointing_Up" });

    // T = 0ms: First frame with Pointing_Up
    controller.update([sample], MOCK_SECTIONS, 1000);
    expect(controller.isFocusModeActive()).toBe(false);

    // T = 100ms: Still holding
    controller.update([sample], MOCK_SECTIONS, 1100);
    expect(controller.isFocusModeActive()).toBe(false);

    // T = 200ms: Held > 180ms -> spotlight mode active!
    controller.update([sample], MOCK_SECTIONS, 1200);
    expect(controller.isFocusModeActive()).toBe(true);
    expect(controller.shouldSuppressBeats()).toBe(true);
    expect(controller.shouldSuppressGlobalDynamics()).toBe(true);
  });

  it("does not enter spotlight mode if pointing is released before threshold", () => {
    const controller = new InstrumentFocusController();
    const pointingSample = createMockSample({ gesture: "Pointing_Up" });
    const idleSample = createMockSample({ gesture: "none" });

    controller.update([pointingSample], MOCK_SECTIONS, 1000);
    controller.update([idleSample], MOCK_SECTIONS, 1080);
    controller.update([idleSample], MOCK_SECTIONS, 1250);

    expect(controller.isFocusModeActive()).toBe(false);
  });

  it("directly spotlights the nearest section when pointing at it", () => {
    const onGrab = vi.fn();
    const onHover = vi.fn();
    const controller = new InstrumentFocusController({ onGrabChange: onGrab, onHoverChange: onHover });

    // Pointing at leftmost section (violin1): mirrored screenX = 1 - 0.80 = 0.20
    const pointingLeft = createMockSample({
      gesture: "Pointing_Up",
      indexTip: { x: 0.80, y: 0.20 },
    });

    controller.update([pointingLeft], MOCK_SECTIONS, 1000);
    controller.update([pointingLeft], MOCK_SECTIONS, 1200); // Activated
    controller.update([pointingLeft], MOCK_SECTIONS, 1280); // Debounce confirmed

    expect(controller.getGrabbedSectionId()).toBe("violin1");
    expect(controller.getHoveredSectionId()).toBe("violin1");
    expect(controller.getSectionFocus()).toBe(1.0);
    expect(onGrab).toHaveBeenCalledWith("violin1");
  });

  it("switches spotlight when pointing finger shifts to another section", () => {
    const onGrab = vi.fn();
    const controller = new InstrumentFocusController({ onGrabChange: onGrab });

    // 1. Point at violin1 (screenX = 0.20)
    const pointingLeft = createMockSample({
      gesture: "Pointing_Up",
      indexTip: { x: 0.80, y: 0.20 },
    });
    controller.update([pointingLeft], MOCK_SECTIONS, 1000);
    controller.update([pointingLeft], MOCK_SECTIONS, 1200);
    controller.update([pointingLeft], MOCK_SECTIONS, 1280);
    expect(controller.getGrabbedSectionId()).toBe("violin1");

    // 2. Shift finger to rightmost section (cello/bass): mirrored screenX = 1 - 0.20 = 0.80
    const pointingRight = createMockSample({
      gesture: "Pointing_Up",
      indexTip: { x: 0.20, y: 0.20 },
    });
    controller.update([pointingRight], MOCK_SECTIONS, 1300);
    controller.update([pointingRight], MOCK_SECTIONS, 1380); // Shift confirmed

    expect(controller.getGrabbedSectionId()).toBe("cello");
    expect(onGrab).toHaveBeenCalledWith("cello");
  });

  it("exits spotlight mode gracefully and restores balance when pointing stops", () => {
    const controller = new InstrumentFocusController();
    const pointing = createMockSample({ gesture: "Pointing_Up" });

    controller.update([pointing], MOCK_SECTIONS, 1000);
    controller.update([pointing], MOCK_SECTIONS, 1200);
    expect(controller.isFocusModeActive()).toBe(true);

    // Idle for > 350ms
    controller.update([], MOCK_SECTIONS, 1600);
    expect(controller.isFocusModeActive()).toBe(false);
    expect(controller.getState()).toBe("idle");
    expect(controller.getGrabbedSectionId()).toBe(null);
    expect(controller.getSectionFocus()).toBe(0.0);
  });

  it("enters spotlight mode in Beat Mode when two hands are held together pointing up (steeple / prayer pose)", () => {
    const controller = new InstrumentFocusController();
    controller.setTempoMode("inertial"); // Beat Mode

    const steepleSamples = [
      createMockSample({ handIndex: 0, indexTip: { x: 0.48, y: 0.30 } }),
      createMockSample({ handIndex: 1, indexTip: { x: 0.52, y: 0.30 } }),
    ];

    controller.update(steepleSamples, MOCK_SECTIONS, 1000);
    expect(controller.isFocusModeActive()).toBe(false);

    // Held > 180ms
    controller.update(steepleSamples, MOCK_SECTIONS, 1200);
    expect(controller.isFocusModeActive()).toBe(true);
  });

  it("ignores single-hand pointing up on entry in Beat Mode to prevent beat-stroke conflicts", () => {
    const controller = new InstrumentFocusController();
    controller.setTempoMode("inertial"); // Beat Mode

    const singlePoint = createMockSample({ gesture: "Pointing_Up" });

    controller.update([singlePoint], MOCK_SECTIONS, 1000);
    controller.update([singlePoint], MOCK_SECTIONS, 1200);
    controller.update([singlePoint], MOCK_SECTIONS, 1400);

    // In Beat Mode, single point is ignored for entry
    expect(controller.isFocusModeActive()).toBe(false);
  });

  it("allows single-hand pointing up on entry in Expressive Mode", () => {
    const controller = new InstrumentFocusController();
    controller.setTempoMode("gestural"); // Expressive Mode

    const singlePoint = createMockSample({ gesture: "Pointing_Up" });

    controller.update([singlePoint], MOCK_SECTIONS, 1000);
    controller.update([singlePoint], MOCK_SECTIONS, 1200);

    expect(controller.isFocusModeActive()).toBe(true);
  });
});
