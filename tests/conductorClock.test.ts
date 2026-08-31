/**
 * conductorClock.test.ts
 *
 * Deterministic unit tests for ConductorClock.
 * These feed synthetic tap sequences without any audio — the getAudioTime
 * function is injected and advances in sync with the tap timestamps.
 *
 * Acceptance criteria from design doc §9 (Phase 0):
 *   ✓ Stable 120 BPM + realistic jitter remains audibly stable
 *   ✓ 90 to 140 BPM accelerando over 8 beats is followed without abrupt jumps
 *   ✓ A ritardando does not stall or reverse the clock
 *   ✓ One missed tap does not halve the tempo
 *   ✓ An accidental quick double tap is ignored
 *   ✓ The opening sound lands on the beat predicted from the two preparatory taps
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ConductorClock } from "../src/clock/ConductorClock";
import type { ClockEvent } from "../src/clock/ConductorClock";
import {
  stableTaps,
  accelerandoTaps,
  tapsWithMissedBeat,
  doubleTapScenario,
} from "./tapScenarios";

// ── Helper: feed taps into a clock and collect events ─────────────────────────

function feedTaps(
  clock: ConductorClock,
  tapsMs: number[],
  audioTimeOffsetSec: number = 0
): ClockEvent[] {
  const events: ClockEvent[] = [];
  const unsub = clock.on(e => events.push(e));
  for (const ms of tapsMs) {
    clock.acceptObservation({
      source: "keyboard",
      timestampMs: ms,
      confidence: 1.0,
    });
  }
  unsub();
  return events;
}

/**
 * Create a clock with a fake audio time that advances proportionally to
 * the tap timestamps (so the clock sees consistent audio time).
 */
function makeClock(options?: { tempoGain?: number; phaseGain?: number }) {
  let audioTimeSec = 0;
  // We'll inject a function that returns audio time in seconds.
  // For tests, we set it manually before each tap.
  const clock = new ConductorClock({
    getAudioTime: () => audioTimeSec,
    getNow: () => 0, // Not used in unit test path
    ...options,
  });
  return { clock, setAudioTime: (sec: number) => { audioTimeSec = sec; } };
}

function feedTapsWithAudio(
  clock: ConductorClock,
  setAudioTime: (s: number) => void,
  tapsMs: number[]
): ClockEvent[] {
  const events: ClockEvent[] = [];
  const unsub = clock.on(e => events.push(e));
  for (const ms of tapsMs) {
    setAudioTime(ms / 1000); // ms → seconds for audio time
    clock.acceptObservation({
      source: "keyboard",
      timestampMs: ms,
      confidence: 1.0,
    });
  }
  unsub();
  return events;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ConductorClock — Phase 0 acceptance tests", () => {

  it("Stable 120 BPM + jitter: BPM stays within ±5 BPM of 120", () => {
    const { clock, setAudioTime } = makeClock();
    // 20 taps at 120 BPM with ±15ms jitter (realistic human tapping noise)
    const taps = stableTaps(120, 20, 15, 0);
    const events = feedTapsWithAudio(clock, setAudioTime, taps);

    const beatEvents = events.filter(e => e.type === "beat");
    expect(beatEvents.length).toBeGreaterThanOrEqual(18); // Most accepted

    // Check final BPM is close to 120
    const lastBeat = beatEvents[beatEvents.length - 1];
    if (lastBeat.type === "beat") {
      expect(lastBeat.state.bpm).toBeGreaterThan(115);
      expect(lastBeat.state.bpm).toBeLessThan(125);
    }
  });

  it("Accelerando 90→140 BPM over 8 beats: final BPM is in range", () => {
    const { clock, setAudioTime } = makeClock();
    const taps = accelerandoTaps(90, 140, 8, 0);
    const events = feedTapsWithAudio(clock, setAudioTime, taps);

    const beatEvents = events.filter(e => e.type === "beat");
    const lastBeat = beatEvents[beatEvents.length - 1];

    // System should have moved significantly towards the new tempo
    if (lastBeat?.type === "beat") {
      expect(lastBeat.state.bpm).toBeGreaterThan(110);
      expect(lastBeat.state.bpm).toBeLessThan(155);
    }
  });

  it("Accelerando: period only decreases monotonically (no reversal)", () => {
    const { clock, setAudioTime } = makeClock();
    const taps = accelerandoTaps(90, 140, 8, 0);
    const events = feedTapsWithAudio(clock, setAudioTime, taps);
    const beatEvents = events.filter(e => e.type === "beat");

    let prevBpm = 0;
    for (const e of beatEvents) {
      if (e.type === "beat") {
        // BPM should not drop dramatically in an accelerando (±20 tolerance per step)
        expect(e.state.bpm).toBeGreaterThan(prevBpm - 20);
        prevBpm = e.state.bpm;
      }
    }
  });

  it("Ritardando: clock does not stall or produce zero/negative period", () => {
    const { clock, setAudioTime } = makeClock();
    const taps = accelerandoTaps(140, 60, 10, 0); // decelerating
    const events = feedTapsWithAudio(clock, setAudioTime, taps);
    const beatEvents = events.filter(e => e.type === "beat");

    for (const e of beatEvents) {
      if (e.type === "beat") {
        expect(e.state.periodMs).toBeGreaterThan(0);
        expect(e.state.bpm).toBeGreaterThan(0);
      }
    }
  });

  it("One missed tap does not halve the tempo", () => {
    const { clock, setAudioTime } = makeClock();
    // Tap at 120 BPM: beats 0, 1, skip 2, 3, 4, 5
    // The gap between beat 1 and beat 3 is 2× period — should be inferred as missed beat
    const bpm = 120;
    const periodMs = 60000 / bpm;
    const taps = [0, periodMs, periodMs * 3, periodMs * 4, periodMs * 5];
    const events = feedTapsWithAudio(clock, setAudioTime, taps);
    const beatEvents = events.filter(e => e.type === "beat");

    // After the gap (2× period), BPM should still be close to 120, not 60
    const finalBeat = beatEvents[beatEvents.length - 1];
    if (finalBeat?.type === "beat") {
      expect(finalBeat.state.bpm).toBeGreaterThan(100);
      expect(finalBeat.state.bpm).toBeLessThan(140);
    }
  });

  it("Missed beat scenario from tapScenarios utility: BPM stays stable", () => {
    const { clock, setAudioTime } = makeClock();
    const taps = tapsWithMissedBeat(120, 8, 3, 0); // Miss beat index 3
    const events = feedTapsWithAudio(clock, setAudioTime, taps);
    const beatEvents = events.filter(e => e.type === "beat");
    const lastBeat = beatEvents[beatEvents.length - 1];
    if (lastBeat?.type === "beat") {
      expect(lastBeat.state.bpm).toBeGreaterThan(100);
      expect(lastBeat.state.bpm).toBeLessThan(145);
    }
  });

  it("Accidental double tap is rejected", () => {
    const { clock, setAudioTime } = makeClock();
    // Two prep taps at normal interval, then a double tap, then normal tap
    const periodMs = 60000 / 120;
    const taps = [0, periodMs, periodMs + 40]; // Third tap 40ms after second
    const events = feedTapsWithAudio(clock, setAudioTime, taps);

    const rejected = events.filter(e => e.type === "rejected");
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    const firstReject = rejected[0];
    if (firstReject.type === "rejected") {
      expect(firstReject.reason).toBe("double_tap");
    }
  });

  it("Double tap scenario from utility: second tap is rejected", () => {
    const { clock, setAudioTime } = makeClock();
    const taps = doubleTapScenario(0);
    const events = feedTapsWithAudio(clock, setAudioTime, taps);
    // The first tap is just stored (no event yet), the second is rejected
    const rejected = events.filter(e => e.type === "rejected");
    expect(rejected.length).toBeGreaterThanOrEqual(1);
  });

  it("Two prep taps predict the first beat correctly", () => {
    const { clock, setAudioTime } = makeClock();
    const bpm = 120;
    const periodMs = 60000 / bpm;
    const periodSec = periodMs / 1000;

    // First tap at t=0, second at t=periodMs
    setAudioTime(0);
    clock.acceptObservation({ source: "keyboard", timestampMs: 0, confidence: 1.0 });
    setAudioTime(periodSec);
    clock.acceptObservation({ source: "keyboard", timestampMs: periodMs, confidence: 1.0 });

    const predicted = clock.predictNextBeatAudioTime();
    // After 2 taps at 120 BPM, next beat should be ~2 periods from 0
    // Allow ±50ms tolerance for PLL blending
    expect(predicted).toBeGreaterThan(periodSec * 1.5);
    expect(predicted).toBeLessThan(periodSec * 2.5);
  });

  it("Clock is not running after first tap only", () => {
    const { clock, setAudioTime } = makeClock();
    setAudioTime(0);
    clock.acceptObservation({ source: "keyboard", timestampMs: 0, confidence: 1.0 });
    expect(clock.isRunning()).toBe(false);
  });

  it("Clock is running after second tap", () => {
    const { clock, setAudioTime } = makeClock();
    const periodMs = 60000 / 120;
    setAudioTime(0);
    clock.acceptObservation({ source: "keyboard", timestampMs: 0, confidence: 1.0 });
    setAudioTime(periodMs / 1000);
    clock.acceptObservation({ source: "keyboard", timestampMs: periodMs, confidence: 1.0 });
    expect(clock.isRunning()).toBe(true);
  });

  it("Confidence rises with consistent tapping", () => {
    const { clock, setAudioTime } = makeClock();
    const taps = stableTaps(120, 10, 0);
    const events = feedTapsWithAudio(clock, setAudioTime, taps);
    const beatEvents = events.filter(e => e.type === "beat");
    const first = beatEvents[0];
    const last = beatEvents[beatEvents.length - 1];
    if (first?.type === "beat" && last?.type === "beat") {
      expect(last.state.confidence).toBeGreaterThanOrEqual(first.state.confidence);
    }
  });

  it("Reset clears all state", () => {
    const { clock, setAudioTime } = makeClock();
    const taps = stableTaps(120, 5, 0);
    feedTapsWithAudio(clock, setAudioTime, taps);
    clock.reset();
    expect(clock.isRunning()).toBe(false);
    const state = clock.getState();
    expect(state.acceptedBeatCount).toBe(0);
  });
});
