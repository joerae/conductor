import { describe, it, expect, vi } from "vitest";
import { ConductorClock } from "../src/clock/ConductorClock";
import type { BeatObservation } from "../src/clock/clockTypes";

describe("ConductorClock Mode D (Inertial Cruise Control / Steer & Release)", () => {
  it("locks tempo on first two taps and begins inertial cruise", () => {
    let audioTime = 0.0;
    const clock = new ConductorClock({
      getAudioTime: () => audioTime,
      initialMode: "inertial",
    });

    const events: any[] = [];
    clock.on(ev => events.push(ev));

    // Tap 1 at t=1000ms
    clock.acceptObservation({ source: "camera", timestampMs: 1000, confidence: 0.9 });
    expect(clock.isRunning()).toBe(false);

    // Tap 2 at t=1500ms (500ms period = 120 BPM)
    audioTime = 0.5;
    clock.acceptObservation({ source: "camera", timestampMs: 1500, confidence: 0.9 });
    expect(clock.isRunning()).toBe(true);
    expect(clock.getState().bpm).toBeCloseTo(120, 1);
    expect(events.length).toBe(1);
  });

  it("free-wheels through missed beats using inertial flywheel timer", async () => {
    vi.useFakeTimers();
    let audioTime = 0.0;
    const clock = new ConductorClock({
      getAudioTime: () => audioTime,
      initialMode: "inertial",
    });

    const beatEvents: any[] = [];
    clock.on(ev => {
      if (ev.type === "beat") beatEvents.push(ev);
    });

    // Establish tempo with 2 beats at 500ms interval (120 BPM)
    clock.acceptObservation({ source: "camera", timestampMs: 1000, confidence: 1.0 });
    audioTime = 0.5;
    clock.acceptObservation({ source: "camera", timestampMs: 1500, confidence: 1.0 });

    expect(beatEvents.length).toBe(1);

    // Advance time by 4 beat intervals (2000ms) without any user input
    for (let i = 0; i < 4; i++) {
      audioTime += 0.5;
      vi.advanceTimersByTime(500);
    }

    // Inertial loop should have produced 4 automated flywheel beats!
    expect(beatEvents.length).toBe(5);
    expect(clock.isRunning()).toBe(true);

    vi.useRealTimers();
  });

  it("steers tempo smoothly when conductor provides fresh beats during cruise", async () => {
    vi.useFakeTimers();
    let audioTime = 0.0;
    const clock = new ConductorClock({
      getAudioTime: () => audioTime,
      initialMode: "inertial",
    });

    // Establish 120 BPM (500ms)
    clock.acceptObservation({ source: "camera", timestampMs: 1000, confidence: 1.0 });
    audioTime = 0.5;
    clock.acceptObservation({ source: "camera", timestampMs: 1500, confidence: 1.0 });
    expect(clock.getState().bpm).toBeCloseTo(120, 1);

    // Free-wheel for 2 beats (1000ms)
    audioTime += 1.0;
    vi.advanceTimersByTime(1000);

    // Now conductor speeds up to ~150 BPM (400ms interval)
    audioTime += 0.4;
    clock.acceptObservation({ source: "camera", timestampMs: 2900, confidence: 1.0 });

    // Smoothly blends toward higher BPM
    expect(clock.getState().bpm).toBeGreaterThan(122);

    vi.useRealTimers();
  });
});
