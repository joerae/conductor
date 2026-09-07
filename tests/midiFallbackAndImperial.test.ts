/**
 * midiFallbackAndImperial.test.ts
 *
 * Tests for:
 * 1. Instrument inference fallback from track name (inferProgramFromTrackName)
 * 2. WebAudioFont script generation for orchestral programs
 * 3. MidiScore parsing with subtrack name inheritance and program fallback
 * 4. The Imperial March piece definition and repertoire catalog loading
 */

import { describe, it, expect } from "vitest";
import {
  inferProgramFromTrackName,
  getScriptsForPiece,
  programName,
  programToWebAudioFontVar,
} from "../src/audio/instruments";
import { MidiScore } from "../src/score/MidiScore";
import fs from "fs";
import path from "path";

describe("Instrument Fallback from Track Name", () => {
  it("correctly identifies woodwind instruments", () => {
    expect(inferProgramFromTrackName("Flutes/Piccolo")).toBe(72);
    expect(inferProgramFromTrackName("Piccolo")).toBe(72);
    expect(inferProgramFromTrackName("Flutes")).toBe(73);
    expect(inferProgramFromTrackName("English Horn")).toBe(69);
    expect(inferProgramFromTrackName("Oboes")).toBe(68);
    expect(inferProgramFromTrackName("Clarinets")).toBe(71);
    expect(inferProgramFromTrackName("Bassoons")).toBe(70);
  });

  it("correctly identifies brass instruments", () => {
    expect(inferProgramFromTrackName("French Horns")).toBe(60);
    expect(inferProgramFromTrackName("Trumpets")).toBe(56);
    expect(inferProgramFromTrackName("Trombones High")).toBe(57);
    expect(inferProgramFromTrackName("Trombones Normal")).toBe(57);
    expect(inferProgramFromTrackName("Tuba")).toBe(58);
  });

  it("correctly identifies percussion, mallets, and keyboards", () => {
    expect(inferProgramFromTrackName("Timpani")).toBe(47);
    expect(inferProgramFromTrackName("Piccolo Snares")).toBe(47);
    expect(inferProgramFromTrackName("Snares")).toBe(47);
    expect(inferProgramFromTrackName("Cymbals")).toBe(47);
    expect(inferProgramFromTrackName("Glockenspiel")).toBe(9);
    expect(inferProgramFromTrackName("\"Harp\" High")).toBe(46);
    expect(inferProgramFromTrackName("\"Celeste\"")).toBe(8);
  });

  it("correctly identifies string instruments", () => {
    expect(inferProgramFromTrackName("Violins I & II")).toBe(40);
    expect(inferProgramFromTrackName("Violas")).toBe(41);
    expect(inferProgramFromTrackName("Cellos")).toBe(42);
    expect(inferProgramFromTrackName("Contrabasses")).toBe(43);
    expect(inferProgramFromTrackName("Strings")).toBe(48);
  });

  it("returns null for non-matching or empty strings", () => {
    expect(inferProgramFromTrackName("")).toBeNull();
    expect(inferProgramFromTrackName("track_1")).toBeNull();
    expect(inferProgramFromTrackName("Unknown Synth")).toBeNull();
  });
});

describe("WebAudioFont Script Resolution for Full Orchestra", () => {
  it("resolves correct FluidR3_GM variable names", () => {
    expect(programToWebAudioFontVar(56, 0)).toBe("_tone_0560_FluidR3_GM_sf2_file"); // Trumpet
    expect(programToWebAudioFontVar(57, 0)).toBe("_tone_0570_FluidR3_GM_sf2_file"); // Trombone
    expect(programToWebAudioFontVar(58, 0)).toBe("_tone_0580_FluidR3_GM_sf2_file"); // Tuba
    expect(programToWebAudioFontVar(60, 0)).toBe("_tone_0600_FluidR3_GM_sf2_file"); // French Horn
    expect(programToWebAudioFontVar(72, 0)).toBe("_tone_0720_FluidR3_GM_sf2_file"); // Piccolo
  });

  it("generates script URLs for all required programs in a piece", () => {
    const mockPiece = {
      sections: [
        { programs: [56, 57, 58, 60] }, // Trumpet, Trombone, Tuba, Horn
        { programs: [47, 9, 8] },       // Timpani, Glockenspiel, Celesta
      ],
    };
    const scripts = getScriptsForPiece(mockPiece);
    expect(scripts).toContain("https://surikov.github.io/webaudiofontdata/sound/0560_FluidR3_GM_sf2_file.js");
    expect(scripts).toContain("https://surikov.github.io/webaudiofontdata/sound/0570_FluidR3_GM_sf2_file.js");
    expect(scripts).toContain("https://surikov.github.io/webaudiofontdata/sound/0580_FluidR3_GM_sf2_file.js");
    expect(scripts).toContain("https://surikov.github.io/webaudiofontdata/sound/0600_FluidR3_GM_sf2_file.js");
    expect(scripts).toContain("https://surikov.github.io/webaudiofontdata/sound/0470_FluidR3_GM_sf2_file.js");
    expect(scripts).toContain("https://surikov.github.io/webaudiofontdata/sound/0090_FluidR3_GM_sf2_file.js");
    expect(scripts).toContain("https://surikov.github.io/webaudiofontdata/sound/0080_FluidR3_GM_sf2_file.js");
  });

  it("provides friendly program names", () => {
    expect(programName(57)).toBe("Trombone");
    expect(programName(58)).toBe("Tuba");
    expect(programName(69)).toBe("English Horn");
    expect(programName(72)).toBe("Piccolo");
    expect(programName(46)).toBe("Orchestral Harp");
    expect(programName(8)).toBe("Celesta");
  });
});

describe("MidiScore Parsing & Track Inheritance on The Imperial March", () => {
  it("parses The-Imperial-March.mid and infers orchestral instruments instead of 100% piano", async () => {
    const midiPath = path.resolve(__dirname, "../public/midi/The-Imperial-March.mid");
    const buffer = fs.readFileSync(midiPath);

    // Mock fetch for MidiScore.load
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      } as any);

    try {
      const midiScore = new MidiScore();
      await midiScore.load("/midi/The-Imperial-March.mid");

      const events = midiScore.getEvents();
      expect(events.length).toBeGreaterThan(0);

      // Check programs across all note events
      const noteOnEvents = events.filter(e => e.type === "noteOn");
      const programsUsed = new Set(noteOnEvents.map(e => e.program));

      // Must have inferred real brass, woodwind, percussion, and string programs!
      expect(programsUsed.has(60)).toBe(true); // French Horn
      expect(programsUsed.has(56)).toBe(true); // Trumpet
      expect(programsUsed.has(57)).toBe(true); // Trombone
      expect(programsUsed.has(58)).toBe(true); // Tuba
      expect(programsUsed.has(47)).toBe(true); // Timpani
      expect(programsUsed.has(40) || programsUsed.has(48)).toBe(true); // Violins / Strings

      // Grand Piano (0) should NOT be the sole program
      expect(programsUsed.size).toBeGreaterThan(5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("applies offline trackPrograms mapping overrides when provided", async () => {
    const midiPath = path.resolve(__dirname, "../public/midi/The-Imperial-March.mid");
    const buffer = fs.readFileSync(midiPath);

    const jsonPath = path.resolve(__dirname, "../public/midi/The-Imperial-March.json");
    const pieceMeta = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      } as any);

    try {
      const midiScore = new MidiScore();
      await midiScore.load("/midi/The-Imperial-March.mid", pieceMeta.trackPrograms);

      const events = midiScore.getEvents();
      const noteOnEvents = events.filter(e => e.type === "noteOn");

      // Verify Trumpet notes (Tracks 20-23) get program 56
      const trumpetNotes = noteOnEvents.filter(e => e.trackId.includes("Trumpet"));
      expect(trumpetNotes.length).toBeGreaterThan(0);
      expect(trumpetNotes.every(n => n.program === 56)).toBe(true);

      // Verify Horn notes (Tracks 15-18) get program 60
      const hornNotes = noteOnEvents.filter(e => e.trackId.includes("French Horn"));
      expect(hornNotes.length).toBeGreaterThan(0);
      expect(hornNotes.every(n => n.program === 60)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
