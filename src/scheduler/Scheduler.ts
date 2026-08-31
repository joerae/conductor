/**
 * Scheduler.ts
 *
 * Look-ahead scheduler: wakes every TICK_INTERVAL_MS and commits upcoming
 * score events to the AudioEngine — exactly once per event.
 *
 * Design rules (from design doc §5):
 *   - Events outside the look-ahead window remain movable as tempo changes.
 *   - Events already committed to Web Audio are fixed.
 *   - Never schedule an event twice.
 *   - The conductor clock + score beat position is the source of truth.
 *   - Do NOT use Tone.Transport, MIDI seconds, or browser timers as musical authority.
 *
 * Timing constants (documented):
 *   TICK_INTERVAL_MS = 25 ms
 *     Wake interval. Short enough to stay ahead of the look-ahead window even
 *     under scheduler jitter. Must be significantly smaller than LOOKAHEAD_MS.
 *
 *   LOOKAHEAD_MS = 150 ms
 *     Events this far ahead in audio time are committed each tick.
 *     Large enough to absorb scheduler jitter; small enough that uncommitted
 *     events can still react to a tempo change.
 */

import type { ScoreEvent } from "../score/scoreTypes";
import type { ScoreTransport } from "../score/ScoreTransport";
import type { AudioEngine } from "../audio/AudioEngine";

/** How often the scheduler wakes and checks for events to commit. */
const TICK_INTERVAL_MS = 25;

/** How far ahead we look when committing events to the audio engine. */
const LOOKAHEAD_MS = 150;

export class Scheduler {
  private transport: ScoreTransport;
  private audioEngine: AudioEngine;
  private committedNoteIds: Set<string> = new Set();
  private tickHandle: ReturnType<typeof setTimeout> | null = null;
  private getAudioTime: () => number;

  /** Diagnostic: number of events committed since last reset. */
  public committedCount: number = 0;
  /** Diagnostic: audio time of the furthest committed event. */
  public horizon: number = 0;

  constructor(
    transport: ScoreTransport,
    audioEngine: AudioEngine,
    getAudioTime: () => number
  ) {
    this.transport = transport;
    this.audioEngine = audioEngine;
    this.getAudioTime = getAudioTime;
  }

  /** Start the scheduler tick loop. */
  start(): void {
    if (this.tickHandle !== null) return;
    this.tick();
  }

  /** Stop the scheduler. Does not cancel already-committed audio events. */
  stop(): void {
    if (this.tickHandle !== null) {
      clearTimeout(this.tickHandle);
      this.tickHandle = null;
    }
  }

  /** Reset committed event tracking (e.g. on restart). */
  reset(): void {
    this.committedNoteIds.clear();
    this.committedCount = 0;
    this.horizon = 0;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private tick(): void {
    const audioNow = this.getAudioTime();
    const lookAheadEnd = audioNow + LOOKAHEAD_MS / 1000;

    // Advance the transport cursor to now
    this.transport.advanceTo(audioNow);

    if (this.transport.isPlaying()) {
      const pending = this.transport.eventsInWindow(audioNow, lookAheadEnd);

      for (const event of pending) {
        // Use a composite key: noteId + type to track each note's on/off separately
        const key = `${event.noteId}:${event.type}`;
        if (this.committedNoteIds.has(key)) continue;

        const audioTime = this.transport.audioTimeForBeat(event.beat);

        // Don't commit events that are already in the past
        if (audioTime < audioNow - 0.010) continue;

        this.commitEvent(event, audioTime);
        this.committedNoteIds.add(key);
        this.committedCount++;

        if (audioTime > this.horizon) this.horizon = audioTime;
      }
    }

    // Schedule next tick
    this.tickHandle = setTimeout(() => this.tick(), TICK_INTERVAL_MS);
  }

  private commitEvent(event: ScoreEvent, audioTime: number): void {
    if (event.type === "noteOn") {
      this.audioEngine.scheduleNoteOn(
        event.midiNote,
        event.velocity,
        event.channel,
        event.program,
        audioTime
      );
    } else {
      this.audioEngine.scheduleNoteOff(
        event.midiNote,
        event.channel,
        audioTime
      );
    }
  }
}
