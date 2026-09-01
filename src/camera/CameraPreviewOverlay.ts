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
  private activeBeatFlashes: Array<{ x: number; y: number; startTime: number; direction: "trough" | "apex" }> = [];
  private activeThumbsUpBursts: Array<{
    x: number;
    y: number;
    startTime: number;
    particles: Array<{ vx: number; vy: number; size: number; color: string; rotation: number; rotSpeed: number }>;
  }> = [];

  constructor(options?: CameraPreviewOverlayOptions) {
    this.mirror = options?.mirror ?? true;
    this.onClose = options?.onClose;
  }

  triggerBeatFlash(x: number, y: number, direction: "trough" | "apex" = "trough"): void {
    this.activeBeatFlashes.push({ x, y, startTime: performance.now(), direction });
    if (this.containerEl) {
      const glowColor = direction === "apex" ? "rgba(107, 231, 255, 0.7)" : "rgba(255, 213, 107, 0.7)";
      this.containerEl.style.boxShadow = `0 16px 48px rgba(0, 0, 0, 0.85), 0 0 42px ${glowColor}`;
      setTimeout(() => {
        if (this.containerEl) {
          this.containerEl.style.boxShadow = "";
        }
      }, 150);
    }
  }

  triggerThumbsUpVFXBurst(x: number, y: number): void {
    const particleColors = ["#ffd700", "#fff3b0", "#ffffff", "#6be7ff", "#ff9e00"];
    const count = 16;
    const particles = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const speed = 75 + Math.random() * 85;
      particles.push({
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3.5 + Math.random() * 3.5,
        color: particleColors[i % particleColors.length],
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 8,
      });
    }

    this.activeThumbsUpBursts.push({
      x,
      y,
      startTime: performance.now(),
      particles,
    });

    if (this.containerEl) {
      this.containerEl.style.boxShadow = "0 16px 48px rgba(0, 0, 0, 0.85), 0 0 48px rgba(255, 215, 0, 0.85)";
      setTimeout(() => {
        if (this.containerEl) {
          this.containerEl.style.boxShadow = "";
        }
      }, 200);
    }
  }

  mount(parentElement: HTMLElement = document.body): void {
    if (!this.containerEl) {
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
            <div class="telemetry-item"><span class="label">Dynamics:</span> <span id="tel-dyn" class="val">mf</span></div>
          </div>
        </div>
      `;

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
    }

    if (this.containerEl.parentElement !== parentElement) {
      parentElement.appendChild(this.containerEl);
    }
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
        this.statusBadgeEl.textContent = "loading magic finger detecting coolness!";
        this.statusBadgeEl.classList.add("badge-info");
        if (placeholder) placeholder.style.display = "flex";
        if (placeholderText) placeholderText.textContent = "loading magic finger detecting coolness!";
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

    });

    // 5. Render active beat flash ripples
    const now = performance.now();
    this.activeBeatFlashes = this.activeBeatFlashes.filter(flash => {
      const elapsed = now - flash.startTime;
      if (elapsed > 400) return false;

      const progress = elapsed / 400; // 0 -> 1
      const rippleRadius = 8 + progress * 42;
      const rippleAlpha = Math.max(0, 1 - progress);

      const px = flash.x * width;
      const py = (1 - flash.y) * height; // Convert from conductor Y to canvas Y

      const isApex = flash.direction === "apex";
      const strokeColor = isApex
        ? `rgba(107, 231, 255, ${rippleAlpha * 0.95})`
        : `rgba(255, 213, 107, ${rippleAlpha * 0.95})`;
      const glowColor = isApex ? "#6be7ff" : "#ffd56b";

      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, rippleRadius, 0, Math.PI * 2);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 3.5 * (1 - progress);
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 16 * (1 - progress);
      ctx.stroke();

      // Inner burst ring
      ctx.beginPath();
      ctx.arc(px, py, rippleRadius * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${rippleAlpha * 0.85})`;
      ctx.lineWidth = 2 * (1 - progress);
      ctx.stroke();
      ctx.restore();

      return true;
    });

    // 6. Render active Thumbs Up VFX bursts (golden shockwaves + sparkling diamond star particles)
    this.activeThumbsUpBursts = this.activeThumbsUpBursts.filter(burst => {
      const elapsed = now - burst.startTime;
      if (elapsed > 550) return false;

      const progress = elapsed / 550; // 0 -> 1
      const alpha = Math.max(0, 1 - progress);
      const px = burst.x * width;
      const py = (1 - burst.y) * height;

      ctx.save();

      // Outer expanding shimmer shockwave
      const ringRadius = 10 + progress * 55;
      ctx.beginPath();
      ctx.arc(px, py, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 215, 0, ${alpha * 0.95})`;
      ctx.lineWidth = 3.5 * (1 - progress);
      ctx.shadowColor = "#ffd700";
      ctx.shadowBlur = 18 * (1 - progress);
      ctx.stroke();

      // Inner fast sparkle ring
      const innerRingRadius = 6 + progress * 30;
      ctx.beginPath();
      ctx.arc(px, py, innerRingRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.85})`;
      ctx.lineWidth = 2 * (1 - progress);
      ctx.stroke();

      // Sparkle diamond star particles shooting outward
      const dt = elapsed / 1000;
      for (const p of burst.particles) {
        const partX = px + p.vx * dt;
        const partY = py + p.vy * dt;
        const partSize = p.size * (1 - progress * 0.65);

        ctx.save();
        ctx.translate(partX, partY);
        ctx.rotate(p.rotation + p.rotSpeed * dt);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10 * (1 - progress);

        // Draw 4-point diamond star sparkle
        ctx.beginPath();
        ctx.moveTo(0, -partSize);
        ctx.lineTo(partSize * 0.35, 0);
        ctx.lineTo(0, partSize);
        ctx.lineTo(-partSize * 0.35, 0);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      }

      ctx.restore();
      return true;
    });
  }

  private updateTelemetry(telemetry: CameraTelemetry): void {
    if (!this.telemetryEl) return;
    const fpsEl = this.telemetryEl.querySelector("#tel-fps");
    const infEl = this.telemetryEl.querySelector("#tel-inf");
    const handsEl = this.telemetryEl.querySelector("#tel-hands");
    const dynEl = this.telemetryEl.querySelector("#tel-dyn");

    if (fpsEl) fpsEl.textContent = `${telemetry.cameraFps}`;
    if (infEl) infEl.textContent = `${telemetry.inferenceFps} fps`;
    if (handsEl) handsEl.textContent = `${telemetry.handsDetected}`;
    if (dynEl) {
      if (telemetry.dynamics) {
        dynEl.textContent = `${telemetry.dynamics.level.toUpperCase()} (${Math.round(telemetry.dynamics.value * 100)}%)`;
      } else {
        dynEl.textContent = "—";
      }
    }
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

  isMountedState(): boolean {
    return this.isMounted;
  }
}
