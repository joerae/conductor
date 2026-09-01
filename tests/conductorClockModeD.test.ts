import { describe, it, expect, vi } from "vitest";
import { ConductorClock } from "../src/clock/ConductorClock";

describe("ConductorClock Mode D (Sparse Predicted Conducting Pulses)", () => {
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

    // Tap 2 at t=2000ms (1000ms pulse period = 60 conducted pulses/min)
    audioTime = 1.0;
    clock.acceptObservation({ source: "camera", timestampMs: 2000, confidence: 0.9 });
    expect(clock.isRunning()).toBe(true);
    expect(clock.getState().periodMs).toBe(1000);
    expect(clock.getState().bpm).toBeCloseTo(60, 1);
    expect(events.length).toBe(1);
  });

  it("maintains predicted timeline and free-wheels through missed beats without slowing down", () => {
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

    // Establish tempo with 2 beats at 1000ms interval (60 pulses/min)
    clock.acceptObservation({ source: "camera", timestampMs: 1000, confidence: 1.0 });
    audioTime = 1.0;
    clock.acceptObservation({ source: "camera", timestampMs: 2000, confidence: 1.0 });

    expect(beatEvents.length).toBe(1);

    // Advance time by 4 pulse intervals (4000ms) without any user input
    for (let i = 0; i < 4; i++) {
      audioTime += 1.0;
      vi.advanceTimersByTime(1000);
    }

    // Inertial loop should have produced 4 automated flywheel beats at 1000ms interval
    expect(beatEvents.length).toBe(5);
    expect(clock.isRunning()).toBe(true);
    expect(clock.getState().periodMs).toBe(1000);
    expect(clock.getState().bpm).toBeCloseTo(60, 1);

    vi.useRealTimers();
  });

  it("associates observation after a multi-second gap with the most plausible predicted pulse without crashing tempo", () => {
    vi.useFakeTimers();
    let audioTime = 0.0;
    const clock = new ConductorClock({
      getAudioTime: () => audioTime,
      initialMode: "inertial",
    });

    // Establish 1000ms pulse (60 BPM)
    clock.acceptObservation({ source: "camera", timestampMs: 1000, confidence: 1.0 });
    audioTime = 1.0;
    clock.acceptObservation({ source: "camera", timestampMs: 2000, confidence: 1.0 });
    expect(clock.getState().periodMs).toBe(1000);

    // Free-wheel for 3 pulses (3000ms elapsed)
    audioTime += 3.0;
    vi.advanceTimersByTime(3000);

    // New observation arrives at t=5040ms (~3 pulses later, 40ms late relative to 5000ms)
    // Mode D should recognize that ~3 pulses elapsed, rather than calculating tempo as 60000 / 3040 = 19.7 BPM!
    audioTime += 0.04;
    clock.acceptObservation({ source: "camera", timestampMs: 5040, confidence: 1.0 });

    const state = clock.getState();
    // Tempo must remain stable near 1000ms (BPM ~60), NOT crashed to ~20 BPM!
    expect(state.periodMs).toBeGreaterThan(950);
    expect(state.periodMs).toBeLessThan(1050);
    expect(state.bpm).toBeCloseTo(60, 0);

    // Phase error is ~40ms
    expect(state.phaseErrorMs).toBeCloseTo(40, 1);

    vi.useRealTimers();
  });

  it("distinguishes phase error on single re-entry tap vs tempo change across sustained consecutive taps", () => {
    vi.useFakeTimers();
    let audioTime = 0.0;
    const clock = new ConductorClock({
      getAudioTime: () => audioTime,
      initialMode: "inertial",
    });

    // Establish 1000ms period (60 BPM)
    clock.acceptObservation({ source: "keyboard", timestampMs: 1000, confidence: 1.0 });
    audioTime = 1.0;
    clock.acceptObservation({ source: "keyboard", timestampMs: 2000, confidence: 1.0 });

    // Step 1: Gap of 2 pulses (2000ms) -> single tap arrives at t=4060ms (60ms late)
    audioTime += 2.06;
    vi.advanceTimersByTime(2060);
    clock.acceptObservation({ source: "keyboard", timestampMs: 4060, confidence: 1.0 });

    // Single tap after gap should mostly correct phase, keeping periodMs stable (~1000ms)
    expect(clock.getState().periodMs).toBeGreaterThan(980);
    expect(clock.getState().periodMs).toBeLessThan(1020);

    // Step 2: Conductor now begins an intentional accelerando with sustained consecutive faster taps at 800ms
    // Tap 1 of accelerando at t=4860 (800ms after 4060)
    audioTime += 0.8;
    vi.advanceTimersByTime(800);
    clock.acceptObservation({ source: "keyboard", timestampMs: 4860, confidence: 1.0 });

    const periodAfterFirstFast = clock.getState().periodMs;
    expect(periodAfterFirstFast).toBeLessThan(980); // Smoothly pulling down

    // Tap 2 of accelerando at t=5660 (800ms after 4860)
    audioTime += 0.8;
    vi.advanceTimersByTime(800);
    clock.acceptObservation({ source: "keyboard", timestampMs: 5660, confidence: 1.0 });

    const periodAfterSecondFast = clock.getState().periodMs;
    expect(periodAfterSecondFast).toBeLessThan(periodAfterFirstFast);

    // Tap 3 of accelerando at t=6460 (800ms after 5660)
    audioTime += 0.8;
    vi.advanceTimersByTime(800);
    clock.acceptObservation({ source: "keyboard", timestampMs: 6460, confidence: 1.0 });

    const periodAfterThirdFast = clock.getState().periodMs;
    expect(periodAfterThirdFast).toBeLessThan(periodAfterSecondFast);

    // Tap 4 of accelerando at t=7260 (800ms after 6460)
    audioTime += 0.8;
    vi.advanceTimersByTime(800);
    clock.acceptObservation({ source: "keyboard", timestampMs: 7260, confidence: 1.0 });

    // Tempo has smoothly and continuously shifted toward 800ms (75 BPM)
    expect(clock.getState().periodMs).toBeLessThan(870);
    expect(clock.getState().bpm).toBeGreaterThan(69);

    vi.useRealTimers();
  });

  it("handles the complete steer-and-release conducting workflow", () => {
    vi.useFakeTimers();
    let audioTime = 0.0;
    const clock = new ConductorClock({
      getAudioTime: () => audioTime,
      initialMode: "inertial",
    });

    // 1. Establish tempo
    clock.acceptObservation({ source: "camera", timestampMs: 1000, confidence: 1.0 });
    audioTime = 1.0;
    clock.acceptObservation({ source: "camera", timestampMs: 2000, confidence: 1.0 });

    // 2. Conduct normally for a couple pulses
    audioTime += 1.0;
    vi.advanceTimersByTime(1000);
    clock.acceptObservation({ source: "camera", timestampMs: 3000, confidence: 1.0 });

    audioTime += 1.0;
    vi.advanceTimersByTime(1000);
    clock.acceptObservation({ source: "camera", timestampMs: 4000, confidence: 1.0 });

    // 3. Stop marking beats for several pulses while using both hands to change dynamics
    audioTime += 4.0;
    vi.advanceTimersByTime(4000);

    // 4. Orchestra continues at predicted tempo
    expect(clock.isRunning()).toBe(true);
    expect(clock.getState().periodMs).toBeCloseTo(1000, 1);

    // 5. Resume conducting at t=8050 (4 pulses later, 50ms late)
    audioTime += 0.05;
    clock.acceptObservation({ source: "camera", timestampMs: 8050, confidence: 1.0 });

    // 6. Matches ictus to predicted pulse, smoothly re-anchors without wild tempo change
    expect(clock.getState().periodMs).toBeGreaterThan(950);
    expect(clock.getState().periodMs).toBeLessThan(1050);
    expect(clock.getState().phaseErrorMs).toBeCloseTo(50, 1);

    vi.useRealTimers();
  });
});
