/**
 * MidiScore.ts
 *
 * Parses a MIDI file into a flat, sorted array of beat-space ScoreEvents.
 * All timing is converted from MIDI ticks to beat positions using PPQ.
 *
 * Rules:
 *   - beatPosition = midiTick / PPQ
 *   - noteOn and noteOff are stored as separate events so that releases
 *     can follow later tempo changes independently.
 *   - Embedded MIDI tempo is extracted for metadata only. It is never used
 *     as the runtime transport — the ConductorClock owns tempo.
 *   - Each note instance gets a unique noteId string so the Scheduler can
 *     pair its noteOn with its noteOff precisely.
 */

import { Midi } from "@tonejs/midi";
import type { ScoreEvent, ScoreMetadata } from "./scoreTypes";

export class MidiScore {
  private events: ScoreEvent[] = [];
  private metadata: ScoreMetadata | null = null;

  /**
   * Load and parse a MIDI file from a URL (e.g. "/midi/Eine-Kleine-Nachtmusik1.mid").
   * Returns self for chaining.
   */
  async load(url: string): Promise<this> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch MIDI file: ${url} (${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    const midi = new Midi(buffer);
    this.parseMidi(midi);
    return this;
  }

  /** Returns all score events sorted by beat position. */
  getEvents(): ScoreEvent[] {
    return this.events;
  }

  /** Returns score metadata. Throws if not yet loaded. */
  getMetadata(): ScoreMetadata {
    if (!this.metadata) throw new Error("MidiScore not yet loaded");
    return this.metadata;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private parseMidi(midi: Midi): void {
    const ppq = midi.header.ppq;
    const events: ScoreEvent[] = [];

    // Extract embedded tempo from the header (for metadata display only)
    const tempoChanges = midi.header.tempos;
    const firstTempo = tempoChanges[0];
    const embeddedTempoMicroseconds = firstTempo ? firstTempo.bpm > 0
      ? Math.round(60_000_000 / firstTempo.bpm) : 500_000
      : 500_000;
    const embeddedBpm = firstTempo ? firstTempo.bpm : 120;

    // Extract time signature
    const timeSigs = midi.header.timeSignatures;
    const firstTimeSig = timeSigs[0];
    const tsNum = firstTimeSig?.timeSignature[0] ?? 4;
    const tsDen = firstTimeSig?.timeSignature[1] ?? 4;

    let maxBeat = 0;
    let noteCounter = 0;

    midi.tracks.forEach((track, trackIndex) => {
      const trackId = track.name || `track_${trackIndex}`;
      const program = track.instrument.number;

      track.notes.forEach(note => {
        noteCounter++;
        const noteId = `n${noteCounter}`;

        // Convert Tone.js ticks → beat position
        // @tonejs/midi exposes note.ticks (start) and note.durationTicks
        const startBeat = note.ticks / ppq;
        const endBeat = (note.ticks + note.durationTicks) / ppq;

        if (endBeat > maxBeat) maxBeat = endBeat;

        const channel = track.channel ?? 0;

        events.push({
          beat: startBeat,
          type: "noteOn",
          trackId,
          noteId,
          midiNote: note.midi,
          velocity: Math.round(note.velocity * 127),
          channel,
          program,
        });

        events.push({
          beat: endBeat,
          type: "noteOff",
          trackId,
          noteId,
          midiNote: note.midi,
          velocity: 0,
          channel,
          program,
        });
      });
    });

    // Sort by beat position, then put noteOff before noteOn at the same beat
    // (prevents clicks from note overlap at tied notes)
    events.sort((a, b) => {
      if (a.beat !== b.beat) return a.beat - b.beat;
      if (a.type === "noteOff" && b.type === "noteOn") return -1;
      if (a.type === "noteOn" && b.type === "noteOff") return 1;
      return 0;
    });

    this.events = events;
    this.metadata = {
      title: midi.header.name || "Eine Kleine Nachtmusik",
      ppq,
      totalBeats: maxBeat,
      timeSignatureNumerator: tsNum,
      timeSignatureDenominator: tsDen,
      embeddedTempoMicroseconds,
      embeddedBpm,
    };
  }
}
