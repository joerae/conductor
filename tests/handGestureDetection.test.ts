/**
 * handGestureDetection.test.ts
 *
 * Unit tests for gesture-driven conducting:
 * - Geometric landmark classifier (Thumb_Down, Thumb_Up, ILoveYou, Victory, Closed_Fist, Open_Palm)
 * - ScoreTransport Fermata (holding current note/chord without advancing)
 */

import { describe, it, expect } from "vitest";
import {
  classifyHandGestureFromLandmarks,
  getNormalizedPinchDistance,
  HAND_LANDMARK_INDICES,
  type HandLandmark,
} from "../src/camera/cameraTypes";
import { ScoreTransport } from "../src/score/ScoreTransport";
import type { ScoreEvent } from "../src/score/scoreTypes";

/** Helper to generate 21 mock landmarks with custom finger configurations */
function createMockHandLandmarks(config: {
  thumbExtended?: boolean;
  thumbDirection?: "up" | "down" | "neutral";
  indexExtended?: boolean;
  middleExtended?: boolean;
  ringExtended?: boolean;
  pinkyExtended?: boolean;
}): HandLandmark[] {
  const landmarks: HandLandmark[] = new Array(21).fill(null).map(() => ({ x: 0.5, y: 0.8, z: 0 }));

  // Wrist at (0.5, 0.8)
  landmarks[HAND_LANDMARK_INDICES.WRIST] = { x: 0.5, y: 0.8, z: 0 };

  // Thumb
  const thumbExt = config.thumbExtended ?? false;
  const thumbDir = config.thumbDirection ?? "up";
  landmarks[HAND_LANDMARK_INDICES.THUMB_MCP] = { x: 0.45, y: 0.75, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.THUMB_IP] = { x: 0.42, y: 0.70, z: 0 };

  if (thumbExt) {
    if (thumbDir === "down") {
      landmarks[HAND_LANDMARK_INDICES.THUMB_TIP] = { x: 0.45, y: 0.92, z: 0 }; // Lower than MCP & wrist
    } else {
      landmarks[HAND_LANDMARK_INDICES.THUMB_TIP] = { x: 0.35, y: 0.60, z: 0 }; // Higher than MCP
    }
  } else {
    landmarks[HAND_LANDMARK_INDICES.THUMB_TIP] = { x: 0.46, y: 0.74, z: 0 };
  }

  // Index (tip: 8, pip: 6)
  const indexExt = config.indexExtended ?? false;
  landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_MCP] = { x: 0.46, y: 0.65, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_PIP] = { x: 0.46, y: 0.55, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_DIP] = { x: 0.46, y: 0.45, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP] = indexExt ? { x: 0.46, y: 0.35, z: 0 } : { x: 0.47, y: 0.62, z: 0 };

  // Middle (tip: 12, pip: 10)
  const middleExt = config.middleExtended ?? false;
  landmarks[HAND_LANDMARK_INDICES.MIDDLE_FINGER_MCP] = { x: 0.50, y: 0.64, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.MIDDLE_FINGER_PIP] = { x: 0.50, y: 0.53, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.MIDDLE_FINGER_DIP] = { x: 0.50, y: 0.43, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.MIDDLE_FINGER_TIP] = middleExt ? { x: 0.50, y: 0.33, z: 0 } : { x: 0.50, y: 0.61, z: 0 };

  // Ring (tip: 16, pip: 14)
  const ringExt = config.ringExtended ?? false;
  landmarks[HAND_LANDMARK_INDICES.RING_FINGER_MCP] = { x: 0.54, y: 0.65, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.RING_FINGER_PIP] = { x: 0.54, y: 0.55, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.RING_FINGER_DIP] = { x: 0.54, y: 0.45, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.RING_FINGER_TIP] = ringExt ? { x: 0.54, y: 0.35, z: 0 } : { x: 0.53, y: 0.62, z: 0 };

  // Pinky (tip: 20, pip: 18)
  const pinkyExt = config.pinkyExtended ?? false;
  landmarks[HAND_LANDMARK_INDICES.PINKY_MCP] = { x: 0.58, y: 0.68, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.PINKY_PIP] = { x: 0.58, y: 0.60, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.PINKY_DIP] = { x: 0.58, y: 0.52, z: 0 };
  landmarks[HAND_LANDMARK_INDICES.PINKY_TIP] = pinkyExt ? { x: 0.58, y: 0.44, z: 0 } : { x: 0.57, y: 0.66, z: 0 };

  return landmarks;
}

describe("Hand Gesture Detection", () => {
  it("classifies Thumb_Down when 4 fingers are curled and thumb points down", () => {
    const thumbDownLandmarks = createMockHandLandmarks({
      thumbExtended: true,
      thumbDirection: "down",
      indexExtended: false,
      middleExtended: false,
      ringExtended: false,
      pinkyExtended: false,
    });

    const gesture = classifyHandGestureFromLandmarks(thumbDownLandmarks);
    expect(gesture).toBe("Thumb_Down");
  });

  it("classifies Thumb_Up when 4 fingers are curled and thumb points up", () => {
    const thumbUpLandmarks = createMockHandLandmarks({
      thumbExtended: true,
      thumbDirection: "up",
      indexExtended: false,
      middleExtended: false,
      ringExtended: false,
      pinkyExtended: false,
    });

    const gesture = classifyHandGestureFromLandmarks(thumbUpLandmarks);
    expect(gesture).toBe("Thumb_Up");
  });

  it("classifies ILoveYou (🤟) when thumb, index, and pinky are extended while middle and ring are curled", () => {
    const loveLandmarks = createMockHandLandmarks({
      thumbExtended: true,
      indexExtended: true,
      middleExtended: false,
      ringExtended: false,
      pinkyExtended: true,
    });

    const gesture = classifyHandGestureFromLandmarks(loveLandmarks);
    expect(gesture).toBe("ILoveYou");
  });

  it("classifies Closed_Fist when all fingers are curled in towards palm/wrist", () => {
    const fistLandmarks = createMockHandLandmarks({
      thumbExtended: false,
      indexExtended: false,
      middleExtended: false,
      ringExtended: false,
      pinkyExtended: false,
    });

    const gesture = classifyHandGestureFromLandmarks(fistLandmarks);
    expect(gesture).toBe("Closed_Fist");
  });

  it("classifies Open_Palm when all 5 fingers are extended", () => {
    const openPalmLandmarks = createMockHandLandmarks({
      thumbExtended: true,
      indexExtended: true,
      middleExtended: true,
      ringExtended: true,
      pinkyExtended: true,
    });

    const gesture = classifyHandGestureFromLandmarks(openPalmLandmarks);
    expect(gesture).toBe("Open_Palm");
  });

  it("classifies Victory (Peace Sign) when index and middle are extended while ring and pinky are curled", () => {
    const peaceLandmarks = createMockHandLandmarks({
      thumbExtended: false,
      indexExtended: true,
      middleExtended: true,
      ringExtended: false,
      pinkyExtended: false,
    });

    const gesture = classifyHandGestureFromLandmarks(peaceLandmarks);
    expect(gesture).toBe("Victory");
  });

  it("classifies Pointing_Up when index is extended vertically and other fingers are strictly curled", () => {
    const pointingLandmarks = createMockHandLandmarks({
      thumbExtended: false,
      indexExtended: true,
      middleExtended: false,
      ringExtended: false,
      pinkyExtended: false,
    });

    const gesture = classifyHandGestureFromLandmarks(pointingLandmarks);
    expect(gesture).toBe("Pointing_Up");
  });

  it("does NOT classify Pointing_Up when hand is oriented sideways/horizontal", () => {
    const sidewaysLandmarks = createMockHandLandmarks({
      thumbExtended: false,
      indexExtended: true,
      middleExtended: false,
      ringExtended: false,
      pinkyExtended: false,
    });
    // Rotate wrist and knuckles so palm axis is horizontal (wrist at right, knuckles at left)
    sidewaysLandmarks[HAND_LANDMARK_INDICES.WRIST] = { x: 0.70, y: 0.60, z: 0 };
    sidewaysLandmarks[HAND_LANDMARK_INDICES.MIDDLE_FINGER_MCP] = { x: 0.40, y: 0.60, z: 0 };
    sidewaysLandmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_MCP] = { x: 0.40, y: 0.55, z: 0 };
    sidewaysLandmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_PIP] = { x: 0.35, y: 0.50, z: 0 };
    sidewaysLandmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP] = { x: 0.30, y: 0.45, z: 0 };

    const gesture = classifyHandGestureFromLandmarks(sidewaysLandmarks);
    expect(gesture).not.toBe("Pointing_Up");
  });

  it("does NOT classify Pointing_Up when other fingers are half-open / floating", () => {
    const looseHandLandmarks = createMockHandLandmarks({
      thumbExtended: false,
      indexExtended: true,
      middleExtended: false,
      ringExtended: false,
      pinkyExtended: false,
    });
    // Middle tip is extended upwards towards PIP rather than curled into palm
    looseHandLandmarks[HAND_LANDMARK_INDICES.MIDDLE_FINGER_TIP] = { x: 0.50, y: 0.48, z: 0 }; // past PIP y: 0.52

    const gesture = classifyHandGestureFromLandmarks(looseHandLandmarks);
    expect(gesture).not.toBe("Pointing_Up");
  });

  it("calculates normalized pinch distance correctly", () => {
    const landmarks = createMockHandLandmarks({ indexExtended: true });
    // Set thumb and index tips very close
    landmarks[HAND_LANDMARK_INDICES.THUMB_TIP] = { x: 0.46, y: 0.36, z: 0 };
    landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP] = { x: 0.46, y: 0.35, z: 0 };
    const pinchDist = getNormalizedPinchDistance(landmarks);
    expect(pinchDist).toBeLessThan(0.40);
  });

  it("returns none for incomplete or empty landmark arrays", () => {
    expect(classifyHandGestureFromLandmarks([])).toBe("none");
    expect(classifyHandGestureFromLandmarks([{ x: 0, y: 0 }])).toBe("none");
  });
});

describe("ScoreTransport Fermata Support", () => {
  function createMockEvents(): ScoreEvent[] {
    return [
      { beat: 0.0, type: "noteOn", durationBeats: 1.0, trackId: "t1", noteId: "n1", midiNote: 60, velocity: 80, channel: 0, program: 40 },
      { beat: 1.0, type: "noteOn", durationBeats: 1.0, trackId: "t1", noteId: "n2", midiNote: 62, velocity: 80, channel: 0, program: 40 },
      { beat: 2.0, type: "noteOn", durationBeats: 1.0, trackId: "t1", noteId: "n3", midiNote: 64, velocity: 80, channel: 0, program: 40 },
    ];
  }

  it("freezes beat advancement during Fermata and stops dispatching upcoming notes", () => {
    const transport = new ScoreTransport();
    transport.setEvents(createMockEvents());
    transport.start(0, 10.0, 0.5); // 120 BPM = 0.5s per beat

    // Advance to audioTime 10.4 (beat 0.8)
    transport.advanceTo(10.4);
    expect(transport.getCursorBeat()).toBeCloseTo(0.8);

    // Activate Fermata at audioTime 10.4
    transport.setFermata(true, 10.4);
    expect(transport.isFermataActive()).toBe(true);

    // Advance audioTime forward to 12.0s while in Fermata
    transport.advanceTo(12.0);
    // Cursor beat must remain frozen at 0.8
    expect(transport.getCursorBeat()).toBeCloseTo(0.8);

    // eventsInWindow must return empty array during Fermata
    const events = transport.eventsInWindow(11.0, 12.5);
    expect(events).toEqual([]);

    // Release Fermata at audioTime 12.0
    transport.setFermata(false, 12.0);
    expect(transport.isFermataActive()).toBe(false);

    // Advance to 12.5s (0.5s later = 1 beat later) -> beat 1.8
    transport.advanceTo(12.5);
    expect(transport.getCursorBeat()).toBeCloseTo(1.8);
  });
});
