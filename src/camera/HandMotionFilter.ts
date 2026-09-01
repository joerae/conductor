/**
 * HandMotionFilter.ts
 *
 * Fast, low-latency motion preprocessor for camera hand tracking.
 * Maintains a rolling circular buffer of recent conducting points per hand,
 * computes smoothed position, instantaneous downward velocity, and vertical acceleration.
 *
 * Designed to eliminate high-frequency landmark jitter without introducing
 * phase lag that would distort the temporal location of the musical ictus.
 */

import type { HandSample } from "./cameraTypes";

export interface MotionSample {
  timestampMs: number;
  /** Conductor-space position (x: 0=left 1=right, y: 0=low 1=high). */
  x: number;
  y: number;
  /** Vertical velocity in conductor space (units/sec). Positive = moving up, Negative = moving down. */
  vy: number;
  /** Horizontal velocity in conductor space (units/sec). */
  vx: number;
  /** Vertical acceleration (units/sec^2). */
  ay: number;
}

export interface HandMotionState {
  handIndex: number;
  lastUpdatedMs: number;
  current: MotionSample;
  history: MotionSample[];
}

export class HandMotionFilter {
  private historySize: number;
  private states: Map<number, HandMotionState> = new Map();

  constructor(historySize: number = 16) {
    this.historySize = historySize;
  }

  /**
   * Processes an incoming hand sample and updates its kinematic state.
   */
  update(sample: HandSample): MotionSample {
    const handIndex = sample.handIndex;
    let state = this.states.get(handIndex);

    if (!state) {
      const initialSample: MotionSample = {
        timestampMs: sample.timestampMs,
        x: sample.conductorPoint.x,
        y: sample.conductorPoint.y,
        vy: 0,
        vx: 0,
        ay: 0,
      };

      state = {
        handIndex,
        lastUpdatedMs: sample.timestampMs,
        current: initialSample,
        history: [initialSample],
      };
      this.states.set(handIndex, state);
      return initialSample;
    }

    const dt = Math.max(0.001, (sample.timestampMs - state.lastUpdatedMs) / 1000);
    const rawX = sample.conductorPoint.x;
    const rawY = sample.conductorPoint.y;

    // Exponential smoothing for position (alpha ~0.70 gives crisp tracking with jitter rejection)
    const posAlpha = 0.70;
    const smoothX = state.current.x + posAlpha * (rawX - state.current.x);
    const smoothY = state.current.y + posAlpha * (rawY - state.current.y);

    // Instantaneous velocities
    const rawVx = (smoothX - state.current.x) / dt;
    const rawVy = (smoothY - state.current.y) / dt;

    // Velocity smoothing (alpha ~0.60)
    const velAlpha = 0.60;
    const smoothVx = state.current.vx + velAlpha * (rawVx - state.current.vx);
    const smoothVy = state.current.vy + velAlpha * (rawVy - state.current.vy);

    // Acceleration
    const rawAy = (smoothVy - state.current.vy) / dt;
    const accAlpha = 0.50;
    const smoothAy = state.current.ay + accAlpha * (rawAy - state.current.ay);

    const motionSample: MotionSample = {
      timestampMs: sample.timestampMs,
      x: smoothX,
      y: smoothY,
      vx: smoothVx,
      vy: smoothVy,
      ay: smoothAy,
    };

    state.current = motionSample;
    state.lastUpdatedMs = sample.timestampMs;
    state.history.push(motionSample);

    if (state.history.length > this.historySize) {
      state.history.shift();
    }

    return motionSample;
  }

  getHistory(handIndex: number): MotionSample[] {
    return this.states.get(handIndex)?.history ?? [];
  }

  getState(handIndex: number): HandMotionState | undefined {
    return this.states.get(handIndex);
  }

  reset(): void {
    this.states.clear();
  }
}
