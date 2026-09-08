/**
 * playbackCoordinator.ts
 *
 * Coordinates score transport playback, clock pacing, and audio scheduling:
 * - startPlayback (concurrent-safe with promise guard and lead-in handling)
 * - pausePlayback (graceful cutoff handling, stop/reset scheduling)
 * - restartPlayback
 * - handlePieceComplete (with session guard timer)
 * - handleClockEvent (beat, reject, stop, and inactivity checking)
 * - handleBeatObservation (prep-tap counting and instant start handling)
 */

import type { AudioEngine } from "../audio/AudioEngine";
import type { ConductorClock, ClockEvent } from "../clock/ConductorClock";
import type { ScoreTransport } from "../score/ScoreTransport";
import type { Scheduler } from "../scheduler/Scheduler";
import type { DebugOverlay } from "../ui/DebugOverlay";
import type { CameraBeatInputProvider } from "../camera/CameraBeatInputProvider";
import type { ExperienceState, InputSource, UICallbacks } from "./ExperienceController";
import type { PieceDefinition } from "../score/repertoire";

export interface PlaybackHost {
  state: ExperienceState;
  inputSource: InputSource;
  isWarmingUp: boolean;
  completionTimer: ReturnType<typeof setTimeout> | null;
  playbackSessionId: number;
  startPlaybackPromise: Promise<void> | null;
  pausedBeat: number;
  prepTapCount: number;
  keyboardInactivityPulseCount: number;
  handsDownPulseCount: number;
  isHandsDown: boolean;
  cutoffInitiatedPause: boolean;
  nominalPieceBpm: number;
  basePieceBpm: number;
  currentGesturalBpm: number;
  indicatedBpm: number;
  lastBeatObservationMs: number;
  beatSoundEnabled: boolean;

  audioEngine: AudioEngine;
  clock: ConductorClock;
  transport: ScoreTransport;
  scheduler: Scheduler;
  debug: DebugOverlay;
  cameraInput: CameraBeatInputProvider | null;
  uiCallbacks: UICallbacks;

  setState(next: ExperienceState): void;
  getState(): ExperienceState;
  getEffectiveBeatsPerTap(): number;
  getCurrentPiece(): PieceDefinition;
  restart(): void;
  startPlayback(): Promise<void>;
  pausePlayback(isCutoff?: boolean): void;
}

/**
 * Starts or resumes score playback with proper audio pre-warming, lead-in calculation,
 * and promise-based concurrency protection.
 */
export async function startPlayback(host: PlaybackHost): Promise<void> {
  if (host.isWarmingUp) return;
  if (host.state === "playing") return;
  if (host.startPlaybackPromise) {
    return host.startPlaybackPromise;
  }

  host.startPlaybackPromise = (async () => {
    try {
      if (host.completionTimer) {
        clearTimeout(host.completionTimer);
        host.completionTimer = null;
      }
      host.playbackSessionId++;

      try {
        await host.audioEngine.resume();
      } catch {
        // AudioContext resume might fail in non-user-gesture context in some strict browsers
      }

      if (host.state === "playing") return;

      if (host.clock.getTempoMode() === "gestural") {
        host.clock.setPeriodMs(60000 / host.currentGesturalBpm);
        host.clock.startRunningAtCurrentPeriod();
      } else if (host.clock.getTempoMode() === "magic") {
        const bpm = host.indicatedBpm > 0 ? host.indicatedBpm : host.nominalPieceBpm;
        host.clock.setBpm(bpm);
        host.clock.setPeriodMs(60000 / bpm);
        host.clock.startRunningAtCurrentPeriod();
      }

      const clockState = host.clock.getState();
      const periodSec = clockState.periodMs / 1000;
      const nextBeatAudioTime = host.clock.predictNextBeatAudioTime();
      const audioNow = host.audioEngine.getAudioTime();

      // In Beat Mode: 2 prep taps establish tempo (1, 2). Music begins 1 beat later on nextBeatAudioTime
      // with pristine audio attack and zero dropped opening notes.
      // In Gestural or Magic Mode: Starts immediately with 60ms audio buffer lead time.
      const isImmediate = host.clock.getTempoMode() === "gestural" || host.clock.getTempoMode() === "magic";
      const startAudioTime = isImmediate
        ? audioNow + 0.06
        : (nextBeatAudioTime > audioNow + 0.05 ? nextBeatAudioTime : audioNow + periodSec);

      // Start or resume from pausedBeat
      const startBeat = host.pausedBeat;
      const beatsPerTap = host.getEffectiveBeatsPerTap();
      const piece = host.getCurrentPiece();
      const leadInBeats = (startBeat === 0 && piece?.leadInBeats) ? piece.leadInBeats : 0;

      host.transport.start(startBeat, startAudioTime, periodSec, beatsPerTap, leadInBeats);
      host.scheduler.start();
      host.setState("playing");

      // Update audio latency in debug overlay
      const ctx = (host.audioEngine as unknown as { ctx: AudioContext | null }).ctx;
      if (ctx) {
        host.debug.updateAudioLatency(
          (ctx as AudioContext & { baseLatency?: number }).baseLatency ?? 0,
          (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0
        );
      }
      host.debug.updateDynamics(host.audioEngine.getDynamicsTelemetry());
    } finally {
      host.startPlaybackPromise = null;
    }
  })();

  return host.startPlaybackPromise;
}

/**
 * Pauses playback, releases active audio notes, records paused transport beat,
 * and updates state.
 */
export function pausePlayback(host: PlaybackHost, isCutoff: boolean = false): void {
  if (host.state !== "playing") return;
  if (host.completionTimer) {
    clearTimeout(host.completionTimer);
    host.completionTimer = null;
  }
  host.playbackSessionId++;
  if (!isCutoff) {
    host.cutoffInitiatedPause = false;
  }
  host.pausedBeat = host.transport.getCursorBeat();
  host.scheduler.stop();
  host.scheduler.reset();
  host.transport.stop();
  host.clock.reset();
  host.audioEngine.stopAllNotes();
  host.prepTapCount = 0;
  host.setState("paused");
  host.debug.updatePauseState(true);
  if (isCutoff) {
    host.uiCallbacks.onFistCutoffChange?.(true);
  }
}

/**
 * Resets playback transport and clock back to beginning of score.
 */
export function restartPlayback(host: PlaybackHost): void {
  if (host.completionTimer) {
    clearTimeout(host.completionTimer);
    host.completionTimer = null;
  }
  host.playbackSessionId++;
  host.scheduler.stop();
  host.scheduler.reset();
  host.transport.stop();
  host.clock.reset();
  host.currentGesturalBpm = host.nominalPieceBpm;
  host.indicatedBpm = Math.round(host.nominalPieceBpm);
  host.clock.setBpm(host.nominalPieceBpm);
  host.clock.setPeriodMs(60000 / host.nominalPieceBpm);
  if (host.cameraInput) {
    host.cameraInput.setIndicatedBpm(host.indicatedBpm);
    host.cameraInput.getMagicFingerController().setInitialBpm(host.indicatedBpm);
  }
  host.audioEngine.stopAllNotes();
  host.prepTapCount = 0;
  host.pausedBeat = 0;
  host.setState("ready");
}

/**
 * Handles end-of-piece event, scheduling transport stop after a 2-second decay.
 */
export function handlePieceComplete(host: PlaybackHost): void {
  host.setState("completed");
  if (host.completionTimer) {
    clearTimeout(host.completionTimer);
    host.completionTimer = null;
  }
  const currentSession = host.playbackSessionId;
  host.completionTimer = setTimeout(() => {
    if (host.playbackSessionId === currentSession) {
      host.scheduler.stop();
      host.transport.stop();
    }
    host.completionTimer = null;
  }, 2000);
}

/**
 * Processes clock events (beats, rejects, stops) and enforces keyboard/camera inactivity pauses.
 */
export function handleClockEvent(host: PlaybackHost, event: ClockEvent): void {
  switch (event.type) {
    case "beat": {
      const s = event.state;

      // Check inactivity in Keyboard Beat Mode: pause if user stops tapping (after 4 missed beats)
      if (host.inputSource === "keyboard" && host.clock.getTempoMode() === "inertial" && host.state === "playing") {
        host.keyboardInactivityPulseCount++;
        if (host.keyboardInactivityPulseCount >= 4) {
          host.keyboardInactivityPulseCount = 0;
          host.pausePlayback();
          return;
        }
      } else {
        host.keyboardInactivityPulseCount = 0;
      }

      // Check hands-down inactivity in camera mode:
      // In Magic Finger mode: pause after 4 beats of dropping hands (or immediate via onSamples)
      // In Mode E: pause within 2 beats of dropping hands
      // In Mode D: pause after 6 beats of dropping hands
      if (host.inputSource === "camera" && host.state === "playing") {
        if (host.isHandsDown) {
          host.handsDownPulseCount++;
          const maxSilentBeats = host.clock.getTempoMode() === "magic"
            ? 4
            : (host.clock.getTempoMode() === "gestural" ? 2 : 6);
          if (host.handsDownPulseCount >= maxSilentBeats) {
            host.handsDownPulseCount = 0;
            host.pausePlayback();
            return;
          }
        } else {
          host.handsDownPulseCount = 0;
        }
      } else {
        host.handsDownPulseCount = 0;
      }

      // Update transport period & phase on every accepted tap while playing
      if (host.state === "playing") {
        host.transport.updatePeriod(
          host.audioEngine.getAudioTime(),
          s.periodMs / 1000,
          s.phaseCorrectionSec ?? 0
        );
      }

      host.debug.updateClock(s);
      host.debug.updateTapAccepted();
      host.debug.updateScore(host.transport.getCursorBeat());
      host.debug.updateScheduler(host.scheduler.horizon, host.scheduler.committedCount);
      host.debug.updateDynamics(host.audioEngine.getDynamicsTelemetry());
      host.debug.updateAudioDiagnostics(host.audioEngine.getAudioDiagnostics(), host.scheduler.getDiagnostics());
      host.uiCallbacks.onBeat();
      break;
    }
    case "rejected":
      host.debug.updateTapRejected(event.reason);
      break;
    case "stopped":
      host.pausePlayback();
      break;
  }
}

/**
 * Handles incoming beat observations from keyboard or camera providers,
 * establishes conducting tempo from prep taps, or immediately triggers playback in gestural/magic modes.
 */
export async function handleBeatObservation(
  host: PlaybackHost,
  obs: { timestampMs: number; source: "keyboard" | "camera"; confidence: number }
): Promise<void> {
  if (host.isWarmingUp) {
    return;
  }

  // If state is completed, reset to ready so conducting restarts cleanly
  if (host.state === "completed") {
    host.restart();
  }

  // Resume AudioContext on first tap if suspended (requires user gesture)
  await host.audioEngine.resume();

  // Reset inactivity counters
  host.keyboardInactivityPulseCount = 0;

  // In Mode E and Magic Finger Mode, tapping SPACE while ready/paused immediately starts/resumes playback!
  if (host.clock.getTempoMode() === "gestural" || host.clock.getTempoMode() === "magic") {
    if (host.beatSoundEnabled) {
      host.audioEngine.playImmediateBeatCymbal();
    }
    host.debug.updateTapAccepted();
    host.uiCallbacks.onBeat();
    host.clock.acceptObservation(obs);

    if (host.state === "ready" || host.state === "paused") {
      void host.startPlayback();
    }
    return;
  }

  // Compute indicated instantaneous BPM with light smoothing (accounting for cut time in Mode D)
  const now = obs.timestampMs;
  const beatsPerTap = host.getEffectiveBeatsPerTap();
  if (host.lastBeatObservationMs > 0) {
    const dtMs = now - host.lastBeatObservationMs;
    if (dtMs >= 100 && dtMs <= 3000) {
      const instantBpm = (60000 / dtMs) * beatsPerTap;
      host.indicatedBpm = host.indicatedBpm > 0
        ? host.indicatedBpm * 0.55 + instantBpm * 0.45
        : instantBpm;
    }
  }
  host.lastBeatObservationMs = now;

  // If beat sound debug cue is active, play cymbal immediately with zero latency
  if (host.beatSoundEnabled) {
    host.audioEngine.playImmediateBeatCymbal();
  }

  host.prepTapCount++;

  // First tap from ready or paused: enter preparing state
  if (host.state === "ready" || host.state === "paused") {
    host.setState("preparing");
  }

  // Feed observation to clock
  host.clock.acceptObservation(obs);

  // After second tap: clock has calibrated period, start/resume playback with 1-beat lookahead
  if (host.prepTapCount === 2 && host.state === "preparing") {
    void host.startPlayback();
  }
}
