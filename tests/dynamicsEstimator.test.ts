import { describe, it, expect } from "vitest";
import { DynamicsEstimator } from "../src/camera/DynamicsEstimator";
import type { HandSample } from "../src/camera/cameraTypes";

function createMockSample(conductorY: number, handIndex: number = 0): HandSample {
  return {
    timestampMs: 1000,
    handIndex,
    handedness: handIndex === 0 ? "right" : "left",
    confidence: 0.9,
    landmarks: [],
    conductingPoint: { x: 0.5, y: 1 - conductorY },
    conductorPoint: { x: 0.5, y: conductorY },
  };
}

describe("DynamicsEstimator (Hand Height -> Musical Dynamic Level)", () => {
  it("initializes to neutral mf (0.50)", () => {
    const estimator = new DynamicsEstimator();
    const obs = estimator.getObservation();
    expect(obs.level).toBe("mf");
    expect(obs.value).toBeCloseTo(0.5, 1);
  });

  it("smoothly increases dynamics to ff when hands are held high", () => {
    const estimator = new DynamicsEstimator({ timeConstantMs: 200 });
    let t = 1000;
    const highHand = [createMockSample(0.85)];

    // Simulate holding hand high over 1.2 seconds
    let obs = estimator.update(highHand, t);
    for (let i = 0; i < 20; i++) {
      t += 50;
      obs = estimator.update(highHand, t);
    }

    expect(obs.value).toBeGreaterThan(0.78);
    expect(["f", "ff", "fff"]).toContain(obs.level);
  });

  it("smoothly decreases dynamics to pp when hands are held low", () => {
    const estimator = new DynamicsEstimator({ timeConstantMs: 200 });
    let t = 1000;
    const lowHand = [createMockSample(0.12)];

    // Simulate holding hand low over 1.2 seconds
    let obs = estimator.update(lowHand, t);
    for (let i = 0; i < 20; i++) {
      t += 50;
      obs = estimator.update(lowHand, t);
    }

    expect(obs.value).toBeLessThan(0.15);
    expect(["p", "pp"]).toContain(obs.level);
  });

  it("averages two visible hands together", () => {
    const estimator = new DynamicsEstimator({ timeConstantMs: 100 });
    let t = 1000;
    // Left hand at 0.80, Right hand at 0.60 -> average 0.70
    const twoHands = [createMockSample(0.80, 0), createMockSample(0.60, 1)];

    let obs = estimator.update(twoHands, t);
    for (let i = 0; i < 20; i++) {
      t += 50;
      obs = estimator.update(twoHands, t);
    }

    expect(obs.handCount).toBe(2);
    expect(obs.smoothedY).toBeCloseTo(0.70, 1);
  });

  it("rejects fast instantaneous beat stroke up/down oscillations without discrete volume pumping", () => {
    const estimator = new DynamicsEstimator({ timeConstantMs: 650 });
    let t = 1000;

    // Simulate rapid up/down beating around neutral center 0.50
    // (e.g. stroke goes down to 0.30 then up to 0.70 every 100ms)
    let obs = estimator.update([createMockSample(0.50)], t);
    for (let cycle = 0; cycle < 6; cycle++) {
      t += 100;
      obs = estimator.update([createMockSample(0.30)], t); // ictus down
      t += 100;
      obs = estimator.update([createMockSample(0.70)], t); // rebound up
    }

    // After 6 fast beat strokes around 0.50, smoothed level remains steady mf
    expect(obs.level).toBe("mf");
    expect(obs.value).toBeGreaterThan(0.40);
    expect(obs.value).toBeLessThan(0.60);
  });

  it("holds posture during brief hand loss before drifting toward neutral", () => {
    const estimator = new DynamicsEstimator({ dropoutHoldMs: 500, timeConstantMs: 200 });
    let t = 1000;

    // First, establish forte posture at 0.62 (value ~0.67 -> f)
    const forteHand = [createMockSample(0.62)];
    for (let i = 0; i < 15; i++) {
      t += 50;
      estimator.update(forteHand, t);
    }
    const beforeLoss = estimator.getObservation();
    expect(beforeLoss.level).toBe("f");

    // Hand drops out for 300ms (< dropoutHoldMs of 500ms)
    t += 300;
    const duringHold = estimator.update([], t);
    expect(duringHold.level).toBe("f"); // Holds posture

    // Hand remains absent for another 1500ms (> dropoutHoldMs)
    for (let i = 0; i < 20; i++) {
      t += 50;
      estimator.update([], t);
    }
    const afterDecay = estimator.getObservation();
    expect(afterDecay.level).toBe("mf"); // Gently drifted to neutral mf
  });
});
