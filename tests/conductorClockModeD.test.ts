import { describe, it, expect, vi } from "vitest";
import { ConductorClock } from "../src/clock/ConductorClock";

describe("ConductorClock Mode D (Coasting & Consistent Tempo Steering)", () => {
  it("locks tempo on first two taps and begins coasting", () => {
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

  it("coasts continuously at established tempo when no observations arrive", () => {
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

    // Establish 1000ms period
    clock.acceptObservation({ source: "camera", timestampMs: 1000, confidence: 1.0 });
    audioTime = 1.0;
    clock.acceptObservation({ source: "camera", timestampMs: 2000, confidence: 1.0 });

    expect(beatEvents.length).toBe(1);

    // Advance 6 pulses (6000ms) without any conducting input
    for (let i = 0; i < 6; i++) {
      audioTime += 1.0;
      vi.advanceTimersByTime(1000);
    }

    // Coasts steadily at 1000ms
    expect(beatEvents.length).toBe(7);
    expect(clock.isRunning()).toBe(true);
    expect(clock.getState().periodMs).toBe(1000);

    vi.useRealTimers();
  });

  it("keeps tempo rock-solid with zero micro-adjustments during steady conducting within deadband", () => {
    let audioTime = 0.0;
    const clock = new ConductorClock({
      getAudioTime: () => audioTime,
      initialMode: "inertial",
    });

    // Establish 1000ms period
    clock.acceptObservation({ source: "camera", timestampMs: 1000, confidence: 1.0 });
    audioTime = 1.0;
    clock.acceptObservation({ source: "camera", timestampMs: 2000, confidence: 1.0 });
    expect(clock.getState().periodMs).toBe(1000);

    // Conductor beats steadily with natural human jitter (+/- 2-4%):
    // 985ms, 1015ms, 990ms, 1020ms, 980ms
    const jitteredIntervals = [985, 1015, 990, 1020, 980];
    let currentT = 2000;

    for (const dt of jitteredIntervals) {
      currentT += dt;
      audioTime += dt / 1000;
      clock.acceptObservation({ source: "camera", timestampMs: currentT, confidence: 1.0 });

      // Tempo must stay strictly rock-solid at 1000ms without micro-adjusting
      const state = clock.getState();
      expect(state.periodMs).toBe(1000);
      expect(state.bpm).toBe(60);
      // Small phase error within deadband produces 0 phase warping
      expect(state.phaseCorrectionSec).toBe(0);
      // Jitter telemetry populated
      expect(state.jitterStatus).toBe("steady");
      expect(state.tempoDeadband).toBe(clock.getTempoDeadband());
      expect(Math.abs(state.lastJitterMs!)).toBeLessThanOrEqual(25);
      expect(state.averageJitterMs).toBeGreaterThan(0);
    }

    // Changing deadband dynamically via setTempoDeadband()
    clock.setTempoDeadband(0.10);
    expect(clock.getTempoDeadband()).toBe(0.10);
    expect(clock.getState().tempoDeadband).toBe(0.10);
  });

  it("handles gaps without inferring skipped beats or changing established tempo", () => {
    vi.useFakeTimers();
    let audioTime = 0.0;
    const clock = new ConductorClock({
      getAudioTime: () => audioTime,
      initialMode: "inertial",
    });

    // Establish 1000ms period (60 BPM)
    clock.acceptObservation({ source: "camera", timestampMs: 1000, confidence: 1.0 });
    audioTime = 1.0;
    clock.acceptObservation({ source: "camera", timestampMs: 2000, confidence: 1.0 });

    // Gap: conductor shapes dynamics for 4.5 seconds
    audioTime += 4.5;
    vi.advanceTimersByTime(4500);

    // Beat 1 of resume at t=6530 (4.53s gap): gently re-anchors phase, does NOT change tempo!
    audioTime += 0.03;
    clock.acceptObservation({ source: "camera", timestampMs: 6530, confidence: 1.0 });

    // Tempo must remain rock-solid at 1000ms (NOT altered by gap interval)
    expect(clock.getState().periodMs).toBe(1000);
    expect(clock.getState().bpm).toBeCloseTo(60, 0);

    vi.useRealTimers();
  });

  it("requires mutually consistent observations to steer tempo, smoothly accelerating", () => {
    vi.useFakeTimers();
    let audioTime = 0.0;
    const clock = new ConductorClock({
      getAudioTime: () => audioTime,
      initialMode: "inertial",
    });

    // Establish 1000ms period
    clock.acceptObservation({ source: "keyboard", timestampMs: 1000, confidence: 1.0 });
    audioTime = 1.0;
    clock.acceptObservation({ source: "keyboard", timestampMs: 2000, confidence: 1.0 });

    // Single erratic / isolated tap at 550ms (inconsistent with 1000ms)
    audioTime += 0.55;
    vi.advanceTimersByTime(550);
    clock.acceptObservation({ source: "keyboard", timestampMs: 2550, confidence: 1.0 });

    // Orchestra ignores single odd tap and stays at 1000ms
    expect(clock.getState().periodMs).toBe(1000);

    // Now conductor delivers consistent accelerando at 750ms:
    // Tap 1 of accelerando at 3300 (750ms after 2550)
    audioTime += 0.75;
    vi.advanceTimersByTime(750);
    clock.acceptObservation({ source: "keyboard", timestampMs: 3300, confidence: 1.0 });

    // Tap 2 of accelerando at 4050 (750ms after 3300) -> 2 consistent 750ms intervals!
    audioTime += 0.75;
    vi.advanceTimersByTime(750);
    clock.acceptObservation({ source: "keyboard", timestampMs: 4050, confidence: 1.0 });

    const periodAfter2Consistent = clock.getState().periodMs;
    // Tempo transitions toward 750ms
    expect(periodAfter2Consistent).toBeLessThan(950);

    // Tap 3 of accelerando at 4800 (750ms after 4050) -> 3 consistent intervals: follows strongly!
    audioTime += 0.75;
    vi.advanceTimersByTime(750);
    clock.acceptObservation({ source: "keyboard", timestampMs: 4800, confidence: 1.0 });

    const periodAfter3Consistent = clock.getState().periodMs;
    expect(periodAfter3Consistent).toBeLessThan(periodAfter2Consistent);
    expect(periodAfter3Consistent).toBeLessThan(890);

    // Tap 4 of accelerando at 5550 -> continues smoothly steering
    audioTime += 0.75;
    vi.advanceTimersByTime(750);
    clock.acceptObservation({ source: "keyboard", timestampMs: 5550, confidence: 1.0 });

    expect(clock.getState().periodMs).toBeLessThan(850);
    expect(clock.getState().bpm).toBeGreaterThan(70);

    vi.useRealTimers();
  });

  it("coasts through normal conducting gaps but pauses after 16 bars of complete inactivity", () => {
    vi.useFakeTimers();
    let audioTime = 0.0;
    const clock = new ConductorClock({
      getAudioTime: () => audioTime,
      initialMode: "inertial",
    });

    let stopped = false;
    clock.on(ev => {
      if (ev.type === "stopped") stopped = true;
    });

    // Establish 1000ms tempo (in 4/4 with 2 beats/pulse, 1 bar = 2 pulses = 2000ms)
    clock.acceptObservation({ source: "camera", timestampMs: 1000, confidence: 1.0 });
    audioTime = 1.0;
    clock.acceptObservation({ source: "camera", timestampMs: 2000, confidence: 1.0 });

    // Free-wheel for 15 bars (30 pulses = 30 seconds)
    for (let p = 0; p < 30; p++) {
      audioTime += 1.0;
      vi.advanceTimersByTime(1000);
    }
    // Still coasting normally during the 15 bars
    expect(clock.isRunning()).toBe(true);
    expect(stopped).toBe(false);

    // Advance past the 16th bar boundary (pulse 32)
    audioTime += 2.0;
    vi.advanceTimersByTime(2000);

    // After 16 bars without input, pauses the orchestra!
    expect(stopped).toBe(true);
    expect(clock.isRunning()).toBe(false);

    vi.useRealTimers();
  });
});
