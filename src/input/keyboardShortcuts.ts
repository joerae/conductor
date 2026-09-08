/**
 * keyboardShortcuts.ts
 *
 * Handles keyboard shortcuts, hotkeys, mouse wheel dynamics adjustments,
 * and first-gesture audio unlock events.
 */

import type { ExperienceController } from "../experience/ExperienceController";
import type { TempoMode } from "../clock/ConductorClock";

export interface KeyboardShortcutsOptions {
  controller: ExperienceController;
  isModalOpen: () => boolean;
  closeModals: () => void;
  onToggleInputSource: () => void;
  onSetTempoMode: (mode: TempoMode) => void;
  onToggleScoreVisualizer: () => void;
  onRerunWarmup: () => void;
  onWarmupSpacebar: () => void;
  onUnlockAudio: () => void;
}

export function setupKeyboardShortcuts(options: KeyboardShortcutsOptions): () => void {
  const {
    controller,
    isModalOpen,
    closeModals,
    onToggleInputSource,
    onSetTempoMode,
    onToggleScoreVisualizer,
    onRerunWarmup,
    onWarmupSpacebar,
    onUnlockAudio,
  } = options;

  // Mouse wheel scroll to adjust orchestral dynamics
  let wheelAccumulator = 0;
  const handleWheel = (e: WheelEvent) => {
    // If user is scrolling inside a modal list, allow normal scrolling
    if ((e.target as HTMLElement)?.closest(".modal-body")) return;

    e.preventDefault();
    wheelAccumulator += e.deltaY;
    if (wheelAccumulator <= -35) {
      controller.stepDynamicLevel(1); // Louder
      wheelAccumulator = 0;
    } else if (wheelAccumulator >= 35) {
      controller.stepDynamicLevel(-1); // Softer
      wheelAccumulator = 0;
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      closeModals();
      return;
    }

    if (isModalOpen()) return;

    if (e.code === "Space") {
      onWarmupSpacebar();
    }

    if (e.code === "KeyC" && !e.repeat) {
      onToggleInputSource();
    } else if (e.code === "KeyT" && !e.repeat) {
      const current = controller.getTempoMode();
      const nextMode: TempoMode = current === "magic" ? "gestural" : "magic";
      onSetTempoMode(nextMode);
    } else if (e.code === "Digit1" && !e.repeat) {
      onSetTempoMode("magic");
    } else if (e.code === "Digit2" && !e.repeat) {
      onSetTempoMode("gestural");
    } else if (e.code === "Digit3" && !e.repeat) {
      onSetTempoMode("magic");
    } else if (e.code === "KeyP" && !e.repeat) {
      controller.togglePause();
    } else if (e.code === "KeyS" && !e.repeat) {
      onToggleScoreVisualizer();
    } else if (e.code === "ArrowUp") {
      e.preventDefault();
      controller.nudgeGesturalBpm(5);
    } else if (e.code === "ArrowDown") {
      e.preventDefault();
      controller.nudgeGesturalBpm(-5);
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      controller.stepDynamicLevel(1);
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      controller.stepDynamicLevel(-1);
    } else if (e.code === "Backslash" && !e.repeat) {
      e.preventDefault();
      controller.armAccent();
    } else if (e.code === "KeyW" && !e.repeat) {
      e.preventDefault();
      onRerunWarmup();
    }
  };

  const handleAudioGesture = () => {
    onUnlockAudio();
  };

  window.addEventListener("wheel", handleWheel, { passive: false });
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("pointerdown", handleAudioGesture, { once: true });
  window.addEventListener("keydown", handleAudioGesture, { once: true });

  return () => {
    window.removeEventListener("wheel", handleWheel);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("pointerdown", handleAudioGesture);
    window.removeEventListener("keydown", handleAudioGesture);
  };
}
