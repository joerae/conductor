/**
 * scoreTypes.ts
 * Type definitions for the MIDI score representation.
 * All timing here is in beat space, not seconds. The runtime clock converts beats → audio time.
 */

/**
 * A single discrete musical event in beat space.
 * noteOn and noteOff are kept separate so that note releases
 * can continue to follow later tempo changes independently.
 */
export type ScoreEvent = {
  /** Beat position within the score (float, 0-based). */
  beat: number;
  type: "noteOn" | "noteOff";
  /** Note duration in beats (quarter notes), for noteOn events. 0 for noteOff. */
  durationBeats: number;
  /** Identifies the MIDI track this note belongs to (for instrument mapping). */
  trackId: string;
  /** Unique string per note instance, used to pair noteOn with its noteOff. */
  noteId: string;
  /** MIDI note number 0–127. */
  midiNote: number;
  /** MIDI velocity 0–127. */
  velocity: number;
  /** MIDI channel 0–15. */
  channel: number;
  /** MIDI program number 0–127 (instrument). */
  program: number;
};

/**
 * Metadata extracted from the MIDI file.
 * The embedded tempo is for display only — the ConductorClock owns runtime tempo.
 */
export type ScoreMetadata = {
  title: string;
  /** Pulses Per Quarter note — needed to convert ticks → beats. */
  ppq: number;
  /** Number of score beats (quarter notes) in the full piece. */
  totalBeats: number;
  /** Time signature numerator (e.g. 4 in 4/4). */
  timeSignatureNumerator: number;
  /** Time signature denominator (e.g. 4 in 4/4). */
  timeSignatureDenominator: number;
  /** Embedded MIDI tempo in microseconds per beat (metadata only). */
  embeddedTempoMicroseconds: number;
  /** Embedded BPM derived from embeddedTempoMicroseconds. */
  embeddedBpm: number;
};
