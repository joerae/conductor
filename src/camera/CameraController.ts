/**
 * CameraController.ts
 *
 * Manages browser camera permissions, MediaStream acquisition,
 * video element attachment, and clean lifecycle teardown.
 */

import type { CameraState } from "./cameraTypes";

export interface CameraControllerOptions {
  idealWidth?: number;
  idealHeight?: number;
  idealFrameRate?: number;
  facingMode?: "user" | "environment";
  onStateChange?: (state: CameraState, errorMessage?: string) => void;
}

export class CameraController {
  private state: CameraState = "idle";
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private options: Required<CameraControllerOptions>;

  constructor(options?: CameraControllerOptions) {
    this.options = {
      idealWidth: options?.idealWidth ?? 640,
      idealHeight: options?.idealHeight ?? 480,
      idealFrameRate: options?.idealFrameRate ?? 30,
      facingMode: options?.facingMode ?? "user",
      onStateChange: options?.onStateChange ?? (() => {}),
    };
  }

  getState(): CameraState {
    return this.state;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.videoEl;
  }

  getMediaStream(): MediaStream | null {
    return this.stream;
  }

  /**
   * Requests camera permission and attaches the stream to the provided video element.
   * If no video element is provided, creates a detached HTMLVideoElement.
   */
  async start(videoElement?: HTMLVideoElement): Promise<HTMLVideoElement> {
    if (this.state === "tracking" && this.videoEl && this.stream?.active) {
      return this.videoEl;
    }

    this.setState("requesting_permission");

    if (!navigator?.mediaDevices?.getUserMedia) {
      const err = "Camera API (navigator.mediaDevices.getUserMedia) is not supported in this browser.";
      this.setState("error", err);
      throw new Error(err);
    }

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: this.options.facingMode,
          width: { ideal: this.options.idealWidth },
          height: { ideal: this.options.idealHeight },
          frameRate: { ideal: this.options.idealFrameRate, max: 60 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.stream = stream;

      const video = videoElement || this.videoEl || document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      this.videoEl = video;

      // Wait for video data to be ready
      await new Promise<void>((resolve, reject) => {
        if (video.readyState >= 2 && video.videoWidth > 0) {
          resolve();
          return;
        }

        const onLoaded = () => {
          cleanup();
          resolve();
        };

        const onError = (e: Event) => {
          cleanup();
          reject(new Error(`Failed to load video stream: ${(e as ErrorEvent).message || "Unknown error"}`));
        };

        const cleanup = () => {
          video.removeEventListener("loadeddata", onLoaded);
          video.removeEventListener("error", onError);
        };

        video.addEventListener("loadeddata", onLoaded);
        video.addEventListener("error", onError);
        video.play().catch(reject);
      });

      this.setState("tracking");
      return video;
    } catch (err: unknown) {
      let message = "Could not access camera.";
      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          message = "Camera permission was denied. Please allow camera access to conduct with motion.";
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          message = "No camera found on this device.";
        } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
          message = "Camera is already in use by another application.";
        } else {
          message = `Camera error: ${err.message}`;
        }
      } else if (err instanceof Error) {
        message = err.message;
      }

      this.stop();
      this.setState("error", message);
      throw new Error(message);
    }
  }

  /**
   * Completely stops all tracks, detaches video source, and resets camera state.
   */
  stop(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      this.stream = null;
    }

    if (this.videoEl) {
      try {
        this.videoEl.pause();
        this.videoEl.srcObject = null;
      } catch {
        // ignore
      }
    }

    this.setState("stopped");
  }

  private setState(state: CameraState, errorMessage?: string): void {
    this.state = state;
    this.options.onStateChange(state, errorMessage);
  }
}
