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
  landmarks[HAND_LANDMARK_INDICES.WRIST] = { x: 0.5, y: 0.8, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.MIDDLE_FINGER_MCP] = { x: 0.5, y: 0.6, z: 0 }; // scale = 0.20

  const indexTip = options.indexTip ?? { x: 0.5, y: 0.3 };
  const thumbTip = options.thumbTip ?? { x: 0.45, y: 0.45 }; // default open

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

describe("InstrumentFocusController", () => {
  it("enters focus mode when Pointing_Up is held for >280ms", () => {
    const controller = new InstrumentFocusController();
    const sample = createMockSample({ gesture: "Pointing_Up" });

    // T = 0ms: First frame with Pointing_Up
    controller.update([sample], MOCK_SECTIONS, 1000);
    expect(controller.isFocusModeActive()).toBe(false);

    // T = 150ms: Still holding
    controller.update([sample], MOCK_SECTIONS, 1150);
    expect(controller.isFocusModeActive()).toBe(false);

    // T = 300ms: Held > 280ms -> focus mode active!
    controller.update([sample], MOCK_SECTIONS, 1300);
    expect(controller.isFocusModeActive()).toBe(true);
    expect(controller.getState()).toBe("hovering");
    expect(controller.shouldSuppressBeats()).toBe(true);
    expect(controller.shouldSuppressGlobalDynamics()).toBe(true);
  });

  it("does not enter focus mode if pointing is released before threshold", () => {
    const controller = new InstrumentFocusController();
    const pointingSample = createMockSample({ gesture: "Pointing_Up" });
    const idleSample = createMockSample({ gesture: "none" });

    controller.update([pointingSample], MOCK_SECTIONS, 1000);
    controller.update([idleSample], MOCK_SECTIONS, 1100);
    controller.update([idleSample], MOCK_SECTIONS, 1350);

    expect(controller.isFocusModeActive()).toBe(false);
  });

  it("hovers over the nearest section when pointing", () => {
    const onHover = vi.fn();
    const controller = new InstrumentFocusController({ onHoverChange: onHover });

    // Enter focus mode
    const pointingLeft = createMockSample({
      gesture: "Pointing_Up",
      indexTip: { x: 0.80, y: 0.20 }, // Mirrored screenX = 1 - 0.80 = 0.20 (near left section: violin1)
    });

    controller.update([pointingLeft], MOCK_SECTIONS, 1000);
    controller.update([pointingLeft], MOCK_SECTIONS, 1300); // Focus mode activated
    controller.update([pointingLeft], MOCK_SECTIONS, 1400); // Stable hover

    expect(controller.getHoveredSectionId()).toBe("violin1");
    expect(onHover).toHaveBeenCalledWith("violin1");
  });

  it("grabs a section when pinch is detected on pointing hand", () => {
    const onGrab = vi.fn();
    const controller = new InstrumentFocusController({ onGrabChange: onGrab });

    // Enter focus mode and hover
    const pointing = createMockSample({
      gesture: "Pointing_Up",
      indexTip: { x: 0.80, y: 0.20 },
      thumbTip: { x: 0.70, y: 0.35 }, // open pinch
    });

    controller.update([pointing], MOCK_SECTIONS, 1000);
    controller.update([pointing], MOCK_SECTIONS, 1300);
    controller.update([pointing], MOCK_SECTIONS, 1400);
    expect(controller.getHoveredSectionId()).toBe("violin1");

    // Pinch closed: thumb tip close to index tip
    const pinching = createMockSample({
      gesture: "Pointing_Up",
      indexTip: { x: 0.80, y: 0.20 },
      thumbTip: { x: 0.805, y: 0.205 }, // pinch dist ~0.007 / handScale 0.20 = 0.035 (< 0.40)
    });

    controller.update([pinching], MOCK_SECTIONS, 1450);
    expect(controller.getState()).toBe("grabbed");
    expect(controller.getGrabbedSectionId()).toBe("violin1");
    expect(onGrab).toHaveBeenCalledWith("violin1");
  });

  it("modulates section focus continuously based on two-hand separation", () => {
    const onFocus = vi.fn();
    const controller = new InstrumentFocusController({ onFocusAmountChange: onFocus });

    // Enter and grab
    const hand0 = createMockSample({
      handIndex: 0,
      gesture: "Pointing_Up",
      indexTip: { x: 0.80, y: 0.20 },
      thumbTip: { x: 0.805, y: 0.205 },
      conductorX: 0.20,
    });
    const hand1 = createMockSample({
      handIndex: 1,
      conductorX: 0.75, // Wide separation (0.75 - 0.20 = 0.55 span)
    });

    controller.update([hand0, hand1], MOCK_SECTIONS, 1000);
    controller.update([hand0, hand1], MOCK_SECTIONS, 1300);
    controller.update([hand0, hand1], MOCK_SECTIONS, 1400);

    // Grabbed and manipulating
    controller.update([hand0, hand1], MOCK_SECTIONS, 1500);
    controller.update([hand0, hand1], MOCK_SECTIONS, 1550);

    expect(controller.getSectionFocus()).toBeGreaterThan(0.0);
    expect(onFocus).toHaveBeenCalled();
  });

  it("exits focus mode gracefully when interaction stops", () => {
    const controller = new InstrumentFocusController();
    const pointing = createMockSample({ gesture: "Pointing_Up" });

    controller.update([pointing], MOCK_SECTIONS, 1000);
    controller.update([pointing], MOCK_SECTIONS, 1300);
    expect(controller.isFocusModeActive()).toBe(true);

    // Idle for > 600ms
    controller.update([], MOCK_SECTIONS, 2000);
    expect(controller.isFocusModeActive()).toBe(false);
    expect(controller.getState()).toBe("idle");
    expect(controller.getSectionFocus()).toBe(0.0);
  });
});
