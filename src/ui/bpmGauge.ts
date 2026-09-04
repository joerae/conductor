/**
 * bpmGauge.ts
 *
 * Mathematical mapping and DOM synchronization for the vertical BPM speedometer gauge.
 * Uses a linear mapping between 40 BPM (0%) and 220 BPM (100%).
 */

export const MIN_GAUGE_BPM = 40;
export const MAX_GAUGE_BPM = 220;

/**
 * Maps a BPM value [40, 220] linearly to vertical percentage [0%, 100%].
 */
export function bpmToPercent(bpm: number): number {
  const clamped = Math.max(MIN_GAUGE_BPM, Math.min(MAX_GAUGE_BPM, bpm));
  return ((clamped - MIN_GAUGE_BPM) / (MAX_GAUGE_BPM - MIN_GAUGE_BPM)) * 100;
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
  ticks.forEach(tick => {
    const val = parseFloat(tick.textContent || "");
    if (!isNaN(val)) {
      tick.style.bottom = `${bpmToPercent(val).toFixed(2)}%`;
    }
  });
}
