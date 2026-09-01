/**
 * ConductorClock.ts
 *
 * Beat follower and predicted pulse tracker with five operating modes:
 *   - Mode A (Balanced): Blends tempo with inertia over ~3-4 beats, absorbing finger jitter.
 *   - Mode B (Instant / On a Dime): Super-responsive to deliberate tempo cuts and accelerandos.
 *   - Mode C (Autoplay): Tap Space twice to set pulse, plays continuously at tempo without stopping.
 *   - Mode D (Inertial / Coast & Steer): Maintains established tempo and coasts through missed beats.
 *     Steers smoothly during genuine accelerando/rallentando.
 *   - Mode E (Gestural Cruise & Height-Based Accelerando - Default): Music starts when hands are raised
 *     at intended piece BPM. Height of hands modulates tempo continuously (higher = accelerando, lower = rallentando).
 *     Beating hands triggers sound/visual feedback without overriding height tempo. Dropping hands pauses within 2 beats.
 */

import type { BeatObservation, ClockState, TapRejectionReason } from "./clockTypes";

// ─── Tuning constants ────────────────────────────────────────────────────────

/**
 * Blend factor for tempo updates in Mode A. Higher = follows deliberate changes faster
 * but is more sensitive to jitter. 0.35 gives a smooth, natural response.
 */
const TEMPO_GAIN = 0.35;

/**
 * Fraction of phase error applied to correct the predicted beat time and transport phase.
 */
const PHASE_GAIN = 0.40;

/** Minimum accepted BPM for conducted pulses (allows slow half-note conducting down to 40 score BPM). */
const BPM_MIN = 20;

/** Maximum accepted BPM. */
const BPM_MAX = 280;

/** Guard against accidental keyboard bounce or sensor noise. */
const DOUBLE_TAP_GUARD_MS = 80;

/** Stop after this many silent beat periods in human conducting modes A and B. */
const STOP_AFTER_PERIODS = 3.0;

/** Mode D: Max silent bars before pausing the orchestra (16 musical bars). */
const MODE_D_MAX_FREEWHEEL_BARS = 16;

/** Mode D: Conducted pulses per bar (in 4/4 conducted in 2, 1 bar = 2 pulses). */
const MODE_D_PULSES_PER_BAR = 2;

/** Mode D: Default tempo deadband ratio (~2.5% jitter absorption so steady conducting has rock-solid BPM). */
const MODE_D_DEFAULT_TEMPO_DEADBAND = 0.025;

/** Mode D: Phase error deadband in ms (errors below this do not apply phase correction). */
const MODE_D_PHASE_DEADBAND_MS = 25;

// ─── Types ───────────────────────────────────────────────────────────────────

export type TempoMode = "balanced" | "instant" | "autoplay" | "inertial" | "gestural";

export type ClockEventType = "beat" | "rejected" | "stopped";

export type ClockEvent =
  | { type: "beat"; state: ClockState; beatNumber: number }
  | { type: "rejected"; reason: TapRejectionReason; timestampMs: number }
  | { type: "stopped" };

type Listener = (event: ClockEvent) => void;

export type ConductorClockConfig = {
  getAudioTime: () => number;
  tempoGain?: number;
  phaseGain?: number;
  initialMode?: TempoMode;
  tempoDeadband?: number;
};

// ─── ConductorClock ──────────────────────────────────────────────────────────

export class ConductorClock {
  private readonly getAudioTime: () => number;
  private readonly tempoGain: number;
  private readonly phaseGain: number;
  private mode: TempoMode = "balanced";

  // Internal state
  private periodMs: number = 500;          // Default 120 BPM until calibrated
  private lastAcceptedTapMs: number = -1;  // performance.now() timestamp of last accepted tap
  private prevIntervalMs: number = 500;
  private nextBeatAudioTime: number = -1;  // Predicted AudioContext time of next beat (seconds)
  private acceptedBeatCount: number = 0;
  private phaseErrorMs: number = 0;
  private phaseCorrectionSec: number = 0;
  private confidence: number = 0;

  // Mode D: configurable deadband and jitter telemetry
  private tempoDeadband: number = MODE_D_DEFAULT_TEMPO_DEADBAND;
  private recentIntervals: number[] = [];
  private lastJitterMs: number = 0;
  private lastJitterPercent: number = 0;
  private recentJitters: number[] = [];
  private averageJitterMs: number = 0;
  private averageJitterPercent: number = 0;
  private jitterStatus: "steady" | "accelerando" | "rallentando" | "coasting" | "calibrating" = "calibrating";

  private listeners: Listener[] = [];
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private autoplayTimer: ReturnType<typeof setTimeout> | null = null;
  private inertialTimer: ReturnType<typeof setTimeout> | null = null;
  private inertialFreeWheelCount: number = 0;

  constructor(config: ConductorClockConfig) {
    this.getAudioTime = config.getAudioTime;
    this.tempoGain = config.tempoGain ?? TEMPO_GAIN;
    this.phaseGain = config.phaseGain ?? PHASE_GAIN;
    this.mode = config.initialMode ?? "balanced";
    this.tempoDeadband = config.tempoDeadband ?? MODE_D_DEFAULT_TEMPO_DEADBAND;
  }

  /** Set the tempo following mode: 'balanced', 'instant', 'autoplay', 'inertial', or 'gestural' */
  setTempoMode(mode: TempoMode): void {
    const prevMode = this.mode;
    this.mode = mode;

    if (this.isRunning()) {
      if (mode === "autoplay" && prevMode !== "autoplay") {
        this.cancelStopTimer();
        this.cancelInertialLoop();
        this.startAutoplayLoop();
      } else if ((mode === "inertial" || mode === "gestural") && (prevMode !== "inertial" && prevMode !== "gestural")) {
        this.cancelAutoplayLoop();
        this.cancelStopTimer();
        this.startInertialLoop();
      } else if (mode !== "autoplay" && mode !== "inertial" && mode !== "gestural") {
        this.cancelAutoplayLoop();
        this.cancelInertialLoop();
        this.scheduleStopTimer();
      }
    }
  }

  getTempoMode(): TempoMode {
    return this.mode;
  }

  /** Set the jitter deadband ratio (e.g. 0.025 for 2.5%, 0 for raw tracking). */
  setTempoDeadband(deadbandRatio: number): void {
    this.tempoDeadband = Math.max(0, Math.min(0.25, deadbandRatio));
  }

  /** Get the current jitter deadband ratio. */
  getTempoDeadband(): number {
    return this.tempoDeadband;
  }

  /** Set base period directly in milliseconds (used for intended piece BPM or gestural modulation). */
  setPeriodMs(periodMs: number): void {
    const clamped = Math.max(60000 / BPM_MAX, Math.min(60000 / BPM_MIN, periodMs));
    this.periodMs = clamped;
    this.prevIntervalMs = clamped;
  }

  /** Directly set BPM (used in Mode E for continuous height-based accelerando/rallentando). */
  setBpm(bpm: number): void {
    const clamped = Math.max(BPM_MIN, Math.min(BPM_MAX, bpm));
    this.periodMs = 60000 / clamped;
    this.prevIntervalMs = this.periodMs;
  }

  /**
   * Starts clock running immediately at the current periodMs without requiring prep taps.
   */
  startRunningAtCurrentPeriod(): void {
    const audioNow = this.getAudioTime();
    this.acceptedBeatCount = 2;
    this.confidence = 0.9;
    this.lastAcceptedTapMs = performance.now();
    this.phaseErrorMs = 0;
    this.phaseCorrectionSec = 0;
    this.nextBeatAudioTime = audioNow + (this.periodMs / 1000);
    this.emit({ type: "beat", state: this.getState(), beatNumber: 2 });
    if (this.mode === "autoplay") {
      this.startAutoplayLoop();
    } else if (this.mode === "inertial" || this.mode === "gestural") {
      this.startInertialLoop();
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Submit a beat observation. Accepts or rejects it, updates state, emits event.
   */
  acceptObservation(obs: BeatObservation): void {
    const nowMs = obs.timestampMs;
    const audioNow = this.getAudioTime();

    // ── Mode E (Continuous Gestural Cruise & Accelerando) ──────────────────────
    if (this.mode === "gestural") {
      // In Mode E, beating hands triggers audio/visual beat feedback for musical feel,
      // but does NOT override the continuous height-controlled tempo!
      this.lastAcceptedTapMs = nowMs;
      this.acceptedBeatCount++;
      this.confidence = Math.min(1.0, this.confidence + 0.05);

      const periodSec = this.periodMs / 1000;
      this.nextBeatAudioTime = audioNow + periodSec;

      this.emit({ type: "beat", state: this.getState(), beatNumber: this.acceptedBeatCount });
      this.startInertialLoop();
      return;
    }

    // ── First tap: record timestamp and wait for a second tap to establish period.
    if (this.lastAcceptedTapMs < 0) {
      this.lastAcceptedTapMs = nowMs;
      this.acceptedBeatCount = 1;
      this.confidence = 0.1;
      this.recentIntervals = [];
      this.recentJitters = [];
      this.jitterStatus = "calibrating";
      return;
    }

    const elapsedMs = nowMs - this.lastAcceptedTapMs;

    // ── Reject: double-tap (keyboard bounce or sensor bounce)
    if (elapsedMs < DOUBLE_TAP_GUARD_MS) {
      this.emit({ type: "rejected", reason: "double_tap", timestampMs: nowMs });
      return;
    }

    // ── Mode D (Inertial Coast & Steer) ───────────────────────────────────────
    if (this.mode === "inertial") {
      if (this.acceptedBeatCount === 1) {
        // Second tap: establish initial conducting pulse period
        const impliedBpm = 60000 / elapsedMs;
        if (impliedBpm < BPM_MIN || impliedBpm > BPM_MAX) {
          if (impliedBpm < BPM_MIN) {
            this.lastAcceptedTapMs = nowMs;
            this.acceptedBeatCount = 1;
            this.confidence = 0.1;
          }
          this.emit({ type: "rejected", reason: "out_of_range", timestampMs: nowMs });
          return;
        }

        this.periodMs = elapsedMs;
        this.prevIntervalMs = elapsedMs;
        this.phaseErrorMs = 0;
        this.phaseCorrectionSec = 0;
        this.lastAcceptedTapMs = nowMs;
        this.acceptedBeatCount = 2;
        this.confidence = 0.6;
        this.recentIntervals = [elapsedMs];
        this.recentJitters = [0];
        this.lastJitterMs = 0;
        this.lastJitterPercent = 0;
        this.averageJitterMs = 0;
        this.averageJitterPercent = 0;
        this.jitterStatus = "steady";
        this.inertialFreeWheelCount = 0;

        const periodSec = this.periodMs / 1000;
        this.nextBeatAudioTime = audioNow + periodSec;
        this.emit({ type: "beat", state: this.getState(), beatNumber: 2 });
        this.startInertialLoop();
        return;
      }

      // Check for an actual meaningful gap in conducting (silence > 1.8s or > 1.8 * periodMs)
      const gapThresholdMs = Math.max(1800, this.periodMs * 1.8);
      const isGap = elapsedMs > gapThresholdMs;

      if (isGap) {
        // After an actual gap: clear recent interval history, start fresh observation sequence.
        // Do NOT reset the orchestra's established clock or tempo!
        this.recentIntervals = [];
        this.jitterStatus = "coasting";

        // Compute phase error relative to the current predicted beat timeline
        let phaseErrorMs = 0;
        if (this.nextBeatAudioTime > 0) {
          phaseErrorMs = (audioNow - this.nextBeatAudioTime) * 1000;
          const maxPhaseError = this.periodMs * 0.5;
          phaseErrorMs = Math.max(-maxPhaseError, Math.min(maxPhaseError, phaseErrorMs));
        }

        // Beat 1 of new sequence: gently re-anchors phase, but does not change tempo by itself
        let phaseCorrectionMs = 0;
        if (Math.abs(phaseErrorMs) > MODE_D_PHASE_DEADBAND_MS) {
          const effectiveError = phaseErrorMs > 0
            ? phaseErrorMs - MODE_D_PHASE_DEADBAND_MS
            : phaseErrorMs + MODE_D_PHASE_DEADBAND_MS;
          phaseCorrectionMs = effectiveError * 0.30;
        }
        this.phaseCorrectionSec = phaseCorrectionMs / 1000;

        this.phaseErrorMs = phaseErrorMs;
        this.lastAcceptedTapMs = nowMs;
        this.acceptedBeatCount++;
        this.inertialFreeWheelCount = 0;
        this.confidence = Math.min(1.0, this.confidence + 0.10);

        const periodSec = this.periodMs / 1000;
        this.nextBeatAudioTime = audioNow + periodSec + this.phaseCorrectionSec;

        this.emit({ type: "beat", state: this.getState(), beatNumber: this.acceptedBeatCount });
        this.startInertialLoop();
        return;
      }

      // Consecutive observation (no gap):
      const candidateInterval = elapsedMs;
      const candidateBpm = 60000 / candidateInterval;

      if (candidateBpm < BPM_MIN || candidateBpm > BPM_MAX) {
        this.emit({ type: "rejected", reason: "out_of_range", timestampMs: nowMs });
        return;
      }

      // Track precision & jitter statistics
      const jitterMs = candidateInterval - this.periodMs;
      const jitterPercent = (jitterMs / this.periodMs) * 100;
      this.lastJitterMs = Math.round(jitterMs * 10) / 10;
      this.lastJitterPercent = Math.round(jitterPercent * 10) / 10;
      this.recentJitters.push(Math.abs(jitterMs));
      if (this.recentJitters.length > 8) this.recentJitters.shift();

      const jitterSum = this.recentJitters.reduce((a, b) => a + b, 0);
      this.averageJitterMs = Math.round((jitterSum / this.recentJitters.length) * 10) / 10;
      this.averageJitterPercent = Math.round(((this.averageJitterMs / this.periodMs) * 100) * 10) / 10;

      // Add to recent interval buffer
      this.recentIntervals.push(candidateInterval);
      if (this.recentIntervals.length > 4) {
        this.recentIntervals.shift();
      }

      // Compute phase error with deadband to prevent micro-warping
      let phaseErrorMs = 0;
      if (this.nextBeatAudioTime > 0) {
        phaseErrorMs = (audioNow - this.nextBeatAudioTime) * 1000;
        const maxPhaseError = this.periodMs * 0.5;
        phaseErrorMs = Math.max(-maxPhaseError, Math.min(maxPhaseError, phaseErrorMs));
      }

      let phaseCorrectionMs = 0;
      if (Math.abs(phaseErrorMs) > MODE_D_PHASE_DEADBAND_MS) {
        const effectiveError = phaseErrorMs > 0
          ? phaseErrorMs - MODE_D_PHASE_DEADBAND_MS
          : phaseErrorMs + MODE_D_PHASE_DEADBAND_MS;
        phaseCorrectionMs = effectiveError * 0.25;
      }
      this.phaseCorrectionSec = phaseCorrectionMs / 1000;

      // ── Steady Deadband & Smooth Accelerando/Rallentando Steering ────────────
      const devFromCurrent = (candidateInterval - this.periodMs) / this.periodMs;

      if (Math.abs(devFromCurrent) <= this.tempoDeadband) {
        // Within deadband: Conductor is beating in time! Keep periodMs rock-solid.
        this.jitterStatus = "steady";
      } else if (this.recentIntervals.length >= 2) {
        const len = this.recentIntervals.length;
        const last = this.recentIntervals[len - 1];
        const prev = this.recentIntervals[len - 2];
        const pairDiff = Math.abs(last - prev) / Math.max(last, prev);

        if (pairDiff <= 0.22) {
          // 2 consecutive fresh intervals broadly agree on a new tempo!
          const targetInterval = (last + prev) / 2;
          this.jitterStatus = targetInterval < this.periodMs ? "accelerando" : "rallentando";

          let blendWeight = 0.40;
          if (this.recentIntervals.length >= 3) {
            const prev2 = this.recentIntervals[len - 3];
            const trioDiff = Math.abs(last - prev2) / Math.max(last, prev2);
            if (trioDiff <= 0.25) {
              blendWeight = 0.60;
            }
          }
          this.periodMs = this.periodMs * (1 - blendWeight) + targetInterval * blendWeight;
        } else {
          this.jitterStatus = "steady";
        }
      } else {
        // 1 interval in buffer: orchestra continues coasting while waiting for confirmation
        this.jitterStatus = "steady";
      }

      this.phaseErrorMs = phaseErrorMs;
      this.lastAcceptedTapMs = nowMs;
      this.acceptedBeatCount++;
      this.inertialFreeWheelCount = 0;
      this.confidence = Math.min(1.0, this.confidence + 0.15);

      const periodSec = this.periodMs / 1000;
      this.nextBeatAudioTime = audioNow + periodSec + this.phaseCorrectionSec;

      this.emit({ type: "beat", state: this.getState(), beatNumber: this.acceptedBeatCount });
      this.startInertialLoop();
      return;
    }

    // ── Modes A, B, C Handling ────────────────────────────────────────────────
    let intervalMs = elapsedMs;

    // Reject: outside plausible BPM range
    const impliedBpm = 60000 / intervalMs;
    if (impliedBpm < BPM_MIN || impliedBpm > BPM_MAX) {
      if (impliedBpm < BPM_MIN) {
        this.lastAcceptedTapMs = nowMs;
        this.acceptedBeatCount = 1;
        this.confidence = 0.1;
        this.cancelAutoplayLoop();
        this.cancelInertialLoop();
      }
      this.emit({ type: "rejected", reason: "out_of_range", timestampMs: nowMs });
      return;
    }

    this.cancelStopTimer();

    // Compute phase error
    let phaseErrorMs = 0;
    if (this.nextBeatAudioTime > 0 && this.acceptedBeatCount >= 2) {
      phaseErrorMs = (audioNow - this.nextBeatAudioTime) * 1000;
      const maxPhaseError = this.periodMs * 0.5;
      phaseErrorMs = Math.max(-maxPhaseError, Math.min(maxPhaseError, phaseErrorMs));
    }

    if (this.mode === "autoplay") {
      this.periodMs = intervalMs;
      this.prevIntervalMs = intervalMs;
      this.phaseCorrectionSec = 0;
    } else if (this.mode === "instant") {
      if (this.acceptedBeatCount === 1) {
        this.periodMs = intervalMs;
        this.prevIntervalMs = intervalMs;
      } else {
        this.periodMs = intervalMs * 0.85 + this.prevIntervalMs * 0.15;
        this.prevIntervalMs = intervalMs;
      }
      const phaseCorrectionMs = phaseErrorMs * 0.85;
      this.phaseCorrectionSec = phaseCorrectionMs / 1000;
    } else {
      // Mode A: Balanced PLL
      if (this.acceptedBeatCount === 1) {
        this.periodMs = intervalMs;
        this.prevIntervalMs = intervalMs;
      } else {
        this.periodMs = this.periodMs * (1 - this.tempoGain) + intervalMs * this.tempoGain;
      }
      const phaseCorrectionMs = phaseErrorMs * this.phaseGain;
      this.phaseCorrectionSec = phaseCorrectionMs / 1000;
    }

    this.phaseErrorMs = phaseErrorMs;
    this.lastAcceptedTapMs = nowMs;
    this.acceptedBeatCount++;
    this.confidence = Math.min(1.0, this.confidence + 0.15);

    const periodSec = this.periodMs / 1000;
    this.nextBeatAudioTime = audioNow + periodSec + this.phaseCorrectionSec;

    this.emit({ type: "beat", state: this.getState(), beatNumber: this.acceptedBeatCount });

    if (this.mode === "autoplay") {
      this.startAutoplayLoop();
    } else {
      this.scheduleStopTimer();
    }
  }

  /** Current clock state snapshot. */
  getState(): ClockState {
    return {
      periodMs: this.periodMs,
      bpm: 60000 / this.periodMs,
      nextBeatAudioTime: this.nextBeatAudioTime,
      phaseErrorMs: this.phaseErrorMs,
      phaseCorrectionSec: this.phaseCorrectionSec,
      confidence: this.confidence,
      acceptedBeatCount: this.acceptedBeatCount,
      tempoDeadband: this.tempoDeadband,
      lastJitterMs: this.lastJitterMs,
      lastJitterPercent: this.lastJitterPercent,
      averageJitterMs: this.averageJitterMs,
      averageJitterPercent: this.averageJitterPercent,
      jitterStatus: this.jitterStatus,
    };
  }

  /**
   * Predicted AudioContext time (seconds) of the next beat.
   */
  predictNextBeatAudioTime(): number {
    return this.nextBeatAudioTime;
  }

  /**
   * True if the clock has received at least two taps and has a valid period.
   */
  isRunning(): boolean {
    return this.acceptedBeatCount >= 2;
  }

  /**
   * Subscribe to clock events. Returns an unsubscribe function.
   */
  on(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /** Reset the clock to its initial state. */
  reset(): void {
    this.cancelStopTimer();
    this.cancelAutoplayLoop();
    this.cancelInertialLoop();
    this.lastAcceptedTapMs = -1;
    this.nextBeatAudioTime = -1;
    this.acceptedBeatCount = 0;
    this.phaseErrorMs = 0;
    this.phaseCorrectionSec = 0;
    this.confidence = 0;
    this.recentIntervals = [];
    this.recentJitters = [];
    this.lastJitterMs = 0;
    this.lastJitterPercent = 0;
    this.averageJitterMs = 0;
    this.averageJitterPercent = 0;
    this.jitterStatus = "calibrating";
    this.inertialFreeWheelCount = 0;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private emit(event: ClockEvent): void {
    this.listeners.forEach(l => l(event));
  }

  /**
   * In Autoplay mode, generates continuous periodic beat events on every periodMs.
   */
  private startAutoplayLoop(): void {
    this.cancelAutoplayLoop();
    if (this.mode !== "autoplay" || this.acceptedBeatCount < 2) return;

    const scheduleNext = () => {
      this.autoplayTimer = setTimeout(() => {
        if (this.mode !== "autoplay" || this.acceptedBeatCount < 2) return;

        const audioNow = this.getAudioTime();
        const periodSec = this.periodMs / 1000;
        this.nextBeatAudioTime = audioNow + periodSec;
        this.acceptedBeatCount++;

        this.emit({
          type: "beat",
          state: this.getState(),
          beatNumber: this.acceptedBeatCount,
        });

        scheduleNext();
      }, this.periodMs);
    };

    scheduleNext();
  }

  private cancelAutoplayLoop(): void {
    if (this.autoplayTimer !== null) {
      clearTimeout(this.autoplayTimer);
      this.autoplayTimer = null;
    }
  }

  /**
   * In Mode D & Mode E, carries the tempo forward through missed beats without halting.
   * In Mode D: pauses after 16 bars of inactivity.
   * In Mode E: pauses after 2 beats of hands dropped (handled in ExperienceController).
   */
  private startInertialLoop(): void {
    this.cancelInertialLoop();
    if ((this.mode !== "inertial" && this.mode !== "gestural") || this.acceptedBeatCount < 2) return;

    const scheduleNext = () => {
      this.inertialTimer = setTimeout(() => {
        if ((this.mode !== "inertial" && this.mode !== "gestural") || this.acceptedBeatCount < 2) return;

        this.inertialFreeWheelCount++;
        const maxFreeWheelPulses = MODE_D_MAX_FREEWHEEL_BARS * MODE_D_PULSES_PER_BAR; // 16 bars = 32 pulses

        if (this.mode === "inertial" && this.inertialFreeWheelCount >= maxFreeWheelPulses) {
          this.reset();
          this.emit({ type: "stopped" });
          return;
        }

        const audioNow = this.getAudioTime();
        const periodSec = this.periodMs / 1000;
        this.nextBeatAudioTime = audioNow + periodSec;
        this.acceptedBeatCount++;
        this.confidence = Math.max(0.40, this.confidence - 0.01);
        if (this.mode === "inertial") {
          this.jitterStatus = "coasting";
        }

        this.emit({
          type: "beat",
          state: this.getState(),
          beatNumber: this.acceptedBeatCount,
        });

        scheduleNext();
      }, this.periodMs);
    };

    scheduleNext();
  }

  private cancelInertialLoop(): void {
    if (this.inertialTimer !== null) {
      clearTimeout(this.inertialTimer);
      this.inertialTimer = null;
    }
  }

  private scheduleStopTimer(): void {
    this.cancelStopTimer();
    if (this.mode === "autoplay" || this.mode === "inertial" || this.mode === "gestural") return;

    this.stopTimer = setTimeout(() => {
      this.reset();
      this.emit({ type: "stopped" });
    }, this.periodMs * STOP_AFTER_PERIODS);
  }

  private cancelStopTimer(): void {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }
}
