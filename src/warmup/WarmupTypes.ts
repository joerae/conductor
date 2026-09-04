/**
 * WarmupTypes.ts
 *
 * Types for the Conductor Interactive Warming Up Experience.
 */

import type { CameraAxisMapping } from "../experience/ExperienceController";

export type LoadTaskStatus = "pending" | "loading" | "ready" | "error";

export interface ConductorLoadState {
  shell: LoadTaskStatus;
  warmupViolin: LoadTaskStatus;
  score: LoadTaskStatus;
  instruments: LoadTaskStatus;
  cameraPermission: LoadTaskStatus;
  handTracking: LoadTaskStatus;
  progress: number;
  statusMessage: string;
  isReady: boolean;
  failedOptionalTasks: string[];
}

export type WarmupLessonId = "tempo" | "dynamics" | "spotlight";

export interface WarmupLessonConfig {
  id: WarmupLessonId;
  stepIndex: number;
  totalSteps: number;
  title: string;
  headline: string;
  copy: string;
  durationMs: number;
}

export type WarmupDisplayState =
  | "awaiting_interaction" // Showing initial shell, awaiting user gesture to unlock audio & camera
  | "lesson"               // Showing active tutorial lesson
  | "nearly_ready"         // All lessons finished, waiting for remaining assets
  | "ready"                // Required dependencies ready, start conducting available
  | "camera_failed";       // Camera denied/failed, keyboard conducting available

export interface WarmupManagerOptions {
  onStartConducting: () => void;
  onContinueKeyboard: () => void;
  onRetryCamera?: () => void;
  onMuteToggle?: (muted: boolean) => void;
  getCameraAxisMapping?: () => CameraAxisMapping;
  onSpotlightSection?: (sectionId: string | null) => void;
  onTempoDemonstration?: (bpm: number, isDemonstration: boolean) => void;
  onDynamicsDemonstration?: (level: string, continuous: number) => void;
}
