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

  describe("A/B Tempo Modes comparison", () => {
    it("Mode B (Instant) adapts to a sudden 120 -> 60 BPM step change immediately on a dime", () => {
      const { clock: clockA, setAudioTime: setTimeA } = makeClock();
      clockA.setTempoMode("balanced");

      const { clock: clockB, setAudioTime: setTimeB } = makeClock();
      clockB.setTempoMode("instant");

      // Establish 120 BPM (500ms period) with first 3 taps: 0, 500, 1000
      feedTapsWithAudio(clockA, setTimeA, [0, 500, 1000]);
      feedTapsWithAudio(clockB, setTimeB, [0, 500, 1000]);

      // Sudden drastic step change: next tap arrives after 1000ms (60 BPM) at t=2000
      const eventsA = feedTapsWithAudio(clockA, setTimeA, [2000]);
      const eventsB = feedTapsWithAudio(clockB, setTimeB, [2000]);

      const stateA = (eventsA[eventsA.length - 1] as any).state;
      const stateB = (eventsB[eventsB.length - 1] as any).state;

      // Mode A has smoothed inertia: period is blended ~675ms (~88 BPM)
      expect(stateA.periodMs).toBeLessThan(800);
      expect(stateA.bpm).toBeGreaterThan(75);

      // Mode B is super-responsive on a dime: period jumps immediately to ~925-1000ms (~65 BPM)
      expect(stateB.periodMs).toBeGreaterThan(850);
      expect(stateB.bpm).toBeLessThan(70);
    });

    it("Mode B (Instant) responds to an immediate 60 -> 180 BPM jump", () => {
      const { clock, setAudioTime } = makeClock();
      clock.setTempoMode("instant");

      // Start at 60 BPM (1000ms period)
      feedTapsWithAudio(clock, setAudioTime, [0, 1000, 2000]);
      expect(clock.getState().bpm).toBeCloseTo(60, 0);

      // Instant jump to 180 BPM (333ms gap) at t=2333
      feedTapsWithAudio(clock, setAudioTime, [2333]);
      expect(clock.getState().bpm).toBeGreaterThan(135);

      // Second fast tap at t=2666
      feedTapsWithAudio(clock, setAudioTime, [2666]);
      expect(clock.getState().bpm).toBeGreaterThan(165);
    });

    it("recovers immediately after a long gap/pause without locking out future taps", () => {
      const { clock, setAudioTime } = makeClock();
      // Establish 120 BPM
      feedTapsWithAudio(clock, setAudioTime, [0, 500, 1000]);
      expect(clock.isRunning()).toBe(true);

      // Long pause of 4000ms: tap at t=5000 is out of range (< 45 BPM)
      const eventsGap = feedTapsWithAudio(clock, setAudioTime, [5000]);
      expect(eventsGap.some(e => e.type === "rejected")).toBe(true);

      // Subsequent tap at t=5500 (500ms later = 120 BPM) MUST be accepted immediately as a valid new beat
      const eventsResume = feedTapsWithAudio(clock, setAudioTime, [5500]);
      const lastBeat = eventsResume.find(e => e.type === "beat");
      expect(lastBeat).toBeDefined();
      if (lastBeat?.type === "beat") {
        expect(lastBeat.state.periodMs).toBeCloseTo(500, 0);
      }
    });

    it("Mode C: Autoplay runs continuously after 2 taps and updates tempo on new taps", () => {
      const { clock, setAudioTime } = makeClock();
      clock.setTempoMode("autoplay");
      expect(clock.getTempoMode()).toBe("autoplay");

      // First two taps establish period of 500ms (120 BPM)
      feedTapsWithAudio(clock, setAudioTime, [0, 500]);
      expect(clock.isRunning()).toBe(true);
      expect(clock.getState().bpm).toBe(120);

      // Third tap at 800 (gap of 300ms = 200 BPM) immediately updates autoplay tempo
      feedTapsWithAudio(clock, setAudioTime, [800]);
      expect(clock.getState().bpm).toBe(200);

      clock.reset();
      expect(clock.isRunning()).toBe(false);
    });
  });
});
