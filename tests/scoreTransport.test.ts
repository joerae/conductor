/**
 * scoreTransport.test.ts
 *
 * Unit tests for ScoreTransport.
 * Tests beat-space ↔ audio-time conversion, window queries, and phase/tempo updates.
 */

import { describe, it, expect } from "vitest";
import { ScoreTransport } from "../src/score/ScoreTransport";
import type { ScoreEvent } from "../src/score/scoreTypes";

function createMockEvents(): ScoreEvent[] {
  return [
    { beat: 0.0, type: "noteOn", durationBeats: 1.0, trackId: "t1", noteId: "n1", midiNote: 60, velocity: 80, channel: 0, program: 40 },
    { beat: 1.0, type: "noteOn", durationBeats: 1.0, trackId: "t1", noteId: "n2", midiNote: 62, velocity: 80, channel: 0, program: 40 },
    { beat: 2.0, type: "noteOn", durationBeats: 2.0, trackId: "t1", noteId: "n3", midiNote: 64, velocity: 80, channel: 0, program: 40 },
    { beat: 4.0, type: "noteOn", durationBeats: 1.0, trackId: "t1", noteId: "n4", midiNote: 65, velocity: 80, channel: 0, program: 40 },
  ];
}

describe("ScoreTransport", () => {
  it("converts beat positions to audio time at constant tempo", () => {
    const transport = new ScoreTransport();
    // 120 BPM = 0.5s per beat, started at audioTime 10.0s for beat 0
    transport.start(0, 10.0, 0.5);

    expect(transport.audioTimeForBeat(0.0)).toBeCloseTo(10.0);
    expect(transport.audioTimeForBeat(1.0)).toBeCloseTo(10.5);
    expect(transport.audioTimeForBeat(2.0)).toBeCloseTo(11.0);
    expect(transport.audioTimeForBeat(4.0)).toBeCloseTo(12.0);
  });

  it("can start from an arbitrary score beat (resume support)", () => {
    const transport = new ScoreTransport();
    // Resuming from beat 16.5 at audioTime 25.0s with period 0.4s
    transport.start(16.5, 25.0, 0.4);

    expect(transport.audioTimeForBeat(16.5)).toBeCloseTo(25.0);
    expect(transport.audioTimeForBeat(17.5)).toBeCloseTo(25.4);
    expect(transport.audioTimeForBeat(18.5)).toBeCloseTo(25.8);
  });

  it("queries events within a look-ahead window accurately", () => {
    const transport = new ScoreTransport();
    transport.setEvents(createMockEvents());
    // Start at beat 0, audio time 0.0, period 0.5s (120 BPM)
    transport.start(0, 0.0, 0.5);

    // Query window from 0.0s to 0.6s (covers beats > 0.0 and <= 1.2) -> should include beat 1.0
    const window1 = transport.eventsInWindow(0.0, 0.6);
    expect(window1.length).toBe(1);
    expect(window1[0].noteId).toBe("n2");

    // Query window from 0.4s to 1.1s (covers beats > 0.8 and <= 2.2) -> should include beat 1.0 and 2.0
    const window2 = transport.eventsInWindow(0.4, 1.1);
    expect(window2.length).toBe(2);
    expect(window2.map(e => e.noteId)).toEqual(["n2", "n3"]);
  });

  it("applies tempo change and phase correction without audio jumps", () => {
    const transport = new ScoreTransport();
    transport.start(0, 0.0, 0.5);

    // At audio time 1.0s (cursor beat 2.0), conductor speeds up to 150 BPM (0.4s period)
    // with a -20ms phase nudge (tapped slightly early)
    transport.updatePeriod(1.0, 0.4, -0.020);

    expect(transport.getPeriodSec()).toBeCloseTo(0.4);
    // Cursor beat at audio time 1.0 was beat 2.0
    expect(transport.getCursorBeat()).toBeCloseTo(2.0);

    // Beat 3.0 was originally at 1.5s, with new period and phase it should be:
    // originAudioTime (1.0 - 0.020 = 0.98) + (3.0 - 2.0) * 0.4 = 1.38s
    expect(transport.audioTimeForBeat(3.0)).toBeCloseTo(1.38);
  });
});
