/**
 * CameraBeatInputProvider.ts
 *
 * Implements BeatInputProvider for camera-based motion conducting.
 * Orchestrates CameraController, HandTracker, HandMotionFilter, HandBeatDetector,
 * BeatFusion, DynamicsEstimator, and CameraPreviewOverlay.
 *
 * Provides real-time hand-gesture beat detection (Phases C1 & C2) and continuous dynamics control.
 */

import type { BeatInputProvider } from "../input/BeatInputProvider";
import type { BeatObservation } from "../clock/clockTypes";
import type {
  CameraConfig,
  CameraState,
  CameraTelemetry,
  DynamicsObservation,
  HandSample,
} from "./cameraTypes";
import { CameraController } from "./CameraController";
import { HandTracker } from "./HandTracker";
import { CameraPreviewOverlay } from "./CameraPreviewOverlay";
import { DynamicsEstimator } from "./DynamicsEstimator";
import { HandMotionFilter } from "./HandMotionFilter";
import { HandBeatDetector } from "./HandBeatDetector";
import { BeatFusion } from "./BeatFusion";
import { InstrumentFocusController, type FocusTelemetry } from "./InstrumentFocusController";
import type { PieceSection } from "../score/repertoire";

export interface CameraBeatInputOptions {
  config?: Partial<CameraConfig>;
  mountOverlay?: boolean;
  onStateChange?: (state: CameraState, error?: string) => void;
  onTelemetry?: (telemetry: CameraTelemetry) => void;
  onSamples?: (samples: HandSample[]) => void;
  onDynamics?: (dynamics: DynamicsObservation) => void;
  onFocus?: (telemetry: FocusTelemetry) => void;
}

export class CameraBeatInputProvider implements BeatInputProvider {
  private cameraController: CameraController;
  private handTracker: HandTracker;
  private dynamicsEstimator: DynamicsEstimator;
  private motionFilter: HandMotionFilter;
  private beatDetector: HandBeatDetector;
  private beatFusion: BeatFusion;
  private focusController: InstrumentFocusController;
  private previewOverlay: CameraPreviewOverlay | null = null;
  private lastThumbsUpBurstTime = new Map<number, number>();
  private isThumbsUpVFXEnabled: boolean = false;
  private currentSections: PieceSection[] = [];

  private callbacks: Array<(beat: BeatObservation) => void> = [];
  private stateChangeCallbacks: Set<(state: CameraState, error?: string) => void> = new Set();
  private telemetryCallbacks: Set<(telemetry: CameraTelemetry) => void> = new Set();
  private sampleCallbacks: Set<(samples: HandSample[]) => void> = new Set();
  private dynamicsCallbacks: Set<(dynamics: DynamicsObservation) => void> = new Set();
  private focusCallbacks: Set<(telemetry: FocusTelemetry) => void> = new Set();

  private isStarted = false;
  private currentTelemetry: CameraTelemetry = {
    state: "idle",
    cameraFps: 0,
    inferenceFps: 0,
    inferenceDurationMs: 0,
    handsDetected: 0,
    handDetails: [],
  };

  constructor(options?: CameraBeatInputOptions) {
    this.cameraController = new CameraController({
      onStateChange: (state, err) => this.handleCameraStateChange(state, err),
    });

    this.handTracker = new HandTracker(options?.config);
    this.dynamicsEstimator = new DynamicsEstimator();
    this.motionFilter = new HandMotionFilter(16);
    this.beatDetector = new HandBeatDetector();
    this.beatFusion = new BeatFusion();
    this.focusController = new InstrumentFocusController();

    if (options?.mountOverlay !== false && typeof document !== "undefined") {
      this.previewOverlay = new CameraPreviewOverlay({
        mirror: options?.config?.mirrorPreview ?? true,
        onClose: () => this.stop(),
      });
    }

    if (options?.onStateChange) this.onStateChange(options.onStateChange);
    if (options?.onTelemetry) this.onTelemetry(options.onTelemetry);
    if (options?.onSamples) this.onSamples(options.onSamples);
    if (options?.onDynamics) this.onDynamics(options.onDynamics);
    if (options?.onFocus) this.onFocus(options.onFocus);

    // Track last beat for telemetry
    let lastBeatDetail: CameraTelemetry["lastBeat"] = undefined;

    // Wire Fused Beats to clock listeners & preview visual flash
    this.beatFusion.onFusedBeat((beat, details) => {
      if (details) {
        lastBeatDetail = {
          timeMs: beat.timestampMs,
          direction: details.direction || "trough",
          handIndex: details.handIndex ?? 0,
          amplitude: details.amplitude ?? 0,
        };
      }

      this.callbacks.forEach(cb => {
        try {
          cb(beat);
        } catch (err) {
          console.warn("CameraBeatInput onBeat error:", err);
        }
      });

      if (details && this.previewOverlay) {
        this.previewOverlay.triggerBeatFlash(details.x, details.y, details.direction || "trough");
      }
    });

    // Wire tracker frame output to focus controller, motion filter, beat detector, dynamics estimator, preview overlay & callbacks
    this.handTracker.onFrame((samples, telemetry) => {
      const now = performance.now();

      // 0. Process Instrument Focus Mode
      const isMirrored = this.handTracker.getConfig().mirrorPreview ?? true;
      const focusTelemetry = this.focusController.update(samples, this.currentSections, now, isMirrored);
      this.previewOverlay?.setFocusModeActive(focusTelemetry.isActive);

      // 1. Process dynamics
      const dynamicsObs = this.dynamicsEstimator.update(samples, now);

      // 2. Process beat detection for each tracked hand (suppressed during active focus mode)
      if (!this.focusController.shouldSuppressBeats()) {
        for (const sample of samples) {
          const motion = this.motionFilter.update(sample);
          const candidate = this.beatDetector.processSample(motion, sample.handIndex);
          if (candidate) {
            this.beatFusion.submitCandidate(candidate, samples.length);
          }
        }
      }

      // 3. Trigger Thumbs Up VFX bursts on preview overlay (when feature flag enabled)
      if (this.isThumbsUpVFXEnabled) {
        for (const sample of samples) {
          if (sample.gesture === "Thumb_Up") {
            const lastBurst = this.lastThumbsUpBurstTime.get(sample.handIndex) || 0;
            if (now - lastBurst > 450) {
              this.lastThumbsUpBurstTime.set(sample.handIndex, now);
              this.previewOverlay?.triggerThumbsUpVFXBurst(sample.conductorPoint.x, sample.conductorPoint.y);
            }
          }
        }
      }

      const fullTelemetry: CameraTelemetry = {
        ...telemetry,
        dynamics: dynamicsObs,
        beatDebug: this.beatDetector.getDebugSnapshot(),
        lastBeat: lastBeatDetail,
      };

      this.currentTelemetry = fullTelemetry;
      this.previewOverlay?.render(samples, fullTelemetry, focusTelemetry);
      this.telemetryCallbacks.forEach(cb => cb(fullTelemetry));
      this.sampleCallbacks.forEach(cb => cb(samples));
      this.dynamicsCallbacks.forEach(cb => cb(dynamicsObs));
      this.focusCallbacks.forEach(cb => cb(focusTelemetry));
    });

    this.handTracker.onStateChange((state, error) => {
      this.handleCameraStateChange(state, error);
    });
  }

  onBeat(callback: (beat: BeatObservation) => void): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter(cb => cb !== callback);
    };
  }

  onStateChange(callback: (state: CameraState, error?: string) => void): () => void {
    this.stateChangeCallbacks.add(callback);
    return () => this.stateChangeCallbacks.delete(callback);
  }

  onTelemetry(callback: (telemetry: CameraTelemetry) => void): () => void {
    this.telemetryCallbacks.add(callback);
    return () => this.telemetryCallbacks.delete(callback);
  }

  onSamples(callback: (samples: HandSample[]) => void): () => void {
    this.sampleCallbacks.add(callback);
    return () => this.sampleCallbacks.delete(callback);
  }

  onDynamics(callback: (dynamics: DynamicsObservation) => void): () => void {
    this.dynamicsCallbacks.add(callback);
    return () => this.dynamicsCallbacks.delete(callback);
  }

  onFocus(callback: (telemetry: FocusTelemetry) => void): () => void {
    this.focusCallbacks.add(callback);
    return () => this.focusCallbacks.delete(callback);
  }

  setSections(sections: PieceSection[]): void {
    this.currentSections = sections;
  }

  getFocusController(): InstrumentFocusController {
    return this.focusController;
  }

  setDynamicsMode(mode: "spread" | "height"): void {
    this.dynamicsEstimator.setMode(mode);
  }

  getDynamicsMode(): "spread" | "height" {
    return this.dynamicsEstimator.getMode();
  }

  getState(): CameraState {
    return this.cameraController.getState();
  }

  getTelemetry(): CameraTelemetry {
    return { ...this.currentTelemetry };
  }

  /**
   * Starts camera capture and hand tracking inference loop.
   */
  async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;

    this.motionFilter.reset();
    this.beatDetector.reset();
    this.beatFusion.reset();
    this.dynamicsEstimator.reset();
    this.focusController.reset();

    try {
      if (this.previewOverlay) {
        const heroSlot = typeof document !== "undefined" ? document.getElementById("camera-hero-slot") : null;
        this.previewOverlay.mount(heroSlot ?? undefined);
        this.previewOverlay.setVisible(true);
      }

      const videoEl = this.previewOverlay?.getVideoElement() ?? undefined;
      const activeVideo = await this.cameraController.start(videoEl);

      await this.handTracker.start(activeVideo);
    } catch (err) {
      this.isStarted = false;
      this.stop();
      throw err;
    }
  }

  /**
   * Stops camera stream, releases hardware tracks, and cancels inference loop.
   */
  stop(): void {
    this.isStarted = false;
    this.handTracker.stop();
    this.cameraController.stop();
    this.motionFilter.reset();
    this.beatDetector.reset();
    this.beatFusion.reset();
    this.focusController.reset();

    if (this.previewOverlay) {
      this.previewOverlay.updateState("stopped");
      this.previewOverlay.setVisible(false);
    }
  }

  /**
   * Disposes all resources and unmounts preview overlay.
   */
  dispose(): void {
    this.stop();
    this.handTracker.dispose();
    if (this.previewOverlay) {
      this.previewOverlay.unmount();
      this.previewOverlay = null;
    }
    this.callbacks = [];
    this.stateChangeCallbacks.clear();
    this.telemetryCallbacks.clear();
    this.sampleCallbacks.clear();
    this.dynamicsCallbacks.clear();
    this.focusCallbacks.clear();
  }

  /**
   * Helper to manually emit a beat observation downstream (e.g. for testing).
   */
  emitBeat(timestampMs: number, confidence: number = 1.0): void {
    const obs: BeatObservation = {
      source: "camera",
      timestampMs,
      confidence,
    };
    this.callbacks.forEach(cb => cb(obs));
  }

  /**
   * Toggles Thumbs-Up magical canvas VFX burst feature flag.
   */
  setThumbsUpVFXEnabled(enabled: boolean): void {
    this.isThumbsUpVFXEnabled = enabled;
  }

  isThumbsUpVFXActive(): boolean {
    return this.isThumbsUpVFXEnabled;
  }

  /**
   * Toggles Instrument Spotlight Focus Mode feature flag.
   */
  setFocusModeEnabled(enabled: boolean): void {
    this.focusController.setEnabled(enabled);
  }

  getFocusModeEnabled(): boolean {
    return this.focusController.getEnabled();
  }

  /**
   * Updates tempo mode on focus controller to tailor gesture triggers.
   */
  setTempoMode(mode: string): void {
    this.focusController.setTempoMode(mode);
  }

  private handleCameraStateChange(state: CameraState, error?: string): void {
    this.previewOverlay?.updateState(state, error);
    this.stateChangeCallbacks.forEach(cb => cb(state, error));
  }
}
