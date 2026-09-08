/**
 * cameraGestureHandler.ts
 *
 * Processes real-time camera tracking samples:
 * - Hands-down grace period & volume fade in Magic Finger Mode
 * - Thumbs-down dramatic cutoff gesture (👎)
 * - Double peace signs for Party Mode (✌️ + ✌️)
 * - Mode E continuous vertical/horizontal gestural tempo tracking with exponential slew filter
 * - Fermata auto-release on hands leaving camera frame
 */

import type { HandSample } from "../camera/cameraTypes";
import type { CameraAxisMapping } from "./gesturalTempoMath";
import { calculateGesturalTempoMultiplier } from "./gesturalTempoMath";
import type { AudioEngine } from "../audio/AudioEngine";
import type { ConductorClock, TempoMode } from "../clock/ConductorClock";
import type { ScoreTransport } from "../score/ScoreTransport";
import type { ExperienceState, InputSource, UICallbacks } from "./ExperienceController";
import type { CameraBeatInputProvider } from "../camera/CameraBeatInputProvider";

export interface CameraGestureHost {
  state: ExperienceState;
  inputSource: InputSource;
  cameraAxisMapping: CameraAxisMapping;
  isFocusModeEnabled: boolean;
  basePieceBpm: number;
  nominalPieceBpm: number;
  currentGesturalBpm: number;
  indicatedBpm: number;
  isFistCutoff: boolean;
  isPartyMode: boolean;
  isFermata: boolean;
  cutoffInitiatedPause: boolean;
  isHandsDown: boolean;
  handsDownPulseCount: number;
  magicNoHandsStartTime: number;
  isWarmingUp: boolean;
  lastGesturalUpdateMs: number;
  handYHistory: Map<number, number[]>;
  readonly HAND_Y_HISTORY_LEN: number;

  audioEngine: AudioEngine;
  clock: ConductorClock;
  transport: ScoreTransport;
  uiCallbacks: UICallbacks;
  cameraInput: CameraBeatInputProvider | null;

  getState(): ExperienceState;
  getInputSource(): InputSource;
  getCameraAxisMapping(): CameraAxisMapping;
  isFocusModeActive(): boolean;
  getTempoMode(): TempoMode;
  getBasePieceBpm(): number;
  getNominalPieceBpm(): number;
  getCurrentPiece(): any;
  pausePlayback(isCutoff?: boolean): void;
  startPlayback(): Promise<void>;
  restart(): void;
}

/**
 * Handles incoming camera samples for hands-down detection, gestural tempo modulation,
 * thumbs-down cutoff, and party mode.
 */
export function processCameraSamples(samples: HandSample[], host: CameraGestureHost): void {
  // In Mode E: only pause when hands are completely off-screen.
  // Low hand position = rallentando, NOT a stop signal.
  host.isHandsDown = samples.length === 0;

  const isFocusActive = host.cameraInput?.getFocusController().isFocusModeActive() ?? false;
  const isMagicMode = host.clock.getTempoMode() === "magic";

  // In Magic Finger mode: if no hands are present on screen, pause with 500ms grace period and 250ms fade down!
  if (isMagicMode && host.inputSource === "camera") {
    if (samples.length === 0) {
      if (host.state === "playing") {
        const now = performance.now();
        if (host.magicNoHandsStartTime === 0) {
          host.magicNoHandsStartTime = now;
        }
        const elapsed = now - host.magicNoHandsStartTime;
        if (elapsed >= 500) {
          host.magicNoHandsStartTime = 0;
          host.audioEngine.restoreMasterVolume();
          host.pausePlayback();
        } else if (elapsed >= 200) {
          const fadeRatio = 1.0 - (elapsed - 200) / 300;
          host.audioEngine.setFadeMultiplier(Math.max(0, Math.min(1, fadeRatio)));
        }
      } else {
        host.magicNoHandsStartTime = 0;
      }
    } else {
      if (host.magicNoHandsStartTime > 0) {
        host.audioEngine.restoreMasterVolume();
        host.magicNoHandsStartTime = 0;
      }
      const isOneHandRaised = samples.some(s => s.conductorPoint.y >= 0.08);

      // Broadcast motion sample for warmup and UI meters in magic mode
      host.uiCallbacks.onCameraMotionSample?.({
        tempoBpm: host.indicatedBpm || Math.round(host.clock.getState().bpm || host.nominalPieceBpm),
        isHandsRaised: isOneHandRaised,
        handPoints: samples.map(s => ({
          x: Math.round(Math.max(40, Math.min(560, s.conductorPoint.x * 600))),
          y: Math.round(Math.max(40, Math.min(360, (1.0 - s.conductorPoint.y) * 400))),
        })),
      });

      // Raising ONE hand starts or resumes playback in Magic Finger mode
      if (!host.isWarmingUp && (host.state === "ready" || host.state === "paused" || host.state === "completed")) {
        if (isOneHandRaised) {
          if (host.state === "completed") {
            host.restart();
          }
          void host.startPlayback();
        }
      }
    }
  }

  if (samples.length > 0 && !isFocusActive && !isMagicMode) {
    // ── 1. Thumbs Down Cutoff (👎): Dramatically pauses music ──
    const hasThumbDown = samples.some(s => s.gesture === "Thumb_Down");
    if (hasThumbDown) {
      if (!host.isFistCutoff) {
        host.isFistCutoff = true;
        if (host.state === "playing") {
          host.cutoffInitiatedPause = true;
          host.pausePlayback(true);
        } else {
          host.cutoffInitiatedPause = false;
          host.uiCallbacks.onFistCutoffChange?.(true);
        }
      }
    } else if (host.isFistCutoff) {
      host.isFistCutoff = false;
      host.uiCallbacks.onFistCutoffChange?.(false);
      // Auto-resume playback ONLY if thumbs down initiated the pause
      if (host.cutoffInitiatedPause && host.state === "paused") {
        host.cutoffInitiatedPause = false;
        void host.startPlayback();
      }
      host.cutoffInitiatedPause = false;
    }

    // ── 2. Double Peace Signs (✌️ + ✌️): Party Mode ──
    const hasDoublePeace = samples.length >= 2 &&
      samples[0].gesture === "Victory" &&
      samples[1].gesture === "Victory";

    if (hasDoublePeace) {
      if (!host.isPartyMode) {
        host.isPartyMode = true;
        host.uiCallbacks.onPartyModeChange?.(true);
      }
    } else if (host.isPartyMode) {
      host.isPartyMode = false;
      host.uiCallbacks.onPartyModeChange?.(false);
    }

    if (host.clock.getTempoMode() === "gestural" && !host.isFistCutoff && !host.isFermata) {
      // Update per-hand Y history for steady-vs-beating detection
      for (const s of samples) {
        let hist = host.handYHistory.get(s.handIndex);
        if (!hist) { hist = []; host.handYHistory.set(s.handIndex, hist); }
        hist.push(s.conductorPoint.y);
        if (hist.length > host.HAND_Y_HISTORY_LEN) hist.shift();
      }

      const isRaised = samples.some(s => s.conductorPoint.y >= 0.10);
      const tempoMultiplier = calculateGesturalTempoMultiplier(samples, host.cameraAxisMapping, host.handYHistory);
      const liveTempoBpm = Math.round((host.basePieceBpm || 108) * tempoMultiplier);
      const handPoints = samples.map(s => ({
        x: Math.round(Math.max(40, Math.min(560, s.conductorPoint.x * 600))),
        y: Math.round(Math.max(40, Math.min(360, (1.0 - s.conductorPoint.y) * 400))),
      }));

      // Broadcast smoothed tempo when playing to prevent gauge jitter
      const gesturalBroadcastBpm = host.state === "playing"
        ? (host.indicatedBpm || Math.round(host.currentGesturalBpm) || liveTempoBpm)
        : liveTempoBpm;

      // Always broadcast live gestural motion sample for warmup & UI meters
      host.uiCallbacks.onCameraMotionSample?.({
        tempoBpm: gesturalBroadcastBpm,
        isHandsRaised: isRaised,
        handPoints,
      });

      // Mode E: Auto-start instantly as soon as user raises hands in front of camera
      if (!host.isWarmingUp && (host.state === "ready" || host.state === "paused" || host.state === "completed")) {
        if (isRaised) {
          if (host.state === "completed") {
            host.restart();
          }
          void host.startPlayback();
        }
      } else if (host.state === "playing") {
        const targetBpm = Math.max(40, Math.min(240, host.basePieceBpm * tempoMultiplier));
        const now = performance.now();
        if (host.lastGesturalUpdateMs === 0) host.lastGesturalUpdateMs = now;
        const dt = Math.max(0.005, (now - host.lastGesturalUpdateMs) / 1000);
        host.lastGesturalUpdateMs = now;

        // Smooth slew interpolation (~350ms time constant)
        const alpha = 1 - Math.exp(-dt / 0.35);
        host.currentGesturalBpm += alpha * (targetBpm - host.currentGesturalBpm);

        host.clock.setBpm(host.currentGesturalBpm);
        host.indicatedBpm = Math.round(host.currentGesturalBpm);

        // Update transport period in real-time
        host.transport.updatePeriod(
          host.audioEngine.getAudioTime(),
          60 / host.currentGesturalBpm,
          0
        );
      }
    }
  } else {
    // No hands detected on screen
    if (host.isFermata) {
      host.isFermata = false;
      host.transport.setFermata(false, host.audioEngine.getAudioTime());
      host.uiCallbacks.onFermataChange?.(false);
    }
  }
}

/**
 * Resets camera-driven gesture states and cancels active focus, party, cutoff, or fermata modes.
 */
export function resetCameraGestureState(host: CameraGestureHost): void {
  if (host.cameraInput) {
    try {
      host.cameraInput.stop();
    } catch {
      // Ignored
    }
  }
  host.audioEngine.setSectionFocus(null, 0);
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

  if (host.isFistCutoff) {
    host.isFistCutoff = false;
    host.uiCallbacks.onFistCutoffChange?.(false);
  }
  host.cutoffInitiatedPause = false;

  if (host.isPartyMode) {
    host.isPartyMode = false;
    host.uiCallbacks.onPartyModeChange?.(false);
  }

  if (host.isFermata) {
    host.isFermata = false;
    host.transport.setFermata(false, host.audioEngine.getAudioTime());
    host.uiCallbacks.onFermataChange?.(false);
  }

  host.handYHistory.clear();
  host.isHandsDown = false;
  host.handsDownPulseCount = 0;
  host.magicNoHandsStartTime = 0;
}
