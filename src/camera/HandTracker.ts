/**
 * HandTracker.ts
 *
 * Wraps Google MediaPipe HandLandmarker (@mediapipe/tasks-vision).
 * Runs client-side local hand landmark inference on video frames,
 * extracting 21 landmarks, conducting points, and performance telemetry.
 */

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type {
  CameraConfig,
  CameraState,
  CameraTelemetry,
  HandSample,
  Handedness,
  HandLandmark,
  HandTelemetryDetail,
  HandGesture,
} from "./cameraTypes";
import {
  DEFAULT_CAMERA_CONFIG,
  extractConductingPoint,
  toConductorSpace,
  classifyHandGestureFromLandmarks,
} from "./cameraTypes";

export type HandTrackerCallback = (
  samples: HandSample[],
  telemetry: CameraTelemetry
) => void;

export class HandTracker {
  private handLandmarker: HandLandmarker | null = null;
  private isModelLoading = false;
  private isRunning = false;
  private animFrameId: number | null = null;
  private lastVideoTime = -1;

  private config: CameraConfig;
  private callbacks: Set<HandTrackerCallback> = new Set();
  private stateChangeCallbacks: Set<(state: CameraState, error?: string) => void> = new Set();

  // Telemetry calculation helpers
  private frameCount = 0;
  private inferenceCount = 0;
  private lastFpsCalcTime = performance.now();
  private currentCameraFps = 0;
  private currentInferenceFps = 0;
  private currentInferenceDurationMs = 0;

  constructor(config?: Partial<CameraConfig>) {
    this.config = { ...DEFAULT_CAMERA_CONFIG, ...config };
  }

  onFrame(callback: HandTrackerCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  onStateChange(callback: (state: CameraState, error?: string) => void): () => void {
    this.stateChangeCallbacks.add(callback);
    return () => this.stateChangeCallbacks.delete(callback);
  }

  /**
   * Initializes the MediaPipe HandLandmarker model asynchronously.
   */
  async initModel(): Promise<HandLandmarker> {
    if (this.handLandmarker) return this.handLandmarker;
    if (this.isModelLoading) {
      // Wait for existing load promise
      while (this.isModelLoading) {
        await new Promise(r => setTimeout(r, 50));
      }
      if (this.handLandmarker) return this.handLandmarker;
    }

    this.isModelLoading = true;
    this.emitState("loading_model");

    try {
      const vision = await FilesetResolver.forVisionTasks(this.config.wasmLoaderUrl);
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: this.config.modelAssetPath,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: this.config.maxHands,
        minHandDetectionConfidence: this.config.minHandDetectionConfidence,
        minHandPresenceConfidence: this.config.minHandPresenceConfidence,
        minTrackingConfidence: this.config.minTrackingConfidence,
      });

      this.isModelLoading = false;
      this.emitState("idle");
      return this.handLandmarker;
    } catch (err: unknown) {
      this.isModelLoading = false;
      const msg = `Failed to load MediaPipe HandLandmarker model: ${err instanceof Error ? err.message : String(err)}`;
      this.emitState("error", msg);
      throw new Error(msg);
    }
  }

  /**
   * Starts tracking hand landmarks from the given active HTMLVideoElement.
   */
  async start(video: HTMLVideoElement): Promise<void> {
    if (this.isRunning) return;

    if (!this.handLandmarker) {
      await this.initModel();
    }

    this.isRunning = true;
    this.lastVideoTime = -1;
    this.lastFpsCalcTime = performance.now();
    this.frameCount = 0;
    this.inferenceCount = 0;
    this.emitState("tracking");

    const processLoop = () => {
      if (!this.isRunning) return;

      const now = performance.now();
      this.frameCount++;

      // Compute FPS every 500ms
      if (now - this.lastFpsCalcTime >= 500) {
        const deltaSec = (now - this.lastFpsCalcTime) / 1000;
        this.currentCameraFps = Math.round(this.frameCount / deltaSec);
        this.currentInferenceFps = Math.round(this.inferenceCount / deltaSec);
        this.frameCount = 0;
        this.inferenceCount = 0;
        this.lastFpsCalcTime = now;
      }

      // Check if video has a new frame ready
      if (
        video.readyState >= 2 &&
        video.currentTime !== this.lastVideoTime &&
        this.handLandmarker
      ) {
        this.lastVideoTime = video.currentTime;
        const inferenceStart = performance.now();

        try {
          const result = this.handLandmarker.detectForVideo(video, now);
          this.currentInferenceDurationMs = performance.now() - inferenceStart;
          this.inferenceCount++;

          const handSamples: HandSample[] = [];
          const telemetryDetails: HandTelemetryDetail[] = [];

          if (result && result.landmarks && result.landmarks.length > 0) {
            result.landmarks.forEach((rawLandmarks, idx) => {
              // Extract handedness (MediaPipe output format)
              let handedness: Handedness = "right";
              let confidence = 0.8;

              if (result.handedness && result.handedness[idx] && result.handedness[idx][0]) {
                const category = result.handedness[idx][0];
                const catName = category.categoryName.toLowerCase();
                handedness = catName.includes("left") ? "left" : "right";
                confidence = category.score ?? 0.8;
              }

              const landmarks: HandLandmark[] = rawLandmarks.map(lm => ({
                x: lm.x,
                y: lm.y,
                z: lm.z,
                visibility: lm.visibility,
              }));

              const conductingPoint = extractConductingPoint(
                landmarks,
                this.config.conductingPointType,
                this.config.wristWeight
              );
              const conductorPoint = toConductorSpace(conductingPoint);

              // Extract gesture from MediaPipe GestureRecognizer or robust geometric classifier
              let gesture: HandGesture = "none";
              let gestureScore = 0.8;

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const anyResult = result as any;
              if (anyResult.gestures && anyResult.gestures[idx] && anyResult.gestures[idx][0]) {
                const gCat = anyResult.gestures[idx][0];
                if (gCat.categoryName && gCat.categoryName !== "Unrecognized") {
                  gesture = gCat.categoryName as HandGesture;
                  gestureScore = gCat.score ?? 0.8;
                }
              }

              if (gesture === "none" || gesture === "Unrecognized") {
                const geomGesture = classifyHandGestureFromLandmarks(landmarks);
                if (geomGesture !== "none") {
                  gesture = geomGesture;
                  gestureScore = 0.9;
                }
              }

              const sample: HandSample = {
                timestampMs: now,
                handIndex: idx,
                handedness,
                confidence,
                landmarks,
                conductingPoint,
                conductorPoint,
                gesture,
                gestureScore,
              };

              handSamples.push(sample);
              telemetryDetails.push({
                handedness,
                confidence,
                conductorPoint,
                gesture,
                gestureScore,
              });
            });
          }

          const telemetry: CameraTelemetry = {
            state: "tracking",
            cameraFps: this.currentCameraFps,
            inferenceFps: this.currentInferenceFps,
            inferenceDurationMs: Math.round(this.currentInferenceDurationMs * 10) / 10,
            handsDetected: handSamples.length,
            handDetails: telemetryDetails,
          };

          this.callbacks.forEach(cb => {
            try {
              cb(handSamples, telemetry);
            } catch (err) {
              console.warn("HandTracker callback error:", err);
            }
          });
        } catch (err) {
          console.warn("HandLandmarker detectForVideo error:", err);
        }
      }

      this.animFrameId = requestAnimationFrame(processLoop);
    };

    this.animFrameId = requestAnimationFrame(processLoop);
  }

  /**
   * Stops the inference loop and cancels the animation frame.
   */
  stop(): void {
    this.isRunning = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.emitState("stopped");
  }

  /**
   * Disposes the HandLandmarker and releases WASM resources.
   */
  dispose(): void {
    this.stop();
    if (this.handLandmarker) {
      try {
        this.handLandmarker.close();
      } catch {
        // ignore
      }
      this.handLandmarker = null;
    }
    this.callbacks.clear();
    this.stateChangeCallbacks.clear();
  }

  setConfig(partialConfig: Partial<CameraConfig>): void {
    this.config = { ...this.config, ...partialConfig };
  }

  getConfig(): CameraConfig {
    return { ...this.config };
  }

  private emitState(state: CameraState, error?: string): void {
    this.stateChangeCallbacks.forEach(cb => cb(state, error));
  }
}
