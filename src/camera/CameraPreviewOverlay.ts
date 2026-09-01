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
import type { FocusTelemetry } from "./InstrumentFocusController";

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
   * Renders detected landmarks, bones, conducting point halos, telemetry, and focus visuals.
   */
  render(samples: HandSample[], telemetry: CameraTelemetry, focusTelemetry?: FocusTelemetry): void {
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

    // 7. Render Focus Mode pointer & targeting visual cues
    if (focusTelemetry && focusTelemetry.isActive && samples.length > 0) {
      const pointingHand = (focusTelemetry.pointingHandIndex !== null
        ? samples.find(s => s.handIndex === focusTelemetry.pointingHandIndex)
        : null) || samples[0];

      if (pointingHand) {
        const tip = pointingHand.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_TIP] || pointingHand.conductingPoint;
        const fx = tip.x * width;
        const fy = tip.y * height;
        const pulse = (Math.sin(now / 120) + 1) / 2; // 0..1 pulse

        // 1. Full-Stage Angled Laser Ray (Pierces straight out of camera box to targeted orchestra section)
        const stageOverlay = document.getElementById("stage-spotlight-ray-overlay") as SVGSVGElement | null;

        if (stageOverlay && (focusTelemetry.state === "grabbed" || focusTelemetry.state === "hovering") && this.canvasEl) {
          const canvasRect = this.canvasEl.getBoundingClientRect();
          const svgRect = stageOverlay.getBoundingClientRect();
          const isMirrored = this.mirror;

          // Fingertip start position in stage-spotlight-ray-overlay coordinate space
          const screenNormX = isMirrored ? (1.0 - tip.x) : tip.x;
          const stageStartX = (canvasRect.left - svgRect.left) + screenNormX * canvasRect.width;
          const stageStartY = (canvasRect.top - svgRect.top) + tip.y * canvasRect.height;

          // Pointing direction vector in screen pixels
          const pip = pointingHand.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_PIP] || pointingHand.landmarks[HAND_LANDMARK_INDICES.INDEX_FINGER_MCP];
          const pipNormX = pip ? (isMirrored ? (1.0 - pip.x) : pip.x) : screenNormX;
          const pipNormY = pip ? pip.y : (tip.y + 0.05);
          const dirX = (screenNormX - pipNormX) * canvasRect.width;
          const dirY = (tip.y - pipNormY) * canvasRect.height;
          const len = Math.hypot(dirX, dirY) || 1;
          const unitX = dirX / len;
          const unitY = dirY / len;

          // Pure straight ray projecting freely across the stage in the exact direction of pointing finger
          const targetRowY = 60;
          const rayDist = unitY < -0.05 ? ((stageStartY - targetRowY) / -unitY) : 340;
          const stageEndX = stageStartX + unitX * rayDist;
          const stageEndY = Math.max(15, stageStartY + unitY * rayDist);

          const activeSecId = focusTelemetry.grabbedSectionId || focusTelemetry.hoveredSectionId;

          const outerRay = stageOverlay.querySelector("#spotlight-stage-outer-ray") as SVGLineElement | null;
          const mainRay = stageOverlay.querySelector("#spotlight-stage-ray") as SVGLineElement | null;
          const coreRay = stageOverlay.querySelector("#spotlight-stage-core") as SVGLineElement | null;
          const targetGlow = stageOverlay.querySelector("#spotlight-stage-target-glow") as SVGCircleElement | null;
          const targetRing = stageOverlay.querySelector("#spotlight-stage-target-ring") as SVGCircleElement | null;
          const targetPip = stageOverlay.querySelector("#spotlight-stage-target-pip") as SVGCircleElement | null;

          if (outerRay && mainRay && coreRay && targetGlow && targetRing && targetPip) {
            outerRay.setAttribute("x1", stageStartX.toFixed(1));
            outerRay.setAttribute("y1", stageStartY.toFixed(1));
            outerRay.setAttribute("x2", stageEndX.toFixed(1));
            outerRay.setAttribute("y2", stageEndY.toFixed(1));

            mainRay.setAttribute("x1", stageStartX.toFixed(1));
            mainRay.setAttribute("y1", stageStartY.toFixed(1));
            mainRay.setAttribute("x2", stageEndX.toFixed(1));
            mainRay.setAttribute("y2", stageEndY.toFixed(1));

            coreRay.setAttribute("x1", stageStartX.toFixed(1));
            coreRay.setAttribute("y1", stageStartY.toFixed(1));
            coreRay.setAttribute("x2", stageEndX.toFixed(1));
            coreRay.setAttribute("y2", stageEndY.toFixed(1));

            targetGlow.setAttribute("cx", stageEndX.toFixed(1));
            targetGlow.setAttribute("cy", stageEndY.toFixed(1));
            targetGlow.setAttribute("r", (16 + pulse * 6).toFixed(1));

            targetRing.setAttribute("cx", stageEndX.toFixed(1));
            targetRing.setAttribute("cy", stageEndY.toFixed(1));
            targetRing.setAttribute("r", (10 + pulse * 3).toFixed(1));

            targetPip.setAttribute("cx", stageEndX.toFixed(1));
            targetPip.setAttribute("cy", stageEndY.toFixed(1));

            // Only show impact flare & ring if actively intersecting an instrument section
            const showImpact = Boolean(activeSecId);
            targetGlow.style.display = showImpact ? "" : "none";
            targetRing.style.display = showImpact ? "" : "none";
            targetPip.style.display = showImpact ? "" : "none";

            stageOverlay.style.display = "block";
          }
        } else if (stageOverlay) {
          stageOverlay.style.display = "none";
        }

        // 2. Fingertip targeting reticle ring & glowing aura
        ctx.save();
        ctx.beginPath();
        ctx.arc(fx, fy, 14 + pulse * 4, 0, Math.PI * 2);
        ctx.fillStyle = focusTelemetry.state === "grabbed"
          ? "rgba(255, 213, 107, 0.20)"
          : "rgba(107, 231, 255, 0.16)";
        ctx.fill();
        ctx.strokeStyle = focusTelemetry.state === "grabbed"
          ? "rgba(255, 213, 107, 0.95)"
          : "rgba(107, 231, 255, 0.85)";
        ctx.lineWidth = 2.2;
        ctx.stroke();

        // 4 crosshair pips on reticle
        for (let i = 0; i < 4; i++) {
          const ang = (Math.PI / 2) * i + (now / 1000);
          const r1 = 17 + pulse * 3;
          const r2 = 23 + pulse * 3;
          ctx.beginPath();
          ctx.moveTo(fx + Math.cos(ang) * r1, fy + Math.sin(ang) * r1);
          ctx.lineTo(fx + Math.cos(ang) * r2, fy + Math.sin(ang) * r2);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.90)";
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }

        // Inner glowing jewel
        ctx.beginPath();
        ctx.arc(fx, fy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.restore();
      }
    } else {
      const stageOverlay = document.getElementById("stage-spotlight-ray-overlay");
      if (stageOverlay) stageOverlay.style.display = "none";
    }
  }

  setFocusModeActive(active: boolean): void {
    if (this.videoEl) {
      this.videoEl.style.transition = "opacity 0.3s ease";
      // In focus mode, hide the video feed completely so glowing hands stand out on dark stage
      // and eliminate full video texture GPU compositing overhead!
      this.videoEl.style.opacity = active ? "0" : "1.0";
    }
    const stageOverlay = document.getElementById("stage-spotlight-ray-overlay");
    if (!active && stageOverlay) {
      stageOverlay.style.display = "none";
    }
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
