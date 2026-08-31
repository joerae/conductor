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
  attackEnvelope: false,
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
  macroRatio: number;
  bypassFlags: DSPBypassFlags;
}

/**
 * Baseline center velocity in GM score space (~72).
 * Compressing baked-in score macro swings gives the conductor full dynamic authority
 * while preserving natural phrasing, note-to-note expression, and lead vs accompaniment.
 */
export const SCORE_VELOCITY_CENTER = 72;
export const DEFAULT_SCORE_MACRO_RATIO = 0.24;

/**
 * Complete step-by-step velocity breakdown for diagnostic telemetry.
 */
export interface VelocityDecomposition {
  raw: number;
  macro: number;
  macroDelta: number;
  macroRatio: number;
  dynMultiplier: number;
  dynamicLevel: DynamicLevel;
  final: number;
  macroEnabled: boolean;
  velScalingEnabled: boolean;
  isAccented?: boolean;
}

/**
 * Proportionally scales a MIDI velocity (0–127) according to dynamic level.
 * Optionally compresses baked-in MIDI terraced macro dynamics so the conductor
 * commands the ensemble volume without losing intra-measure phrasing.
 * If accent is true or a number (0.0–1.0), applies a punchy physical transient burst along a smooth decay curve.
 */
export function scaleVelocity(
  rawVelocity: number,
  level: DynamicLevel,
  enabled: boolean = true,
  scoreCompression: boolean = true,
  macroRatio: number = DEFAULT_SCORE_MACRO_RATIO,
  accent: boolean | number = false
): number {
  if (!enabled || rawVelocity <= 0) return rawVelocity;

  // 1. Score macro-dynamics compression with configurable ratio
  const baseVelocity = scoreCompression
    ? SCORE_VELOCITY_CENTER + (rawVelocity - SCORE_VELOCITY_CENTER) * macroRatio
    : rawVelocity;

  // 2. Conductor dynamic tier scaling
  const preset = DYNAMIC_PRESETS[level] || DYNAMIC_PRESETS.mf;
  let scaled = Math.round(baseVelocity * preset.velocityMultiplier);

  // 3. Musical Accent transient punch with smooth sine curve decay
  const factor = typeof accent === "number" ? Math.max(0, Math.min(1, accent)) : (accent ? 1.0 : 0.0);
  if (factor > 0) {
    scaled = Math.round(scaled * (1 + 0.35 * factor) + 30 * factor);
  }

  return Math.max(10, Math.min(127, scaled));
}

/**
 * Returns full step-by-step velocity breakdown for telemetry and UI HUD.
 */
export function decomposeVelocity(
  rawVelocity: number,
  level: DynamicLevel,
  enabled: boolean = true,
  scoreCompression: boolean = true,
  macroRatio: number = DEFAULT_SCORE_MACRO_RATIO,
  accent: boolean | number = false
): VelocityDecomposition {
  const preset = DYNAMIC_PRESETS[level] || DYNAMIC_PRESETS.mf;
  const factor = typeof accent === "number" ? Math.max(0, Math.min(1, accent)) : (accent ? 1.0 : 0.0);
  const isAccented = factor > 0.05;

  if (!enabled || rawVelocity <= 0) {
    return {
      raw: rawVelocity,
      macro: rawVelocity,
      macroDelta: 0,
      macroRatio,
      dynMultiplier: 1.0,
      dynamicLevel: level,
      final: rawVelocity,
      macroEnabled: scoreCompression,
      velScalingEnabled: enabled,
      isAccented,
    };
  }

  const baseVelocity = scoreCompression
    ? SCORE_VELOCITY_CENTER + (rawVelocity - SCORE_VELOCITY_CENTER) * macroRatio
    : rawVelocity;
  const macro = Math.round(baseVelocity);
  let final = Math.round(baseVelocity * preset.velocityMultiplier);
  if (factor > 0) {
    final = Math.round(final * (1 + 0.35 * factor) + 30 * factor);
  }
  final = Math.max(10, Math.min(127, final));

  return {
    raw: rawVelocity,
    macro,
    macroDelta: macro - rawVelocity,
    macroRatio,
    dynMultiplier: preset.velocityMultiplier,
    dynamicLevel: level,
    final,
    macroEnabled: scoreCompression,
    velScalingEnabled: enabled,
    isAccented,
  };
}

/**
 * Returns the next or previous dynamic level in the ladder.
 */
export function getStepDynamicLevel(
  current: DynamicLevel,
  delta: number
): DynamicLevel {
  const currentIndex = DYNAMIC_ORDER.indexOf(current);
  if (currentIndex === -1) return "mf";
  const nextIndex = Math.max(0, Math.min(DYNAMIC_ORDER.length - 1, currentIndex + delta));
  return DYNAMIC_ORDER[nextIndex];
}
