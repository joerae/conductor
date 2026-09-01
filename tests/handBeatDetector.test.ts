import { describe, it, expect } from "vitest";
import { HandMotionFilter } from "../src/camera/HandMotionFilter";
import { HandBeatDetector } from "../src/camera/HandBeatDetector";
import { BeatFusion } from "../src/camera/BeatFusion";
import type { HandSample } from "../src/camera/cameraTypes";

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

describe("HandBeatDetector & Kinematic ictus Detection (Phases C1 & C2)", () => {
  it("detects a clean downward stroke and emits a candidate beat at the inflection point", () => {
    const filter = new HandMotionFilter();
    const detector = new HandBeatDetector();

    let t = 1000;
    // Simulate downward stroke: start high (0.75), plunge down to (0.35) over 250ms, then rebound up (0.45)
    const trajectory = [
      0.75, 0.74, 0.70, 0.62, 0.50, 0.38, 0.35, 0.37, 0.42, 0.48
    ];

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
    expect(candidates[0].amplitude).toBeGreaterThanOrEqual(0.30);
    expect(candidates[0].confidence).toBeGreaterThanOrEqual(0.80);
  });

  it("rejects small resting jitter without emitting false beats", () => {
    const filter = new HandMotionFilter();
    const detector = new HandBeatDetector();

    let t = 1000;
    const candidates = [];
    // Simulate stationary hand with small tracking noise (+/- 0.01)
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
      x: 0.30,
      y: 0.40,
    }, 2);

    fusion.submitCandidate({
      handIndex: 1,
      timestampMs: 1035,
      confidence: 0.90,
      amplitude: 0.28,
      peakVelocity: 0.90,
      x: 0.70,
      y: 0.40,
    }, 2);

    expect(emittedBeats.length).toBe(1);
    expect(emittedBeats[0].details.handCount).toBe(2);
    expect(emittedBeats[0].beat.source).toBe("camera");
    expect(emittedBeats[0].beat.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("handles fast conducting tempos (up to 200+ BPM) without refractory blockage", () => {
    const detector = new HandBeatDetector({ refractoryMs: 130 });
    const filter = new HandMotionFilter();
    let t = 1000;
    const detectedBeats = [];

    // Simulate 4 successive beat strokes at 200 BPM (period = 300ms)
    for (let beat = 0; beat < 4; beat++) {
      const stroke = [0.65, 0.55, 0.40, 0.35, 0.38, 0.45, 0.58, 0.65];
      for (const y of stroke) {
        t += 35;
        const sample = createMockSample(y, t);
        const motion = filter.update(sample);
        const cand = detector.processSample(motion, sample.handIndex);
        if (cand) detectedBeats.push(cand);
      }
    }

    expect(detectedBeats.length).toBe(4);
  });
});
