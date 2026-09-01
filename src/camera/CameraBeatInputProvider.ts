/**
 * CameraBeatInputProvider.ts
 *
 * Implements BeatInputProvider for camera-based motion conducting.
 * Orchestrates CameraController, HandTracker, and CameraPreviewOverlay.
 *
 * In Stage A (Phase C0):
 *   - Establishes browser camera access, local MediaPipe HandLandmarker inference,
 *     dual-hand tracking, and live skeleton overlay rendering.
 *   - Clean start/stop lifecycle without lingering media tracks or animation loops.
 *   - Downstream beat emission pipeline will be integrated in Phase C1 (HandBeatDetector).
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

export interface CameraBeatInputOptions {
  config?: Partial<CameraConfig>;
  mountOverlay?: boolean;
  onStateChange?: (state: CameraState, error?: string) => void;
  onTelemetry?: (telemetry: CameraTelemetry) => void;
  onSamples?: (samples: HandSample[]) => void;
  onDynamics?: (dynamics: DynamicsObservation) => void;
}

export class CameraBeatInputProvider implements BeatInputProvider {
  private cameraController: CameraController;
  private handTracker: HandTracker;
  private dynamicsEstimator: DynamicsEstimator;
  private previewOverlay: CameraPreviewOverlay | null = null;

  private callbacks: Array<(beat: BeatObservation) => void> = [];
  private stateChangeCallbacks: Set<(state: CameraState, error?: string) => void> = new Set();
  private telemetryCallbacks: Set<(telemetry: CameraTelemetry) => void> = new Set();
  private sampleCallbacks: Set<(samples: HandSample[]) => void> = new Set();
  private dynamicsCallbacks: Set<(dynamics: DynamicsObservation) => void> = new Set();

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

    // Wire tracker frame output to dynamics estimator, preview overlay & callbacks
    this.handTracker.onFrame((samples, telemetry) => {
      const dynamicsObs = this.dynamicsEstimator.update(samples, performance.now());
      const fullTelemetry: CameraTelemetry = {
        ...telemetry,
        dynamics: dynamicsObs,
      };

      this.currentTelemetry = fullTelemetry;
      this.previewOverlay?.render(samples, fullTelemetry);
      this.telemetryCallbacks.forEach(cb => cb(fullTelemetry));
      this.sampleCallbacks.forEach(cb => cb(samples));
      this.dynamicsCallbacks.forEach(cb => cb(dynamicsObs));
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

    try {
      if (this.previewOverlay) {
        this.previewOverlay.mount();
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
  }

  /**
   * Helper to emit a beat observation downstream to ConductorClock.
   * (Ready for Phase C1 integration).
   */
  protected emitBeat(timestampMs: number, confidence: number = 1.0): void {
    const obs: BeatObservation = {
      source: "camera",
      timestampMs,
      confidence,
    };
    this.callbacks.forEach(cb => cb(obs));
  }

  private handleCameraStateChange(state: CameraState, error?: string): void {
    this.previewOverlay?.updateState(state, error);
    this.stateChangeCallbacks.forEach(cb => cb(state, error));
  }
}
