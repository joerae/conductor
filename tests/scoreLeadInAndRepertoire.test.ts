import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { REPERTOIRE, getPieceById } from "../src/score/repertoire";
import { ScoreTransport } from "../src/score/ScoreTransport";
import type { ScoreEvent } from "../src/score/scoreTypes";

describe("Beethoven Metadata & Score Lead-In Timing (Issues 8 & 9)", () => {
  it("Issue 8: Beethoven metadata in JSON matches built-in definition", () => {
    const jsonPath = path.resolve(__dirname, "../public/midi/5th-Symphony-Part-1.json");
    const jsonData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

    const builtInBeethoven = getPieceById("beethoven-5");
    expect(builtInBeethoven).toBeDefined();

    // Verify timeSignature, beatsPerTap, defaultBpm, and leadInBeats
    expect(jsonData.timeSignature).toBe("2/4");
    expect(jsonData.beatsPerTap).toBe(2);
    expect(jsonData.defaultBpm).toBe(108);
    expect(jsonData.leadInBeats).toBe(1);

    expect(builtInBeethoven?.timeSignature).toBe("2/4");
    expect(builtInBeethoven?.beatsPerTap).toBe(2);
    expect(builtInBeethoven?.defaultBpm).toBe(108);
    expect(builtInBeethoven?.leadInBeats).toBe(1);
  });

  it("Issue 9: ScoreTransport applies leadInBeats to cursor position and origin time", () => {
    const transport = new ScoreTransport();
    const mockEvents: ScoreEvent[] = [
      {
        beat: 0,
        durationBeats: 1,
        midiNote: 67,
        channel: 0,
        trackId: 0,
        velocity: 80,
      },
      {
        beat: 1,
        durationBeats: 1,
        midiNote: 67,
        channel: 0,
        trackId: 0,
        velocity: 80,
      },
      {
        beat: 2,
        durationBeats: 2,
        midiNote: 63,
        channel: 0,
        trackId: 0,
        velocity: 80,
      },
    ];
    transport.setEvents(mockEvents, 10);

    const startAudioTime = 10.0;
    const periodSec = 0.5; // 120 BPM
    const beatsPerTap = 1;
    const leadInBeats = 1; // 1 beat count-in (0.5s)

    // Start with leadInBeats = 1
    transport.start(0, startAudioTime, periodSec, beatsPerTap, leadInBeats);

    // At startAudioTime (10.0), cursor beat should be -1.0 (in the lead-in count-in)
    expect(transport.getCursorBeat()).toBeCloseTo(-1.0, 3);

    // Audio time for beat 0 should be at exactly 10.5s (after 1 beat lead-in)
    expect(transport.audioTimeForBeat(0)).toBeCloseTo(10.5, 3);

    // After 1 beat (10.5s), advanceTo(10.5) should hit exactly beat 0.0 (the opening note!)
    transport.advanceTo(10.5);
    expect(transport.getCursorBeat()).toBeCloseTo(0.0, 3);

    // At 10.0s with lookahead of 1.0s (up to 11.0s / beat 1.0):
    // Opening note at beat 0 falls at audio time 10.5s, well within lookahead horizon
    const scheduledEvents = transport.eventsInWindow(10.0, 11.0);
    const hasOpeningNote = scheduledEvents.some(e => e.beat === 0);
    expect(hasOpeningNote).toBe(true);

    // Check piece without lead-in starts at beat 0 directly
    const directTransport = new ScoreTransport();
    directTransport.setEvents(mockEvents, 10);
    directTransport.start(0, 10.0, periodSec, beatsPerTap, 0);

    expect(directTransport.getCursorBeat()).toBeCloseTo(0.0, 3);
    expect(directTransport.audioTimeForBeat(0)).toBeCloseTo(10.0, 3);
  });
});
