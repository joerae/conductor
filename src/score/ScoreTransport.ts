/**
 * ScoreTransport.ts
 *
 * Maps the score's beat-space position to real AudioContext time via the
 * ConductorClock's current period and phase.
 *
 * Responsibilities:
 *   - Track the current playback beat position.
 *   - Convert a score beat → AudioContext time using: audioTime = beatOrigin + (beat - originBeat) * periodSec
 *   - Expose a "look-ahead" query: "which events fall in the next N seconds?"
 *
 * The Scheduler polls ScoreTransport to know what to commit next.
 * The ScoreTransport never touches audio itself.
 */

import type { ScoreEvent } from "./scoreTypes";

export class ScoreTransport {
  private events: ScoreEvent[] = [];

  /**
   * The audio time (AudioContext seconds) at which beat `originBeat` occurs.
   * This anchors the entire score in real time.
   */
  private originAudioTime: number = 0;

  /** The beat number corresponding to originAudioTime. */
  private originBeat: number = 0;

  /** Current beat period in seconds (from ConductorClock). */
  private periodSec: number = 0.5; // 120 BPM default

  /** Current playback cursor in beats. */
  private cursorBeat: number = 0;

  /** Whether the transport is actively playing. */
  private playing: boolean = false;

  // ── Public API ──────────────────────────────────────────────────────────

  /** Load score events from MidiScore. */
  setEvents(events: ScoreEvent[]): void {
    this.events = events;
  }

  /**
   * Start or re-anchor the transport.
   *
   * @param startBeat   The beat in the score to start from (usually 0).
   * @param audioTime   The AudioContext time corresponding to startBeat.
   * @param periodSec   The current beat period from ConductorClock.
   */
  start(startBeat: number, audioTime: number, periodSec: number): void {
    this.originBeat = startBeat;
    this.originAudioTime = audioTime;
    this.periodSec = periodSec;
    this.cursorBeat = startBeat;
    this.playing = true;
  }

  /** Stop playback. */
  stop(): void {
    this.playing = false;
  }

  /** True if the transport is playing. */
  isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Update the beat period when the conductor changes tempo.
   * Also re-anchors the origin to the current cursor position and audio time,
   * applying any phase correction to align the score grid with the conductor's pulse.
   *
   * @param currentAudioTime    AudioContext.currentTime at the moment of update.
   * @param newPeriodSec        New period from ConductorClock.
   * @param phaseCorrectionSec  Phase adjustment in seconds (optional).
   */
  updatePeriod(currentAudioTime: number, newPeriodSec: number, phaseCorrectionSec: number = 0): void {
    const currentBeat = this.beatAtAudioTime(currentAudioTime);
    this.originBeat = currentBeat;
    this.originAudioTime = currentAudioTime + phaseCorrectionSec;
    this.periodSec = newPeriodSec;
    this.cursorBeat = currentBeat;
  }

  /**
   * Advance the cursor to match the given audio time.
   * Called by the Scheduler every tick so it knows where we are.
   */
  advanceTo(audioTime: number): void {
    if (!this.playing) return;
    this.cursorBeat = this.beatAtAudioTime(audioTime);
  }

  /**
   * Return all score events whose beat position falls within the given audio time window.
   * Events are returned in ascending beat order.
   *
   * @param fromAudioTime  Start of the window (exclusive — events after cursor).
   * @param toAudioTime    End of the window (look-ahead horizon).
   */
  eventsInWindow(fromAudioTime: number, toAudioTime: number): ScoreEvent[] {
    const fromBeat = this.beatAtAudioTime(fromAudioTime);
    const toBeat = this.beatAtAudioTime(toAudioTime);
    return this.events.filter(e => e.beat > fromBeat && e.beat <= toBeat);
  }

  /**
   * Convert a score beat position to an AudioContext time.
   */
  audioTimeForBeat(beat: number): number {
    return this.originAudioTime + (beat - this.originBeat) * this.periodSec;
  }

  /** Current playback position in beats. */
  getCursorBeat(): number {
    return this.cursorBeat;
  }

  /** Current period in seconds. */
  getPeriodSec(): number {
    return this.periodSec;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private beatAtAudioTime(audioTime: number): number {
    if (this.periodSec <= 0) return this.originBeat;
    return this.originBeat + (audioTime - this.originAudioTime) / this.periodSec;
  }
}
