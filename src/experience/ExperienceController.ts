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
import type { FocusTelemetry } from "../camera/InstrumentFocusController";
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

export type CameraAxisMapping = "flipped" | "classic"; // "flipped" = Width is Tempo, Height is Volume (DEFAULT)

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
  onCameraAxisMappingChange?: (mapping: CameraAxisMapping) => void;
  onFistCutoffChange?: (isCutoff: boolean) => void;
  onFermataChange?: (isFermata: boolean) => void;
  onPartyModeChange?: (isParty: boolean) => void;
  onLoveModeChange?: (isLove: boolean) => void;
  onFocusChange?: (telemetry: FocusTelemetry) => void;
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

  // Camera Dynamics Mode: "spread" (default for classic mapping) or "height" (in flipped mode)
  private cameraDynamicsMode: "spread" | "height" = "spread";
  // Camera Axis Mapping: "classic" (Width is Dynamics, Height is Tempo - DEFAULT) or "flipped"
  private cameraAxisMapping: CameraAxisMapping = "classic";

  // Gesture-driven expressive states
  private isFistCutoff: boolean = false;
  private isFermata: boolean = false;
  private isPartyMode: boolean = false;
  private isLoveMode: boolean = false;
  private isThumbsUpVFXEnabled: boolean = false; // Feature flag (Default: OFF)
  private isFocusModeEnabled: boolean = true; // Feature flag (Default: ON)

  // Overburn decay timer (for ff/fff dynamic)
  private overburnTimer: ReturnType<typeof setTimeout> | null = null;

  // Hands-down inactivity tracking (pauses within 2 beats in Mode E, 6 beats in Mode D)
  // In Mode E: only true when hands are completely off-screen (samples.length === 0)
  private isHandsDown: boolean = false;
  private handsDownPulseCount: number = 0;

  // Mode E: Gestural Conducting (Intended BPM base + continuous height accelerando)
  private nominalPieceBpm: number = 140;
  private basePieceBpm: number = 140;
  private currentGesturalBpm: number = 140;
  private lastGesturalUpdateMs: number = 0;

  // Per-hand recent Y history for detecting "beating" vs "steady" hands (Mode E)
  // Ring buffer: last N y-values per hand index
  private readonly HAND_Y_HISTORY_LEN = 12; // ~400ms at 30fps
  private handYHistory: Map<number, number[]> = new Map();

  // Lifecycle & Concurrency Guards
  private unsubscribeKeyboard: (() => void) | null = null;
  private completionTimer: ReturnType<typeof setTimeout> | null = null;
  private playbackSessionId: number = 0;
  private startPlaybackPromise: Promise<void> | null = null;
  private cutoffInitiatedPause: boolean = false;
  private isCameraInitializing: boolean = false;

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
      },
      (enabled: boolean) => {
        this.setThumbsUpVFXEnabled(enabled);
      },
      (enabled: boolean) => {
        this.setFocusModeEnabled(enabled);
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
    if (this.completionTimer) {
      clearTimeout(this.completionTimer);
      this.completionTimer = null;
    }
    const currentSession = this.playbackSessionId;
    this.completionTimer = setTimeout(() => {
      if (this.playbackSessionId === currentSession) {
        this.scheduler.stop();
        this.transport.stop();
      }
      this.completionTimer = null;
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
      const beatsPerTap = this.getEffectiveBeatsPerTap();
      this.clock.setBeatsPerTap(beatsPerTap);
      this.transport.setBeatsPerTap(beatsPerTap);

      // Save baseline piece BPM for gestural tempo modulation
      const meta = this.midiScore.getMetadata();
      this.nominalPieceBpm = meta?.embeddedBpm || piece.defaultBpm || 140;
      this.basePieceBpm = this.nominalPieceBpm;
      this.currentGesturalBpm = this.nominalPieceBpm;
      if (this.clock.getTempoMode() === "inertial") {
        this.clock.setPeriodMs((60000 / this.basePieceBpm) * beatsPerTap);
      } else {
        this.clock.setPeriodMs(60000 / this.basePieceBpm);
      }

      // Wire active input provider → clock (cleanly retain exactly 1 subscription)
      if (this.unsubscribeKeyboard) {
        this.unsubscribeKeyboard();
        this.unsubscribeKeyboard = null;
      }
      this.unsubscribeKeyboard = this.keyboardInput.onBeat(obs => this.handleBeatObservation(obs));
      this.keyboardInput.start();

      if (this.cameraInput) {
        this.cameraInput.setSections(piece.sections);
      }
      this.audioEngine.setDefaultSectionPanning(piece.sections);
      this.audioEngine.setSectionFocus(null, 0);

      if (this.inputSource === "camera") {
        try {
          await this.initCamera();
        } catch (err) {
          console.warn("Conductor: camera startup failed during piece load, continuing in keyboard mode", err);
          await this.setInputSource("keyboard");
        }
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
      try {
        await this.initCamera();
      } catch (err) {
        console.warn("Conductor: setInputSource('camera') failed, falling back to keyboard:", err);
        await this.setInputSource("keyboard");
        return;
      }
    } else {
      if (source === this.inputSource && !this.cameraInput) return;
      this.inputSource = "keyboard";
      this.shutdownCameraState();
    }

    this.updateBeatsPerTap();
    const currentBpm = this.clock.getState().bpm || this.basePieceBpm;
    if (this.clock.getTempoMode() === "inertial") {
      this.clock.setPeriodMs((60000 / currentBpm) * this.getEffectiveBeatsPerTap());
    }
    this.uiCallbacks.onInputSourceChange?.(this.inputSource);
  }

  private shutdownCameraState(): void {
    if (this.cameraInput) {
      try {
        this.cameraInput.stop();
      } catch {
        // Ignored
      }
    }
    this.audioEngine.setSectionFocus(null, 0);
    this.uiCallbacks.onFocusChange?.({
      isActive: false,
      state: "idle",
      hoveredSectionId: null,
      grabbedSectionId: null,
      sectionFocus: 0,
      pointerScreenPoint: null,
      pointingHandIndex: null,
      pinchDistanceRatio: 1.0,
    });

    if (this.isFistCutoff) {
      this.isFistCutoff = false;
      this.uiCallbacks.onFistCutoffChange?.(false);
    }
    this.cutoffInitiatedPause = false;

    if (this.isPartyMode) {
      this.isPartyMode = false;
      this.uiCallbacks.onPartyModeChange?.(false);
    }

    if (this.isFermata) {
      this.isFermata = false;
      this.transport.setFermata(false, this.audioEngine.getAudioTime());
      this.uiCallbacks.onFermataChange?.(false);
    }

    this.handYHistory.clear();
    this.isHandsDown = false;
    this.handsDownPulseCount = 0;
  }

  private async initCamera(): Promise<void> {
    if (this.isCameraInitializing) return;
    this.isCameraInitializing = true;

    try {
      if (!this.cameraInput) {
        this.cameraInput = new CameraBeatInputProvider({
          onClose: () => {
            void this.setInputSource("keyboard");
          },
        });
        this.cameraInput.setDynamicsMode(this.cameraDynamicsMode);
        this.cameraInput.setThumbsUpVFXEnabled(this.isThumbsUpVFXEnabled);
        this.cameraInput.setFocusModeEnabled(this.isFocusModeEnabled);
        this.cameraInput.setTempoMode(this.clock.getTempoMode());

        const piece = getPieceById(this.currentPieceId) || REPERTOIRE[0];
        if (piece) {
          this.cameraInput.setSections(piece.sections);
        }

        // Pre-warm / resume AudioContext on camera activation
        try {
          await this.audioEngine.resume();
        } catch {
          // Ignored
        }

        // Wire camera error fallback to keyboard mode
        this.cameraInput.onStateChange((state, err) => {
          if (state === "error") {
            console.warn("Camera failed to load, gracefully falling back to keyboard mode:", err);
            void this.setInputSource("keyboard");
          }
        });

      // Wire camera dynamics directly into existing orchestral dynamic ladder & AudioEngine
      let lastAudioDynUpdateTime = 0;
      let lastAppliedDynamicValue = -1;

      this.cameraInput.onDynamics(dyn => {
        if (this.inputSource === "camera") {
          // Suppress global dynamics if actively in focus mode
          if (this.cameraInput?.getFocusController().shouldSuppressGlobalDynamics()) {
            return;
          }
          const now = performance.now();
          // Rate-limit audio engine continuous dynamics to ~20 Hz (50ms interval) unless large step
          const valDiff = Math.abs(dyn.value - lastAppliedDynamicValue);
          if (now - lastAudioDynUpdateTime >= 50 || valDiff >= 0.05) {
            this.audioEngine.setContinuousDynamic(dyn.value);
            lastAudioDynUpdateTime = now;
            lastAppliedDynamicValue = dyn.value;
          }
          const snappedLevel = this.audioEngine.getDynamicLevel();
          if (snappedLevel !== this.baseDynamicLevel) {
            this.baseDynamicLevel = snappedLevel;
            this.uiCallbacks.onDynamicChange?.(snappedLevel);
            this.debug.updateDynamics(this.audioEngine.getDynamicsTelemetry());
          }
        }
      });

      // Wire Instrument Focus Mode telemetry & dynamic section mixing
      let lastAudioFocusUpdateTime = 0;
      let lastAppliedSectionId: string | null = null;
      let lastAppliedSectionFocus: number = -1;

      this.cameraInput.onFocus(focusTel => {
        if (this.inputSource === "camera") {
          const now = performance.now();
          const isFocused = focusTel.isActive && focusTel.grabbedSectionId && focusTel.sectionFocus > 0.001;
          const targetSectionId = isFocused ? focusTel.grabbedSectionId : null;
          const targetFocusAmount = isFocused ? focusTel.sectionFocus : 0;

          const hasSectionChanged = targetSectionId !== lastAppliedSectionId;
          const hasAmountChanged = Math.abs(targetFocusAmount - lastAppliedSectionFocus) > 0.005;

          if (hasSectionChanged || hasAmountChanged || (now - lastAudioFocusUpdateTime >= 50)) {
            if (targetSectionId && targetFocusAmount > 0.001) {
              const currentPiece = getPieceById(this.currentPieceId) || REPERTOIRE[0];
              const sec = currentPiece?.sections.find(s => s.id === targetSectionId);
              if (sec) {
                this.audioEngine.setSectionFocus(sec.channels, targetFocusAmount);
              }
            } else if (lastAppliedSectionId !== null || lastAppliedSectionFocus > 0.001) {
              this.audioEngine.setSectionFocus(null, 0);
            }
            lastAppliedSectionId = targetSectionId;
            lastAppliedSectionFocus = targetFocusAmount;
            lastAudioFocusUpdateTime = now;
          }

          this.uiCallbacks.onFocusChange?.(focusTel);
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

        const isFocusActive = this.cameraInput?.getFocusController().isFocusModeActive() ?? false;

        if (samples.length > 0 && !isFocusActive) {
          // ── 1. Thumbs Down Cutoff (👎): Dramatically pauses music ──
          const hasThumbDown = samples.some(s => s.gesture === "Thumb_Down");
          if (hasThumbDown) {
            if (!this.isFistCutoff) {
              this.isFistCutoff = true;
              if (this.state === "playing") {
                this.cutoffInitiatedPause = true;
                this.pausePlayback(true);
              } else {
                this.cutoffInitiatedPause = false;
                this.uiCallbacks.onFistCutoffChange?.(true);
              }
            }
          } else if (this.isFistCutoff) {
            this.isFistCutoff = false;
            this.uiCallbacks.onFistCutoffChange?.(false);
            // Auto-resume playback ONLY if thumbs down initiated the pause
            if (this.cutoffInitiatedPause && this.state === "paused") {
              this.cutoffInitiatedPause = false;
              this.startPlayback();
            }
            this.cutoffInitiatedPause = false;
          }

          // ── 2. Double Peace Signs (✌️ + ✌️): Party Mode ──
          const hasDoublePeace = samples.length >= 2 &&
            samples[0].gesture === "Victory" &&
            samples[1].gesture === "Victory";

          if (hasDoublePeace) {
            if (!this.isPartyMode) {
              this.isPartyMode = true;
              this.uiCallbacks.onPartyModeChange?.(true);
            }
          } else if (this.isPartyMode) {
            this.isPartyMode = false;
            this.uiCallbacks.onPartyModeChange?.(false);
          }

          if (this.clock.getTempoMode() === "gestural" && !this.isFistCutoff && !this.isFermata) {
            // Update per-hand Y history for steady-vs-beating detection
            for (const s of samples) {
              let hist = this.handYHistory.get(s.handIndex);
              if (!hist) { hist = []; this.handYHistory.set(s.handIndex, hist); }
              hist.push(s.conductorPoint.y);
              if (hist.length > this.HAND_Y_HISTORY_LEN) hist.shift();
            }

            // Mode E: Auto-start instantly as soon as user raises hands in front of camera
            if (this.state === "ready" || this.state === "paused" || this.state === "completed") {
              const isRaised = samples.some(s => s.conductorPoint.y >= 0.10);
              if (isRaised) {
                if (this.state === "completed") {
                  this.restart();
                }
                this.startPlayback();
              }
            } else if (this.state === "playing") {
              let tempoMultiplier = 1.0;

              if (this.cameraAxisMapping === "flipped") {
                // ── FLIPPED: Horizontal Span (Width) modulates Tempo ──
                // Spreading hands apart -> Accelerando (up to 1.65x piece BPM)
                // Bringing hands together -> Rallentando (down to 0.35x piece BPM)
                if (samples.length >= 2) {
                  const s0 = samples[0];
                  const s1 = samples[1];
                  const centerSpan = Math.abs(s0.conductorPoint.x - s1.conductorPoint.x);

                  // Estimate hand scale from landmarks if available
                  let avgHandSize = 0.10;
                  if (s0.landmarks && s1.landmarks && s0.landmarks.length >= 5 && s1.landmarks.length >= 5) {
                    const xs0 = s0.landmarks.map(p => p.x);
                    const xs1 = s1.landmarks.map(p => p.x);
                    const size0 = Math.max(...xs0) - Math.min(...xs0);
                    const size1 = Math.max(...xs1) - Math.min(...xs1);
                    avgHandSize = (size0 + size1) / 2;
                  }

                  const touchingSpan = Math.max(0.04, avgHandSize * 0.95);
                  const neutralSpan = touchingSpan + 0.18 + avgHandSize * 0.35;
                  const maxSpan = neutralSpan + 0.26 + avgHandSize * 0.40;
                  const DEADBAND = 0.03; // Deadband around resting shoulder width

                  if (centerSpan > neutralSpan + DEADBAND) {
                    const norm = Math.min(1.0, (centerSpan - (neutralSpan + DEADBAND)) / Math.max(0.05, maxSpan - (neutralSpan + DEADBAND)));
                    tempoMultiplier = 1.0 + 0.65 * norm; // [1.00, 1.65]
                  } else if (centerSpan < neutralSpan - DEADBAND) {
                    const norm = Math.min(1.0, ((neutralSpan - DEADBAND) - centerSpan) / Math.max(0.05, (neutralSpan - DEADBAND) - touchingSpan));
                    tempoMultiplier = 1.0 - 0.65 * norm; // [1.00, 0.35]
                  } else {
                    tempoMultiplier = 1.0;
                  }
                } else if (samples.length === 1) {
                  // 1 hand: distance from horizontal center (x=0.50)
                  const dx = Math.abs(samples[0].conductorPoint.x - 0.50);
                  if (dx > 0.25) {
                    tempoMultiplier = 1.0 + 0.65 * Math.min(1.0, (dx - 0.25) / 0.25);
                  } else if (dx < 0.10) {
                    tempoMultiplier = 1.0 - 0.65 * Math.min(1.0, (0.10 - dx) / 0.10);
                  } else {
                    tempoMultiplier = 1.0;
                  }
                }
              } else {
                // ── CLASSIC (DEFAULT): Vertical Height (Y) modulates Tempo ──
                // Raising hands up -> Accelerando (up to 1.65x piece BPM)
                // Lowering hands down -> Rallentando (down to 0.35x piece BPM)
                let effectiveY: number;
                if (samples.length === 2) {
                  const stats = samples.map(s => {
                    const hist = this.handYHistory.get(s.handIndex) ?? [s.conductorPoint.y];
                    const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
                    const variance = hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length;
                    return { y: s.conductorPoint.y, mean, variance };
                  });

                  const [h0, h1] = stats;
                  const h0Beating = h0.variance > 0.0006 && h0.variance > 2.0 * h1.variance;
                  const h1Beating = h1.variance > 0.0006 && h1.variance > 2.0 * h0.variance;

                  if (h0Beating && !h1Beating) {
                    effectiveY = h1.mean;
                  } else if (h1Beating && !h0Beating) {
                    effectiveY = h0.mean;
                  } else {
                    effectiveY = (h0.mean + h1.mean) / 2;
                  }
                } else {
                  const hist = this.handYHistory.get(samples[0].handIndex) ?? [samples[0].conductorPoint.y];
                  effectiveY = hist.reduce((a, b) => a + b, 0) / hist.length;
                }

                const NEUTRAL_Y = 0.40;
                const DEADBAND = 0.03;

                if (effectiveY > NEUTRAL_Y + DEADBAND) {
                  const norm = Math.min(1.0, (effectiveY - (NEUTRAL_Y + DEADBAND)) / (0.85 - (NEUTRAL_Y + DEADBAND)));
                  tempoMultiplier = 1.0 + 0.65 * norm;
                } else if (effectiveY < NEUTRAL_Y - DEADBAND) {
                  const norm = Math.min(1.0, ((NEUTRAL_Y - DEADBAND) - effectiveY) / ((NEUTRAL_Y - DEADBAND) - 0.10));
                  tempoMultiplier = 1.0 - 0.65 * norm;
                } else {
                  tempoMultiplier = 1.0;
                }
              }

              const targetBpm = Math.max(40, Math.min(240, this.basePieceBpm * tempoMultiplier));
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
        } else {
          // No hands detected on screen
          if (this.isFermata) {
            this.isFermata = false;
            this.transport.setFermata(false, this.audioEngine.getAudioTime());
            this.uiCallbacks.onFermataChange?.(false);
          }
        }
      });
      this.cameraInput.setOnClose(() => {
        void this.setInputSource("keyboard");
      });
    }

    try {
      await this.cameraInput.start();
    } catch (err) {
      console.warn("Failed to start camera, falling back to keyboard mode:", err);
      await this.setInputSource("keyboard");
      return;
    }
  } finally {
    this.isCameraInitializing = false;
  }
}

  getInputSource(): InputSource {
    return this.inputSource;
  }

  getCameraProvider(): CameraBeatInputProvider | null {
    return this.cameraInput;
  }

  setCameraAxisMapping(mapping: CameraAxisMapping): void {
    this.cameraAxisMapping = mapping;
    // In flipped mode (default): Height controls Volume -> cameraDynamicsMode = "height"
    // In classic mode: Width controls Volume -> cameraDynamicsMode = "spread"
    const dynamicsMode = mapping === "flipped" ? "height" : "spread";
    this.setCameraDynamicsMode(dynamicsMode);
    this.uiCallbacks.onCameraAxisMappingChange?.(mapping);
  }

  getCameraAxisMapping(): CameraAxisMapping {
    return this.cameraAxisMapping;
  }

  toggleCameraAxisMapping(): CameraAxisMapping {
    const next: CameraAxisMapping = this.cameraAxisMapping === "flipped" ? "classic" : "flipped";
    this.setCameraAxisMapping(next);
    return next;
  }

  setCameraDynamicsMode(mode: "spread" | "height"): void {
    this.cameraDynamicsMode = mode;
    this.cameraAxisMapping = mode === "height" ? "flipped" : "classic";
    if (this.cameraInput) {
      this.cameraInput.setDynamicsMode(mode);
    }
    this.uiCallbacks.onCameraAxisMappingChange?.(this.cameraAxisMapping);
  }

  getCameraDynamicsMode(): "spread" | "height" {
    return this.cameraDynamicsMode;
  }

  async loadPiece(pieceId: string): Promise<void> {
    if (this.completionTimer) {
      clearTimeout(this.completionTimer);
      this.completionTimer = null;
    }
    this.playbackSessionId++;
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
    if (this.completionTimer) {
      clearTimeout(this.completionTimer);
      this.completionTimer = null;
    }
    this.playbackSessionId++;
    this.scheduler.stop();
    this.scheduler.reset();
    this.transport.stop();
    this.clock.reset();
    this.audioEngine.stopAllNotes();
    this.prepTapCount = 0;
    this.pausedBeat = 0;
    this.setState("ready");
  }

  pausePlayback(isCutoff: boolean = false): void {
    if (this.state !== "playing") return;
    if (this.completionTimer) {
      clearTimeout(this.completionTimer);
      this.completionTimer = null;
    }
    this.playbackSessionId++;
    if (!isCutoff) {
      this.cutoffInitiatedPause = false;
    }
    this.pausedBeat = this.transport.getCursorBeat();
    this.scheduler.stop();
    this.scheduler.reset();
    this.transport.stop();
    this.clock.reset();
    this.audioEngine.stopAllNotes();
    this.prepTapCount = 0;
    this.setState("paused");
    this.debug.updatePauseState(true);
    if (isCutoff) {
      this.uiCallbacks.onFistCutoffChange?.(true);
    }
  }

  getIsFistCutoff(): boolean {
    return this.isFistCutoff;
  }

  getIsFermata(): boolean {
    return this.isFermata;
  }

  getIsPartyMode(): boolean {
    return this.isPartyMode;
  }

  getIsLoveMode(): boolean {
    return this.isLoveMode;
  }

  togglePause(): void {
    this.cutoffInitiatedPause = false;
    if (this.state === "playing") {
      this.pausePlayback(false);
    } else if (this.state === "paused" || this.state === "ready" || this.state === "completed") {
      if (this.state === "completed") {
        this.restart();
      }
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

  setThumbsUpVFXEnabled(enabled: boolean): void {
    this.isThumbsUpVFXEnabled = enabled;
    this.cameraInput?.setThumbsUpVFXEnabled(enabled);
  }

  isThumbsUpVFXActive(): boolean {
    return this.isThumbsUpVFXEnabled;
  }

  setFocusModeEnabled(enabled: boolean): void {
    this.isFocusModeEnabled = enabled;
    this.cameraInput?.setFocusModeEnabled(enabled);
  }

  isFocusModeActive(): boolean {
    return this.isFocusModeEnabled;
  }

  async resumeAudio(): Promise<void> {
    await this.audioEngine.resume();
  }

  // ── Beat observation handler ─────────────────────────────────────────────

  private beatSoundEnabled = false; // Off by default — VFX flash still fires on beat
  private lastBeatObservationMs = -1;
  private indicatedBpm = 0;
  private keyboardInactivityPulseCount = 0;

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

  getNominalPieceBpm(): number {
    return this.nominalPieceBpm;
  }

  /**
   * Nudge the Mode E gestural live BPM by deltaBpm.
   * Adjusts target base BPM so the change persists across subsequent camera samples.
   */
  nudgeGesturalBpm(deltaBpm: number): void {
    this.basePieceBpm = Math.max(30, Math.min(240, this.basePieceBpm + deltaBpm));
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
    // If state is completed, reset to ready so conducting restarts cleanly
    if (this.state === "completed") {
      this.restart();
    }

    // Resume AudioContext on first tap if suspended (requires user gesture)
    await this.audioEngine.resume();

    // Reset inactivity counters
    this.keyboardInactivityPulseCount = 0;

    // In Mode E, beating hands triggers instant cymbal cue and visual pulse, but height governs tempo
    if (this.clock.getTempoMode() === "gestural") {
      if (this.beatSoundEnabled) {
        this.audioEngine.playImmediateBeatCymbal();
      }
      this.debug.updateTapAccepted();
      this.uiCallbacks.onBeat();
      this.clock.acceptObservation(obs);

      // In Expressive Mode: Tapping SPACE or pressing key while ready/paused immediately starts/resumes playback!
      if (this.state === "ready" || this.state === "paused") {
        this.startPlayback();
      }
      return;
    }

    // Compute indicated instantaneous BPM with light smoothing (accounting for cut time in Mode D)
    const now = obs.timestampMs;
    const beatsPerTap = this.getEffectiveBeatsPerTap();
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

    // After second tap: clock has calibrated period, start/resume playback with 1-beat lookahead
    if (this.prepTapCount === 2 && this.state === "preparing") {
      this.startPlayback();
    }
  }

  // ── Playback ─────────────────────────────────────────────────────────────

  private async startPlayback(): Promise<void> {
    if (this.state === "playing") return;
    if (this.startPlaybackPromise) {
      return this.startPlaybackPromise;
    }

    this.startPlaybackPromise = (async () => {
      try {
        if (this.completionTimer) {
          clearTimeout(this.completionTimer);
          this.completionTimer = null;
        }
        this.playbackSessionId++;

        try {
          await this.audioEngine.resume();
        } catch {
          // AudioContext resume might fail in non-user-gesture context in some strict browsers
        }

        if (this.state === "playing") return;

        if (this.clock.getTempoMode() === "gestural") {
          this.clock.setPeriodMs(60000 / this.currentGesturalBpm);
          this.clock.startRunningAtCurrentPeriod();
        }

        const clockState = this.clock.getState();
        const periodSec = clockState.periodMs / 1000;
        const nextBeatAudioTime = this.clock.predictNextBeatAudioTime();
        const audioNow = this.audioEngine.getAudioTime();

        // In Beat Mode: 2 prep taps establish tempo (1, 2). Music begins 1 beat later on nextBeatAudioTime
        // with pristine audio attack and zero dropped opening notes.
        // In Gestural Mode: Starts immediately with 60ms audio buffer lead time.
        const isGestural = this.clock.getTempoMode() === "gestural";
        const startAudioTime = isGestural
          ? audioNow + 0.06
          : (nextBeatAudioTime > audioNow + 0.05 ? nextBeatAudioTime : audioNow + periodSec);

        // Start or resume from pausedBeat
        const startBeat = this.pausedBeat;
        const beatsPerTap = this.getEffectiveBeatsPerTap();
        const piece = this.getCurrentPiece();
        const leadInBeats = (startBeat === 0 && piece?.leadInBeats) ? piece.leadInBeats : 0;

        this.transport.start(startBeat, startAudioTime, periodSec, beatsPerTap, leadInBeats);
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
      } finally {
        this.startPlaybackPromise = null;
      }
    })();

    return this.startPlaybackPromise;
  }

  // ── Clock event handler ──────────────────────────────────────────────────

  private handleClockEvent(event: ClockEvent): void {
    switch (event.type) {
      case "beat": {
        const s = event.state;

        // Check inactivity in Keyboard Beat Mode: pause if user stops tapping (after 4 missed beats)
        if (this.inputSource === "keyboard" && this.clock.getTempoMode() === "inertial" && this.state === "playing") {
          this.keyboardInactivityPulseCount++;
          if (this.keyboardInactivityPulseCount >= 4) {
            this.keyboardInactivityPulseCount = 0;
            this.pausePlayback();
            return;
          }
        } else {
          this.keyboardInactivityPulseCount = 0;
        }

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
        this.debug.updateAudioDiagnostics(this.audioEngine.getAudioDiagnostics(), this.scheduler.getDiagnostics());
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

  // ── State ────────────────────────────────────────────────────────────────

  private setState(next: ExperienceState): void {
    this.state = next;
    this.uiCallbacks.onStateChange(next);
  }

  getState(): ExperienceState {
    return this.state;
  }

  updateBeatsPerTap(): void {
    const beatsPerTap = this.getEffectiveBeatsPerTap();
    this.clock.setBeatsPerTap(beatsPerTap);
    this.transport.setBeatsPerTap(beatsPerTap);
  }

  setTempoMode(mode: TempoMode): void {
    this.clock.setTempoMode(mode);
    this.debug.updateTempoMode(mode);
    if (this.cameraInput) {
      this.cameraInput.setTempoMode(mode);
    }
    this.updateBeatsPerTap();
    const beatsPerTap = this.getEffectiveBeatsPerTap();

    if (mode === "gestural") {
      this.clock.setPeriodMs(60000 / this.basePieceBpm);
    } else if (mode === "inertial") {
      this.clock.setPeriodMs((60000 / this.basePieceBpm) * beatsPerTap);
    }
  }

  startAutoplayInTempo(): void {
    this.setTempoMode("autoplay");
    this.clock.setPeriodMs(60000 / this.basePieceBpm);
    if (this.state === "completed") {
      this.restart();
    }
    if (this.state === "ready" || this.state === "paused") {
      this.startPlayback();
    }
  }

  getEffectiveBeatsPerTap(): number {
    // In Keyboard mode, conductor taps every single quarter note beat (1 tap = 1 beat)
    if (this.inputSource === "keyboard") {
      return 1;
    }
    // In Camera mode, Beat Mode (inertial) conducts in cut time (1 stroke = 2 beats)
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

  getCurrentPieceId(): string {
    return this.currentPieceId;
  }

  getMidiMetadata() {
    try {
      return this.midiScore.getMetadata();
    } catch {
      return null;
    }
  }
}
