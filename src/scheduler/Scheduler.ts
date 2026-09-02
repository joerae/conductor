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
const TICK_INTERVAL_MS = 15;

/** How far ahead we look when committing events to the audio engine (tight for instant responsiveness). */
const LOOKAHEAD_MS = 120;

export type NotePlaybackEvent = {
  type: "noteOn" | "noteOff";
  noteId: string;
  trackId: string;
  channel: number;
  midiNote: number;
  velocity: number;
  audioTime: number;
};

export interface SchedulerDiagnostics {
  lastTickDurationMs: number;
  eventsExaminedLastTick: number;
  lateEventCount: number;
  maxLatenessMs: number;
  committedCount: number;
  horizon: number;
}

export class Scheduler {
  private transport: ScoreTransport;
  private audioEngine: AudioEngine;
  private committedNoteIds: Set<string> = new Set();
  private tickHandle: ReturnType<typeof setTimeout> | null = null;
  private getAudioTime: () => number;
  private onNoteEvent?: (event: NotePlaybackEvent) => void;
  private onComplete?: () => void;
  private hasCompleted: boolean = false;

  /** Diagnostic: number of events committed since last reset. */
  public committedCount: number = 0;
  /** Diagnostic: audio time of the furthest committed event. */
  public horizon: number = 0;
  /** Diagnostic: duration of the last scheduler tick in ms. */
  public lastTickDurationMs: number = 0;
  /** Diagnostic: count of events examined in the last tick window. */
  public eventsExaminedLastTick: number = 0;
  /** Diagnostic: count of events that were scheduled with audioTime in the past. */
  public lateEventCount: number = 0;
  /** Diagnostic: maximum scheduling lateness in ms. */
  public maxLatenessMs: number = 0;

  constructor(
    transport: ScoreTransport,
    audioEngine: AudioEngine,
    getAudioTime: () => number,
    onNoteEvent?: (event: NotePlaybackEvent) => void,
    onComplete?: () => void
  ) {
    this.transport = transport;
    this.audioEngine = audioEngine;
    this.getAudioTime = getAudioTime;
    this.onNoteEvent = onNoteEvent;
    this.onComplete = onComplete;
  }

  /** Start the scheduler tick loop. */
  start(): void {
    if (this.tickHandle !== null) return;
    this.hasCompleted = false;
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
    this.hasCompleted = false;
    this.lastTickDurationMs = 0;
    this.eventsExaminedLastTick = 0;
    this.lateEventCount = 0;
    this.maxLatenessMs = 0;
  }

  getDiagnostics(): SchedulerDiagnostics {
    return {
      lastTickDurationMs: Math.round(this.lastTickDurationMs * 100) / 100,
      eventsExaminedLastTick: this.eventsExaminedLastTick,
      lateEventCount: this.lateEventCount,
      maxLatenessMs: Math.round(this.maxLatenessMs * 10) / 10,
      committedCount: this.committedCount,
      horizon: Math.round(this.horizon * 1000) / 1000,
    };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private tick(): void {
    const tickStart = performance.now();
    const audioNow = this.getAudioTime();
    // Advance cursor to match current audio time
    this.transport.advanceTo(audioNow);

    if (this.transport.isPlaying()) {
      // Check for piece completion
      if (this.transport.isCompleted() && !this.hasCompleted) {
        this.hasCompleted = true;
        if (this.onComplete) {
          this.onComplete();
        }
      }

      // Predictive lookahead: look from audioNow up through the predicted cursor beat + lookahead horizon
      const cursorAudioTime = this.transport.audioTimeForBeat(this.transport.getCursorBeat());
      const windowStart = Math.min(audioNow, cursorAudioTime);
      const windowEnd = Math.max(audioNow + LOOKAHEAD_MS / 1000, cursorAudioTime + LOOKAHEAD_MS / 1000);

      const pending = this.transport.eventsInWindow(windowStart, windowEnd);
      this.eventsExaminedLastTick = pending.length;

      for (const event of pending) {
        // Use a composite key: noteId + type to track each note's on/off separately
        const key = `${event.noteId}:${event.type}`;
        if (this.committedNoteIds.has(key)) continue;

        let audioTime = this.transport.audioTimeForBeat(event.beat);

        // If audioTime is slightly in the past due to start tap jitter (up to 300ms),
        // schedule immediately (audioNow + 0.004) so opening downbeat notes are NEVER dropped!
        if (audioTime < audioNow) {
          const latenessMs = (audioNow - audioTime) * 1000;
          this.lateEventCount++;
          if (latenessMs > this.maxLatenessMs) {
            this.maxLatenessMs = latenessMs;
          }
          if (audioTime >= audioNow - 0.300) {
            audioTime = audioNow + 0.004;
          } else {
            continue;
          }
        }

        this.commitEvent(event, audioTime);
        this.committedNoteIds.add(key);
        this.committedCount++;

        if (audioTime > this.horizon) this.horizon = audioTime;
      }
    } else {
      this.eventsExaminedLastTick = 0;
    }

    this.lastTickDurationMs = performance.now() - tickStart;

    // Schedule next tick
    this.tickHandle = setTimeout(() => this.tick(), TICK_INTERVAL_MS);
  }

  private commitEvent(event: ScoreEvent, audioTime: number): void {
    if (event.type === "noteOn") {
      this.audioEngine.scheduleNoteOn(
        event.noteId,
        event.midiNote,
        event.velocity,
        event.channel,
        event.program,
        audioTime
      );
    } else {
      this.audioEngine.scheduleNoteOff(
        event.noteId,
        audioTime
      );
    }

    // Emit note event for visual synchronization
    if (this.onNoteEvent) {
      this.onNoteEvent({
        type: event.type,
        noteId: event.noteId,
        trackId: event.trackId,
        channel: event.channel,
        midiNote: event.midiNote,
        velocity: event.velocity,
        audioTime,
      });
    }
  }
}
