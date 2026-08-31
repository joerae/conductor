/**
 * scheduler.test.ts
 *
 * Unit tests for Scheduler.
 * Tests look-ahead event commitment, noteOn/noteOff dispatch, and deduplication.
 */

import { describe, it, expect } from "vitest";
import { Scheduler } from "../src/scheduler/Scheduler";
import type { NotePlaybackEvent } from "../src/scheduler/Scheduler";
import { ScoreTransport } from "../src/score/ScoreTransport";
import type { AudioEngine } from "../src/audio/AudioEngine";
import type { ScoreEvent } from "../src/score/scoreTypes";

class MockAudioEngine {
  public scheduledNoteOns: Array<{
    noteId: string;
    midiNote: number;
    velocity: number;
    channel: number;
    program: number;
    audioTime: number;
  }> = [];

  public scheduledNoteOffs: Array<{
    noteId: string;
    audioTime: number;
  }> = [];

  scheduleNoteOn(
    noteId: string,
    midiNote: number,
    velocity: number,
    channel: number,
    program: number,
    audioTime: number
  ) {
    this.scheduledNoteOns.push({
      noteId,
      midiNote,
      velocity,
      channel,
      program,
      audioTime,
    });
  }

  scheduleNoteOff(noteId: string, audioTime: number) {
    this.scheduledNoteOffs.push({ noteId, audioTime });
  }

  stopAllNotes() {}
}

describe("Scheduler", () => {
  it("commits upcoming noteOn and noteOff events within lookahead window", () => {
    let mockTime = 0.0;
    const transport = new ScoreTransport();
    const mockAudio = new MockAudioEngine();
    const visualEvents: NotePlaybackEvent[] = [];

    const events: ScoreEvent[] = [
      { beat: 0.1, type: "noteOn", durationBeats: 0.1, trackId: "Violin I", noteId: "n1", midiNote: 60, velocity: 90, channel: 0, program: 48 },
      { beat: 0.2, type: "noteOff", durationBeats: 0, trackId: "Violin I", noteId: "n1", midiNote: 60, velocity: 0, channel: 0, program: 48 },
      { beat: 0.8, type: "noteOn", durationBeats: 1.0, trackId: "Viola", noteId: "n2", midiNote: 64, velocity: 80, channel: 1, program: 48 },
    ];
    transport.setEvents(events);
    // 120 BPM = 0.5s per beat, started at audio time 0.0
    transport.start(0, 0.0, 0.5);

    const scheduler = new Scheduler(
      transport,
      mockAudio as unknown as AudioEngine,
      () => mockTime,
      (e) => visualEvents.push(e)
    );

    // Run scheduler tick at time 0.0 (lookahead = 150ms / 0.15s = 0.3 beats)
    (scheduler as any).tick();

    // Beat 0.1 (0.05s) and Beat 0.2 (0.10s) are within the 150ms window!
    expect(mockAudio.scheduledNoteOns.length).toBe(1);
    expect(mockAudio.scheduledNoteOns[0].noteId).toBe("n1");
    expect(mockAudio.scheduledNoteOns[0].audioTime).toBeCloseTo(0.05);

    expect(mockAudio.scheduledNoteOffs.length).toBe(1);
    expect(mockAudio.scheduledNoteOffs[0].noteId).toBe("n1");
    expect(mockAudio.scheduledNoteOffs[0].audioTime).toBeCloseTo(0.10);

    // Visual events were also emitted for both
    expect(visualEvents.length).toBe(2);
    expect(visualEvents[0].type).toBe("noteOn");
    expect(visualEvents[1].type).toBe("noteOff");

    scheduler.stop();
  });

  it("never commits the same event twice", () => {
    let mockTime = 0.0;
    const transport = new ScoreTransport();
    const mockAudio = new MockAudioEngine();

    const events: ScoreEvent[] = [
      { beat: 0.1, type: "noteOn", durationBeats: 1.0, trackId: "Violin I", noteId: "n1", midiNote: 60, velocity: 90, channel: 0, program: 48 },
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
    expect(mockAudio.scheduledNoteOns.length).toBe(1);

    // Second tick at mockTime 0.02
    mockTime = 0.02;
    (scheduler as any).tick();
    // Still 1 note committed, not duplicated
    expect(mockAudio.scheduledNoteOns.length).toBe(1);

    scheduler.stop();
  });

  it("calls onComplete when the score reaches the end", () => {
    let mockTime = 0.0;
    const transport = new ScoreTransport();
    const mockAudio = new MockAudioEngine();
    let completedCalled = false;

    const events: ScoreEvent[] = [
      { beat: 0.1, type: "noteOn", durationBeats: 0.5, trackId: "Violin I", noteId: "n1", midiNote: 60, velocity: 90, channel: 0, program: 48 },
    ];
    transport.setEvents(events, 1.0); // Total 1 beat
    transport.start(0, 0.0, 0.5);

    const scheduler = new Scheduler(
      transport,
      mockAudio as unknown as AudioEngine,
      () => mockTime,
      undefined,
      () => { completedCalled = true; }
    );

    // Initial tick at 0.0
    (scheduler as any).tick();
    expect(completedCalled).toBe(false);

    // Advance time to 0.6s (beat 1.2 >= totalBeats 1.0)
    mockTime = 0.6;
    (scheduler as any).tick();
    expect(completedCalled).toBe(true);

    scheduler.stop();
  });
});
