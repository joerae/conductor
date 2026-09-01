import { describe, it, expect } from "vitest";
import { HandMotionFilter } from "../src/camera/HandMotionFilter";
import { HandBeatDetector } from "../src/camera/HandBeatDetector";
import { BeatFusion } from "../src/camera/BeatFusion";
import type { HandSample } from "../src/camera/cameraTypes";
import type { MotionSample } from "../src/camera/HandMotionFilter";

function createMockSample(y: number, timestampMs: number, handIndex: number = 0, x: number = 0.5): HandSample {
  return {
    timestampMs,
    handIndex,
    handedness: handIndex === 0 ? "right" : "left",
    confidence: 0.95,
    landmarks: [],
    conductingPoint: { x, y: 1 - y },
    conductorPoint: { x, y },
  };
}

describe("HandBeatDetector & Kinematic Ictus Detection", () => {
  it("detects a clean downward stroke and preserves the exact trough timestamp", () => {
    const detector = new HandBeatDetector();

    // Direct motion samples feeding into detector:
    // Downward motion reaching trough at t=1120 (y=0.30), then rebounding upward at t=1150
    const motionStream: MotionSample[] = [
      { timestampMs: 1000, x: 0.5, y: 0.75, vy: -0.1, vx: 0, ay: 0 },
      { timestampMs: 1030, x: 0.5, y: 0.70, vy: -0.8, vx: 0, ay: 0 },
      { timestampMs: 1060, x: 0.5, y: 0.58, vy: -1.4, vx: 0, ay: 0 },
      { timestampMs: 1090, x: 0.5, y: 0.42, vy: -1.6, vx: 0, ay: 0 },
      { timestampMs: 1120, x: 0.5, y: 0.30, vy: -0.2, vx: 0, ay: 0 }, // Physical trough at t=1120!
      { timestampMs: 1150, x: 0.5, y: 0.33, vy: +0.6, vx: 0, ay: 0 }, // Rebounding upward
      { timestampMs: 1180, x: 0.5, y: 0.42, vy: +1.2, vx: 0, ay: 0 },
    ];

    const candidates = [];
    for (const motion of motionStream) {
      const candidate = detector.processSample(motion, 0);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    expect(candidates.length).toBe(1);
    expect(candidates[0].direction).toBe("trough");
    expect(candidates[0].timestampMs).toBe(1120); // Preserves exact physical trough timestamp!
    expect(candidates[0].y).toBe(0.30);
    expect(candidates[0].amplitude).toBeGreaterThanOrEqual(0.30);
    expect(candidates[0].confidence).toBeGreaterThanOrEqual(0.80);
  });

  it("detects a clean stroke through full motion filter pipeline", () => {
    const filter = new HandMotionFilter();
    const detector = new HandBeatDetector();

    let t = 1000;
    const trajectory = [0.75, 0.74, 0.70, 0.62, 0.50, 0.38, 0.35, 0.37, 0.42, 0.48];

    const candidates = [];
    for (const y of trajectory) {
      t += 30;
      const sample = createMockSample(y, t);
      const motion = filter.update(sample);
      const candidate = detector.processSample(motion, sample.handIndex);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    expect(candidates.length).toBe(1);
    expect(candidates[0].direction).toBe("trough");
    expect(candidates[0].amplitude).toBeGreaterThanOrEqual(0.30);
    expect(candidates[0].confidence).toBeGreaterThanOrEqual(0.80);
  });

  it("detects BOTTOM turnarounds only and ignores top apex turnarounds", () => {
    const filter = new HandMotionFilter();
    const detector = new HandBeatDetector();

    let t = 1000;
    const candidates = [];

    // Stroke 1: Downward stroke (0.80 -> 0.30 -> 0.38)
    const down1 = [0.80, 0.72, 0.58, 0.42, 0.30, 0.32, 0.38];
    for (const y of down1) {
      t += 35;
      const s = createMockSample(y, t);
      const m = filter.update(s);
      const c = detector.processSample(m, s.handIndex);
      if (c) candidates.push(c);
    }

    // Stroke 2: Upward rebound and top apex turnaround (0.38 -> 0.82 -> 0.70)
    const up1 = [0.46, 0.60, 0.74, 0.82, 0.80, 0.72];
    for (const y of up1) {
      t += 35;
      const s = createMockSample(y, t);
      const m = filter.update(s);
      const c = detector.processSample(m, s.handIndex);
      if (c) candidates.push(c);
    }

    // Only the bottom trough turnaround must be emitted; top turnaround is NOT a beat
    expect(candidates.length).toBe(1);
    expect(candidates[0].direction).toBe("trough");
  });

  it("enforces recovery requirement after a beat: wobbles near bottom do not trigger false beats", () => {
    const filter = new HandMotionFilter();
    const detector = new HandBeatDetector({ recoveryThreshold: 0.040 });

    let t = 1000;
    const candidates = [];

    // Step 1: Clean stroke that triggers a beat at y=0.30
    const stroke1 = [0.75, 0.65, 0.50, 0.35, 0.30, 0.33, 0.36];
    for (const y of stroke1) {
      t += 35;
      const s = createMockSample(y, t);
      const m = filter.update(s);
      const c = detector.processSample(m, s.handIndex);
      if (c) candidates.push(c);
    }
    expect(candidates.length).toBe(1);

    // Step 2: Hand wobbles near the bottom (between 0.32 and 0.34)
    // without recovering above 0.30 + 0.040 = 0.34
    const wobbles = [0.34, 0.32, 0.31, 0.33, 0.32, 0.30, 0.32];
    for (const y of wobbles) {
      t += 35;
      const s = createMockSample(y, t);
      const m = filter.update(s);
      const c = detector.processSample(m, s.handIndex);
      if (c) candidates.push(c);
    }
    // No extra beats should have been emitted during the wobble
    expect(candidates.length).toBe(1);

    // Step 3: Hand recovers fully upward to 0.70, then delivers 2nd clean downward stroke to 0.30
    const recoveryAndStroke2 = [
      0.45, 0.58, 0.70, 0.75, // Upward recovery past recovery threshold
      0.65, 0.50, 0.35, 0.30, 0.33, 0.37 // Stroke 2
    ];
    for (const y of recoveryAndStroke2) {
      t += 35;
      const s = createMockSample(y, t);
      const m = filter.update(s);
      const c = detector.processSample(m, s.handIndex);
      if (c) candidates.push(c);
    }

    // Now exactly 2 beats have been detected
    expect(candidates.length).toBe(2);
    expect(candidates[0].direction).toBe("trough");
    expect(candidates[1].direction).toBe("trough");
  });

  it("rejects small resting jitter without emitting false beats", () => {
    const filter = new HandMotionFilter();
    const detector = new HandBeatDetector();

    let t = 1000;
    const candidates = [];
    // Simulate stationary hand with small tracking noise (+/- 0.008)
    for (let i = 0; i < 40; i++) {
      t += 30;
      const jitter = (Math.sin(i) * 0.008);
      const sample = createMockSample(0.50 + jitter, t);
      const motion = filter.update(sample);
      const candidate = detector.processSample(motion, sample.handIndex);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    expect(candidates.length).toBe(0);
  });

  it("fuses simultaneous two-hand beats into exactly one beat observation", () => {
    const fusion = new BeatFusion({ fusionWindowMs: 75 });
    const emittedBeats: any[] = [];

    fusion.onFusedBeat((beat, details) => {
      emittedBeats.push({ beat, details });
    });

    // Left hand candidate at t=1000, Right hand candidate at t=1035 (35ms apart)
    fusion.submitCandidate({
      handIndex: 0,
      timestampMs: 1000,
      confidence: 0.90,
      amplitude: 0.25,
      peakVelocity: 0.85,
      direction: "trough",
      x: 0.30,
      y: 0.40,
    }, 2);

    fusion.submitCandidate({
      handIndex: 1,
      timestampMs: 1035,
      confidence: 0.90,
      amplitude: 0.28,
      peakVelocity: 0.90,
      direction: "trough",
      x: 0.70,
      y: 0.40,
    }, 2);

    expect(emittedBeats.length).toBe(1);
    expect(emittedBeats[0].details.handCount).toBe(2);
    expect(emittedBeats[0].beat.source).toBe("camera");
    expect(emittedBeats[0].beat.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("never emits multiple beats during a single long continuous downward motion", () => {
    const filter = new HandMotionFilter();
    const detector = new HandBeatDetector();

    let t = 1000;
    const candidates = [];
    // Continuous long slow downward movement: from 0.90 down to 0.10 over 800ms
    const longDescent = [
      0.90, 0.86, 0.82, 0.78, 0.74, 0.70, 0.66, 0.62, 0.58, 0.54, 0.50, 0.46,
      0.42, 0.38, 0.34, 0.30, 0.26, 0.22, 0.18, 0.14, 0.10, 0.12, 0.16, 0.22
    ];

    for (const y of longDescent) {
      t += 35;
      const sample = createMockSample(y, t);
      const motion = filter.update(sample);
      const cand = detector.processSample(motion, sample.handIndex);
      if (cand) candidates.push(cand);
    }

    // Must emit exactly 1 beat at the turnaround, NEVER multiple beats during descent!
    expect(candidates.length).toBe(1);
    expect(candidates[0].amplitude).toBeGreaterThan(0.70);
    expect(candidates[0].direction).toBe("trough");
  });
});
