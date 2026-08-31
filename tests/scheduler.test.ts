/**
 * scheduler.test.ts
 *
 * Unit tests for Scheduler.
 * Tests look-ahead event commitment, duration conversion, and deduplication.
 */

import { describe, it, expect } from "vitest";
import { Scheduler } from "../src/scheduler/Scheduler";
import { ScoreTransport } from "../src/score/ScoreTransport";
import type { AudioEngine } from "../src/audio/AudioEngine";
import type { ScoreEvent } from "../src/score/scoreTypes";

class MockAudioEngine {
  public scheduledNotes: Array<{
    midiNote: number;
    velocity: number;
    channel: number;
    program: number;
    audioTime: number;
    durationSec: number;
  }> = [];

  scheduleNoteOn(
    midiNote: number,
    velocity: number,
    channel: number,
    program: number,
    audioTime: number,
    durationSec: number = 0.5
  ) {
    this.scheduledNotes.push({
      midiNote,
      velocity,
      channel,
      program,
      audioTime,
      durationSec,
    });
  }

  scheduleNoteOff() {}
  stopAllNotes() {}
}

describe("Scheduler", () => {
  it("commits upcoming events within lookahead window with correct duration", () => {
    let mockTime = 0.0;
    const transport = new ScoreTransport();
    const mockAudio = new MockAudioEngine();

    const events: ScoreEvent[] = [
      { beat: 0.1, type: "noteOn", durationBeats: 2.0, trackId: "t1", noteId: "n1", midiNote: 60, velocity: 90, channel: 0, program: 40 },
      { beat: 0.5, type: "noteOn", durationBeats: 1.0, trackId: "t1", noteId: "n2", midiNote: 64, velocity: 80, channel: 0, program: 40 },
    ];
    transport.setEvents(events);
    // 120 BPM = 0.5s per beat, started at audio time 0.0
    transport.start(0, 0.0, 0.5);

    const scheduler = new Scheduler(
      transport,
      mockAudio as unknown as AudioEngine,
      () => mockTime
    );

    // Run scheduler tick at time 0.0
    (scheduler as any).tick();

    // Lookahead is 150ms (0.15s). Beat 0.1 corresponds to 0.05s, so it is inside the 150ms window!
    expect(mockAudio.scheduledNotes.length).toBe(1);
    expect(mockAudio.scheduledNotes[0].midiNote).toBe(60);
    // durationSec should be 2.0 beats * 0.5s = 1.0s
    expect(mockAudio.scheduledNotes[0].durationSec).toBeCloseTo(1.0);
    expect(mockAudio.scheduledNotes[0].audioTime).toBeCloseTo(0.05);

    // Stop tick loop
    scheduler.stop();
  });

  it("never commits the same event twice", () => {
    let mockTime = 0.0;
    const transport = new ScoreTransport();
    const mockAudio = new MockAudioEngine();

    const events: ScoreEvent[] = [
      { beat: 0.1, type: "noteOn", durationBeats: 1.0, trackId: "t1", noteId: "n1", midiNote: 60, velocity: 90, channel: 0, program: 40 },
    ];
    transport.setEvents(events);
    transport.start(0, 0.0, 0.5);

    const scheduler = new Scheduler(
      transport,
      mockAudio as unknown as AudioEngine,
      () => mockTime
    );

    // First tick
    (scheduler as any).tick();
    expect(mockAudio.scheduledNotes.length).toBe(1);

    // Second tick at mockTime 0.02
    mockTime = 0.02;
    (scheduler as any).tick();
    // Still 1 note committed, not duplicated
    expect(mockAudio.scheduledNotes.length).toBe(1);

    scheduler.stop();
  });
});
