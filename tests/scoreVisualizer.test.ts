/**
 * scoreVisualizer.test.ts
 *
 * Unit tests for Spotlight Score Visualizer:
 * - Clef selection per instrument section
 * - VexFlow duration quantization (crotchets, quavers, semiquavers, demisemiquavers, dotted notes)
 * - VexFlow pitch key & accidental mapping
 * - Section note extraction and 2-bar measure windowing
 */

import { describe, it, expect } from "vitest";
import {
  getClefForSection,
  midiNoteToVexKey,
  durationToBeatsToVexDuration,
  groupNotesByBeat,
  SpotlightScoreVisualizer,
} from "../src/ui/SpotlightScoreVisualizer";
import type { PieceDefinition } from "../src/score/repertoire";
import type { ScoreEvent } from "../src/score/scoreTypes";

describe("SpotlightScoreVisualizer - Clef & VexFlow Mapping", () => {
  it("selects appropriate musical clef based on instrument section", () => {
    expect(getClefForSection("violin1")).toBe("treble");
    expect(getClefForSection("violin2")).toBe("treble");
    expect(getClefForSection("viola")).toBe("alto");
    expect(getClefForSection("cello")).toBe("bass");
    expect(getClefForSection("timpani")).toBe("bass");
    expect(getClefForSection("woodwinds")).toBe("treble");
    expect(getClefForSection("strings-lower")).toBe("bass");
  });

  describe("VexFlow Pitch Key & Accidental Mapping", () => {
    it("maps Middle C (C4 = MIDI 60) to key c/4 without accidental", () => {
      const res = midiNoteToVexKey(60);
      expect(res.key).toBe("c/4");
      expect(res.accidental).toBeNull();
    });

    it("maps C#4 (MIDI 61) to key c/4 with sharp accidental", () => {
      const res = midiNoteToVexKey(61);
      expect(res.key).toBe("c/4");
      expect(res.accidental).toBe("#");
    });

    it("maps D4 (MIDI 62) to key d/4", () => {
      const res = midiNoteToVexKey(62);
      expect(res.key).toBe("d/4");
      expect(res.accidental).toBeNull();
    });

    it("maps Eb4 (MIDI 63) to key e/4 with flat accidental", () => {
      const res = midiNoteToVexKey(63);
      expect(res.key).toBe("e/4");
      expect(res.accidental).toBe("b");
    });

    it("maps F#4 (MIDI 66) to key f/4 with sharp accidental", () => {
      const res = midiNoteToVexKey(66);
      expect(res.key).toBe("f/4");
      expect(res.accidental).toBe("#");
    });

    it("maps G4 (MIDI 67) to key g/4", () => {
      const res = midiNoteToVexKey(67);
      expect(res.key).toBe("g/4");
      expect(res.accidental).toBeNull();
    });

    it("maps Bb4 (MIDI 70) to key b/4 with flat accidental", () => {
      const res = midiNoteToVexKey(70);
      expect(res.key).toBe("b/4");
      expect(res.accidental).toBe("b");
    });

    it("maps G2 (MIDI 43, Cello/Bass range) to key g/2", () => {
      const res = midiNoteToVexKey(43);
      expect(res.key).toBe("g/2");
    });
  });

  describe("VexFlow Duration Quantization (Quavers, Semiquavers, Dots)", () => {
    it("quantizes 0.5 beat to quaver (8th note) with duration '8' and 0 dots", () => {
      const res = durationToBeatsToVexDuration(0.5);
      expect(res.duration).toBe("8");
      expect(res.dots).toBe(0);
    });

    it("quantizes 0.75 beat to dotted quaver with duration '8' and 1 dot", () => {
      const res = durationToBeatsToVexDuration(0.75);
      expect(res.duration).toBe("8");
      expect(res.dots).toBe(1);
    });

    it("quantizes 0.25 beat to semiquaver (16th note) with duration '16' and 0 dots", () => {
      const res = durationToBeatsToVexDuration(0.25);
      expect(res.duration).toBe("16");
      expect(res.dots).toBe(0);
    });

    it("quantizes 0.375 beat to dotted semiquaver with duration '16' and 1 dot", () => {
      const res = durationToBeatsToVexDuration(0.375);
      expect(res.duration).toBe("16");
      expect(res.dots).toBe(1);
    });

    it("quantizes 1.0 beat to crotchet (quarter note) with duration 'q'", () => {
      const res = durationToBeatsToVexDuration(1.0);
      expect(res.duration).toBe("q");
      expect(res.dots).toBe(0);
    });

    it("quantizes 1.5 beats to dotted crotchet with duration 'q' and 1 dot", () => {
      const res = durationToBeatsToVexDuration(1.5);
      expect(res.duration).toBe("q");
      expect(res.dots).toBe(1);
    });

    it("quantizes 2.0 beats to minim (half note) with duration 'h'", () => {
      const res = durationToBeatsToVexDuration(2.0);
      expect(res.duration).toBe("h");
      expect(res.dots).toBe(0);
    });

    it("quantizes 3.0 beats to dotted minim with duration 'h' and 1 dot", () => {
      const res = durationToBeatsToVexDuration(3.0);
      expect(res.duration).toBe("h");
      expect(res.dots).toBe(1);
    });

    it("quantizes 4.0 beats to semibreve (whole note) with duration 'w'", () => {
      const res = durationToBeatsToVexDuration(4.0);
      expect(res.duration).toBe("w");
      expect(res.dots).toBe(0);
    });

    it("quantizes 0.125 beat to demisemiquaver (32nd note) with duration '32'", () => {
      const res = durationToBeatsToVexDuration(0.125);
      expect(res.duration).toBe("32");
      expect(res.dots).toBe(0);
    });
  });
});

describe("SpotlightScoreVisualizer - Section Note Extraction & State", () => {
  const mockPiece: PieceDefinition = {
    id: "test-piece",
    title: "Test Piece",
    subtitle: "Test Subtitle",
    composer: "Mozart",
    movement: "I. Allegro",
    year: 1787,
    midiFile: "test.mid",
    midiUrl: "/midi/test.mid",
    defaultBpm: 120,
    timeSignature: "4/4",
    beatsPerTap: 1,
    conductMode: "In 4",
    layout: "chamber_strings",
    description: "Test description",
    sections: [
      { id: "violin1", name: "Violin I", channels: [0], programs: [48] },
      { id: "cello", name: "Violoncello", channels: [2], programs: [48] },
    ],
  };

  const mockEvents: ScoreEvent[] = [
    { beat: 0, type: "noteOn", durationBeats: 0.5, trackId: "Violin I", noteId: "n1", midiNote: 67, velocity: 90, channel: 0, program: 48 },
    { beat: 0.5, type: "noteOff", durationBeats: 0, trackId: "Violin I", noteId: "n1", midiNote: 67, velocity: 0, channel: 0, program: 48 },
    { beat: 0.5, type: "noteOn", durationBeats: 0.25, trackId: "Violin I", noteId: "n2", midiNote: 71, velocity: 95, channel: 0, program: 48 },
    { beat: 0.75, type: "noteOff", durationBeats: 0, trackId: "Violin I", noteId: "n2", midiNote: 71, velocity: 0, channel: 0, program: 48 },
    { beat: 0, type: "noteOn", durationBeats: 2, trackId: "Violoncello", noteId: "n3", midiNote: 48, velocity: 80, channel: 2, program: 48 },
    { beat: 2, type: "noteOff", durationBeats: 0, trackId: "Violoncello", noteId: "n3", midiNote: 48, velocity: 0, channel: 2, program: 48 },
  ];

  const mockMidiScore = {
    getEvents: () => mockEvents,
    getMetadata: () => ({
      title: "Test Piece",
      ppq: 256,
      totalBeats: 16,
      timeSignatureNumerator: 4,
      timeSignatureDenominator: 4,
      embeddedTempoMicroseconds: 500000,
      embeddedBpm: 120,
    }),
  };

  let cursorBeat = 0;
  const mockTransport = {
    getCursorBeat: () => cursorBeat,
  };

  it("extracts and isolates notes matching the spotlighted section channel", () => {
    const visualizer = new SpotlightScoreVisualizer({
      getMidiScore: () => mockMidiScore as any,
      getTransport: () => mockTransport as any,
      getCurrentPiece: () => mockPiece,
    });

    visualizer.show("violin1");
    expect(visualizer.getIsVisible()).toBe(true);
    expect(visualizer.getCurrentSectionId()).toBe("violin1");

    const notes = visualizer.getCurrentNotes();
    expect(notes.length).toBe(2);
    expect(notes[0].midiNote).toBe(67);
    expect(notes[0].durationBeats).toBe(0.5); // quaver
    expect(notes[1].midiNote).toBe(71);
    expect(notes[1].durationBeats).toBe(0.25); // semiquaver
    expect(notes.every(n => n.channel === 0)).toBe(true);

    // Switch to cello
    visualizer.show("cello");
    expect(visualizer.getCurrentSectionId()).toBe("cello");
    const celloNotes = visualizer.getCurrentNotes();
    expect(celloNotes.length).toBe(1);
    expect(celloNotes[0].midiNote).toBe(48);
    expect(celloNotes[0].channel).toBe(2);

    visualizer.hide();
    expect(visualizer.getIsVisible()).toBe(false);
  });

  it("groups simultaneous notes within 0.05 beats into chords and preserves single notes", () => {
    const notes = [
      { noteId: "1", midiNote: 60, beat: 0.0, durationBeats: 1.0, velocity: 80, channel: 0, trackId: "t" },
      { noteId: "2", midiNote: 64, beat: 0.01, durationBeats: 1.0, velocity: 80, channel: 0, trackId: "t" }, // chord with note 1
      { noteId: "3", midiNote: 67, beat: 0.02, durationBeats: 1.0, velocity: 80, channel: 0, trackId: "t" }, // chord with note 1
      { noteId: "4", midiNote: 72, beat: 1.0, durationBeats: 0.5, velocity: 90, channel: 0, trackId: "t" },
      { noteId: "5", midiNote: 74, beat: 1.5, durationBeats: 0.5, velocity: 90, channel: 0, trackId: "t" },
    ];

    const groups = groupNotesByBeat(notes);
    expect(groups.length).toBe(3);

    // Group 1: 3-note chord (C major triad)
    expect(groups[0].beat).toBe(0.0);
    expect(groups[0].notes.length).toBe(3);
    expect(groups[0].notes.map(n => n.midiNote)).toEqual([60, 64, 67]);

    // Group 2 & 3: single melody notes
    expect(groups[1].beat).toBe(1.0);
    expect(groups[1].notes.length).toBe(1);
    expect(groups[2].beat).toBe(1.5);
    expect(groups[2].notes.length).toBe(1);
  });

  describe("Feature Flag & State Toggling", () => {
    it("defaults to enabled and allows toggling feature flag", () => {
      const visualizer = new SpotlightScoreVisualizer({
        getMidiScore: () => mockMidiScore as any,
        getTransport: () => mockTransport as any,
        getCurrentPiece: () => mockPiece,
      });

      expect(visualizer.getIsEnabled()).toBe(true);

      // Disable feature flag
      visualizer.setEnabled(false);
      expect(visualizer.getIsEnabled()).toBe(false);

      // Attempt to show while disabled -> remains hidden
      visualizer.show("violin1");
      expect(visualizer.getIsVisible()).toBe(false);

      // Re-enable feature flag
      visualizer.setEnabled(true);
      expect(visualizer.getIsEnabled()).toBe(true);

      // Now show succeeds
      visualizer.show("violin1");
      expect(visualizer.getIsVisible()).toBe(true);

      // Disabling while currently visible immediately hides it
      visualizer.setEnabled(false);
      expect(visualizer.getIsVisible()).toBe(false);
    });

    it("provides debug telemetry including placement, note count, and state", () => {
      const visualizer = new SpotlightScoreVisualizer({
        getMidiScore: () => mockMidiScore as any,
        getTransport: () => mockTransport as any,
        getCurrentPiece: () => mockPiece,
      });

      const telemBefore = visualizer.getDebugTelemetry();
      expect(telemBefore.isEnabled).toBe(true);
      expect(telemBefore.isVisible).toBe(false);

      visualizer.show("violin1");
      const telemAfter = visualizer.getDebugTelemetry();
      expect(telemAfter.isVisible).toBe(true);
      expect(telemAfter.sectionId).toBe("violin1");
      expect(telemAfter.notesCount).toBe(2);
      expect(telemAfter.zIndex).toContain("120");
    });
  });
});

