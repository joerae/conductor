/**
 * tapScenarios.ts — Reusable synthetic tap sequence generators for ConductorClock tests.
 * These produce arrays of timestampMs values simulating various conducting scenarios.
 */

/**
 * Generate n taps at a stable BPM with optional random jitter.
 * @param bpm       Target tempo
 * @param count     Number of taps
 * @param jitterMs  Max random jitter per tap in milliseconds
 * @param startMs   Start time in ms (default 0)
 */
export function stableTaps(
  bpm: number,
  count: number,
  jitterMs: number = 0,
  startMs: number = 0
): number[] {
  const periodMs = 60000 / bpm;
  const taps: number[] = [];
  for (let i = 0; i < count; i++) {
    const jitter = jitterMs > 0 ? (Math.random() * 2 - 1) * jitterMs : 0;
    taps.push(startMs + i * periodMs + jitter);
  }
  return taps;
}

/**
 * Generate taps that linearly accelerate from fromBpm to toBpm over `count` taps.
 */
export function accelerandoTaps(
  fromBpm: number,
  toBpm: number,
  count: number,
  startMs: number = 0
): number[] {
  const taps: number[] = [];
  let t = startMs;
  for (let i = 0; i < count; i++) {
    const bpm = fromBpm + (toBpm - fromBpm) * (i / (count - 1));
    const periodMs = 60000 / bpm;
    taps.push(t);
    t += periodMs;
  }
  return taps;
}

/**
 * Generate taps with one beat missing at position `missIndex`.
 */
export function tapsWithMissedBeat(
  bpm: number,
  count: number,
  missIndex: number,
  startMs: number = 0
): number[] {
  const periodMs = 60000 / bpm;
  const taps: number[] = [];
  let tapIdx = 0;
  for (let beat = 0; beat < count + 1; beat++) {
    if (beat === missIndex) continue; // Skip this beat — missed!
    taps.push(startMs + beat * periodMs);
    tapIdx++;
    if (tapIdx >= count) break;
  }
  return taps;
}

/**
 * Generate a quick double-tap: two taps very close together (< 80ms apart).
 */
export function doubleTapScenario(startMs: number = 0): number[] {
  return [startMs, startMs + 40]; // 40ms apart — should be rejected
}
