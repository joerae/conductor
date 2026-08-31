/**
 * dynamicsTypes.ts
 *
 * Defines the orchestral dynamic levels, presets, velocity curves,
 * DSP acoustic parameters, and bypass flags for A/B testing in Conductor.
 */

export type DynamicLevel = "pp" | "p" | "mp" | "mf" | "f" | "ff";

export interface DynamicPreset {
  level: DynamicLevel;
  label: string;
  symbol: string;
  velocityMultiplier: number;
  filterCutoffHz: number;
  highShelfGainDb: number;
  reverbWet: number;
  attackTimeSec: number;
}

export const DYNAMIC_ORDER: readonly DynamicLevel[] = [
  "pp",
  "p",
  "mp",
  "mf",
  "f",
  "ff",
] as const;

export const DYNAMIC_PRESETS: Record<DynamicLevel, DynamicPreset> = {
  pp: {
    level: "pp",
    label: "Pianissimo",
    symbol: "pp",
    velocityMultiplier: 0.50,
    filterCutoffHz: 5500,
    highShelfGainDb: -3.0,
    reverbWet: 0.07,
    attackTimeSec: 0.016,
  },
  p: {
    level: "p",
    label: "Piano",
    symbol: "p",
    velocityMultiplier: 0.68,
    filterCutoffHz: 7500,
    highShelfGainDb: -2.0,
    reverbWet: 0.09,
    attackTimeSec: 0.014,
  },
  mp: {
    level: "mp",
    label: "Mezzo-piano",
    symbol: "mp",
    velocityMultiplier: 0.84,
    filterCutoffHz: 10500,
    highShelfGainDb: -1.0,
    reverbWet: 0.12,
    attackTimeSec: 0.011,
  },
  mf: {
    level: "mf",
    label: "Mezzo-forte (Default)",
    symbol: "mf",
    velocityMultiplier: 1.00,
    filterCutoffHz: 14000,
    highShelfGainDb: 0.0,
    reverbWet: 0.16,
    attackTimeSec: 0.008,
  },
  f: {
    level: "f",
    label: "Forte",
    symbol: "f",
    velocityMultiplier: 1.18,
    filterCutoffHz: 17500,
    highShelfGainDb: 1.2,
    reverbWet: 0.24,
    attackTimeSec: 0.005,
  },
  ff: {
    level: "ff",
    label: "Fortissimo (Overburn)",
    symbol: "ff",
    velocityMultiplier: 1.36,
    filterCutoffHz: 20000,
    highShelfGainDb: 2.2,
    reverbWet: 0.30,
    attackTimeSec: 0.003,
  },
};

export interface DSPBypassFlags {
  velocityScaling: boolean;
  timbreFilter: boolean;
  reverbScaling: boolean;
  attackEnvelope: boolean;
  safetyLimiter: boolean;
}

export const DEFAULT_DSP_BYPASS_FLAGS: DSPBypassFlags = {
  velocityScaling: true,
  timbreFilter: true,
  reverbScaling: true,
  attackEnvelope: true,
  safetyLimiter: true,
};

export interface DynamicsTelemetry {
  level: DynamicLevel;
  velocityMultiplier: number;
  filterCutoffHz: number;
  highShelfGainDb: number;
  reverbWet: number;
  attackTimeSec: number;
  bypassFlags: DSPBypassFlags;
}

/**
 * Proportionally scales a MIDI velocity (0–127) according to dynamic level.
 * Preserves melody vs accompaniment balance without clipping.
 * Always clamped between MIN_VELOCITY (18) and MAX_VELOCITY (127).
 */
export function scaleVelocity(
  rawVelocity: number,
  level: DynamicLevel,
  enabled: boolean = true
): number {
  if (!enabled || rawVelocity <= 0) return rawVelocity;
  const preset = DYNAMIC_PRESETS[level] || DYNAMIC_PRESETS.mf;
  const scaled = Math.round(rawVelocity * preset.velocityMultiplier);
  return Math.max(18, Math.min(127, scaled));
}

/**
 * Returns the next or previous dynamic level in the ladder.
 */
export function getStepDynamicLevel(
  current: DynamicLevel,
  delta: 1 | -1
): DynamicLevel {
  const currentIndex = DYNAMIC_ORDER.indexOf(current);
  if (currentIndex === -1) return "mf";
  const nextIndex = Math.max(0, Math.min(DYNAMIC_ORDER.length - 1, currentIndex + delta));
  return DYNAMIC_ORDER[nextIndex];
}
