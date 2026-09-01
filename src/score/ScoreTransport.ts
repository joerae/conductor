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

  private totalBeats: number = 0;
  private beatsPerTap: number = 1;
  private fermata: boolean = false;

  // ── Public API ──────────────────────────────────────────────────────────

  setBeatsPerTap(multiplier: number): void {
    this.beatsPerTap = Math.max(1, multiplier);
  }

  getBeatsPerTap(): number {
    return this.beatsPerTap;
  }

  /** Enable or release a musical Fermata (holding current notes without advancing score). */
  setFermata(active: boolean, currentAudioTime: number): void {
    if (this.fermata === active) return;
    this.fermata = active;
    if (active) {
      this.cursorBeat = this.beatAtAudioTime(currentAudioTime);
      this.originBeat = this.cursorBeat;
      this.originAudioTime = currentAudioTime;
    } else {
      this.originBeat = this.cursorBeat;
      this.originAudioTime = currentAudioTime;
    }
  }

  isFermataActive(): boolean {
    return this.fermata;
  }

  /** Load score events from MidiScore. */
  setEvents(events: ScoreEvent[], totalBeats?: number): void {
    this.events = events;
    if (totalBeats !== undefined) {
      this.totalBeats = totalBeats;
    } else {
      this.totalBeats = events.reduce((max, e) => Math.max(max, e.beat), 0);
    }
  }

  setTotalBeats(totalBeats: number): void {
    this.totalBeats = totalBeats;
  }

  getTotalBeats(): number {
    return this.totalBeats;
  }

  isCompleted(): boolean {
    return this.totalBeats > 0 && this.cursorBeat >= this.totalBeats;
  }

  /**
   * Start or re-anchor the transport.
   *
   * @param startBeat     The beat in the score to start from (usually 0).
   * @param audioTime     The AudioContext time corresponding to startBeat.
   * @param periodSec     The current beat period from ConductorClock.
   * @param beatsPerTap   Beats advanced per tap (1 for 4/4, 2 for cut time).
   */
  start(startBeat: number, audioTime: number, periodSec: number, beatsPerTap: number = 1): void {
    this.beatsPerTap = Math.max(1, beatsPerTap);
    this.originBeat = startBeat;
    this.originAudioTime = audioTime;
    this.periodSec = periodSec / this.beatsPerTap;
    this.cursorBeat = startBeat;
    this.playing = true;
    this.fermata = false;
  }

  /** Stop playback. */
  stop(): void {
    this.playing = false;
    this.fermata = false;
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
    if (this.fermata) {
      this.periodSec = newPeriodSec / this.beatsPerTap;
      this.originAudioTime = currentAudioTime;
      return;
    }
    const currentBeat = this.beatAtAudioTime(currentAudioTime);
    this.originBeat = currentBeat;
    this.originAudioTime = currentAudioTime + phaseCorrectionSec;
    this.periodSec = newPeriodSec / this.beatsPerTap;
    this.cursorBeat = currentBeat;
  }

  /**
   * Advance the cursor to match the given audio time.
   * Called by the Scheduler every tick so it knows where we are.
   */
  advanceTo(audioTime: number): void {
    if (!this.playing) return;
    if (this.fermata) {
      this.originAudioTime = audioTime;
      return;
    }
    this.cursorBeat = this.beatAtAudioTime(audioTime);
  }

  /**
   * Return all score events whose beat position falls within the given audio time window.
   * Events are returned in ascending beat order.
   *
   * @param fromAudioTime  Start of the window.
   * @param toAudioTime    End of the window (look-ahead horizon).
   */
  eventsInWindow(fromAudioTime: number, toAudioTime: number): ScoreEvent[] {
    if (this.fermata) {
      return [];
    }
    const fromBeat = this.beatAtAudioTime(fromAudioTime);
    const toBeat = this.beatAtAudioTime(toAudioTime);
    // Include boundary margin so opening downbeat notes at originBeat are never missed
    return this.events.filter(e => e.beat >= fromBeat - 0.05 && e.beat <= toBeat);
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
