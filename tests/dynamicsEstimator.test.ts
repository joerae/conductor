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
    expect(estimator.isActivelyChanging()).toBe(false);
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

    it("detects active dynamics shaping during rapid hand separation change and settles with hysteresis", () => {
      const estimator = new DynamicsEstimator({
        mode: "spread",
        dynamicsEngageRate: 0.18,
        dynamicsReleaseRate: 0.07,
        dynamicsSettleMs: 200,
      });

      let t = 1000;
      // Initial resting shoulder width: span = 0.30
      let hands = [createMockSample(0.50, 0, 0.35), createMockSample(0.50, 1, 0.65)];
      estimator.update(hands, t);

      // Hands held stationary for 200ms
      for (let i = 0; i < 5; i++) {
        t += 40;
        estimator.update(hands, t);
      }
      expect(estimator.isActivelyChanging()).toBe(false);

      // Now actively pull hands apart rapidly from span 0.30 to 0.70 over 300ms (rate = 1.33 units/sec)
      for (let i = 1; i <= 8; i++) {
        t += 35;
        const leftX = 0.35 - (0.20 * i / 8);
        const rightX = 0.65 + (0.20 * i / 8);
        hands = [createMockSample(0.50, 0, leftX), createMockSample(0.50, 1, rightX)];
        const obs = estimator.update(hands, t);
        if (i >= 3) {
          expect(obs.isActivelyChanging).toBe(true);
          expect(estimator.isActivelyChanging()).toBe(true);
        }
      }

      // Hands stop moving and are held wide apart (span = 0.70)
      // Advance by 100ms: within hysteresis settle hold (200ms), still active
      for (let i = 0; i < 2; i++) {
        t += 50;
        estimator.update(hands, t);
      }
      expect(estimator.isActivelyChanging()).toBe(true);

      // Advance by another 350ms (total hold = 450ms > 200ms settle): now settled!
      for (let i = 0; i < 7; i++) {
        t += 50;
        estimator.update(hands, t);
      }
      // Once settled, active dynamics state disengages even while hands are held far apart
      expect(estimator.isActivelyChanging()).toBe(false);
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
