/**
 * LoadingCoordinator.ts
 *
 * Coordinates structured load milestones, computes monotonic progress,
 * and maintains honest, non-technical status messages for the warming up experience.
 */

import type { ConductorLoadState, LoadTaskStatus } from "./WarmupTypes";

export type LoadMode = "camera" | "keyboard";

export interface TaskWeights {
  shell: number;
  warmupViolin: number;
  score: number;
  instruments: number;
  cameraPermission: number;
  handTracking: number;
}

const DEFAULT_WEIGHTS: TaskWeights = {
  shell: 0.05,
  warmupViolin: 0.10,
  score: 0.15,
  instruments: 0.40,
  cameraPermission: 0.10,
  handTracking: 0.20,
};

export class LoadingCoordinator {
  private mode: LoadMode = "camera";
  private state: ConductorLoadState = {
    shell: "pending",
    warmupViolin: "pending",
    score: "pending",
    instruments: "pending",
    cameraPermission: "pending",
    handTracking: "pending",
    progress: 0,
    statusMessage: "Preparing the stage...",
    isReady: false,
    failedOptionalTasks: [],
  };

  private maxReportedProgress = 0;
  private listeners: Set<(state: ConductorLoadState) => void> = new Set();
  private weights: TaskWeights = { ...DEFAULT_WEIGHTS };

  constructor(initialMode: LoadMode = "camera") {
    this.mode = initialMode;
  }

  onStateChange(callback: (state: ConductorLoadState) => void): () => void {
    this.listeners.add(callback);
    callback(this.getState());
    return () => this.listeners.delete(callback);
  }

  private fastPathEligible: boolean = false;
  private customMessage: string | null = null;

  getState(): ConductorLoadState {
    return { ...this.state, failedOptionalTasks: [...this.state.failedOptionalTasks] };
  }

  setFastPathEligible(eligible: boolean): void {
    this.fastPathEligible = eligible;
  }

  isFastPathEligible(): boolean {
    return this.fastPathEligible;
  }

  setMode(mode: LoadMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.recalculate();
  }

  getMode(): LoadMode {
    return this.mode;
  }

  updateTask(task: keyof TaskWeights, status: LoadTaskStatus, customMessage?: string): void {
    if (customMessage !== undefined) {
      this.customMessage = customMessage;
    }
    this.state[task] = status;

    if (status === "error") {
      if (!this.state.failedOptionalTasks.includes(task)) {
        this.state.failedOptionalTasks.push(task);
      }
    } else if (status === "ready") {
      const idx = this.state.failedOptionalTasks.indexOf(task);
      if (idx !== -1) {
        this.state.failedOptionalTasks.splice(idx, 1);
      }
    }

    this.recalculate();
  }

  private recalculate(): void {
    const isKeyboard = this.mode === "keyboard";

    // Required tasks check
    const coreReady =
      this.state.shell === "ready" &&
      this.state.score === "ready" &&
      this.state.instruments === "ready";

    const cameraReady =
      this.state.cameraPermission === "ready" &&
      this.state.handTracking === "ready";

    const isReady = isKeyboard ? coreReady : (coreReady && cameraReady);

    // Calculate raw weighted progress
    let rawProgress = 0;
    if (isKeyboard) {
      // Re-normalize weights across non-camera tasks (sum = 0.70)
      const coreWeightSum =
        this.weights.shell +
        this.weights.warmupViolin +
        this.weights.score +
        this.weights.instruments;

      if (this.state.shell === "ready") rawProgress += this.weights.shell / coreWeightSum;
      if (this.state.warmupViolin === "ready") rawProgress += this.weights.warmupViolin / coreWeightSum;
      if (this.state.score === "ready") rawProgress += this.weights.score / coreWeightSum;
      if (this.state.instruments === "ready") rawProgress += this.weights.instruments / coreWeightSum;
    } else {
      // Full camera mode weights
      if (this.state.shell === "ready") rawProgress += this.weights.shell;
      if (this.state.warmupViolin === "ready") rawProgress += this.weights.warmupViolin;
      if (this.state.score === "ready") rawProgress += this.weights.score;
      if (this.state.instruments === "ready") rawProgress += this.weights.instruments;
      if (this.state.cameraPermission === "ready") rawProgress += this.weights.cameraPermission;
      if (this.state.handTracking === "ready") rawProgress += this.weights.handTracking;
    }

    // Progress in percent [0, 100]
    let pct = Math.round(rawProgress * 100);

    // If ready, progress is 100%. If not ready, cap at 99%
    if (isReady) {
      pct = 100;
    } else {
      pct = Math.min(99, pct);
    }

    // Monotonicity rule: never move backwards
    this.maxReportedProgress = Math.max(this.maxReportedProgress, pct);
    this.state.progress = this.maxReportedProgress;
    this.state.isReady = isReady;
    this.state.statusMessage = this.deriveStatusMessage();

    this.emit();
  }

  private deriveStatusMessage(): string {
    if (this.state.isReady) {
      return "Your orchestra is ready";
    }

    if (this.customMessage) {
      return this.customMessage;
    }

    if (this.state.cameraPermission === "error" || this.state.handTracking === "error") {
      if (this.mode === "keyboard") {
        if (this.state.instruments === "loading") return "Tuning the orchestra...";
        if (this.state.score === "loading") return "Opening the score...";
        return "Camera unavailable. Keyboard conducting is ready.";
      }
      return "Camera unavailable. You can continue with keyboard.";
    }

    if (this.state.handTracking === "loading") {
      return "Teaching the camera to see your hands...";
    }

    if (this.state.cameraPermission === "loading") {
      return "Waiting for camera permission...";
    }

    if (this.state.instruments === "loading") {
      return "Tuning the orchestra...";
    }

    if (this.state.score === "loading") {
      return "Opening the score...";
    }

    if (this.state.warmupViolin === "loading") {
      return "Tuning the first violin...";
    }

    if (this.state.warmupViolin === "ready" && !this.state.isReady) {
      return "Violin ready. Try the controls.";
    }

    return "Warming up the orchestra...";
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.warn("LoadingCoordinator listener error:", err);
      }
    }
  }

  reset(): void {
    this.state = {
      shell: "pending",
      warmupViolin: "pending",
      score: "pending",
      instruments: "pending",
      cameraPermission: "pending",
      handTracking: "pending",
      progress: 0,
      statusMessage: "Preparing the stage...",
      isReady: false,
      failedOptionalTasks: [],
    };
    this.maxReportedProgress = 0;
    this.emit();
  }
}
