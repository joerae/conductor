/**
 * ExperienceController.ts
 *
 * Coordinates user interaction, clock, transport, and audio scheduling.
 * Provides the top-level API consumed by the UI layer (main.ts).
 */

import { AudioEngine } from "../audio/AudioEngine";
import type { DSPBypassFlags, DynamicsTelemetry, DynamicLevel } from "../audio/dynamicsTypes";
import { getStepDynamicLevel } from "../audio/dynamicsTypes";
import { ConductorClock } from "../clock/ConductorClock";
import type { ClockEvent, TempoMode } from "../clock/ConductorClock";
import { KeyboardBeatInput } from "../input/KeyboardBeatInput";
import { CameraBeatInputProvider } from "../camera/CameraBeatInputProvider";
import { MidiScore } from "../score/MidiScore";
import { ScoreTransport } from "../score/ScoreTransport";
import { Scheduler } from "../scheduler/Scheduler";
import type { NotePlaybackEvent } from "../scheduler/Scheduler";
import { DebugOverlay } from "../ui/DebugOverlay";
import { DEFAULT_PIECE_ID, getPieceById, REPERTOIRE } from "../score/repertoire";
import type { PieceDefinition } from "../score/repertoire";
import type { VelocityDecomposition } from "../audio/dynamicsTypes";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExperienceState =
  | "uninitialized"
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

export type UICallbacks = {
  onStateChange: (state: ExperienceState) => void;
  onBeat: () => void;
  onNoteVisual?: (event: NoteVisualEvent) => void;
  onDynamicChange?: (level: DynamicLevel) => void;
  onAccentFlash?: () => void;
  onAccentArmed?: (armed: boolean) => void;
  onInputSourceChange?: (source: InputSource) => void;
};

// ─── ExperienceController ───────────────────────────────────────────────────

export class ExperienceController {
  private state: ExperienceState = "uninitialized";
  private currentPieceId: string = DEFAULT_PIECE_ID;
  private inputSource: InputSource = "camera";

  // Subsystems
  private readonly audioEngine: AudioEngine;
  private readonly clock: ConductorClock;
  private readonly keyboardInput: KeyboardBeatInput;
  private cameraInput: CameraBeatInputProvider | null = null;
  private readonly midiScore: MidiScore;
  private readonly transport: ScoreTransport;
  private readonly scheduler: Scheduler;
  private readonly debug: DebugOverlay;

  private readonly uiCallbacks: UICallbacks;
  private prepTapCount: number = 0;
  private pausedBeat: number = 0;

  // Sustained conductor dynamic level
  private baseDynamicLevel: DynamicLevel = "mf";

  // Camera Dynamics Mode: "spread" (default) or "height"
  private cameraDynamicsMode: "spread" | "height" = "spread";

  // Overburn decay timer (for ff/fff dynamic)
  private overburnTimer: ReturnType<typeof setTimeout> | null = null;

  // Hands-down inactivity tracking (pauses within 2 beats in Mode E, 6 beats in Mode D)
  // In Mode E: only true when hands are completely off-screen (samples.length === 0)
  private isHandsDown: boolean = false;
  private handsDownPulseCount: number = 0;

  // Mode E: Gestural Conducting (Intended BPM base + continuous height accelerando)
  private basePieceBpm: number = 140;
  private currentGesturalBpm: number = 140;
  private lastGesturalUpdateMs: number = 0;

  // Per-hand recent Y history for detecting "beating" vs "steady" hands (Mode E)
  // Ring buffer: last N y-values per hand index
  private readonly HAND_Y_HISTORY_LEN = 12; // ~400ms at 30fps
  private handYHistory: Map<number, number[]> = new Map();

  constructor(callbacks: UICallbacks) {
    this.uiCallbacks = callbacks;
    this.audioEngine = new AudioEngine();

    // Clock uses AudioEngine's time function for audio scheduling
    this.clock = new ConductorClock({
      getAudioTime: () => this.audioEngine.getAudioTime(),
      initialMode: "gestural", // Default to Mode E: Gestural Conducting
    });

    // Wire debug overlay with A/B DSP bypass control, pause toggle, macro ratio slider, camera dynamics mode, beat sound cue, and jitter deadband
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
      },
      (mode: "spread" | "height") => {
        this.setCameraDynamicsMode(mode);
      },
      (enabled: boolean) => {
        this.setBeatSoundEnabled(enabled);
      },
      (deadbandRatio: number) => {
        this.clock.setTempoDeadband(deadbandRatio);
      },
      (mode: TempoMode) => {
        this.setTempoMode(mode);
        this.uiCallbacks.onStateChange(this.state);
      },
      () => {
        this.startAutoplayInTempo();
      }
    );

    this.keyboardInput = new KeyboardBeatInput();
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

    this.debug.updateLastNoteDecomp(decomp, String(event.trackId));

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
      const beatsPerTap = this.clock.getTempoMode() === "inertial" ? 2 : (piece.beatsPerTap || 1);
      this.clock.setBeatsPerTap(beatsPerTap);
      this.transport.setBeatsPerTap(beatsPerTap);

      // Save baseline piece BPM for gestural tempo modulation
      const meta = this.midiScore.getMetadata();
      this.basePieceBpm = meta?.embeddedBpm || piece.defaultBpm || 140;
      this.currentGesturalBpm = this.basePieceBpm;
      if (this.clock.getTempoMode() === "inertial") {
        this.clock.setPeriodMs((60000 / this.basePieceBpm) * beatsPerTap);
      } else {
        this.clock.setPeriodMs(60000 / this.basePieceBpm);
      }

      // Wire active input provider → clock
      this.keyboardInput.onBeat(obs => this.handleBeatObservation(obs));
      this.keyboardInput.start();

      if (this.inputSource === "camera") {
        await this.initCamera();
      }

      this.prepTapCount = 0;
      this.pausedBeat = 0;
      this.setState("ready");
    } catch (err) {
      console.error("Conductor: failed to load piece", err);
      throw err;
    }
  }

  async setInputSource(source: InputSource): Promise<void> {
    if (source === "camera") {
      this.inputSource = "camera";
      this.setTempoMode("gestural");
      await this.initCamera();
    } else {
      if (source === this.inputSource && !this.cameraInput) return;
      this.inputSource = "keyboard";
      if (this.clock.getTempoMode() === "inertial" || this.clock.getTempoMode() === "gestural") {
        this.setTempoMode("balanced");
      }
      if (this.cameraInput) {
        this.cameraInput.stop();
      }
    }

    this.uiCallbacks.onInputSourceChange?.(this.inputSource);
  }

  private async initCamera(): Promise<void> {
    if (!this.cameraInput) {
      this.cameraInput = new CameraBeatInputProvider();
      this.cameraInput.setDynamicsMode(this.cameraDynamicsMode);
      // Wire camera dynamics directly into existing orchestral dynamic ladder & AudioEngine
      this.cameraInput.onDynamics(dyn => {
        if (this.inputSource === "camera") {
          // Use continuous 0-1 value for smooth interpolated DSP; discrete level is derived internally
          this.audioEngine.setContinuousDynamic(dyn.value);
          const snappedLevel = this.audioEngine.getDynamicLevel();
          this.baseDynamicLevel = snappedLevel;
          this.uiCallbacks.onDynamicChange?.(snappedLevel);
          this.debug.updateDynamics(this.audioEngine.getDynamicsTelemetry());
        }
      });
      // Wire camera telemetry into debug overlay
      this.cameraInput.onTelemetry(t => {
        this.debug.updateCameraTelemetry(t);
      });
      // Wire camera beat observations into clock
      this.cameraInput.onBeat(obs => this.handleBeatObservation(obs));
      // Wire sample tracking for hands-down detection & Mode E continuous height tempo
      this.cameraInput.onSamples(samples => {
        // In Mode E: only pause when hands are completely off-screen.
        // Low hand position = rallentando, NOT a stop signal.
        this.isHandsDown = samples.length === 0;

        if (samples.length > 0) {
          if (this.clock.getTempoMode() === "gestural") {
            // Update per-hand Y history for steady-vs-beating detection
            for (const s of samples) {
              let hist = this.handYHistory.get(s.handIndex);
              if (!hist) { hist = []; this.handYHistory.set(s.handIndex, hist); }
              hist.push(s.conductorPoint.y);
              if (hist.length > this.HAND_Y_HISTORY_LEN) hist.shift();
            }

            // Determine effective tempo-control Y using steady-hand filtering:
            // If one hand is "beating" (high Y variance) and one is "steady",
            // use ONLY the steady hand's smoothed mean Y for tempo to prevent beating
            // motion from modulating speed.
            let effectiveY: number;
            if (samples.length === 2) {
              const stats = samples.map(s => {
                const hist = this.handYHistory.get(s.handIndex) ?? [s.conductorPoint.y];
                const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
                const variance = hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length;
                return { y: s.conductorPoint.y, mean, variance };
              });

              const [h0, h1] = stats;
              // Hand is beating if its Y variance is notably higher than the other (> 2.0x ratio & > 0.0006 abs variance)
              const h0Beating = h0.variance > 0.0006 && h0.variance > 2.0 * h1.variance;
              const h1Beating = h1.variance > 0.0006 && h1.variance > 2.0 * h0.variance;

              if (h0Beating && !h1Beating) {
                // Hand 0 is beating, hand 1 is steady — use hand 1's smooth mean position
                effectiveY = h1.mean;
              } else if (h1Beating && !h0Beating) {
                // Hand 1 is beating, hand 0 is steady — use hand 0's smooth mean position
                effectiveY = h0.mean;
              } else {
                // Both steady or both beating — use average of smooth means
                effectiveY = (h0.mean + h1.mean) / 2;
              }
            } else {
              const hist = this.handYHistory.get(samples[0].handIndex) ?? [samples[0].conductorPoint.y];
              effectiveY = hist.reduce((a, b) => a + b, 0) / hist.length;
            }

            // Mode E: Auto-start as soon as user moves or raises hands from resting position
            if (this.state === "ready" || this.state === "paused") {
              const isMovingOrRaised = samples.some(s => {
                const hist = this.handYHistory.get(s.handIndex);
                if (!hist || hist.length < 2) return s.conductorPoint.y >= 0.20;
                const dy = Math.abs(s.conductorPoint.y - hist[0]);
                return s.conductorPoint.y >= 0.22 || dy > 0.02;
              });

              if (isMovingOrRaised) {
                this.startPlayback();
              }
            } else if (this.state === "playing") {
              // Continuous Height Modulation for Accelerando / Rallentando:
              // Hands comfortably in front of body ~0.40 -> 1.0x intended piece BPM (Dead center of Green Zone)
              // Raising hands up to 0.85 -> 1.65x intended piece BPM
              // Lowering hands down to 0.10 -> 0.35x intended piece BPM (Largo)
              let heightMultiplier = 1.0;
              const NEUTRAL_Y = 0.40;
              const DEADBAND = 0.03; // [0.37, 0.43] holds exact middle of green zone

              if (effectiveY > NEUTRAL_Y + DEADBAND) {
                const norm = Math.min(1.0, (effectiveY - (NEUTRAL_Y + DEADBAND)) / (0.85 - (NEUTRAL_Y + DEADBAND)));
                heightMultiplier = 1.0 + 0.65 * norm;
              } else if (effectiveY < NEUTRAL_Y - DEADBAND) {
                const norm = Math.min(1.0, ((NEUTRAL_Y - DEADBAND) - effectiveY) / ((NEUTRAL_Y - DEADBAND) - 0.10));
                heightMultiplier = 1.0 - 0.65 * norm;
              } else {
                heightMultiplier = 1.0;
              }

              const targetBpm = Math.max(40, Math.min(240, this.basePieceBpm * heightMultiplier));
              const now = performance.now();
              if (this.lastGesturalUpdateMs === 0) this.lastGesturalUpdateMs = now;
              const dt = Math.max(0.005, (now - this.lastGesturalUpdateMs) / 1000);
              this.lastGesturalUpdateMs = now;

              // Smooth slew interpolation (~350ms time constant)
              const alpha = 1 - Math.exp(-dt / 0.35);
              this.currentGesturalBpm += alpha * (targetBpm - this.currentGesturalBpm);

              this.clock.setBpm(this.currentGesturalBpm);
              this.indicatedBpm = Math.round(this.currentGesturalBpm);

              // Update transport period in real-time
              this.transport.updatePeriod(
                this.audioEngine.getAudioTime(),
                60 / this.currentGesturalBpm,
                0
              );
            }
          }
        }
      });
    }

    await this.cameraInput.start();
  }

  getInputSource(): InputSource {
    return this.inputSource;
  }

  getCameraProvider(): CameraBeatInputProvider | null {
    return this.cameraInput;
  }

  setCameraDynamicsMode(mode: "spread" | "height"): void {
    this.cameraDynamicsMode = mode;
    if (this.cameraInput) {
      this.cameraInput.setDynamicsMode(mode);
    }
  }

  getCameraDynamicsMode(): "spread" | "height" {
    return this.cameraDynamicsMode;
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

  private beatSoundEnabled = false; // Off by default — VFX flash still fires on beat
  private lastBeatObservationMs = -1;
  private indicatedBpm = 0;

  setBeatSoundEnabled(enabled: boolean): void {
    this.beatSoundEnabled = enabled;
  }

  isBeatSoundEnabled(): boolean {
    return this.beatSoundEnabled;
  }

  getIndicatedBpm(): number {
    return this.indicatedBpm > 0 ? this.indicatedBpm : this.clock.getState().bpm;
  }

  getBasePieceBpm(): number {
    return this.basePieceBpm;
  }

  /**
   * Nudge the Mode E gestural base BPM by deltaBpm.
   * This shifts the "neutral height" reference point so the whole accelerando
   * range shifts up or down. Clamped to [30, 240].
   */
  nudgeGesturalBpm(deltaBpm: number): void {
    this.basePieceBpm = Math.max(30, Math.min(240, this.basePieceBpm + deltaBpm));
    // Immediately apply to current gestural BPM with a gentle nudge
    this.currentGesturalBpm = Math.max(30, Math.min(240, this.currentGesturalBpm + deltaBpm));
    this.clock.setBpm(this.currentGesturalBpm);
    this.indicatedBpm = Math.round(this.currentGesturalBpm);
    this.transport.updatePeriod(this.audioEngine.getAudioTime(), 60 / this.currentGesturalBpm, 0);
  }

  private async handleBeatObservation(obs: {
    timestampMs: number;
    source: "keyboard" | "camera";
    confidence: number;
  }): Promise<void> {
    // Resume AudioContext on first tap if suspended (requires user gesture)
    await this.audioEngine.resume();

    // In Mode E, beating hands triggers instant cymbal cue and visual pulse, but height governs tempo
    if (this.clock.getTempoMode() === "gestural") {
      if (this.beatSoundEnabled) {
        this.audioEngine.playImmediateBeatCymbal();
      }
      this.debug.updateTapAccepted();
      this.uiCallbacks.onBeat();
      this.clock.acceptObservation(obs);
      return;
    }

    // Compute indicated instantaneous BPM with light smoothing (accounting for cut time in Mode D)
    const now = obs.timestampMs;
    const piece = this.getCurrentPiece();
    const beatsPerTap = this.clock.getTempoMode() === "inertial" ? 2 : (piece?.beatsPerTap || 1);
    if (this.lastBeatObservationMs > 0) {
      const dtMs = now - this.lastBeatObservationMs;
      if (dtMs >= 100 && dtMs <= 3000) {
        const instantBpm = (60000 / dtMs) * beatsPerTap;
        this.indicatedBpm = this.indicatedBpm > 0
          ? this.indicatedBpm * 0.55 + instantBpm * 0.45
          : instantBpm;
      }
    }
    this.lastBeatObservationMs = now;

    // If beat sound debug cue is active, play cymbal immediately with zero latency
    if (this.beatSoundEnabled) {
      this.audioEngine.playImmediateBeatCymbal();
    }

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
    if (this.clock.getTempoMode() === "gestural") {
      this.clock.setPeriodMs(60000 / this.currentGesturalBpm);
      this.clock.startRunningAtCurrentPeriod();
    }

    const clockState = this.clock.getState();
    const periodSec = clockState.periodMs / 1000;
    const nextBeatAudioTime = this.clock.predictNextBeatAudioTime();
    const audioNow = this.audioEngine.getAudioTime();
    const piece = this.getCurrentPiece();

    // In Mode E (Gestural): Start IMMEDIATELY on hand gesture, zero lead-in delay
    const isGestural = this.clock.getTempoMode() === "gestural";
    const leadInBeats = isGestural ? 0 : (piece.leadInBeats ?? 0);
    const startAudioTime = isGestural
      ? Math.max(audioNow + 0.03, nextBeatAudioTime)
      : nextBeatAudioTime + leadInBeats * periodSec;

    // Start or resume from pausedBeat
    const startBeat = this.pausedBeat;
    const beatsPerTap = this.clock.getTempoMode() === "inertial" ? 2 : (piece.beatsPerTap || 1);
    this.transport.start(startBeat, startAudioTime, periodSec, beatsPerTap);
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

        // Check hands-down inactivity in camera mode:
        // In Mode E: pause within 2 beats of dropping hands
        // In Mode D: pause after 6 beats of dropping hands
        if (this.inputSource === "camera" && this.state === "playing") {
          if (this.isHandsDown) {
            this.handsDownPulseCount++;
            const maxSilentBeats = this.clock.getTempoMode() === "gestural" ? 2 : 6;
            if (this.handsDownPulseCount >= maxSilentBeats) {
              this.handsDownPulseCount = 0;
              this.pausePlayback();
              return;
            }
          } else {
            this.handsDownPulseCount = 0;
          }
        } else {
          this.handsDownPulseCount = 0;
        }

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
        this.pausePlayback();
        break;
    }
  }

  /**
   * Pauses the orchestra smoothly at the current beat position, awaiting further conducting input.
   */
  pausePlayback(): void {
    this.pausedBeat = this.transport.getCursorBeat();
    this.clock.reset();
    this.scheduler.stop();
    this.scheduler.reset();
    this.transport.stop();
    this.audioEngine.stopAllNotes();
    this.prepTapCount = 0;
    this.handsDownPulseCount = 0;
    this.setState("paused");
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
    const piece = this.getCurrentPiece();
    const beatsPerTap = mode === "inertial" ? 2 : (piece?.beatsPerTap || 1);
    this.clock.setBeatsPerTap(beatsPerTap);
    this.transport.setBeatsPerTap(beatsPerTap);

    if (mode === "gestural") {
      this.clock.setPeriodMs(60000 / this.basePieceBpm);
    } else if (mode === "inertial") {
      this.clock.setPeriodMs((60000 / this.basePieceBpm) * beatsPerTap);
    }
  }

  startAutoplayInTempo(): void {
    this.setTempoMode("autoplay");
    this.clock.setPeriodMs(60000 / this.basePieceBpm);
    if (this.state === "ready" || this.state === "paused") {
      this.startPlayback();
    }
  }

  getEffectiveBeatsPerTap(): number {
    const piece = this.getCurrentPiece();
    return this.clock.getTempoMode() === "inertial" ? 2 : (piece?.beatsPerTap || 1);
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
