import { describe, it, expect } from "vitest";
import {
  extractConductingPoint,
  toConductorSpace,
  HAND_LANDMARK_INDICES,
  type HandLandmark,
} from "../src/camera/cameraTypes";

function createMockLandmarks(): HandLandmark[] {
  const lms: HandLandmark[] = [];
  for (let i = 0; i < 21; i++) {
    lms.push({ x: 0.1 * i, y: 0.05 * i, z: 0.01 * i });
  }
  // Explicitly set wrist (#0) and index tip (#8)
  lms[HAND_LANDMARK_INDICES.WRIST] = { x: 0.4, y: 0.8, z: 0.1 };
  lms[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP] = { x: 0.6, y: 0.2, z: 0.3 };
  return lms;
}

describe("cameraTypes & Coordinate Transforms", () => {
  describe("extractConductingPoint", () => {
    it("extracts wrist landmark when type is 'wrist'", () => {
      const lms = createMockLandmarks();
      const pt = extractConductingPoint(lms, "wrist");
      expect(pt.x).toBeCloseTo(0.4);
      expect(pt.y).toBeCloseTo(0.8);
      expect(pt.z).toBeCloseTo(0.1);
    });

    it("extracts index fingertip landmark when type is 'indexTip'", () => {
      const lms = createMockLandmarks();
      const pt = extractConductingPoint(lms, "indexTip");
      expect(pt.x).toBeCloseTo(0.6);
      expect(pt.y).toBeCloseTo(0.2);
      expect(pt.z).toBeCloseTo(0.3);
    });

    it("calculates weighted blend between wrist and index fingertip", () => {
      const lms = createMockLandmarks();
      // 0.6 wrist (0.4, 0.8) + 0.4 index tip (0.6, 0.2)
      // x = 0.4 * 0.6 + 0.6 * 0.4 = 0.24 + 0.24 = 0.48
      // y = 0.8 * 0.6 + 0.2 * 0.4 = 0.48 + 0.08 = 0.56
      const pt = extractConductingPoint(lms, "weightedBlend", 0.6);
      expect(pt.x).toBeCloseTo(0.48);
      expect(pt.y).toBeCloseTo(0.56);
    });

    it("handles empty or insufficient landmarks safely", () => {
      const pt = extractConductingPoint([]);
      expect(pt.x).toBe(0.5);
      expect(pt.y).toBe(0.5);
    });
  });

  describe("toConductorSpace", () => {
    it("inverts Y axis so physically high is 1.0 and low is 0.0", () => {
      // Top of image space (y = 0.0) -> Conductor space 1.0 (raised high)
      const topPt = toConductorSpace({ x: 0.5, y: 0.0 });
      expect(topPt.y).toBe(1.0);
      expect(topPt.x).toBe(0.5);

      // Bottom of image space (y = 1.0) -> Conductor space 0.0 (low / floor)
      const botPt = toConductorSpace({ x: 0.5, y: 1.0 });
      expect(botPt.y).toBe(0.0);

      // Middle (y = 0.3) -> Conductor space 0.7
      const midPt = toConductorSpace({ x: 0.2, y: 0.3 });
      expect(midPt.y).toBeCloseTo(0.7);
      expect(midPt.x).toBeCloseTo(0.2);
    });

    it("clamps out-of-bounds coordinates to [0, 1]", () => {
      const outHigh = toConductorSpace({ x: 0.5, y: -0.2 });
      expect(outHigh.y).toBe(1.0);

      const outLow = toConductorSpace({ x: 0.5, y: 1.5 });
      expect(outLow.y).toBe(0.0);
    });
  });
});
