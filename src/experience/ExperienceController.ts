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
 *   Dynamic level state machine + overburn timer → AudioEngine DSP
 *   All modules → DebugOverlay
 */

import { ConductorClock } from "../clock/ConductorClock";
import type { ClockEvent, TempoMode } from "../clock/ConductorClock";
import type { BeatInputProvider } from "../input/BeatInputProvider";
import { KeyboardBeatInput } from "../input/KeyboardBeatInput";
import { CameraBeatInputProvider } from "../camera/CameraBeatInputProvider";
import { AudioEngine } from "../audio/AudioEngine";
import { MidiScore } from "../score/MidiScore";
import { ScoreTransport } from "../score/ScoreTransport";
import { Scheduler } from "../scheduler/Scheduler";
import { DebugOverlay } from "../ui/DebugOverlay";
import { getStepDynamicLevel } from "../audio/dynamicsTypes";
import type {
  DynamicLevel,
  DSPBypassFlags,
  DynamicsTelemetry,
  VelocityDecomposition,
} from "../audio/dynamicsTypes";

import type { NotePlaybackEvent } from "../scheduler/Scheduler";
import { REPERTOIRE, getPieceById, DEFAULT_PIECE_ID } from "../score/repertoire";
import type { PieceDefinition } from "../score/repertoire";

export type ExperienceState =
  | "loading"
  | "ready"
  | "preparing"
  | "playing"
  | "paused"
  | "completed";

export type InputSource = "keyboard" | "camera";

export type NoteVisualEvent = {
  type: "noteOn" | "noteOff";
  trackId: string;
  channel: number;
  midiNote: number;
  velocity: number;
  rawVelocity: number;
  decomp: VelocityDecomposition;
  delayMs: number;
};

interface UICallbacks {
  onStateChange: (state: ExperienceState) => void;
  onBeat: () => void;
  onNoteVisual?: (event: NoteVisualEvent) => void;
  onDynamicChange?: (level: DynamicLevel) => void;
  onAccentArmed?: (armed: boolean) => void;
  onAccentFlash?: () => void;
  onInputSourceChange?: (source: InputSource) => void;
}

export class ExperienceController {
  private state: ExperienceState = "loading";
  private currentPieceId: string = DEFAULT_PIECE_ID;

  private audioEngine: AudioEngine;
  private clock: ConductorClock;
  private inputSource: InputSource = "keyboard";
  private keyboardInput: KeyboardBeatInput;
  private cameraInput: CameraBeatInputProvider | null = null;
  private currentInputProvider: BeatInputProvider;
  private inputUnsubscribe: (() => void) | null = null;
  private midiScore: MidiScore;
  private transport: ScoreTransport;
  private scheduler: Scheduler;
  private debug: DebugOverlay;

  private uiCallbacks: UICallbacks;
  private prepTapCount: number = 0;
  private pausedBeat: number = 0;

  // Sustained conductor dynamic level
  private baseDynamicLevel: DynamicLevel = "mf";

  // Overburn decay timer (for ff dynamic)
  private overburnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(callbacks: UICallbacks) {
    this.uiCallbacks = callbacks;
    this.audioEngine = new AudioEngine();

    // Wire debug overlay with A/B DSP bypass control, pause toggle, and macro ratio slider
    this.debug = new DebugOverlay(
      (flag: keyof DSPBypassFlags, enabled: boolean) => {
        this.audioEngine.setDSPBypassFlags({ [flag]: enabled });
        this.debug.updateDynamics(this.audioEngine.getDynamicsTelemetry());
      },
      () => {
        this.togglePause();
      },
      (ratio: number) => {
        this.audioEngine.setScoreMacroRatio(ratio);
        this.debug.updateDynamics(this.audioEngine.getDynamicsTelemetry());
      }
    );

    // Clock uses AudioEngine's time function for audio scheduling
    this.clock = new ConductorClock({
      getAudioTime: () => this.audioEngine.getAudioTime(),
    });

    this.keyboardInput = new KeyboardBeatInput();
    this.currentInputProvider = this.keyboardInput;
    this.midiScore = new MidiScore();
    this.transport = new ScoreTransport();
    this.scheduler = new Scheduler(
      this.transport,
      this.audioEngine,
      () => this.audioEngine.getAudioTime(),
      (event: NotePlaybackEvent) => this.handleNotePlaybackEvent(event),
      () => this.handlePieceComplete()
    );

    // Wire clock events → UI + debug
    this.clock.on((event: ClockEvent) => this.handleClockEvent(event));

    // Initialize dynamics telemetry in debug
    this.debug.updateDynamics(this.audioEngine.getDynamicsTelemetry());
  }

  private handleNotePlaybackEvent(event: NotePlaybackEvent): void {
    if (!this.uiCallbacks.onNoteVisual) return;
    const now = this.audioEngine.getAudioTime();
    const delayMs = Math.max(0, (event.audioTime - now) * 1000);
    const decomp = this.audioEngine.decomposeNoteVelocity(event.velocity);

    this.debug.updateLastNoteDecomp(decomp, event.trackId);

    this.uiCallbacks.onNoteVisual({
      type: event.type,
      trackId: event.trackId,
      channel: event.channel,
      midiNote: event.midiNote,
      velocity: decomp.final,
      rawVelocity: event.velocity,
      decomp,
      delayMs,
    });
  }

  private handlePieceComplete(): void {
    this.setState("completed");
    setTimeout(() => {
      this.scheduler.stop();
      this.transport.stop();
    }, 2000);
  }

  // ── Lifecycle & Repertoire ────────────────────────────────────────────────

  async load(pieceId: string = DEFAULT_PIECE_ID): Promise<void> {
    this.setState("loading");
    this.currentPieceId = pieceId;
    const piece = getPieceById(pieceId) || REPERTOIRE[0];

    try {
      // Load MIDI score and instrument samples in parallel
      await Promise.all([
        this.midiScore.load(piece.midiUrl),
        this.audioEngine.loadSamples().catch(err =>
          console.warn("Conductor: sample loading failed, using fallback click", err)
        ),
      ]);
      this.transport.setEvents(this.midiScore.getEvents(), this.midiScore.getMetadata().totalBeats);
      this.transport.setBeatsPerTap(piece.beatsPerTap || 1);

      // Wire active input provider → clock
      this.attachInputProvider(this.inputSource === "camera" && this.cameraInput ? this.cameraInput : this.keyboardInput);

      this.prepTapCount = 0;
      this.pausedBeat = 0;
      this.setState("ready");
    } catch (err) {
      console.error("Conductor: failed to load piece", err);
      throw err;
    }
  }

  private attachInputProvider(provider: BeatInputProvider): void {
    if (this.inputUnsubscribe) {
      this.inputUnsubscribe();
      this.inputUnsubscribe = null;
    }
    this.currentInputProvider.stop();
    this.currentInputProvider = provider;
    this.inputUnsubscribe = this.currentInputProvider.onBeat(obs => this.handleBeatObservation(obs));
    this.currentInputProvider.start();
  }

  async setInputSource(source: InputSource): Promise<void> {
    if (source === this.inputSource) return;

    if (source === "camera") {
      if (!this.cameraInput) {
        this.cameraInput = new CameraBeatInputProvider();
      }
      this.inputSource = "camera";
      this.attachInputProvider(this.cameraInput);
    } else {
      this.inputSource = "keyboard";
      this.attachInputProvider(this.keyboardInput);
    }

    this.uiCallbacks.onInputSourceChange?.(this.inputSource);
  }

  getInputSource(): InputSource {
    return this.inputSource;
  }

  getCameraProvider(): CameraBeatInputProvider | null {
    return this.cameraInput;
  }

  async loadPiece(pieceId: string): Promise<void> {
    this.scheduler.stop();
    this.scheduler.reset();
    this.transport.stop();
    this.clock.reset();
    this.audioEngine.stopAllNotes();
    await this.load(pieceId);
  }

  getCurrentPiece(): PieceDefinition {
    return getPieceById(this.currentPieceId) || REPERTOIRE[0];
  }

  getRepertoire(): PieceDefinition[] {
    return REPERTOIRE;
  }

  restart(): void {
    this.scheduler.stop();
    this.scheduler.reset();
    this.transport.stop();
    this.clock.reset();
    this.audioEngine.stopAllNotes();
    this.prepTapCount = 0;
    this.pausedBeat = 0;
    this.setState("ready");
  }

  togglePause(): void {
    if (this.state === "playing") {
      this.pausedBeat = this.transport.getCursorBeat();
      this.scheduler.stop();
      this.scheduler.reset();
      this.transport.stop();
      this.clock.reset();
      this.audioEngine.stopAllNotes();
      this.prepTapCount = 0;
      this.setState("paused");
      this.debug.updatePauseState(true);
    } else if (this.state === "paused" || this.state === "ready") {
      this.startPlayback();
      this.debug.updatePauseState(false);
    }
  }

  // ── Dynamics & Expression ────────────────────────────────────────────────

  setDynamicLevel(level: DynamicLevel, updateBase: boolean = true): void {
    if (this.overburnTimer) {
      clearTimeout(this.overburnTimer);
      this.overburnTimer = null;
    }

    if (updateBase) {
      this.baseDynamicLevel = level;
    }

    this.audioEngine.setDynamicLevel(level);
    this.debug.updateDynamics(this.audioEngine.getDynamicsTelemetry());

    if (this.uiCallbacks.onDynamicChange) {
      this.uiCallbacks.onDynamicChange(level);
    }

    // If pushed to fff (overburn ⚡), schedule automatic decay back to ff after 1.5s
    if (level === "fff") {
      this.overburnTimer = setTimeout(() => {
        if (this.audioEngine.getDynamicLevel() === "fff") {
          this.setDynamicLevel("ff");
        }
      }, 1500);
    }
  }

  getDynamicLevel(): DynamicLevel {
    return this.audioEngine.getDynamicLevel();
  }

  stepDynamicLevel(delta: number): void {
    const current = this.baseDynamicLevel;
    const next = getStepDynamicLevel(current, delta);
    this.setDynamicLevel(next);
  }

  private accentClearTimer: ReturnType<typeof setTimeout> | null = null;

  armAccent(): void {
    const periodMs = this.clock.getState().periodMs || 500;

    // 1. Instantly trigger acoustic burst, voice gain surge, open filter & cranked reverb
    this.audioEngine.triggerAccentBurst(Math.max(380, periodMs * 0.95));
    this.uiCallbacks.onAccentFlash?.();
    this.uiCallbacks.onAccentArmed?.(true);
    this.debug.updateDynamics(this.audioEngine.getDynamicsTelemetry());

    // 2. Clear visual accent mark after the burst window finishes
    if (this.accentClearTimer) clearTimeout(this.accentClearTimer);
    this.accentClearTimer = setTimeout(() => {
      this.uiCallbacks.onAccentArmed?.(false);
    }, Math.max(320, periodMs * 0.85));
  }

  isAccentArmedState(): boolean {
    return this.audioEngine.isAccentActive();
  }

  setDSPBypassFlags(flags: Partial<DSPBypassFlags>): void {
    this.audioEngine.setDSPBypassFlags(flags);
    this.debug.updateDynamics(this.audioEngine.getDynamicsTelemetry());
  }

  getDSPBypassFlags(): DSPBypassFlags {
    return this.audioEngine.getDSPBypassFlags();
  }

  getDynamicsTelemetry(): DynamicsTelemetry {
    return this.audioEngine.getDynamicsTelemetry();
  }

  // ── Beat observation handler ─────────────────────────────────────────────

  private async handleBeatObservation(obs: {
    timestampMs: number;
    source: "keyboard" | "camera";
    confidence: number;
  }): Promise<void> {
    // Resume AudioContext on first tap if suspended (requires user gesture)
    await this.audioEngine.resume();

    this.prepTapCount++;

    // First tap from ready or paused: enter preparing state
    if (this.state === "ready" || this.state === "paused") {
      this.setState("preparing");
    }

    // Feed observation to clock
    this.clock.acceptObservation(obs);

    // After second tap: clock has calibrated period, start/resume playback
    if (this.prepTapCount === 2 && this.state === "preparing") {
      this.startPlayback();
    }
  }

  // ── Playback ─────────────────────────────────────────────────────────────

  private startPlayback(): void {
    const clockState = this.clock.getState();
    const periodSec = clockState.periodMs / 1000;
    const nextBeatAudioTime = this.clock.predictNextBeatAudioTime();
    const piece = this.getCurrentPiece();

    // Start or resume from pausedBeat
    const startBeat = this.pausedBeat;
    this.transport.start(startBeat, nextBeatAudioTime, periodSec, piece.beatsPerTap || 1);
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
    this.debug.updateDynamics(this.audioEngine.getDynamicsTelemetry());
  }

  // ── Clock event handler ──────────────────────────────────────────────────

  private handleClockEvent(event: ClockEvent): void {
    switch (event.type) {
      case "beat": {
        const s = event.state;
        // Update transport period & phase on every accepted tap while playing
        if (this.state === "playing") {
          this.transport.updatePeriod(
            this.audioEngine.getAudioTime(),
            s.periodMs / 1000,
            s.phaseCorrectionSec ?? 0
          );
        }

        this.debug.updateClock(s);
        this.debug.updateTapAccepted();
        this.debug.updateScore(this.transport.getCursorBeat());
        this.debug.updateScheduler(this.scheduler.horizon, this.scheduler.committedCount);
        this.debug.updateDynamics(this.audioEngine.getDynamicsTelemetry());
        this.uiCallbacks.onBeat();
        break;
      }
      case "rejected":
        this.debug.updateTapRejected(event.reason);
        break;
      case "stopped":
        // Orchestra pauses: record current beat position to resume seamlessly on next taps
        this.pausedBeat = this.transport.getCursorBeat();
        this.scheduler.stop();
        this.scheduler.reset();
        this.transport.stop();
        this.audioEngine.stopAllNotes();
        this.prepTapCount = 0;
        this.setState("paused");
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

  setTempoMode(mode: TempoMode): void {
    this.clock.setTempoMode(mode);
    this.debug.updateTempoMode(mode);
  }

  getTempoMode(): TempoMode {
    return this.clock.getTempoMode();
  }

  setMasterVolume(vol: number): void {
    this.audioEngine.setMasterVolume(vol);
  }

  getMasterVolume(): number {
    return this.audioEngine.getMasterVolume();
  }

  getCursorBeat(): number {
    return this.transport.getCursorBeat();
  }

  getPausedBeat(): number {
    return this.pausedBeat;
  }

  getMidiMetadata() {
    try {
      return this.midiScore.getMetadata();
    } catch {
      return null;
    }
  }
}
