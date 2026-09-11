/**
 * ExperienceController.ts
 *
 * Coordinates user interaction, clock, transport, and audio scheduling.
 * Provides the top-level API consumed by the UI layer (main.ts).
 */

import { AudioEngine } from "../audio/AudioEngine";
import type { DSPBypassFlags, DynamicsTelemetry, DynamicLevel, VelocityDecomposition } from "../audio/dynamicsTypes";
import { getStepDynamicLevel } from "../audio/dynamicsTypes";
import { ConductorClock } from "../clock/ConductorClock";
import type { ClockEvent, TempoMode } from "../clock/ConductorClock";
import { KeyboardBeatInput } from "../input/KeyboardBeatInput";
import { CameraBeatInputProvider } from "../camera/CameraBeatInputProvider";
import type { FocusTelemetry } from "../camera/InstrumentFocusController";
import type { MagicFingerTelemetry } from "../camera/MagicFingerController";
import type { HandSample } from "../camera/cameraTypes";
import { MidiScore } from "../score/MidiScore";
import { ScoreTransport } from "../score/ScoreTransport";
import { Scheduler } from "../scheduler/Scheduler";
import type { NotePlaybackEvent } from "../scheduler/Scheduler";
import { DebugOverlay } from "../ui/DebugOverlay";
import { DEFAULT_PIECE_ID, getPieceById, REPERTOIRE } from "../score/repertoire";
import type { PieceDefinition } from "../score/repertoire";
import { LoadingCoordinator } from "../warmup/LoadingCoordinator";
import { setGaugeBpmRange, initBpmGaugeTicks } from "../ui/bpmGauge";

import type { CameraAxisMapping } from "./gesturalTempoMath";
import { calculateGesturalTempoMultiplier } from "./gesturalTempoMath";
import { resetCameraGestureState } from "./cameraGestureHandler";
import { wireCameraProvider } from "./cameraWiring";
import type { CameraWiringHost } from "./cameraWiring";
import {
  startPlayback,
  pausePlayback,
  restartPlayback,
  handlePieceComplete,
  handleClockEvent,
  handleBeatObservation,
} from "./playbackCoordinator";
import type { PlaybackHost } from "./playbackCoordinator";

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

export type { CameraAxisMapping } from "./gesturalTempoMath";

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
  onMagicFinger?: (telemetry: MagicFingerTelemetry) => void;
  onAudioReady?: (ctx: AudioContext) => void;
  onCameraMotionSample?: (sample: {
    tempoBpm?: number;
    dynamicLevel?: string;
    dynamicContinuous?: number;
    isHandsRaised?: boolean;
    handPoints?: { x: number; y: number }[];
  }) => void;
};

// ─── ExperienceController ───────────────────────────────────────────────────

export class ExperienceController implements CameraWiringHost, PlaybackHost {
  state: ExperienceState = "uninitialized";
  currentPieceId: string = DEFAULT_PIECE_ID;
  inputSource: InputSource = "camera";

  // Subsystems
  readonly audioEngine: AudioEngine;
  readonly clock: ConductorClock;
  readonly keyboardInput: KeyboardBeatInput;
  cameraInput: CameraBeatInputProvider | null = null;
  readonly midiScore: MidiScore;
  readonly transport: ScoreTransport;
  readonly scheduler: Scheduler;
  readonly debug: DebugOverlay;

  readonly uiCallbacks: UICallbacks;
  prepTapCount: number = 0;
  pausedBeat: number = 0;

  // Sustained conductor dynamic level
  baseDynamicLevel: DynamicLevel = "mf";

  // Camera Dynamics Mode: "spread" (default for classic mapping) or "height" (in flipped mode)
  cameraDynamicsMode: "spread" | "height" = "spread";
  // Camera Axis Mapping: "classic" (Width is Dynamics, Height is Tempo - DEFAULT) or "flipped"
  cameraAxisMapping: CameraAxisMapping = "classic";

  // Gesture-driven expressive states
  isFistCutoff: boolean = false;
  isFermata: boolean = false;
  isPartyMode: boolean = false;
  isLoveMode: boolean = false;
  isThumbsUpVFXEnabled: boolean = false; // Feature flag (Default: OFF)
  isFocusModeEnabled: boolean = true; // Feature flag (Default: ON)
  isScoreVisualizerEnabled: boolean = true; // Feature flag (Default: ON)
  isWarmupFeatureEnabled: boolean = false; // Feature flag (Default: OFF for now)

  // Overburn decay timer (for ff/fff dynamic)
  private overburnTimer: ReturnType<typeof setTimeout> | null = null;

  // Hands-down inactivity tracking
  isHandsDown: boolean = false;
  handsDownPulseCount: number = 0;
  magicNoHandsStartTime: number = 0;

  // Mode E: Gestural Conducting
  nominalPieceBpm: number = 140;
  basePieceBpm: number = 140;
  currentGesturalBpm: number = 140;
  lastGesturalUpdateMs: number = 0;

  // Per-hand recent Y history for detecting "beating" vs "steady" hands (Mode E)
  readonly HAND_Y_HISTORY_LEN = 12; // ~400ms at 30fps
  handYHistory: Map<number, number[]> = new Map();

  // Lifecycle & Concurrency Guards
  private unsubscribeKeyboard: (() => void) | null = null;
  completionTimer: ReturnType<typeof setTimeout> | null = null;
  playbackSessionId: number = 0;
  startPlaybackPromise: Promise<void> | null = null;
  cutoffInitiatedPause: boolean = false;
  isCameraInitializing: boolean = false;
  isWarmingUp: boolean = false;

  activeCoordinator: LoadingCoordinator | null = null;

  constructor(callbacks: UICallbacks) {
    this.uiCallbacks = callbacks;
    this.audioEngine = new AudioEngine();

    // Restore feature flag preference from localStorage if available
    try {
      if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem("conductor_feature_score_visualizer");
        if (saved !== null) {
          this.isScoreVisualizerEnabled = saved === "true";
        }
        const savedWarmup = localStorage.getItem("conductor_feature_warmup");
        if (savedWarmup !== null) {
          this.isWarmupFeatureEnabled = savedWarmup === "true";
        }
      }
    } catch {
      // Ignore storage errors in restricted contexts
    }

    // Clock uses AudioEngine's time function for audio scheduling
    this.clock = new ConductorClock({
      getAudioTime: () => this.audioEngine.getAudioTime(),
      initialMode: "gestural", // Default to Mode: Expressive (Mode E)
    });
    this.clock.setBpm(this.nominalPieceBpm);
    this.clock.setPeriodMs(60000 / this.nominalPieceBpm);

    // Wire debug overlay
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
      },
      (enabled: boolean) => {
        this.setScoreVisualizerEnabled(enabled);
      }
    );

    this.debug.setScoreVisualizerCheckbox(this.isScoreVisualizerEnabled);

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

  // ── Lifecycle & Repertoire ────────────────────────────────────────────────

  getAudioEngine(): AudioEngine {
    return this.audioEngine;
  }

  isWarmupActive(): boolean {
    return this.isWarmingUp;
  }

  isWarmupEnabled(): boolean {
    return this.isWarmupFeatureEnabled;
  }

  setWarmupEnabled(enabled: boolean): void {
    this.isWarmupFeatureEnabled = enabled;
  }

  startConducting(): void {
    this.isWarmingUp = false;
    this.currentGesturalBpm = this.nominalPieceBpm;
    this.clock.setBpm(this.nominalPieceBpm);
    this.indicatedBpm = Math.round(this.nominalPieceBpm);
    this.baseDynamicLevel = "mf";
    this.audioEngine.setDynamicLevel("mf");
    this.prepTapCount = 0;
    this.pausedBeat = 0;
    this.setState("ready");
    this.uiCallbacks.onStateChange?.("ready");
    this.uiCallbacks.onDynamicChange?.("mf");
  }

  private applyPieceMetadata(piece: PieceDefinition): void {
    this.transport.setEvents(this.midiScore.getEvents(), this.midiScore.getMetadata().totalBeats);
    const beatsPerTap = this.getEffectiveBeatsPerTap();
    this.clock.setBeatsPerTap(beatsPerTap);
    this.transport.setBeatsPerTap(beatsPerTap);
    this.pausedBeat = piece.startBeat ?? 0;

    const minBpm = piece.minBpm ?? 40;
    const maxBpm = piece.maxBpm ?? 220;
    setGaugeBpmRange(minBpm, maxBpm);
    this.clock.setBpmRange(minBpm - 20, maxBpm + 20);
    if (typeof document !== "undefined") {
      initBpmGaugeTicks();
    }

    const meta = this.midiScore.getMetadata();
    this.nominalPieceBpm = meta?.embeddedBpm || piece.defaultBpm || 140;
    this.basePieceBpm = this.nominalPieceBpm;
    this.currentGesturalBpm = this.nominalPieceBpm;
    this.indicatedBpm = Math.round(this.nominalPieceBpm);
    this.clock.setBpm(this.nominalPieceBpm);
    if (this.clock.getTempoMode() === "inertial") {
      this.clock.setPeriodMs((60000 / this.basePieceBpm) * beatsPerTap);
    } else {
      this.clock.setPeriodMs(60000 / this.basePieceBpm);
    }

    if (this.unsubscribeKeyboard) {
      this.unsubscribeKeyboard();
      this.unsubscribeKeyboard = null;
    }
    this.unsubscribeKeyboard = this.keyboardInput.onBeat(obs => this.handleBeatObservation(obs));
    this.keyboardInput.start();

    if (this.cameraInput) {
      this.cameraInput.setSections(piece.sections);
      this.cameraInput.setIndicatedBpm(this.indicatedBpm);
      this.cameraInput.getMagicFingerController().setInitialBpm(this.indicatedBpm);
    }
    this.audioEngine.setDefaultSectionPanning(piece.sections);
    this.audioEngine.setSectionFocus(null, 0);
  }

  async load(
    pieceId: string = DEFAULT_PIECE_ID,
    coordinator?: LoadingCoordinator
  ): Promise<void> {
    if (coordinator) {
      return this.loadWithCoordinator(coordinator, pieceId);
    }

    this.isWarmingUp = false;
    this.setState("loading");
    this.currentPieceId = pieceId;
    const piece = getPieceById(pieceId) || REPERTOIRE[0];

    try {
      await Promise.all([
        this.midiScore.load(piece.midiUrl, piece.trackPrograms, piece.velocityScale),
        this.audioEngine.loadPieceSamples(piece).catch(err =>
          console.warn("Conductor: piece sample loading failed, using fallback click", err)
        ),
      ]);
      this.applyPieceMetadata(piece);

      if (this.inputSource === "camera") {
        try {
          await this.initCamera();
        } catch (err) {
          console.warn("Conductor: camera startup failed during piece load, continuing in keyboard mode", err);
          await this.setInputSource("keyboard");
        }
      }

      this.prepTapCount = 0;
      this.pausedBeat = piece.startBeat ?? 0;
      this.setState("ready");
    } catch (err) {
      console.error("Conductor: failed to load piece", err);
      throw err;
    }
  }

  async loadWithCoordinator(
    coordinator: LoadingCoordinator,
    pieceId: string = DEFAULT_PIECE_ID
  ): Promise<void> {
    this.isWarmingUp = this.isWarmupFeatureEnabled;
    this.activeCoordinator = coordinator;
    this.setState("loading");
    this.currentPieceId = pieceId;
    const piece = getPieceById(pieceId) || REPERTOIRE[0];

    coordinator.updateTask("shell", "ready");

    coordinator.updateTask("warmupViolin", "loading");
    const violinPromise = this.audioEngine.loadWarmupViolin()
      .then(() => coordinator.updateTask("warmupViolin", "ready"))
      .catch(err => {
        console.warn("Warm-up violin load warning:", err);
        coordinator.updateTask("warmupViolin", "ready");
      });

    coordinator.updateTask("score", "loading");
    const scorePromise = this.midiScore.load(piece.midiUrl, piece.trackPrograms, piece.velocityScale)
      .then(() => {
        this.applyPieceMetadata(piece);
        coordinator.updateTask("score", "ready");
      })
      .catch(err => {
        coordinator.updateTask("score", "error");
        throw err;
      });

    coordinator.updateTask("instruments", "loading");
    const instrumentsPromise = this.audioEngine.loadPieceSamples(piece)
      .then(() => {
        coordinator.updateTask("instruments", "ready");
        this.audioEngine.preloadRemainingSamples();
      })
      .catch(err => {
        console.warn("Piece instruments load warning, using click/synth fallback:", err);
        coordinator.updateTask("instruments", "ready");
      });

    let cameraPromise = Promise.resolve();
    if (this.inputSource === "camera") {
      coordinator.updateTask("cameraPermission", "loading");
      cameraPromise = this.initCamera().catch(err => {
        console.warn("Camera init failed during warmup, continuing with keyboard:", err);
        coordinator.updateTask("cameraPermission", "error");
        coordinator.updateTask("handTracking", "error");
      });
    }

    await Promise.all([violinPromise, scorePromise, instrumentsPromise, cameraPromise]);

    this.prepTapCount = 0;
    this.pausedBeat = piece.startBeat ?? 0;
    if (!this.isWarmupFeatureEnabled) {
      this.isWarmingUp = false;
    }
    this.setState("ready");
  }

  async setInputSource(source: InputSource): Promise<void> {
    if (source === "camera") {
      this.inputSource = "camera";
      if (this.clock.getTempoMode() !== "gestural" && this.clock.getTempoMode() !== "magic") {
        this.setTempoMode("gestural");
      }
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
    resetCameraGestureState(this);
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
        this.cameraInput.setIndicatedBpm(this.indicatedBpm || this.nominalPieceBpm);
        this.cameraInput.getMagicFingerController().setInitialBpm(this.indicatedBpm || this.nominalPieceBpm);

        const piece = this.getCurrentPiece();
        if (piece) {
          this.cameraInput.setSections(piece.sections);
        }

        // Pre-warm AudioContext on camera activation asynchronously
        void this.audioEngine.resume().then(() => {
          const ctx = this.audioEngine.getAudioContext();
          if (ctx) {
            this.uiCallbacks.onAudioReady?.(ctx);
          }
        }).catch(() => {
          // Ignored
        });

        wireCameraProvider(this.cameraInput, this);
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

  calculateGesturalTempoMultiplier(samples: HandSample[]): number {
    return calculateGesturalTempoMultiplier(samples, this.cameraAxisMapping, this.handYHistory);
  }

  getInputSource(): InputSource {
    return this.inputSource;
  }

  getCameraProvider(): CameraBeatInputProvider | null {
    return this.cameraInput;
  }

  setCameraAxisMapping(mapping: CameraAxisMapping): void {
    this.cameraAxisMapping = mapping;
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
    restartPlayback(this);
  }

  pausePlayback(isCutoff: boolean = false): void {
    pausePlayback(this, isCutoff);
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
      void this.startPlayback();
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
    this.audioEngine.triggerAccentBurst(Math.max(380, periodMs * 0.95));
    this.uiCallbacks.onAccentFlash?.();
    this.uiCallbacks.onAccentArmed?.(true);
    this.debug.updateDynamics(this.audioEngine.getDynamicsTelemetry());

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

  setScoreVisualizerEnabled(enabled: boolean): void {
    this.isScoreVisualizerEnabled = enabled;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("conductor_feature_score_visualizer", String(enabled));
      }
    } catch {
      // Ignore storage errors
    }
    this.debug?.setScoreVisualizerCheckbox(enabled);
  }

  isScoreVisualizerActive(): boolean {
    return this.isScoreVisualizerEnabled;
  }

  getDebugOverlay(): DebugOverlay {
    return this.debug;
  }

  async resumeAudio(): Promise<void> {
    await this.audioEngine.resume();
  }

  // ── Beat observation handler ─────────────────────────────────────────────

  beatSoundEnabled = false;
  lastBeatObservationMs = -1;
  indicatedBpm = 140;
  keyboardInactivityPulseCount = 0;

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

  nudgeGesturalBpm(deltaBpm: number): void {
    this.basePieceBpm = Math.max(40, Math.min(220, this.basePieceBpm + deltaBpm));
    this.currentGesturalBpm = Math.max(40, Math.min(220, this.currentGesturalBpm + deltaBpm));
    this.clock.setBpm(this.currentGesturalBpm);
    this.indicatedBpm = Math.round(this.currentGesturalBpm);
    this.transport.updatePeriod(this.audioEngine.getAudioTime(), 60 / this.currentGesturalBpm, 0);
  }

  async handleBeatObservation(obs: {
    timestampMs: number;
    source: "keyboard" | "camera";
    confidence: number;
  }): Promise<void> {
    return handleBeatObservation(this, obs);
  }

  // ── Playback ─────────────────────────────────────────────────────────────

  startPlayback(): Promise<void> {
    return startPlayback(this);
  }

  private handlePieceComplete(): void {
    handlePieceComplete(this);
  }

  // ── Clock event handler ──────────────────────────────────────────────────

  handleClockEvent(event: ClockEvent): void {
    handleClockEvent(this, event);
  }

  // ── State ────────────────────────────────────────────────────────────────

  setState(next: ExperienceState): void {
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
    if (mode === "magic" && this.inputSource !== "camera") {
      void this.setInputSource("camera");
    }
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
    } else if (mode === "magic") {
      const targetBpm = this.indicatedBpm > 0 ? this.indicatedBpm : this.nominalPieceBpm;
      this.indicatedBpm = Math.round(targetBpm);
      this.clock.setBpm(this.indicatedBpm);
      this.clock.setPeriodMs(60000 / this.indicatedBpm);
      if (this.cameraInput) {
        this.cameraInput.setIndicatedBpm(this.indicatedBpm);
        this.cameraInput.getMagicFingerController().setInitialBpm(this.indicatedBpm);
      }
    }
  }

  setLiveBpm(bpm: number): void {
    const clamped = Math.max(40, Math.min(220, bpm));
    this.clock.setBpm(clamped);
    this.indicatedBpm = Math.round(clamped);
    this.currentGesturalBpm = clamped;
    this.debug.updateClock(this.clock.getState());

    if (this.cameraInput) {
      this.cameraInput.setIndicatedBpm(this.indicatedBpm);
    }

    if (this.state === "playing") {
      this.transport.updatePeriod(
        this.audioEngine.getAudioTime(),
        60 / clamped,
        0
      );
    }

    this.uiCallbacks.onCameraMotionSample?.({
      tempoBpm: this.indicatedBpm,
    });
  }

  setContinuousDynamic(val: number): void {
    const clamped = Math.max(0, Math.min(1, val));
    this.audioEngine.setContinuousDynamic(clamped);
    if (this.cameraInput) {
      this.cameraInput.setContinuousDynamic(clamped);
    }
    const snappedLevel = this.audioEngine.getDynamicLevel();
    if (snappedLevel !== this.baseDynamicLevel) {
      this.baseDynamicLevel = snappedLevel;
      this.uiCallbacks.onDynamicChange?.(snappedLevel);
      this.debug.updateDynamics(this.audioEngine.getDynamicsTelemetry());
    }
    this.uiCallbacks.onCameraMotionSample?.({
      dynamicLevel: snappedLevel,
      dynamicContinuous: clamped,
    });
  }

  startAutoplayInTempo(): void {
    this.setTempoMode("autoplay");
    this.clock.setPeriodMs(60000 / this.basePieceBpm);
    if (this.state === "completed") {
      this.restart();
    }
    if (this.state === "ready" || this.state === "paused") {
      void this.startPlayback();
    }
  }

  getEffectiveBeatsPerTap(): number {
    if (this.inputSource === "keyboard") {
      return 1;
    }
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

  getMidiScore(): MidiScore {
    return this.midiScore;
  }

  getTransport(): ScoreTransport {
    return this.transport;
  }

  getMidiMetadata() {
    try {
      return this.midiScore.getMetadata();
    } catch {
      return null;
    }
  }
}
