import { describe, it, expect } from "vitest";
import {
  doesRayIntersectBox,
  getTargetedInstrumentSection,
  type ScreenRect,
  type InstrumentSectionTarget,
} from "../src/camera/magicFingerGeometry";
import {
  AdaptiveRaySmoother,
  extractFingertipCoordinates,
} from "../src/camera/magicFingerMotion";
import type { HandSample } from "../src/camera/cameraTypes";

describe("magicFingerGeometry", () => {
  describe("doesRayIntersectBox", () => {
    const box = { left: 100, right: 200, top: 100, bottom: 200 };

    it("returns true when ray points directly into box", () => {
      // Ray starting at (50, 150) pointing right (1, 0)
      const hit = doesRayIntersectBox(50, 150, 1, 0, box);
      expect(hit).toBe(true);
    });

    it("returns false when ray points away from box", () => {
      // Ray starting at (50, 150) pointing left (-1, 0)
      const hit = doesRayIntersectBox(50, 150, -1, 0, box);
      expect(hit).toBe(false);
    });

    it("returns false when ray misses box above or below", () => {
      // Ray at y=50 pointing right
      const hit = doesRayIntersectBox(50, 50, 1, 0, box);
      expect(hit).toBe(false);
    });

    it("respects padding around bounding box", () => {
      // Ray at y=90 misses unpadded box (top is 100), but hits with pad=15
      expect(doesRayIntersectBox(50, 90, 1, 0, box, 0)).toBe(false);
      expect(doesRayIntersectBox(50, 90, 1, 0, box, 15)).toBe(true);
    });

    it("returns true when ray starts inside the box", () => {
      const hit = doesRayIntersectBox(150, 150, 0, 1, box);
      expect(hit).toBe(true);
    });

    it("handles zero direction vectors safely", () => {
      expect(doesRayIntersectBox(50, 150, 0, 0, box)).toBe(false);
      expect(doesRayIntersectBox(150, 150, 0, 0, box)).toBe(true);
    });
  });

  describe("getTargetedInstrumentSection", () => {
    const svgRect: ScreenRect = { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 };
    const sections: InstrumentSectionTarget[] = [
      { id: "violins", rect: { left: 100, right: 300, top: 20, bottom: 100, width: 200, height: 80 } },
      { id: "cellos", rect: { left: 400, right: 600, top: 20, bottom: 100, width: 200, height: 80 } },
    ];

    it("returns null when ray is not pointing upward", () => {
      // rayDirY = 0 or positive
      const res = getTargetedInstrumentSection(0, 0.5, 200, 400, svgRect, sections);
      expect(res).toBeNull();
    });

    it("identifies matching section when ray points upward towards it", () => {
      // Ray at (200, 400) pointing straight up (dirX=0, dirY=-1)
      const res = getTargetedInstrumentSection(0, -1, 200, 400, svgRect, sections);
      expect(res).not.toBeNull();
      expect(res?.sectionId).toBe("violins");
    });

    it("generates fallback sections from repertoire when instrumentSections is empty", () => {
      const repSections = [
        { id: "theme-a", name: "Theme A", measureStart: 1, measureEnd: 16 },
        { id: "theme-b", name: "Theme B", measureStart: 17, measureEnd: 32 },
      ];
      // Points up towards left half of stage
      const res = getTargetedInstrumentSection(-0.3, -0.9, 500, 500, svgRect, [], repSections);
      expect(res).not.toBeNull();
      expect(res?.sectionId).toBe("theme-a");
    });
  });

  describe("AdaptiveRaySmoother", () => {
    it("initializes to first direction on first sample", () => {
      const smoother = new AdaptiveRaySmoother();
      const dir = smoother.smooth(1, 0);
      expect(dir.dirX).toBeCloseTo(1, 4);
      expect(dir.dirY).toBeCloseTo(0, 4);
    });

    it("smooths direction towards target angle on subsequent samples", () => {
      const smoother = new AdaptiveRaySmoother();
      smoother.smooth(1, 0);
      const dir2 = smoother.smooth(0, -1);
      // Direction should be between (1, 0) and (0, -1)
      expect(dir2.dirX).toBeGreaterThan(0);
      expect(dir2.dirX).toBeLessThan(1);
      expect(dir2.dirY).toBeLessThan(0);
    });
  });

  describe("extractFingertipCoordinates", () => {
    it("converts normalized coordinates to SVG overlay space with mirroring", () => {
      const landmarks = Array(21).fill({ x: 0.5, y: 0.5, z: 0 });
      landmarks[8] = { x: 0.8, y: 0.4, z: 0 }; // tip
      landmarks[6] = { x: 0.8, y: 0.6, z: 0 }; // pip

      const sample: HandSample = {
        handIndex: 0,
        timestampMs: 100,
        handedness: "Right",
        confidence: 0.99,
        landmarks,
        conductorX: 0.8,
        conductorY: 0.4,
        speed: 0,
        acceleration: 0,
        direction: { x: 0, y: 0 },
      };

      const canvasRect = { left: 100, top: 100, width: 200, height: 200 };
      const svgRect = { left: 0, top: 0 };

      // Mirrored: 1 - 0.8 = 0.2 screen norm X -> startX = (100 - 0) + 0.2 * 200 = 140
      const coords = extractFingertipCoordinates(sample, canvasRect, svgRect, true);
      expect(coords.startX).toBeCloseTo(140, 1);
      expect(coords.startY).toBeCloseTo(180, 1);
      expect(coords.unitY).toBeLessThan(0); // pointing upward
    });
  });
});
