import { describe, it, expect } from "vitest";
import { DynamicsEstimator } from "../src/camera/DynamicsEstimator";
import type { HandSample } from "../src/camera/cameraTypes";

function createMockSample(conductorY: number, handIndex: number = 0, conductorX: number = 0.5): HandSample {
  return {
    timestampMs: 1000,
    handIndex,
    handedness: handIndex === 0 ? "right" : "left",
    confidence: 0.9,
    landmarks: [],
    conductingPoint: { x: conductorX, y: 1 - conductorY },
    conductorPoint: { x: conductorX, y: conductorY },
  };
}

describe("DynamicsEstimator (Two Switchable Modes: Spread vs Height)", () => {
  it("initializes to neutral mf (0.50) in spread mode by default", () => {
    const estimator = new DynamicsEstimator();
    expect(estimator.getMode()).toBe("spread");
    const obs = estimator.getObservation();
    expect(obs.level).toBe("mf");
    expect(obs.value).toBeCloseTo(0.5, 1);
  });

  describe("Mode 1: Spread / Aperture (Default)", () => {
    it("expands dynamics to fff when hands are pulled wide apart (height ignored)", () => {
      const estimator = new DynamicsEstimator({ mode: "spread", timeConstantMs: 120 });
      let t = 1000;
      // Hands at mid height (y=0.50), but spread wide apart: x=0.15 and x=0.85 (span = 0.70)
      const wideHands = [
        createMockSample(0.50, 0, 0.15),
        createMockSample(0.50, 1, 0.85),
      ];

      let obs = estimator.update(wideHands, t);
      for (let i = 0; i < 20; i++) {
        t += 50;
        obs = estimator.update(wideHands, t);
      }

      expect(obs.handCount).toBe(2);
      expect(obs.value).toBeGreaterThanOrEqual(0.85);
      expect(["ff", "fff"]).toContain(obs.level);
    });

    it("contracts dynamics to pp when hands are brought close together (height ignored)", () => {
      const estimator = new DynamicsEstimator({ mode: "spread", timeConstantMs: 120 });
      let t = 1000;
      // Hands at high height (y=0.80), but pinched close together: x=0.48 and x=0.52 (span = 0.04)
      const closeHands = [
        createMockSample(0.80, 0, 0.48),
        createMockSample(0.80, 1, 0.52),
      ];

      let obs = estimator.update(closeHands, t);
      for (let i = 0; i < 20; i++) {
        t += 50;
        obs = estimator.update(closeHands, t);
      }

      expect(obs.handCount).toBe(2);
      expect(obs.value).toBeLessThanOrEqual(0.12);
      expect(obs.level).toBe("pp");
    });
  });

  describe("Mode 2: Vertical Hand Height", () => {
    it("increases dynamics to ff/fff when hands are raised high (span ignored)", () => {
      const estimator = new DynamicsEstimator({ mode: "height", timeConstantMs: 120 });
      let t = 1000;
      // Hands raised high (y=0.85), but close together (x=0.48, x=0.52)
      const highHands = [
        createMockSample(0.85, 0, 0.48),
        createMockSample(0.85, 1, 0.52),
      ];

      let obs = estimator.update(highHands, t);
      for (let i = 0; i < 20; i++) {
        t += 50;
        obs = estimator.update(highHands, t);
      }

      expect(obs.value).toBeGreaterThanOrEqual(0.85);
      expect(["ff", "fff"]).toContain(obs.level);
    });

    it("decreases dynamics to pp when hands are held low", () => {
      const estimator = new DynamicsEstimator({ mode: "height", timeConstantMs: 120 });
      let t = 1000;
      // Single hand held low (y=0.15)
      const lowHand = [createMockSample(0.15)];

      let obs = estimator.update(lowHand, t);
      for (let i = 0; i < 20; i++) {
        t += 50;
        obs = estimator.update(lowHand, t);
      }

      expect(obs.value).toBeLessThanOrEqual(0.10);
      expect(obs.level).toBe("pp");
    });
  });

  it("dynamically switches mode via setMode()", () => {
    const estimator = new DynamicsEstimator({ timeConstantMs: 100 });
    expect(estimator.getMode()).toBe("spread");

    estimator.setMode("height");
    expect(estimator.getMode()).toBe("height");

    estimator.setMode("spread");
    expect(estimator.getMode()).toBe("spread");
  });
});
