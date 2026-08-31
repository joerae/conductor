/**
 * ExperienceController.ts
 *
 * Owns the top-level state machine for the Conductor experience.
 *
 * States:
 *   loading    → Assets (MIDI + samples) are being fetched/decoded.
 *   ready      → Loaded. Showing "Tap SPACE twice to set the pulse."
 *   preparing  → First tap received. Waiting for second tap to establish period.
 *   playing    → Clock is running. Score is playing. Tempo is following the conductor.
 *   coasting   → Input has stopped. Orchestra plays from momentum.
 *   paused     → Too many missed beats. Orchestra holds.
 *
 * Wires together:
 *   KeyboardBeatInput → ConductorClock → ScoreTransport → Scheduler → AudioEngine
 *   All modules → DebugOverlay
 */

import { ConductorClock } from "../clock/ConductorClock";
import { KeyboardBeatInput } from "../input/KeyboardBeatInput";
import { AudioEngine } from "../audio/AudioEngine";
import { MidiScore } from "../score/MidiScore";
import { ScoreTransport } from "../score/ScoreTransport";
import { Scheduler } from "../scheduler/Scheduler";
import { DebugOverlay } from "../ui/DebugOverlay";
import type { ClockEvent } from "../clock/ConductorClock";

export type ExperienceState =
  | "loading"
  | "ready"
  | "preparing"
  | "playing"
  | "coasting"
  | "paused";

interface UICallbacks {
  onStateChange: (state: ExperienceState) => void;
  onBeat: () => void;
}

export class ExperienceController {
  private state: ExperienceState = "loading";

  private audioEngine: AudioEngine;
  private clock: ConductorClock;
  private input: KeyboardBeatInput;
  private midiScore: MidiScore;
  private transport: ScoreTransport;
  private scheduler: Scheduler;
  private debug: DebugOverlay;

  private uiCallbacks: UICallbacks;
  private prepTapCount: number = 0;

  constructor(callbacks: UICallbacks) {
    this.uiCallbacks = callbacks;
    this.audioEngine = new AudioEngine();
    this.debug = new DebugOverlay();

    // Clock uses AudioEngine's time function for audio scheduling
    this.clock = new ConductorClock({
      getAudioTime: () => this.audioEngine.getAudioTime(),
    });

    this.input = new KeyboardBeatInput();
    this.midiScore = new MidiScore();
    this.transport = new ScoreTransport();
    this.scheduler = new Scheduler(
      this.transport,
      this.audioEngine,
      () => this.audioEngine.getAudioTime()
    );

    // Wire clock events → UI + debug
    this.clock.on((event: ClockEvent) => this.handleClockEvent(event));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async load(): Promise<void> {
    this.setState("loading");
    try {
      // Load MIDI score
      await this.midiScore.load("/midi/Eine-Kleine-Nachtmusik1.mid");
      this.transport.setEvents(this.midiScore.getEvents());

      // Wire input → clock (doesn't need audio yet)
      this.input.onBeat(obs => this.handleBeatObservation(obs));
      this.input.start();

      this.setState("ready");
    } catch (err) {
      console.error("Conductor: failed to load", err);
      throw err;
    }
  }

  restart(): void {
    this.scheduler.stop();
    this.scheduler.reset();
    this.transport.stop();
    this.clock.reset();
    this.prepTapCount = 0;
    this.setState("ready");
  }

  // ── Beat observation handler ─────────────────────────────────────────────

  private async handleBeatObservation(obs: {
    timestampMs: number;
    source: "keyboard" | "camera";
    confidence: number;
  }): Promise<void> {
    // First tap ever: resume the AudioContext (requires user gesture)
    if (this.prepTapCount === 0) {
      await this.audioEngine.resume();
      // Load samples in the background (Phase 1 audio)
      this.audioEngine.loadSamples().catch(err =>
        console.warn("Conductor: sample loading failed, using fallback click", err)
      );
    }

    this.prepTapCount++;

    if (this.state === "ready" || this.state === "paused") {
      this.setState("preparing");
    }

    // Feed to clock
    this.clock.acceptObservation(obs);

    // After second tap: the clock has a period, start playing
    if (this.prepTapCount === 2 && this.state === "preparing") {
      this.startPlayback();
    }
  }

  // ── Playback ─────────────────────────────────────────────────────────────

  private startPlayback(): void {
    const clockState = this.clock.getState();
    const periodSec = clockState.periodMs / 1000;
    const nextBeatAudioTime = this.clock.predictNextBeatAudioTime();

    // Anchor score beat 0 at the predicted first downbeat
    this.transport.start(0, nextBeatAudioTime, periodSec);
    this.scheduler.start();
    this.setState("playing");

    // Update audio latency in debug overlay
    const ctx = (this.audioEngine as unknown as { ctx: AudioContext | null }).ctx;
    if (ctx) {
      this.debug.updateAudioLatency(
        (ctx as AudioContext & { baseLatency?: number }).baseLatency ?? 0,
        (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0
      );
    }
  }

  // ── Clock event handler ──────────────────────────────────────────────────

  private handleClockEvent(event: ClockEvent): void {
    switch (event.type) {
      case "beat": {
        const s = event.state;
        // Update transport with new period on each beat
        if (this.state === "playing" || this.state === "coasting") {
          this.transport.updatePeriod(
            this.audioEngine.getAudioTime(),
            s.periodMs / 1000
          );
        }
        this.debug.updateClock(s);
        this.debug.updateTapAccepted();
        this.debug.updateScore(this.transport.getCursorBeat());
        this.debug.updateScheduler(this.scheduler.horizon, this.scheduler.committedCount);
        this.uiCallbacks.onBeat();
        break;
      }
      case "rejected":
        this.debug.updateTapRejected(event.reason);
        break;
      case "coasting":
        this.setState("coasting");
        break;
      case "paused":
        this.setState("paused");
        this.scheduler.stop();
        break;
      case "resumed":
        this.setState("playing");
        this.scheduler.start();
        break;
    }
  }

  // ── State ────────────────────────────────────────────────────────────────

  private setState(next: ExperienceState): void {
    this.state = next;
    this.uiCallbacks.onStateChange(next);
  }

  getState(): ExperienceState {
    return this.state;
  }

  getMidiMetadata() {
    try {
      return this.midiScore.getMetadata();
    } catch {
      return null;
    }
  }
}
