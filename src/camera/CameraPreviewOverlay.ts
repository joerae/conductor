/**
 * CameraPreviewOverlay.ts
 *
 * Renders a floating, elegant stage-themed camera preview window with
 * 2D canvas hand skeleton overlays, conducting point indicators,
 * and live performance telemetry.
 */

import type {
  CameraState,
  CameraTelemetry,
  HandSample,
} from "./cameraTypes";
import {
  HAND_CONNECTIONS,
  HAND_LANDMARK_INDICES,
} from "./cameraTypes";

export interface CameraPreviewOverlayOptions {
  onClose?: () => void;
  mirror?: boolean;
}

export class CameraPreviewOverlay {
  private containerEl: HTMLElement | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private statusBadgeEl: HTMLElement | null = null;
  private telemetryEl: HTMLElement | null = null;

  private isMounted = false;
  private isCollapsed = false;
  private mirror: boolean;
  private onClose?: () => void;

  constructor(options?: CameraPreviewOverlayOptions) {
    this.mirror = options?.mirror ?? true;
    this.onClose = options?.onClose;
  }

  mount(parentElement: HTMLElement = document.body): void {
    if (this.isMounted && this.containerEl) return;

    const container = document.createElement("div");
    container.id = "camera-preview-overlay";
    container.className = "camera-preview-overlay";
    container.innerHTML = `
      <div class="camera-preview-header">
        <div class="camera-title-group">
          <span class="camera-icon">📷</span>
          <span class="camera-title">Conductor Camera</span>
          <span id="camera-status-badge" class="camera-status-badge badge-loading">Initializing…</span>
        </div>
        <div class="camera-header-actions">
          <button id="camera-collapse-btn" class="camera-btn-icon" title="Minimize/Expand preview" aria-label="Minimize preview">−</button>
          <button id="camera-close-btn" class="camera-btn-icon" title="Turn off camera" aria-label="Close camera">✕</button>
        </div>
      </div>
      <div class="camera-preview-body" id="camera-preview-body">
        <div class="camera-media-wrap">
          <video id="camera-video" class="camera-video ${this.mirror ? "mirrored" : ""}" autoplay playsinline muted></video>
          <canvas id="camera-canvas" class="camera-canvas ${this.mirror ? "mirrored" : ""}"></canvas>
          <div id="camera-placeholder" class="camera-placeholder">
            <div class="camera-spinner"></div>
            <p id="camera-placeholder-text">Activating camera…</p>
          </div>
        </div>
        <div class="camera-telemetry-hud" id="camera-telemetry-hud">
          <div class="telemetry-item"><span class="label">FPS:</span> <span id="tel-fps" class="val">—</span></div>
          <div class="telemetry-item"><span class="label">Inference:</span> <span id="tel-inf" class="val">—</span></div>
          <div class="telemetry-item"><span class="label">Hands:</span> <span id="tel-hands" class="val">0</span></div>
          <div class="telemetry-item"><span class="label">Latency:</span> <span id="tel-lat" class="val">—</span></div>
        </div>
      </div>
    `;

    parentElement.appendChild(container);
    this.containerEl = container;
    this.videoEl = container.querySelector("#camera-video");
    this.canvasEl = container.querySelector("#camera-canvas");
    this.statusBadgeEl = container.querySelector("#camera-status-badge");
    this.telemetryEl = container.querySelector("#camera-telemetry-hud");

    if (this.canvasEl) {
      this.ctx = this.canvasEl.getContext("2d");
    }

    // Wire collapse & close buttons
    const collapseBtn = container.querySelector("#camera-collapse-btn");
    collapseBtn?.addEventListener("click", () => this.toggleCollapse());

    const closeBtn = container.querySelector("#camera-close-btn");
    closeBtn?.addEventListener("click", () => {
      this.onClose?.();
    });

    this.isMounted = true;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.videoEl;
  }

  toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
    const body = this.containerEl?.querySelector("#camera-preview-body") as HTMLElement;
    const collapseBtn = this.containerEl?.querySelector("#camera-collapse-btn") as HTMLButtonElement;
    if (body) {
      body.style.display = this.isCollapsed ? "none" : "block";
    }
    if (collapseBtn) {
      collapseBtn.textContent = this.isCollapsed ? "+" : "−";
    }
  }

  updateState(state: CameraState, message?: string): void {
    if (!this.statusBadgeEl) return;

    const placeholder = this.containerEl?.querySelector("#camera-placeholder") as HTMLElement;
    const placeholderText = this.containerEl?.querySelector("#camera-placeholder-text") as HTMLElement;

    this.statusBadgeEl.className = "camera-status-badge";

    switch (state) {
      case "requesting_permission":
        this.statusBadgeEl.textContent = "Requesting permission…";
        this.statusBadgeEl.classList.add("badge-warning");
        if (placeholder) placeholder.style.display = "flex";
        if (placeholderText) placeholderText.textContent = "Allow camera in browser prompt…";
        break;
      case "loading_model":
        this.statusBadgeEl.textContent = "Loading AI model…";
        this.statusBadgeEl.classList.add("badge-info");
        if (placeholder) placeholder.style.display = "flex";
        if (placeholderText) placeholderText.textContent = "Loading MediaPipe HandLandmarker…";
        break;
      case "tracking":
        this.statusBadgeEl.textContent = "Live Tracking";
        this.statusBadgeEl.classList.add("badge-active");
        if (placeholder) placeholder.style.display = "none";
        break;
      case "error":
        this.statusBadgeEl.textContent = "Error";
        this.statusBadgeEl.classList.add("badge-error");
        if (placeholder) placeholder.style.display = "flex";
        if (placeholderText) placeholderText.textContent = message || "Camera error.";
        break;
      case "stopped":
      case "idle":
        this.statusBadgeEl.textContent = "Off";
        this.statusBadgeEl.classList.add("badge-idle");
        if (placeholder) placeholder.style.display = "flex";
        if (placeholderText) placeholderText.textContent = "Camera stopped.";
        break;
    }
  }

  /**
   * Renders detected landmarks, bones, conducting point halos, and telemetry.
   */
  render(samples: HandSample[], telemetry: CameraTelemetry): void {
    this.updateTelemetry(telemetry);

    if (!this.canvasEl || !this.ctx || !this.videoEl) return;
    if (this.isCollapsed) return;

    const width = this.videoEl.videoWidth || 320;
    const height = this.videoEl.videoHeight || 240;

    if (this.canvasEl.width !== width || this.canvasEl.height !== height) {
      this.canvasEl.width = width;
      this.canvasEl.height = height;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);

    if (samples.length === 0) return;

    samples.forEach(sample => {
      const isLeft = sample.handedness === "left";
      const primaryColor = isLeft ? "#ffd56b" : "#ffb03a";
      const boneColor = isLeft ? "rgba(255, 213, 107, 0.45)" : "rgba(255, 176, 58, 0.45)";
      const conductingGlow = "#ffffff";

      // 1. Draw skeletal bones
      ctx.beginPath();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = boneColor;

      HAND_CONNECTIONS.forEach(([startIdx, endIdx]) => {
        const start = sample.landmarks[startIdx];
        const end = sample.landmarks[endIdx];
        if (start && end) {
          ctx.moveTo(start.x * width, start.y * height);
          ctx.lineTo(end.x * width, end.y * height);
        }
      });
      ctx.stroke();

      // 2. Draw all 21 joint landmark dots
      sample.landmarks.forEach((lm, idx) => {
        const x = lm.x * width;
        const y = lm.y * height;
        const isFingertip = [4, 8, 12, 16, 20].includes(idx);
        const radius = isFingertip ? 4 : 2.5;

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isFingertip ? primaryColor : "rgba(255, 255, 255, 0.75)";
        ctx.fill();
      });

      // 3. Highlight the primary conducting point with a glowing halo
      const cpX = sample.conductingPoint.x * width;
      const cpY = sample.conductingPoint.y * height;

      // Outer pulsating glow
      ctx.save();
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(cpX, cpY, 7, 0, Math.PI * 2);
      ctx.fillStyle = primaryColor;
      ctx.fill();

      // Inner white core
      ctx.beginPath();
      ctx.arc(cpX, cpY, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = conductingGlow;
      ctx.fill();
      ctx.restore();

      // 4. Handedness & confidence label
      const wristLm = sample.landmarks[HAND_LANDMARK_INDICES.WRIST] || sample.conductingPoint;
      const labelX = wristLm.x * width;
      const labelY = Math.max(16, wristLm.y * height - 12);

      ctx.save();
      ctx.font = "600 11px Inter, sans-serif";
      ctx.fillStyle = "rgba(10, 12, 18, 0.75)";
      const labelText = `${isLeft ? "Left" : "Right"} (${Math.round(sample.confidence * 100)}%)`;
      const textWidth = ctx.measureText(labelText).width;
      ctx.fillRect(labelX - textWidth / 2 - 4, labelY - 11, textWidth + 8, 15);

      ctx.fillStyle = primaryColor;
      ctx.textAlign = "center";
      ctx.fillText(labelText, labelX, labelY);
      ctx.restore();
    });
  }

  private updateTelemetry(telemetry: CameraTelemetry): void {
    if (!this.telemetryEl) return;
    const fpsEl = this.telemetryEl.querySelector("#tel-fps");
    const infEl = this.telemetryEl.querySelector("#tel-inf");
    const handsEl = this.telemetryEl.querySelector("#tel-hands");
    const latEl = this.telemetryEl.querySelector("#tel-lat");

    if (fpsEl) fpsEl.textContent = `${telemetry.cameraFps}`;
    if (infEl) infEl.textContent = `${telemetry.inferenceFps} fps`;
    if (handsEl) handsEl.textContent = `${telemetry.handsDetected}`;
    if (latEl) latEl.textContent = `${telemetry.inferenceDurationMs}ms`;
  }

  unmount(): void {
    if (this.containerEl) {
      this.containerEl.remove();
      this.containerEl = null;
    }
    this.videoEl = null;
    this.canvasEl = null;
    this.ctx = null;
    this.statusBadgeEl = null;
    this.telemetryEl = null;
    this.isMounted = false;
  }

  setVisible(visible: boolean): void {
    if (this.containerEl) {
      this.containerEl.style.display = visible ? "block" : "none";
    }
  }
}
