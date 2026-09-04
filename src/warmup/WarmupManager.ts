/**
 * WarmupManager.ts
 *
 * Orchestrates LoadingCoordinator, WarmupAudioPlayer, and WarmupVisuals.
 * Manages the interactive sequence lifecycle, lesson transitions, returning user fast-path,
 * and clean musical handoff to the live conducting experience.
 */

import { LoadingCoordinator } from "./LoadingCoordinator";
import { WarmupAudioPlayer } from "./WarmupAudioPlayer";
import { WarmupVisuals } from "./WarmupVisuals";
import type { WarmupLessonId, WarmupManagerOptions } from "./WarmupTypes";

export const ONBOARDING_STORAGE_KEY = "conductor:onboarding-version";
export const CURRENT_ONBOARDING_VERSION = "1";

export class WarmupManager {
  private coordinator: LoadingCoordinator;
  private audioPlayer: WarmupAudioPlayer;
  private visuals: WarmupVisuals | null = null;
  private options: WarmupManagerOptions;

  private isRunning: boolean = false;
  private isMuted: boolean = false;
  private isReturningUser: boolean = false;
  private currentLessonIndex: number = 0;
  private lessonTimerId: ReturnType<typeof setTimeout> | null = null;
  private lessons: WarmupLessonId[] = ["tempo", "dynamics", "spotlight"];

  constructor(options: Partial<WarmupManagerOptions> = {}) {
    this.options = {
      onStartConducting: () => {},
      onContinueKeyboard: () => {},
      ...options,
    };
    this.coordinator = new LoadingCoordinator("camera");
    this.audioPlayer = new WarmupAudioPlayer();

    if (typeof localStorage !== "undefined") {
      const storedVersion = localStorage.getItem(ONBOARDING_STORAGE_KEY);
      this.isReturningUser = storedVersion === CURRENT_ONBOARDING_VERSION;
    }
  }

  getCoordinator(): LoadingCoordinator {
    return this.coordinator;
  }

  getAudioPlayer(): WarmupAudioPlayer {
    return this.audioPlayer;
  }

  getCurrentLesson(): WarmupLessonId | "ready" | "nearly_ready" | "countdown" {
    if (this.currentLessonIndex >= this.lessons.length) {
      return "ready";
    }
    return this.lessons[this.currentLessonIndex];
  }

  advanceLesson(): void {
    if (this.lessonTimerId) {
      clearTimeout(this.lessonTimerId);
      this.lessonTimerId = null;
    }
    this.currentLessonIndex++;
    this.presentCurrentLesson();
  }

  mount(container: HTMLElement, audioCtx?: AudioContext): void {
    if (audioCtx) {
      this.audioPlayer.init(audioCtx);
    }

    this.visuals = new WarmupVisuals(
      {
        onStartWarmup: () => this.handleStartWarmupWithGesture(),
        onSkipWarmup: () => this.handleSkipWarmup(),
        onStartConducting: () => this.handleStartConducting(),
        onContinueKeyboard: () => this.handleContinueKeyboard(),
        onRetryCamera: () => this.options.onRetryCamera?.(),
        onToggleMute: () => this.toggleMute(),
      },
      () => this.options.getCameraAxisMapping?.() ?? "classic"
    );

    this.visuals.setReturningUser(this.isReturningUser);
    this.visuals.setMuted(this.isMuted);
    this.visuals.mount(container);

    // Wire visual demonstration to audio player & host callbacks
    this.visuals.onTempoSync = (bpm, isDemo) => {
      this.audioPlayer.setTempo(bpm);
      this.options.onTempoDemonstration?.(bpm, isDemo);
    };

    this.visuals.onDynamicsSync = (level, continuous) => {
      this.audioPlayer.setDynamic(level, continuous);
      this.options.onDynamicsDemonstration?.(level, continuous);
    };

    this.visuals.onSpotlightSync = (sectionId) => {
      this.audioPlayer.setSpotlightSection(sectionId);
      this.options.onSpotlightSection?.(sectionId);
    };

    // Subscribe to loading state
    this.coordinator.onStateChange((state) => {
      this.visuals?.updateLoadProgress(state);

      if (state.warmupViolin === "ready") {
        this.audioPlayer.enableAccompaniment(state.instruments === "ready");
      }

      // If returning user and all ready, auto-advance
      if (this.isReturningUser && state.isReady) {
        this.handleStartConducting();
      }
    });

    // If returning user or user gesture already handled, set display state
    if (this.isReturningUser) {
      this.visuals.setDisplayState("nearly_ready");
    } else {
      this.visuals.setDisplayState("awaiting_interaction");
    }
  }

  /**
   * Called when user clicks "Start musical warm-up" or when gesture unlocks audio.
   */
  async handleStartWarmupWithGesture(audioCtx?: AudioContext): Promise<void> {
    if (audioCtx) {
      this.audioPlayer.init(audioCtx);
    }
    this.audioPlayer.start();
    this.isRunning = true;

    if (this.visuals) {
      this.visuals.setDisplayState("lesson");
      this.startLessonSequence();
    }
  }

  private startLessonSequence(): void {
    this.currentLessonIndex = 0;
    this.presentCurrentLesson();
  }

  private presentCurrentLesson(): void {
    if (!this.visuals) return;

    if (this.currentLessonIndex >= this.lessons.length) {
      // Finished all 3 lessons
      const isReady = this.coordinator.getState().isReady;
      this.visuals.setDisplayState(isReady ? "ready" : "nearly_ready");
      return;
    }

    const lesson = this.lessons[this.currentLessonIndex];
    this.visuals.setLesson(lesson);

    const duration = lesson === "spotlight" ? 3000 : 2500;
    this.lessonTimerId = setTimeout(() => {
      this.currentLessonIndex++;
      this.presentCurrentLesson();
    }, duration);
  }

  handleLiveSample(sample: { tempoBpm?: number; dynamicLevel?: string; dynamicContinuous?: number }): void {
    if (!this.isRunning) return;

    this.visuals?.setLiveTrackingActive(true);

    if (sample.tempoBpm) {
      this.audioPlayer.setTempo(sample.tempoBpm);
      this.options.onTempoDemonstration?.(sample.tempoBpm, false);
    }
    if (sample.dynamicLevel && sample.dynamicContinuous !== undefined) {
      this.audioPlayer.setDynamic(sample.dynamicLevel, sample.dynamicContinuous);
      this.options.onDynamicsDemonstration?.(sample.dynamicLevel, sample.dynamicContinuous);
    }
  }

  setCameraError(_errMessage?: string): void {
    this.coordinator.updateTask("cameraPermission", "error");
    this.visuals?.setDisplayState("camera_failed");
  }

  handleContinueKeyboard(): void {
    this.coordinator.setMode("keyboard");
    this.options.onContinueKeyboard();
    const isReady = this.coordinator.getState().isReady;
    this.visuals?.setDisplayState(isReady ? "ready" : "nearly_ready");
  }

  handleSkipWarmup(): void {
    if (this.lessonTimerId) {
      clearTimeout(this.lessonTimerId);
      this.lessonTimerId = null;
    }
    const isReady = this.coordinator.getState().isReady;
    this.visuals?.setDisplayState(isReady ? "ready" : "nearly_ready");

    if (isReady) {
      this.handleStartConducting();
    }
  }

  toggleMute(): void {
    this.isMuted = !this.isMuted;
    this.audioPlayer.setMuted(this.isMuted);
    this.visuals?.setMuted(this.isMuted);
    this.options.onMuteToggle?.(this.isMuted);
  }

  async handleStartConducting(): Promise<void> {
    if (this.lessonTimerId) {
      clearTimeout(this.lessonTimerId);
      this.lessonTimerId = null;
    }

    // Mark completion in storage
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(ONBOARDING_STORAGE_KEY, CURRENT_ONBOARDING_VERSION);
      } catch {
        // Storage disabled/quota
      }
    }

    // Fade warm-up audio over 200ms
    await this.audioPlayer.fadeAndStop(200);

    // Clean up visuals
    this.visuals?.destroy();
    this.visuals = null;

    // Trigger host conducting start
    this.options.onStartConducting();
  }

  replayWarmup(container: HTMLElement, audioCtx?: AudioContext): void {
    this.isReturningUser = false;
    this.mount(container, audioCtx);
    this.handleStartWarmupWithGesture(audioCtx);
  }

  dispose(): void {
    this.destroy();
  }

  destroy(): void {
    if (this.lessonTimerId) {
      clearTimeout(this.lessonTimerId);
      this.lessonTimerId = null;
    }
    this.audioPlayer.dispose();
    this.visuals?.destroy();
    this.visuals = null;
  }
}
