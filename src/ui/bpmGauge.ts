/**
 * bpmGauge.ts
 *
 * Mathematical mapping and DOM synchronization for the vertical BPM speedometer gauge.
 * Uses a linear mapping between 40 BPM (0%) and 220 BPM (100%).
 */

export const MIN_GAUGE_BPM = 40;
export const MAX_GAUGE_BPM = 220;

let activeMinBpm = MIN_GAUGE_BPM;
let activeMaxBpm = MAX_GAUGE_BPM;

/**
 * Sets the active BPM range for the gauge display and pointer mapping.
 */
export function setGaugeBpmRange(minBpm: number = MIN_GAUGE_BPM, maxBpm: number = MAX_GAUGE_BPM): void {
  activeMinBpm = minBpm;
  activeMaxBpm = maxBpm;
}

/**
 * Returns the currently configured BPM gauge range.
 */
export function getGaugeBpmRange(): { minBpm: number; maxBpm: number } {
  return { minBpm: activeMinBpm, maxBpm: activeMaxBpm };
}

/**
 * Maps a BPM value linearly to vertical percentage [0%, 100%] according to active gauge bounds.
 */
export function bpmToPercent(bpm: number, minBpm = activeMinBpm, maxBpm = activeMaxBpm): number {
  const clamped = Math.max(minBpm, Math.min(maxBpm, bpm));
  return ((clamped - minBpm) / Math.max(1, maxBpm - minBpm)) * 100;
}

/**
 * Maps a vertical percentage [0%, 100%] linearly back to BPM according to active gauge bounds.
 */
export function percentToBpm(percent: number, minBpm = activeMinBpm, maxBpm = activeMaxBpm): number {
  const clamped = Math.max(0, Math.min(100, percent));
  return minBpm + (clamped / 100) * (maxBpm - minBpm);
}

/**
 * Dynamically positions all BPM gauge tick labels to match the linear formula.
 */
export function initBpmGaugeTicks(container?: HTMLElement | null): void {
  const ticksContainer =
    container ??
    (typeof document !== "undefined"
      ? document.querySelector<HTMLElement>(".bpm-gauge-ticks")
      : null);
  if (!ticksContainer) return;
  const ticks = ticksContainer.querySelectorAll<HTMLElement>(".bpm-tick");
  if (ticks.length >= 2 && (activeMinBpm !== MIN_GAUGE_BPM || activeMaxBpm !== MAX_GAUGE_BPM)) {
    ticks[0].textContent = `${activeMaxBpm}`;
    ticks[ticks.length - 1].textContent = `${activeMinBpm}`;
  }
  ticks.forEach(tick => {
    const val = parseFloat(tick.textContent || "");
    if (!isNaN(val)) {
      if (val < activeMinBpm || val > activeMaxBpm) {
        tick.style.display = "none";
      } else {
        tick.style.display = "";
        tick.style.bottom = `${bpmToPercent(val).toFixed(2)}%`;
      }
    }
  });
}
