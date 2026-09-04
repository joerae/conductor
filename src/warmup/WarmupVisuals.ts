/**
 * WarmupVisuals.ts
 *
 * Renders the interactive visual tutorial inside the camera frame:
 * - Animated golden hand silhouettes (Tempo, Dynamics, Spotlight)
 * - Compact glassmorphism instruction card
 * - Honest, monotonic loading bar & percentage
 * - Live input crossfade
 * - Accessibility: aria-live polite region & prefers-reduced-motion support
 */

import type { CameraAxisMapping } from "../experience/ExperienceController";
import type { ConductorLoadState, WarmupDisplayState, WarmupLessonId } from "./WarmupTypes";

export interface WarmupVisualsCallbacks {
  onStartWarmup: () => void;
  onSkipWarmup: () => void;
  onStartConducting: () => void;
  onContinueKeyboard: () => void;
  onRetryCamera: () => void;
  onToggleMute: () => void;
}

export class WarmupVisuals {
  private container: HTMLElement | null = null;
  private overlayEl: HTMLElement | null = null;
  private callbacks: WarmupVisualsCallbacks;
  private getAxisMapping: () => CameraAxisMapping;

  private currentLesson: WarmupLessonId = "tempo";
  private displayState: WarmupDisplayState = "awaiting_interaction";
  private isMuted: boolean = false;
  private isReturningUser: boolean = false;
  private prefersReducedMotion: boolean = false;

  private animFrameId: number | null = null;
  private animStartTime: number = 0;
  private isLiveTracking: boolean = false;

  // External sync callbacks
  public onTempoSync?: (bpm: number, isDemo: boolean) => void;
  public onDynamicsSync?: (level: string, continuous: number) => void;
  public onSpotlightSync?: (sectionId: string | null) => void;

  constructor(
    callbacks: WarmupVisualsCallbacks,
    getAxisMapping: () => CameraAxisMapping = () => "classic"
  ) {
    this.callbacks = callbacks;
    this.getAxisMapping = getAxisMapping;

    if (typeof window !== "undefined") {
      this.prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
  }

  mount(container: HTMLElement): HTMLElement | null {
    this.container = container;
    this.render();
    return this.overlayEl;
  }

  getCurrentLesson(): WarmupLessonId {
    return this.currentLesson;
  }

  setReturningUser(isReturning: boolean): void {
    this.isReturningUser = isReturning;
    if (this.overlayEl) {
      this.overlayEl.classList.toggle("returning-user", isReturning);
    }
  }

  setDisplayState(state: WarmupDisplayState): void {
    this.displayState = state;
    this.updateDisplayStateUI();
  }

  setLesson(lesson: WarmupLessonId): void {
    this.currentLesson = lesson;
    this.animStartTime = performance.now();
    this.updateLessonUI();
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    const muteBtn = this.overlayEl?.querySelector("#warmup-mute-btn");
    if (muteBtn) {
      muteBtn.textContent = muted ? "🔇 Muted" : "🔊 Sound on";
      muteBtn.setAttribute("aria-label", muted ? "Unmute audio" : "Mute audio");
    }
  }

  isSoundMuted(): boolean {
    return this.isMuted;
  }

  setLiveTrackingActive(active: boolean): void {
    this.isLiveTracking = active;
    if (this.overlayEl) {
      this.overlayEl.classList.toggle("live-tracking-active", active);
    }
    const liveBadge = this.overlayEl?.querySelector("#warmup-live-badge") as HTMLElement | null;
    if (liveBadge) {
      liveBadge.style.display = active ? "inline-flex" : "none";
    }
  }

  updateLoadProgress(state: ConductorLoadState): void {
    if (!this.overlayEl) return;

    const progressFill = this.overlayEl.querySelector("#warmup-progress-fill") as HTMLElement | null;
    const percentLabel = this.overlayEl.querySelector("#warmup-progress-pct") as HTMLElement | null;
    const statusLabel = this.overlayEl.querySelector("#warmup-task-status") as HTMLElement | null;
    const ariaLive = this.overlayEl.querySelector("#warmup-aria-live") as HTMLElement | null;

    if (progressFill) {
      progressFill.style.width = `${state.progress}%`;
    }
    if (percentLabel) {
      percentLabel.textContent = `${state.progress}%`;
    }
    if (statusLabel) {
      statusLabel.textContent = state.statusMessage;
    }
    if (ariaLive && state.isReady) {
      ariaLive.textContent = "Orchestra is ready for conducting.";
    }

    // If ready, show start conducting button
    if (state.isReady && this.displayState !== "camera_failed") {
      this.setDisplayState("ready");
    }
  }

  private render(): void {
    if (!this.container) return;

    // Create tutorial overlay element
    const overlay = document.createElement("div");
    overlay.id = "warmup-overlay";
    overlay.className = "warmup-overlay";
    overlay.setAttribute("role", "region");
    overlay.setAttribute("aria-label", "Orchestra Warming Up Tutorial");

    overlay.innerHTML = `
      <!-- Ambient Glow & Subtle Stage Atmosphere -->
      <div class="warmup-ambient-backdrop" aria-hidden="true"></div>

      <!-- Live Tracking Active Indicator -->
      <div id="warmup-live-badge" class="warmup-live-badge" style="display: none;">
        <span class="live-dot"></span> LIVE HANDS DETECTED
      </div>

      <!-- Golden Hand Silhouettes Animation Stage (SVG) -->
      <div class="warmup-animation-stage" id="warmup-animation-stage" aria-hidden="true">
        <svg id="warmup-hands-svg" class="warmup-hands-svg" viewBox="0 0 600 400" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="gold-glow-filter" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id="warmup-gold-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#fff1c1" />
              <stop offset="50%" stop-color="#ffd56b" />
              <stop offset="100%" stop-color="#c9a84c" />
            </linearGradient>
          </defs>

          <!-- Left Hand Silhouette Group -->
          <g id="warmup-hand-left" class="warmup-hand-group">
            <path class="hand-silhouette" d="M -25,35 C -30,15 -25,-15 -20,-30 C -18,-35 -12,-35 -10,-28 C -7,-18 -7,5 -10,18 C -5,-15 2,-25 6,-25 C 9,-25 12,-18 9,0 C 13,-12 18,-18 22,-18 C 26,-18 28,-12 25,8 C 28,-5 34,-8 37,-6 C 40,-3 39,8 33,22 C 25,40 10,55 -5,55 C -18,55 -22,48 -25,35 Z" fill="rgba(255, 213, 107, 0.12)" stroke="url(#warmup-gold-grad)" stroke-width="2.2" filter="url(#gold-glow-filter)" />
          </g>

          <!-- Right Hand Silhouette Group -->
          <g id="warmup-hand-right" class="warmup-hand-group">
            <path class="hand-silhouette" d="M 25,35 C 30,15 25,-15 20,-30 C 18,-35 12,-35 10,-28 C 7,-18 7,5 10,18 C 5,-15 -2,-25 -6,-25 C -9,-25 -12,-18 -9,0 C -13,-12 -18,-18 -22,-18 C -26,-18 -28,-12 -25,8 C -28,-5 -34,-8 -37,-6 C -40,-3 -39,8 -33,22 C -25,40 -10,55 5,55 C 18,55 22,48 25,35 Z" fill="rgba(255, 213, 107, 0.12)" stroke="url(#warmup-gold-grad)" stroke-width="2.2" filter="url(#gold-glow-filter)" />
          </g>

          <!-- Spotlight Pointing Hand Silhouette Group (Hidden by default) -->
          <g id="warmup-hand-pointer" class="warmup-hand-group" style="display: none;">
            <path class="hand-silhouette" d="M 0,45 C -15,45 -22,35 -20,15 C -18,-5 -5,-25 0,-55 C 2,-62 8,-62 10,-55 C 14,-25 15,10 18,25 C 22,12 28,12 28,25 C 25,42 12,45 0,45 Z" fill="rgba(255, 213, 107, 0.18)" stroke="url(#warmup-gold-grad)" stroke-width="2.5" filter="url(#gold-glow-filter)" />
            <!-- Laser Ray Demonstration -->
            <line id="warmup-ray" x1="5" y1="-58" x2="160" y2="-120" stroke="#ffd56b" stroke-width="2.5" stroke-dasharray="6,4" opacity="0.85" />
            <circle cx="160" cy="-120" r="10" fill="none" stroke="#ffd56b" stroke-width="2" />
            <circle cx="160" cy="-120" r="3" fill="#ffffff" />
          </g>
        </svg>
      </div>

      <!-- Compact Glassmorphism Instruction Card (Bottom of Frame) -->
      <div class="warmup-card" id="warmup-card">
        <div class="warmup-card-header">
          <span class="warmup-step-badge" id="warmup-step-badge">WARMING UP 1 OF 3</span>
          <div class="warmup-card-actions">
            <button id="warmup-mute-btn" class="warmup-pill-btn" aria-label="Toggle sound">
              🔊 Sound on
            </button>
            <button id="warmup-skip-btn" class="warmup-pill-btn secondary" aria-label="Skip warming up">
              Skip warm-up
            </button>
          </div>
        </div>

        <h2 class="warmup-headline" id="warmup-headline">Shape the tempo</h2>
        <p class="warmup-copy" id="warmup-copy">
          Move your hands higher to speed up. Lower them to slow down. Hear the violin follow you.
        </p>

        <!-- Loading Bar Section -->
        <div class="warmup-progress-section">
          <div class="warmup-progress-header">
            <span class="warmup-progress-title">WARMING UP THE ORCHESTRA</span>
            <span class="warmup-progress-pct" id="warmup-progress-pct">0%</span>
          </div>
          <div class="warmup-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div class="warmup-progress-fill" id="warmup-progress-fill" style="width: 0%;"></div>
          </div>
          <div class="warmup-status-row">
            <span class="warmup-task-status" id="warmup-task-status">Tuning the first violin...</span>
          </div>
        </div>

        <!-- Dynamic Action Buttons Row -->
        <div class="warmup-actions-row" id="warmup-actions-row">
          <!-- Initial Button (User Gesture for Audio + Camera) -->
          <button id="warmup-start-audio-btn" class="warmup-primary-btn" style="display: none;">
            🎵 Start musical warm-up
          </button>
          <!-- Secondary Option -->
          <button id="warmup-use-keyboard-btn" class="warmup-secondary-btn" style="display: none;">
            ⌨️ Use keyboard instead
          </button>
          <!-- Ready State Button -->
          <button id="warmup-ready-btn" class="warmup-primary-btn ready-glow" style="display: none;">
            🪄 Start conducting
          </button>
          <!-- Camera Retry Button -->
          <button id="warmup-retry-cam-btn" class="warmup-secondary-btn" style="display: none;">
            📷 Try camera again
          </button>
        </div>

        <!-- Accessible Live Region -->
        <div id="warmup-aria-live" class="sr-only" aria-live="polite"></div>
      </div>
    `;

    this.overlayEl = overlay;
    this.container.appendChild(overlay);
    this.bindEvents();
    this.startAnimationLoop();
    this.updateLessonUI();
    this.updateDisplayStateUI();
  }

  private bindEvents(): void {
    if (!this.overlayEl) return;

    this.overlayEl.querySelector("#warmup-start-audio-btn")?.addEventListener("click", () => {
      this.callbacks.onStartWarmup();
    });

    this.overlayEl.querySelector("#warmup-use-keyboard-btn")?.addEventListener("click", () => {
      this.callbacks.onContinueKeyboard();
    });

    this.overlayEl.querySelector("#warmup-skip-btn")?.addEventListener("click", () => {
      this.callbacks.onSkipWarmup();
    });

    this.overlayEl.querySelector("#warmup-mute-btn")?.addEventListener("click", () => {
      this.callbacks.onToggleMute();
    });

    this.overlayEl.querySelector("#warmup-ready-btn")?.addEventListener("click", () => {
      this.callbacks.onStartConducting();
    });

    this.overlayEl.querySelector("#warmup-retry-cam-btn")?.addEventListener("click", () => {
      this.callbacks.onRetryCamera();
    });
  }

  private updateDisplayStateUI(): void {
    if (!this.overlayEl) return;

    const startAudioBtn = this.overlayEl.querySelector("#warmup-start-audio-btn") as HTMLElement | null;
    const useKeyBtn = this.overlayEl.querySelector("#warmup-use-keyboard-btn") as HTMLElement | null;
    const readyBtn = this.overlayEl.querySelector("#warmup-ready-btn") as HTMLElement | null;
    const retryCamBtn = this.overlayEl.querySelector("#warmup-retry-cam-btn") as HTMLElement | null;
    const skipBtn = this.overlayEl.querySelector("#warmup-skip-btn") as HTMLElement | null;

    if (startAudioBtn) startAudioBtn.style.display = "none";
    if (useKeyBtn) useKeyBtn.style.display = "none";
    if (readyBtn) readyBtn.style.display = "none";
    if (retryCamBtn) retryCamBtn.style.display = "none";

    switch (this.displayState) {
      case "awaiting_interaction":
        if (startAudioBtn) startAudioBtn.style.display = "inline-flex";
        if (useKeyBtn) useKeyBtn.style.display = "inline-flex";
        break;
      case "lesson":
        // Ongoing tutorial lessons
        break;
      case "nearly_ready":
        if (skipBtn) skipBtn.style.display = "none";
        break;
      case "ready":
        if (readyBtn) readyBtn.style.display = "inline-flex";
        if (skipBtn) skipBtn.style.display = "none";
        break;
      case "camera_failed":
        if (useKeyBtn) {
          useKeyBtn.textContent = "⌨️ Continue with keyboard";
          useKeyBtn.style.display = "inline-flex";
        }
        if (retryCamBtn) retryCamBtn.style.display = "inline-flex";
        break;
    }
  }

  private updateLessonUI(): void {
    if (!this.overlayEl) return;

    const badge = this.overlayEl.querySelector("#warmup-step-badge");
    const headline = this.overlayEl.querySelector("#warmup-headline");
    const copy = this.overlayEl.querySelector("#warmup-copy");
    const handLeft = this.overlayEl.querySelector("#warmup-hand-left") as SVGElement | null;
    const handRight = this.overlayEl.querySelector("#warmup-hand-right") as SVGElement | null;
    const handPointer = this.overlayEl.querySelector("#warmup-hand-pointer") as SVGElement | null;

    const mapping = this.getAxisMapping();
    const isFlipped = mapping === "flipped";

    if (this.isReturningUser) {
      if (badge) badge.textContent = "QUICK CONDUCTING TIP";
      if (headline) headline.textContent = "Welcome Back";
      if (copy) copy.textContent = "Raise your hands when ready to begin conducting.";
      return;
    }

    switch (this.currentLesson) {
      case "tempo":
        if (badge) badge.textContent = "WARMING UP 1 OF 3";
        if (headline) headline.textContent = "Shape the tempo";
        if (copy) {
          copy.textContent = isFlipped
            ? "Move your hands apart to speed up. Bring them together to slow down. Hear the violin follow you."
            : "Move your hands higher to speed up. Lower them to slow down. Hear the violin follow you.";
        }
        if (handLeft) handLeft.style.display = "block";
        if (handRight) handRight.style.display = "block";
        if (handPointer) handPointer.style.display = "none";
        break;

      case "dynamics":
        if (badge) badge.textContent = "WARMING UP 2 OF 3";
        if (headline) headline.textContent = "Shape the sound";
        if (copy) {
          copy.textContent = isFlipped
            ? "Move your hands higher for louder. Lower them for softer."
            : "Move your hands apart for louder. Bring them together for softer.";
        }
        if (handLeft) handLeft.style.display = "block";
        if (handRight) handRight.style.display = "block";
        if (handPointer) handPointer.style.display = "none";
        break;

      case "spotlight":
        if (badge) badge.textContent = "WARMING UP 3 OF 3";
        if (headline) headline.textContent = "Spotlight the orchestra";
        if (copy) copy.textContent = "Hold one finger upright, then aim at a section to bring it forward.";
        if (handLeft) handLeft.style.display = "none";
        if (handRight) handRight.style.display = "none";
        if (handPointer) handPointer.style.display = "block";
        break;
    }
  }

  private startAnimationLoop(): void {
    if (typeof requestAnimationFrame === "undefined") return;
    const loop = (now: number) => {
      this.animateStep(now);
      if (typeof requestAnimationFrame !== "undefined") {
        this.animFrameId = requestAnimationFrame(loop);
      }
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private animateStep(now: number): void {
    if (!this.overlayEl) return;

    // If live tracking is active, don't drive needle/audio with synthetic animation
    if (this.isLiveTracking) return;

    const elapsed = (now - this.animStartTime) / 1000;
    const mapping = this.getAxisMapping();
    const isFlipped = mapping === "flipped";

    const handLeft = this.overlayEl.querySelector("#warmup-hand-left") as SVGElement | null;
    const handRight = this.overlayEl.querySelector("#warmup-hand-right") as SVGElement | null;
    const handPointer = this.overlayEl.querySelector("#warmup-hand-pointer") as SVGElement | null;

    if (this.prefersReducedMotion) {
      // In reduced motion, stay at clean stationary demonstration poses
      if (handLeft) handLeft.setAttribute("transform", "translate(220, 220)");
      if (handRight) handRight.setAttribute("transform", "translate(380, 220)");
      if (handPointer) handPointer.setAttribute("transform", "translate(300, 240)");
      return;
    }

    if (this.currentLesson === "tempo") {
      // Periodic sinusoidal oscillation (~2.5s cycle)
      const phase = (elapsed % 2.5) / 2.5; // 0 -> 1
      const sinVal = Math.sin(phase * Math.PI * 2); // -1 -> 1
      const normalized01 = (sinVal + 1) / 2; // 0 (low) -> 1 (high)

      if (isFlipped) {
        // Flipped: Width modulates tempo
        const spread = 80 + normalized01 * 120; // 80 to 200px
        if (handLeft) handLeft.setAttribute("transform", `translate(${300 - spread}, 230)`);
        if (handRight) handRight.setAttribute("transform", `translate(${300 + spread}, 230)`);
      } else {
        // Classic: Height modulates tempo
        const yPos = 280 - normalized01 * 140; // 280 (low) to 140 (high)
        if (handLeft) handLeft.setAttribute("transform", `translate(220, ${yPos})`);
        if (handRight) handRight.setAttribute("transform", `translate(380, ${yPos})`);
      }

      // Sync tempo needle: 70 BPM (slow) to 160 BPM (fast)
      const demoBpm = 70 + normalized01 * 90;
      this.onTempoSync?.(demoBpm, true);
    } else if (this.currentLesson === "dynamics") {
      const phase = (elapsed % 2.5) / 2.5;
      const sinVal = Math.sin(phase * Math.PI * 2);
      const normalized01 = (sinVal + 1) / 2; // 0 (soft) -> 1 (loud)

      if (isFlipped) {
        // Flipped: Height modulates dynamics
        const yPos = 280 - normalized01 * 140;
        if (handLeft) handLeft.setAttribute("transform", `translate(220, ${yPos})`);
        if (handRight) handRight.setAttribute("transform", `translate(380, ${yPos})`);
      } else {
        // Classic: Width modulates dynamics
        const spread = 70 + normalized01 * 140; // 70 to 210px
        if (handLeft) handLeft.setAttribute("transform", `translate(${300 - spread}, 230)`);
        if (handRight) handRight.setAttribute("transform", `translate(${300 + spread}, 230)`);
      }

      // Sync dynamics ladder & volume
      const level = normalized01 > 0.75 ? "ff" : normalized01 > 0.5 ? "f" : normalized01 > 0.25 ? "mf" : "p";
      this.onDynamicsSync?.(level, normalized01);
    } else if (this.currentLesson === "spotlight") {
      // Hand pointer ray sweeps across stage (~3s cycle)
      const phase = (elapsed % 3.0) / 3.0;
      const sweepX = 260 + Math.sin(phase * Math.PI * 2) * 90; // sweeps left to right
      if (handPointer) {
        handPointer.setAttribute("transform", `translate(${sweepX}, 250)`);
      }

      // Intersect sections visually
      const targetSec = sweepX < 280 ? "violin1" : sweepX < 320 ? "violin2" : "viola";
      this.onSpotlightSync?.(targetSec);
    }
  }

  unmount(): void {
    this.destroy();
  }

  destroy(): void {
    if (this.animFrameId) {
      if (typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(this.animFrameId);
      }
      this.animFrameId = null;
    }
    if (this.overlayEl && this.overlayEl.parentNode) {
      this.overlayEl.parentNode.removeChild(this.overlayEl);
    }
    this.overlayEl = null;
  }
}
