import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { Midi } from "@tonejs/midi";

describe("Inspect MIDI File", () => {
  it("inspects tracks and instruments in Eine Kleine", () => {
    const filePath = path.resolve(__dirname, "../public/midi/Eine-Kleine-Nachtmusik1.mid");
    const buffer = fs.readFileSync(filePath);
    const midi = new Midi(buffer);
    console.log("MIDI Name:", midi.header.name);
    console.log("PPQ:", midi.header.ppq);
    console.log("TimeSignatures:", JSON.stringify(midi.header.timeSignatures));
    console.log("Tempos:", JSON.stringify(midi.header.tempos));
    console.log("Number of tracks:", midi.tracks.length);
    midi.tracks.forEach((t, i) => {
      console.log(`Track ${i}: name="${t.name}", channel=${t.channel}, instrument="${t.instrument.name}" (${t.instrument.number}), noteCount=${t.notes.length}`);
      if (t.notes.length > 0) {
        console.log(`  First 5 notes of track ${i}:`, t.notes.slice(0, 5).map(n => ({
          name: n.name,
          midi: n.midi,
          ticks: n.ticks,
          beat: n.ticks / midi.header.ppq,
          durationBeats: n.durationTicks / midi.header.ppq,
          time: n.time
        })));
      }
    });
    expect(midi.tracks.length).toBeGreaterThan(0);
  });

  it("inspects Beethoven Symphony 5", () => {
    const filePath = path.resolve(__dirname, "../public/midi/5th-Symphony-Part-1.mid");
    const buffer = fs.readFileSync(filePath);
    const midi = new Midi(buffer);
    console.log("--- Beethoven 5th ---");
    console.log("MIDI Name:", midi.header.name);
    console.log("PPQ:", midi.header.ppq);
    console.log("Number of tracks:", midi.tracks.length);
    midi.tracks.forEach((t, i) => {
      console.log(`Track ${i}: name="${t.name}", channel=${t.channel}, instrument="${t.instrument.name}" (${t.instrument.number}), noteCount=${t.notes.length}`);
    });
    expect(midi.tracks.length).toBeGreaterThan(0);
  });
});
