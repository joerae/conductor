import { describe, it, expect } from "vitest";
import { calculateGesturalTempoMultiplier } from "../src/experience/gesturalTempoMath";
import type { HandSample } from "../src/camera/cameraTypes";

function createMockSample(
  handIndex: number,
  x: number,
  y: number,
  landmarks?: { x: number; y: number; z: number }[]
): HandSample {
  return {
    handIndex,
    conductorPoint: { x, y },
    wrist: { x, y, z: 0 },
    landmarks: landmarks ?? [],
    handedness: handIndex === 0 ? "Right" : "Left",
    score: 0.95,
    gesture: "None",
    timestampMs: 1000,
  };
}

describe("gesturalTempoMath", () => {
  describe("empty samples", () => {
    it("returns 1.0 when no hands are present", () => {
      expect(calculateGesturalTempoMultiplier([], "classic")).toBe(1.0);
      expect(calculateGesturalTempoMultiplier([], "flipped")).toBe(1.0);
    });
  });

  describe("Classic mapping (vertical Y height)", () => {
    it("returns 1.0 for single hand in neutral deadband", () => {
      const sample = createMockSample(0, 0.5, 0.40);
      const mult = calculateGesturalTempoMultiplier([sample], "classic");
      expect(mult).toBe(1.0);
    });

    it("accelerates up to 1.65x when raising hand high", () => {
      const sample = createMockSample(0, 0.5, 0.85);
      const mult = calculateGesturalTempoMultiplier([sample], "classic");
      expect(mult).toBeCloseTo(1.65, 2);
    });

    it("decelerates down to 0.35x when lowering hand", () => {
      const sample = createMockSample(0, 0.5, 0.10);
      const mult = calculateGesturalTempoMultiplier([sample], "classic");
      expect(mult).toBeCloseTo(0.35, 2);
    });

    it("filters out beating hand variance when two hands are present", () => {
      // Hand 0 is beating (varying between 0.2 and 0.6)
      const handYHistory = new Map<number, number[]>();
      handYHistory.set(0, [0.2, 0.6, 0.2, 0.6, 0.2, 0.6]); // high variance
      // Hand 1 is steady at neutral height 0.40
      handYHistory.set(1, [0.40, 0.40, 0.40, 0.40]); // zero variance

      const s0 = createMockSample(0, 0.3, 0.4);
      const s1 = createMockSample(1, 0.7, 0.4);

      const mult = calculateGesturalTempoMultiplier([s0, s1], "classic", handYHistory);
      expect(mult).toBe(1.0);
    });
  });

  describe("Flipped mapping (horizontal span)", () => {
    it("returns 1.0 for two hands at neutral span", () => {
      // Touching span ~0.10 * 0.95 = 0.095. Neutral ~ 0.095 + 0.18 + 0.035 = 0.31.
      const s0 = createMockSample(0, 0.345, 0.4);
      const s1 = createMockSample(1, 0.655, 0.4);
      // centerSpan = 0.31
      const mult = calculateGesturalTempoMultiplier([s0, s1], "flipped");
      expect(mult).toBe(1.0);
    });

    it("accelerates when spreading hands apart", () => {
      const s0 = createMockSample(0, 0.1, 0.4);
      const s1 = createMockSample(1, 0.9, 0.4);
      // centerSpan = 0.80 -> well above neutral
      const mult = calculateGesturalTempoMultiplier([s0, s1], "flipped");
      expect(mult).toBeGreaterThan(1.5);
    });

    it("decelerates when bringing hands together", () => {
      const s0 = createMockSample(0, 0.48, 0.4);
      const s1 = createMockSample(1, 0.52, 0.4);
      // centerSpan = 0.04 -> close together
      const mult = calculateGesturalTempoMultiplier([s0, s1], "flipped");
      expect(mult).toBeLessThan(0.7);
    });

    it("handles single hand position relative to center", () => {
      // Neutral is between dx 0.10 and 0.25 (e.g. x = 0.68 -> dx = 0.18)
      const sNeutral = createMockSample(0, 0.68, 0.4);
      expect(calculateGesturalTempoMultiplier([sNeutral], "flipped")).toBe(1.0);

      // Wide (spread out toward edge) accelerates (x = 0.90 -> dx = 0.40 > 0.25)
      const sWide = createMockSample(0, 0.90, 0.4);
      expect(calculateGesturalTempoMultiplier([sWide], "flipped")).toBeGreaterThan(1.0);

      // Center (tucked into center of screen) decelerates (x = 0.50 -> dx = 0.0 < 0.10)
      const sCenter = createMockSample(0, 0.50, 0.4);
      expect(calculateGesturalTempoMultiplier([sCenter], "flipped")).toBeCloseTo(0.35, 2);
    });
  });
});
