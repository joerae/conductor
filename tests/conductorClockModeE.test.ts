import { describe, it, expect, vi } from "vitest";
import { ConductorClock } from "../src/clock/ConductorClock";

describe("ConductorClock Mode E (Gestural Cruise & Continuous Accelerando)", () => {
  it("initializes in gestural mode by default with intended piece BPM", () => {
    let audioTime = 0.0;
    const clock = new ConductorClock({
      getAudioTime: () => audioTime,
      initialMode: "gestural",
    });

    expect(clock.getTempoMode()).toBe("gestural");
    // Clock can directly set intended piece BPM (e.g. 140 BPM for Mozart)
    clock.setBpm(140);
    expect(clock.getState().bpm).toBeCloseTo(140, 1);
    expect(clock.getState().periodMs).toBeCloseTo(428.57, 1);
  });

  it("starts running immediately at current period when hands are raised", () => {
    vi.useFakeTimers();
    let audioTime = 0.0;
    const clock = new ConductorClock({
      getAudioTime: () => audioTime,
      initialMode: "gestural",
    });

    clock.setBpm(120); // 500ms period
    const beats: number[] = [];
    clock.on(event => {
      if (event.type === "beat") beats.push(event.beatNumber);
    });

    // Conductor raises hands -> clock starts running without needing prep taps
    clock.startRunningAtCurrentPeriod();
    expect(clock.isRunning()).toBe(true);
    expect(beats.length).toBe(1);

    // Clock coasts periodic beats continuously
    vi.advanceTimersByTime(500);
    expect(beats.length).toBe(2);

    vi.advanceTimersByTime(500);
    expect(beats.length).toBe(3);

    vi.useRealTimers();
  });

  it("smoothly updates tempo via setBpm when raising hands together for accelerando", () => {
    vi.useFakeTimers();
    let audioTime = 0.0;
    const clock = new ConductorClock({
      getAudioTime: () => audioTime,
      initialMode: "gestural",
    });

    clock.setBpm(120); // 500ms period
    clock.startRunningAtCurrentPeriod();

    // Hands raised higher -> accelerando to 180 BPM (333.3ms period)
    clock.setBpm(180);
    expect(clock.getState().bpm).toBeCloseTo(180, 1);
    expect(clock.getState().periodMs).toBeCloseTo(333.33, 1);

    // Hands lowered -> rallentando to 90 BPM (666.7ms period)
    clock.setBpm(90);
    expect(clock.getState().bpm).toBeCloseTo(90, 1);
    expect(clock.getState().periodMs).toBeCloseTo(666.67, 1);

    vi.useRealTimers();
  });

  it("emits beat events for hand-beating feedback without altering height-controlled tempo", () => {
    vi.useFakeTimers();
    let audioTime = 0.0;
    const clock = new ConductorClock({
      getAudioTime: () => audioTime,
      initialMode: "gestural",
    });

    clock.setBpm(140); // 428.57ms
    clock.startRunningAtCurrentPeriod();

    // Conductor beats hand vigorously at a different interval (e.g. 800ms) for fun/sound feedback
    clock.acceptObservation({
      source: "camera",
      timestampMs: 1000,
      confidence: 1.0,
    });

    // In Mode E, the height-controlled tempo remains strictly preserved at 140 BPM!
    expect(clock.getState().bpm).toBeCloseTo(140, 1);
    expect(clock.getState().periodMs).toBeCloseTo(428.57, 1);

    vi.useRealTimers();
  });
});
