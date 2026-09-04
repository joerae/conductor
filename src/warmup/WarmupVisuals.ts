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
  onToggleMute?: () => void;
}

export class WarmupVisuals {
  private container: HTMLElement | null = null;
  private overlayEl: HTMLElement | null = null;
  private callbacks: WarmupVisualsCallbacks;
  private getAxisMapping: () => CameraAxisMapping;
  private getInputMode: () => "camera" | "keyboard";

  private currentLesson: WarmupLessonId = "tempo";
  private displayState: WarmupDisplayState = "awaiting_interaction";
  private isMuted: boolean = false;
  private isReturningUser: boolean = false;
  private prefersReducedMotion: boolean = false;

  private animFrameId: number | null = null;
  private animStartTime: number = 0;
  private isLiveTracking: boolean = false;
  private userSelectedLesson: boolean = false;
  private liveHandPoints: { x: number; y: number }[] | null = null;
  private hasLiveConductorInput: boolean = false;

  // External sync callbacks
  public onTempoSync?: (bpm: number, isDemo: boolean) => void;
  public onDynamicsSync?: (level: string, continuous: number) => void;

  constructor(
    callbacks?: Partial<WarmupVisualsCallbacks>,
    getAxisMapping: () => CameraAxisMapping = () => "classic",
    getInputMode: () => "camera" | "keyboard" = () => "camera"
  ) {
    this.callbacks = {
      onStartWarmup: () => {},
      onSkipWarmup: () => {},
      onStartConducting: () => {},
      onContinueKeyboard: () => {},
      onRetryCamera: () => {},
      ...callbacks,
    };
    this.getAxisMapping = getAxisMapping;
    this.getInputMode = getInputMode;

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

  getDisplayState(): WarmupDisplayState {
    return this.displayState;
  }

  setLiveHandPoints(points: { x: number; y: number }[] | null): void {
    this.liveHandPoints = points && points.length > 0 ? points : null;
    this.hasLiveConductorInput = !!(this.liveHandPoints && this.liveHandPoints.length > 0);
  }

  setReturningUser(isReturning: boolean): void {
    this.isReturningUser = isReturning;
    if (this.overlayEl) {
      this.overlayEl.classList.toggle("returning-user", isReturning);
      const animStage = this.overlayEl.querySelector("#warmup-animation-stage") as HTMLElement | null;
      if (animStage) animStage.style.display = isReturning ? "none" : "block";
      const pills = this.overlayEl.querySelector("#warmup-lesson-pills") as HTMLElement | null;
      if (pills) pills.style.display = isReturning ? "none" : "flex";
      const skipBtn = this.overlayEl.querySelector("#warmup-skip-btn") as HTMLElement | null;
      if (skipBtn) skipBtn.style.display = isReturning ? "none" : "inline-flex";
    }
    this.updateLessonUI();
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
  }

  isSoundMuted(): boolean {
    return this.isMuted;
  }

  isLiveTrackingActive(): boolean {
    return this.isLiveTracking;
  }

  isConductorInputActive(): boolean {
    return this.hasLiveConductorInput;
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
          <g id="warmup-hand-left" class="warmup-hand-group" transform="translate(220, 200)">
            <path class="hand-silhouette" d="M -25,35 C -30,15 -25,-15 -20,-30 C -18,-35 -12,-35 -10,-28 C -7,-18 -7,5 -10,18 C -5,-15 2,-25 6,-25 C 9,-25 12,-18 9,0 C 13,-12 18,-18 22,-18 C 26,-18 28,-12 25,8 C 28,-5 34,-8 37,-6 C 40,-3 39,8 33,22 C 25,40 10,55 -5,55 C -18,55 -22,48 -25,35 Z" fill="rgba(255, 213, 107, 0.12)" stroke="url(#warmup-gold-grad)" stroke-width="2.2" filter="url(#gold-glow-filter)" />
          </g>

          <!-- Right Hand Silhouette Group -->
          <g id="warmup-hand-right" class="warmup-hand-group" transform="translate(380, 200)">
            <path class="hand-silhouette" d="M 25,35 C 30,15 25,-15 20,-30 C 18,-35 12,-35 10,-28 C 7,-18 7,5 10,18 C 5,-15 -2,-25 -6,-25 C -9,-25 -12,-18 -9,0 C -13,-12 -18,-18 -22,-18 C -26,-18 -28,-12 -25,8 C -28,-5 -34,-8 -37,-6 C -40,-3 -39,8 -33,22 C -25,40 -10,55 5,55 C 18,55 22,48 25,35 Z" fill="rgba(255, 213, 107, 0.12)" stroke="url(#warmup-gold-grad)" stroke-width="2.2" filter="url(#gold-glow-filter)" />
          </g>
        </svg>
      </div>

      <!-- Compact Glassmorphism Instruction Card (Bottom of Frame) -->
      <div class="warmup-card" id="warmup-card">
        <div class="warmup-card-header">
          <div class="warmup-card-header-left" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="warmup-step-badge" id="warmup-step-badge">STEP 1: SPEED (TEMPO)</span>
            <div class="warmup-lesson-pills" id="warmup-lesson-pills" role="tablist" aria-label="Tutorial lessons">
              <button class="warmup-lesson-pill active" data-lesson="tempo" id="pill-tempo" role="tab" aria-selected="true">⚡ Speed</button>
              <button class="warmup-lesson-pill" data-lesson="dynamics" id="pill-dynamics" role="tab" aria-selected="false">🔊 Volume</button>
            </div>
          </div>
          <div class="warmup-card-actions">
            <button id="warmup-skip-btn" class="warmup-pill-btn secondary" aria-label="Skip warming up">
              Skip
            </button>
          </div>
        </div>

        <h2 class="warmup-headline" id="warmup-headline">Shape the tempo</h2>
        <p class="warmup-copy" id="warmup-copy">
          Raise your hands higher to speed up. Lower them to slow down. Watch the tempo speedometer to your right.
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
            <span class="warmup-task-status" id="warmup-task-status">Tuning instruments...</span>
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
          <!-- Ready State Button (High-contrast, unmissable call-to-action) -->
          <button id="warmup-ready-btn" class="warmup-primary-btn ready-glow prominent-cta" style="display: none;">
            🪄 START CONDUCTING — TRY IT NOW ➔
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
    this.setReturningUser(this.isReturningUser);
    this.startAnimationLoop();
    this.updateLessonUI();
    this.updateDisplayStateUI();
  }

  private bindEvents(): void {
    if (!this.overlayEl) return;

    this.overlayEl.querySelector("#pill-tempo")?.addEventListener("click", () => {
      this.userSelectedLesson = true;
      this.setLesson("tempo");
    });

    this.overlayEl.querySelector("#pill-dynamics")?.addEventListener("click", () => {
      this.userSelectedLesson = true;
      this.setLesson("dynamics");
    });

    this.overlayEl.querySelector("#warmup-start-audio-btn")?.addEventListener("click", () => {
      this.callbacks.onStartWarmup();
    });

    this.overlayEl.querySelector("#warmup-use-keyboard-btn")?.addEventListener("click", () => {
      this.callbacks.onContinueKeyboard();
    });

    this.overlayEl.querySelector("#warmup-skip-btn")?.addEventListener("click", () => {
      this.callbacks.onSkipWarmup();
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
    const badge = this.overlayEl.querySelector("#warmup-step-badge");
    const headline = this.overlayEl.querySelector("#warmup-headline");
    const copy = this.overlayEl.querySelector("#warmup-copy");

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
      case "ready": {
        const isCam = this.getInputMode() === "camera";
        if (readyBtn) {
          readyBtn.textContent = isCam ? "🪄 RAISE HANDS TO BEGIN ➔" : "⌨️ PRESS SPACE TO BEGIN ➔";
          readyBtn.style.display = "inline-flex";
        }
        if (skipBtn) skipBtn.style.display = "none";
        if (headline) headline.textContent = "Ready to Conduct!";
        if (badge) badge.textContent = "✓ ORCHESTRA READY • BATON IN HAND";
        if (copy) {
          copy.textContent = isCam ? "Raise your hands to begin" : "Press SPACE to begin";
        }
        break;
      }
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

    const pillTempo = this.overlayEl.querySelector("#pill-tempo");
    const pillDynamics = this.overlayEl.querySelector("#pill-dynamics");
    if (pillTempo) pillTempo.classList.toggle("active", this.currentLesson === "tempo");
    if (pillDynamics) pillDynamics.classList.toggle("active", this.currentLesson === "dynamics");

    const mapping = this.getAxisMapping();
    const isFlipped = mapping === "flipped";

    if (this.displayState === "ready") {
      const isCam = this.getInputMode() === "camera";
      if (badge) badge.textContent = "✓ ORCHESTRA READY • BATON IN HAND";
      if (headline) headline.textContent = "Ready to Conduct!";
      if (copy) copy.textContent = isCam ? "Raise your hands to begin" : "Press SPACE to begin";
      return;
    }

    if (this.isReturningUser) {
      if (badge) badge.textContent = "WELCOME BACK";
      if (headline) headline.textContent = "Tuning the Orchestra…";
      if (copy) copy.textContent = "Preparing instruments for your performance.";
      if (handLeft) handLeft.style.display = "none";
      if (handRight) handRight.style.display = "none";
      return;
    }

    switch (this.currentLesson) {
      case "tempo":
        if (badge) {
          badge.textContent = "STEP 1 OF 2: SPEED (TEMPO)";
        }
        if (headline) headline.textContent = "Shape the tempo";
        if (copy) {
          copy.textContent = isFlipped
            ? "Move your hands apart to speed up. Bring them together to slow down. Watch the tempo speedometer to your right."
            : "Raise your hands higher to speed up. Lower them to slow down. Watch the tempo speedometer to your right.";
        }
        if (handLeft) handLeft.style.display = "block";
        if (handRight) handRight.style.display = "block";
        break;

      case "dynamics":
        if (badge) {
          badge.textContent = "STEP 2 OF 2: VOLUME (DYNAMICS)";
        }
        if (headline) headline.textContent = "Shape the volume";
        if (copy) {
          copy.textContent = isFlipped
            ? "Raise your hands higher for louder (fff). Lower them for softer (pp). Watch the dynamics ribbon below."
            : "Move your hands apart for louder (fff). Bring them together for softer (pp). Watch the dynamics ribbon below.";
        }
        if (handLeft) handLeft.style.display = "block";
        if (handRight) handRight.style.display = "block";
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

    // If returning user, don't display tutorial animations
    if (this.isReturningUser) return;

    const handLeft = this.overlayEl.querySelector("#warmup-hand-left") as SVGElement | null;
    const handRight = this.overlayEl.querySelector("#warmup-hand-right") as SVGElement | null;

    // If live hand points are actively present from camera tracking, follow user's hands!
    if (this.liveHandPoints && this.liveHandPoints.length > 0) {
      const sorted = [...this.liveHandPoints].sort((a, b) => a.x - b.x);
      const leftPt = sorted[0];
      const rightPt = sorted.length > 1 ? sorted[1] : null;

      if (handLeft) {
        handLeft.style.display = "block";
        handLeft.setAttribute("transform", `translate(${Math.round(leftPt.x)}, ${Math.round(leftPt.y)})`);
      }
      if (handRight) {
        handRight.style.display = "block";
        if (rightPt) {
          handRight.setAttribute("transform", `translate(${Math.round(rightPt.x)}, ${Math.round(rightPt.y)})`);
        } else {
          // If only 1 hand visible, mirror across center
          const mirrorX = Math.max(320, 600 - leftPt.x);
          handRight.setAttribute("transform", `translate(${Math.round(mirrorX)}, ${Math.round(leftPt.y)})`);
        }
      }
      // Live hands are actively driving; do not override with synthetic demo updates
      return;
    }

    const elapsed = (now - this.animStartTime) / 1000;
    const mapping = this.getAxisMapping();
    const isFlipped = mapping === "flipped";

    // Auto-advance between Speed and Volume tutorials if user has not manually clicked a tab
    if (!this.userSelectedLesson && elapsed > 8.0 && this.displayState !== "ready") {
      this.setLesson(this.currentLesson === "tempo" ? "dynamics" : "tempo");
      return;
    }

    if (this.prefersReducedMotion) {
      // In reduced motion, stay at clean stationary demonstration poses
      if (handLeft) handLeft.setAttribute("transform", "translate(220, 200)");
      if (handRight) handRight.setAttribute("transform", "translate(380, 200)");
      return;
    }

    // Deliberate, graceful 5.4-second conducting cycle with cosine easing
    const CYCLE_DURATION = 5.4;
    const phase = (elapsed % CYCLE_DURATION) / CYCLE_DURATION; // 0 -> 1
    const eased = (1 - Math.cos(phase * Math.PI * 2)) / 2; // 0 (min) -> 1 (max) -> 0 (min)

    if (this.currentLesson === "tempo") {
      if (isFlipped) {
        // Flipped: Width modulates tempo
        const spread = 60 + eased * 140; // 60 to 200px
        if (handLeft) handLeft.setAttribute("transform", `translate(${300 - spread}, 200)`);
        if (handRight) handRight.setAttribute("transform", `translate(${300 + spread}, 200)`);
      } else {
        // Classic: Height modulates tempo with deliberate broad travel
        const yPos = 260 - eased * 150; // 260 (low, slow) down to 110 (high, fast)
        if (handLeft) handLeft.setAttribute("transform", `translate(220, ${yPos})`);
        if (handRight) handRight.setAttribute("transform", `translate(380, ${yPos})`);
      }

      // Sync tempo needle and audio smoothly: 52 BPM (Largo) to 162 BPM (Presto)
      const demoBpm = Math.round(52 + eased * 110);
      this.onTempoSync?.(demoBpm, true);
    } else if (this.currentLesson === "dynamics") {
      if (isFlipped) {
        // Flipped: Height modulates dynamics
        const yPos = 260 - eased * 150;
        if (handLeft) handLeft.setAttribute("transform", `translate(220, ${yPos})`);
        if (handRight) handRight.setAttribute("transform", `translate(380, ${yPos})`);
      } else {
        // Classic: Width modulates dynamics with broad horizontal travel
        const spread = 45 + eased * 165; // 45px (intimate pp) to 210px (expansive fff)
        if (handLeft) handLeft.setAttribute("transform", `translate(${300 - spread}, 200)`);
        if (handRight) handRight.setAttribute("transform", `translate(${300 + spread}, 200)`);
      }

      // Sync dynamics ladder, analogue pip, badge & audio volume
      const continuous = 0.05 + eased * 0.90;
      const level =
        continuous >= 0.88 ? "fff" :
        continuous >= 0.72 ? "ff" :
        continuous >= 0.56 ? "f" :
        continuous >= 0.42 ? "mf" :
        continuous >= 0.26 ? "mp" :
        continuous >= 0.14 ? "p" : "pp";

      this.onDynamicsSync?.(level, continuous);
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
