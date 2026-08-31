/**
 * dynamicsTypes.ts
 *
 * Defines the orchestral dynamic levels, presets, velocity curves,
 * DSP acoustic parameters, and bypass flags for A/B testing in Conductor.
 */

export type DynamicLevel = "pp" | "p" | "mp" | "mf" | "f" | "ff" | "fff";

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
  "fff",
] as const;

export const DYNAMIC_PRESETS: Record<DynamicLevel, DynamicPreset> = {
  pp: {
    level: "pp",
    label: "Pianissimo",
    symbol: "pp",
    velocityMultiplier: 0.30,
    filterCutoffHz: 4000,
    highShelfGainDb: -5.0,
    reverbWet: 0.06,
    attackTimeSec: 0.018,
  },
  p: {
    level: "p",
    label: "Piano",
    symbol: "p",
    velocityMultiplier: 0.50,
    filterCutoffHz: 6000,
    highShelfGainDb: -3.0,
    reverbWet: 0.09,
    attackTimeSec: 0.014,
  },
  mp: {
    level: "mp",
    label: "Mezzo-piano",
    symbol: "mp",
    velocityMultiplier: 0.75,
    filterCutoffHz: 9500,
    highShelfGainDb: -1.2,
    reverbWet: 0.14,
    attackTimeSec: 0.011,
  },
  mf: {
    level: "mf",
    label: "Mezzo-forte (Default)",
    symbol: "mf",
    velocityMultiplier: 1.00,
    filterCutoffHz: 14000,
    highShelfGainDb: 0.0,
    reverbWet: 0.18,
    attackTimeSec: 0.008,
  },
  f: {
    level: "f",
    label: "Forte",
    symbol: "f",
    velocityMultiplier: 1.20,
    filterCutoffHz: 17500,
    highShelfGainDb: 1.2,
    reverbWet: 0.24,
    attackTimeSec: 0.005,
  },
  ff: {
    level: "ff",
    label: "Fortissimo",
    symbol: "ff",
    velocityMultiplier: 1.38,
    filterCutoffHz: 19500,
    highShelfGainDb: 2.2,
    reverbWet: 0.30,
    attackTimeSec: 0.003,
  },
  fff: {
    level: "fff",
    label: "Fortississimo (Overburn ⚡)",
    symbol: "fff",
    velocityMultiplier: 1.55,
    filterCutoffHz: 20000,
    highShelfGainDb: 3.5,
    reverbWet: 0.38,
    attackTimeSec: 0.002,
  },
};

export interface DSPBypassFlags {
  velocityScaling: boolean;
  timbreFilter: boolean;
  reverbScaling: boolean;
  attackEnvelope: boolean;
  safetyLimiter: boolean;
  scoreCompression: boolean;
}

export const DEFAULT_DSP_BYPASS_FLAGS: DSPBypassFlags = {
  velocityScaling: true,
  timbreFilter: true,
  reverbScaling: true,
  attackEnvelope: true,
  safetyLimiter: true,
  scoreCompression: true,
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
 * Baseline center velocity in GM score space (~72).
 * Compressing baked-in score macro swings gives the conductor full dynamic authority
 * while preserving natural phrasing, note-to-note expression, and lead vs accompaniment.
 */
const SCORE_VELOCITY_CENTER = 72;
const SCORE_MACRO_RATIO = 0.45;

/**
 * Complete step-by-step velocity breakdown for diagnostic telemetry.
 */
export interface VelocityDecomposition {
  raw: number;
  macro: number;
  macroDelta: number;
  dynMultiplier: number;
  dynamicLevel: DynamicLevel;
  final: number;
  macroEnabled: boolean;
  velScalingEnabled: boolean;
}

/**
 * Proportionally scales a MIDI velocity (0–127) according to dynamic level.
 * Optionally compresses baked-in MIDI terraced macro dynamics so the conductor
 * commands the ensemble volume without losing intra-measure phrasing.
 */
export function scaleVelocity(
  rawVelocity: number,
  level: DynamicLevel,
  enabled: boolean = true,
  scoreCompression: boolean = true
): number {
  if (!enabled || rawVelocity <= 0) return rawVelocity;

  // 1. Gentle score macro-dynamics compression
  const baseVelocity = scoreCompression
    ? SCORE_VELOCITY_CENTER + (rawVelocity - SCORE_VELOCITY_CENTER) * SCORE_MACRO_RATIO
    : rawVelocity;

  // 2. Conductor dynamic tier scaling
  const preset = DYNAMIC_PRESETS[level] || DYNAMIC_PRESETS.mf;
  const scaled = Math.round(baseVelocity * preset.velocityMultiplier);

  return Math.max(10, Math.min(127, scaled));
}

/**
 * Returns full step-by-step velocity breakdown for telemetry and UI HUD.
 */
export function decomposeVelocity(
  rawVelocity: number,
  level: DynamicLevel,
  enabled: boolean = true,
  scoreCompression: boolean = true
): VelocityDecomposition {
  const preset = DYNAMIC_PRESETS[level] || DYNAMIC_PRESETS.mf;
  if (!enabled || rawVelocity <= 0) {
    return {
      raw: rawVelocity,
      macro: rawVelocity,
      macroDelta: 0,
      dynMultiplier: 1.0,
      dynamicLevel: level,
      final: rawVelocity,
      macroEnabled: scoreCompression,
      velScalingEnabled: enabled,
    };
  }

  const baseVelocity = scoreCompression
    ? SCORE_VELOCITY_CENTER + (rawVelocity - SCORE_VELOCITY_CENTER) * SCORE_MACRO_RATIO
    : rawVelocity;
  const macro = Math.round(baseVelocity);
  const final = Math.max(10, Math.min(127, Math.round(baseVelocity * preset.velocityMultiplier)));

  return {
    raw: rawVelocity,
    macro,
    macroDelta: macro - rawVelocity,
    dynMultiplier: preset.velocityMultiplier,
    dynamicLevel: level,
    final,
    macroEnabled: scoreCompression,
    velScalingEnabled: enabled,
  };
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
