/**
 * cameraWiring.ts
 *
 * Wires CameraBeatInputProvider event streams:
 * - Loading coordinator task state transitions & graceful error fallback to keyboard
 * - Rate-limited audio engine dynamics and dynamic ladder UI telemetry
 * - Instrument focus mode section mixing and spotlight panning
 * - Magic Finger mode auto-playback, BPM, and dynamic tracking
 * - Beat detection and real-time sample processing
 */

import type { CameraBeatInputProvider } from "../camera/CameraBeatInputProvider";
import type { CameraGestureHost } from "./cameraGestureHandler";
import { processCameraSamples } from "./cameraGestureHandler";
import type { DebugOverlay } from "../ui/DebugOverlay";
import type { LoadingCoordinator } from "../warmup/LoadingCoordinator";
import type { InputSource } from "./ExperienceController";
import type { DynamicLevel } from "../audio/dynamicsTypes";
import type { PieceSection } from "../score/repertoire";

export interface CameraWiringHost extends CameraGestureHost {
  activeCoordinator: LoadingCoordinator | null;
  baseDynamicLevel: DynamicLevel;
  debug: DebugOverlay;

  setInputSource(source: InputSource): Promise<void>;
  setLiveBpm(bpm: number): void;
  setContinuousDynamic(val: number): void;
  handleBeatObservation(obs: {
    timestampMs: number;
    source: "keyboard" | "camera";
    confidence: number;
  }): Promise<void>;
}

function findPieceSection(sections: PieceSection[] | undefined, targetSectionId: string): PieceSection | undefined {
  if (!sections) return undefined;
  return sections.find((s, idx) =>
    s.id === targetSectionId ||
    `section-${s.id}` === targetSectionId ||
    String(idx) === targetSectionId ||
    `section-${idx}` === targetSectionId ||
    targetSectionId.endsWith(s.id)
  );
}

/**
 * Connects a CameraBeatInputProvider instance to the experience controller host.
 */
export function wireCameraProvider(cameraInput: CameraBeatInputProvider, host: CameraWiringHost): void {
  // Wire camera state to loading coordinator & error fallback to keyboard mode
  cameraInput.onStateChange((state, err) => {
    if (state === "requesting_permission") {
      host.activeCoordinator?.updateTask("cameraPermission", "loading");
    } else if (state === "loading_model") {
      host.activeCoordinator?.updateTask("cameraPermission", "ready");
      host.activeCoordinator?.updateTask("handTracking", "loading");
    } else if (state === "tracking") {
      host.activeCoordinator?.updateTask("cameraPermission", "ready");
      host.activeCoordinator?.updateTask("handTracking", "ready");
    } else if (state === "error") {
      host.activeCoordinator?.updateTask("cameraPermission", "error");
      host.activeCoordinator?.updateTask("handTracking", "error");
      console.warn("Camera failed to load, gracefully falling back to keyboard mode:", err);
      void host.setInputSource("keyboard");
    }
  });

  // Wire camera dynamics directly into orchestral dynamic ladder & AudioEngine
  let lastAudioDynUpdateTime = 0;
  let lastAppliedDynamicValue = -1;

  cameraInput.onDynamics(dyn => {
    if (host.inputSource === "camera") {
      // Suppress global dynamics if actively in focus mode
      if (cameraInput.getFocusController().shouldSuppressGlobalDynamics()) {
        return;
      }
      const now = performance.now();
      // Rate-limit audio engine continuous dynamics to ~20 Hz (50ms interval) unless large step
      const valDiff = Math.abs(dyn.value - lastAppliedDynamicValue);
      if (now - lastAudioDynUpdateTime >= 50 || valDiff >= 0.05) {
        host.audioEngine.setContinuousDynamic(dyn.value);
        lastAudioDynUpdateTime = now;
        lastAppliedDynamicValue = dyn.value;
      }
      const snappedLevel = host.audioEngine.getDynamicLevel();
      if (snappedLevel !== host.baseDynamicLevel) {
        host.baseDynamicLevel = snappedLevel;
        host.uiCallbacks.onDynamicChange?.(snappedLevel);
        host.debug.updateDynamics(host.audioEngine.getDynamicsTelemetry());
      }
    }

    host.uiCallbacks.onCameraMotionSample?.({
      dynamicLevel: dyn.level,
      dynamicContinuous: dyn.value,
    });
  });

  // Wire Instrument Focus Mode telemetry & dynamic section mixing
  let lastAudioFocusUpdateTime = 0;
  let lastAppliedSectionId: string | null = null;
  let lastAppliedSectionFocus: number = -1;

  cameraInput.onFocus(focusTel => {
    if (host.inputSource === "camera") {
      const now = performance.now();
      const isFocused = focusTel.isActive && focusTel.grabbedSectionId && focusTel.sectionFocus > 0.001;
      const targetSectionId = isFocused ? focusTel.grabbedSectionId : null;
      const targetFocusAmount = isFocused ? focusTel.sectionFocus : 0;

      const hasSectionChanged = targetSectionId !== lastAppliedSectionId;
      const hasAmountChanged = Math.abs(targetFocusAmount - lastAppliedSectionFocus) > 0.005;

      if (hasSectionChanged || hasAmountChanged || (now - lastAudioFocusUpdateTime >= 50)) {
        if (targetSectionId && targetFocusAmount > 0.001) {
          const currentPiece = host.getCurrentPiece();
          const sec = findPieceSection(currentPiece?.sections, targetSectionId);
          if (sec) {
            host.audioEngine.setSectionFocus(sec.channels, targetFocusAmount);
          }
        } else if (lastAppliedSectionId !== null || lastAppliedSectionFocus > 0.001) {
          host.audioEngine.setSectionFocus(null, 0);
        }
        lastAppliedSectionId = targetSectionId;
        lastAppliedSectionFocus = targetFocusAmount;
        lastAudioFocusUpdateTime = now;
      }

      host.uiCallbacks.onFocusChange?.(focusTel);
    }
  });

  // Wire Magic Finger Mode callbacks & safe acquisition updates
  const mfController = cameraInput.getMagicFingerController();
  mfController.setCallbacks({
    onBpmChange: (bpm: number) => {
      host.setLiveBpm(bpm);
    },
    onDynamicChange: (val: number) => {
      host.setContinuousDynamic(val);
    },
    onSpotlightChange: (sectionId: string | null) => {
      if (sectionId) {
        const currentPiece = host.getCurrentPiece();
        const sec = findPieceSection(currentPiece?.sections, sectionId);
        if (sec) {
          host.audioEngine.setSectionFocus(sec.channels, 1.0);
          lastAppliedSectionId = sec.id;
          lastAppliedSectionFocus = 1.0;
          host.uiCallbacks.onFocusChange?.({
            isActive: true,
            state: "grabbed",
            hoveredSectionId: sec.id,
            grabbedSectionId: sec.id,
            sectionFocus: 1.0,
            pointerScreenPoint: null,
            pointingHandIndex: null,
            pinchDistanceRatio: 1.0,
          });
        }
      } else {
        host.audioEngine.setSectionFocus(null, 0);
        lastAppliedSectionId = null;
        lastAppliedSectionFocus = 0;
        host.uiCallbacks.onFocusChange?.({
          isActive: false,
          state: "idle",
          hoveredSectionId: null,
          grabbedSectionId: null,
          sectionFocus: 0,
          pointerScreenPoint: null,
          pointingHandIndex: null,
          pinchDistanceRatio: 1.0,
        });
      }
    },
  });

  cameraInput.onMagicFinger(magicTel => {
    if (host.inputSource === "camera") {
      cameraInput.setIndicatedBpm(host.indicatedBpm);
      const curDyn = host.audioEngine.getContinuousDynamic() ?? 0.5;
      cameraInput.setContinuousDynamic(curDyn);

      if (magicTel.isActive && (host.state === "ready" || host.state === "paused" || host.state === "completed")) {
        if (host.state === "completed") {
          host.restart();
        }
        void host.startPlayback();
      }

      host.uiCallbacks.onMagicFinger?.(magicTel);
    }
  });

  // Wire camera telemetry into debug overlay
  cameraInput.onTelemetry(t => {
    host.debug.updateCameraTelemetry(t);
  });

  // Wire camera beat observations into clock
  cameraInput.onBeat(obs => {
    void host.handleBeatObservation(obs);
  });

  // Wire sample tracking for hands-down detection & Mode E continuous height tempo
  cameraInput.onSamples(samples => {
    processCameraSamples(samples, host);
  });

  cameraInput.setOnClose(() => {
    void host.setInputSource("keyboard");
  });
}
