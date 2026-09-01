/**
 * dynamics.test.ts
 *
 * Tests for the Hybrid Dynamic Modeling System:
 * proportional velocity scaling, macro-dynamics compression,
 * boundary clamping, ladder stepping, and preset acoustic parameters.
 */

import { describe, it, expect } from "vitest";
import { AudioEngine } from "../src/audio/AudioEngine";
import {
  DYNAMIC_ORDER,
  DYNAMIC_PRESETS,
  scaleVelocity,
  decomposeVelocity,
  getStepDynamicLevel,
  DEFAULT_DSP_BYPASS_FLAGS,
  type DynamicLevel,
} from "../src/audio/dynamicsTypes";

describe("Dynamic Presets & Acoustic Parameters", () => {
  it("defines all 7 canonical dynamic levels in correct musical order including fff overburn", () => {
    expect(DYNAMIC_ORDER).toEqual(["pp", "p", "mp", "mf", "f", "ff", "fff"]);
  });

  it("ensures filter cutoffs scale monotonically with dynamic intensity", () => {
    let lastCutoff = 0;
    for (const level of DYNAMIC_ORDER) {
      const preset = DYNAMIC_PRESETS[level];
      expect(preset.filterCutoffHz).toBeGreaterThan(lastCutoff);
      expect(preset.filterCutoffHz).toBeGreaterThanOrEqual(4000);
      expect(preset.filterCutoffHz).toBeLessThanOrEqual(20000);
      lastCutoff = preset.filterCutoffHz;
    }
  });

  it("ensures reverb wet ratio expands monotonically from pp to fff", () => {
    let lastWet = 0;
    for (const level of DYNAMIC_ORDER) {
      const preset = DYNAMIC_PRESETS[level];
      expect(preset.reverbWet).toBeGreaterThan(lastWet);
      expect(preset.reverbWet).toBeGreaterThanOrEqual(0.05);
      expect(preset.reverbWet).toBeLessThanOrEqual(0.85);
      lastWet = preset.reverbWet;
    }
  });

  it("ensures attack time shortens monotonically for crisp bite in forte", () => {
    let lastAttack = Infinity;
    for (const level of DYNAMIC_ORDER) {
      const preset = DYNAMIC_PRESETS[level];
      expect(preset.attackTimeSec).toBeLessThan(lastAttack);
      expect(preset.attackTimeSec).toBeGreaterThanOrEqual(0.002);
      expect(preset.attackTimeSec).toBeLessThanOrEqual(0.020);
      lastAttack = preset.attackTimeSec;
    }
  });
});

describe("Score Macro-Dynamics Compression & Proportional Scaling", () => {
  it("preserves score median near mf when compression is active", () => {
    // Note at score median (72) remains at 72 at mf
    expect(scaleVelocity(72, "mf", true, true)).toBe(72);
  });

  it("smooths raw score terraced macro swings while preserving intra-phrase hierarchy", () => {
    // In raw MIDI: Forte theme lead is 115, accomp is 95
    const theme1Lead = scaleVelocity(115, "mf", true, true);
    const theme1Acc = scaleVelocity(95, "mf", true, true);
    expect(theme1Lead).toBe(82);
    expect(theme1Acc).toBe(78);
    expect(theme1Lead).toBeGreaterThan(theme1Acc);

    // In raw MIDI: Piano theme lead is 55, accomp is 40
    const theme2Lead = scaleVelocity(55, "mf", true, true);
    const theme2Acc = scaleVelocity(40, "mf", true, true);
    expect(theme2Lead).toBe(68);
    expect(theme2Acc).toBe(64);
    expect(theme2Lead).toBeGreaterThan(theme2Acc);
  });

  it("gives conductor commanding control across dynamic tiers", () => {
    // In pp: entire orchestra (even loud theme 1) plays softly
    expect(scaleVelocity(115, "pp", true, true)).toBe(25);
    expect(scaleVelocity(55, "pp", true, true)).toBe(20);

    // In ff: entire orchestra plays with powerful volume
    expect(scaleVelocity(115, "ff", true, true)).toBe(114);
    expect(scaleVelocity(55, "ff", true, true)).toBe(94);

    // In fff (overburn): pushes to peak limit
    expect(scaleVelocity(115, "fff", true, true)).toBe(127);
    expect(scaleVelocity(55, "fff", true, true)).toBe(105);
  });

  it("enforces minimum clamp of 10 and maximum clamp of 127", () => {
    expect(scaleVelocity(10, "pp", true, false)).toBe(10);
    expect(scaleVelocity(127, "fff", true, true)).toBe(127);
  });

  it("respects bypass flags when disabled", () => {
    expect(scaleVelocity(95, "ff", false, true)).toBe(95);
    expect(scaleVelocity(95, "ff", true, false)).toBe(127); // uncompressed raw 95 * 1.38
  });
});

describe("Dynamic Ladder Stepping", () => {
  it("steps up through all 7 dynamic levels to fff", () => {
    expect(getStepDynamicLevel("pp", 1)).toBe("p");
    expect(getStepDynamicLevel("p", 1)).toBe("mp");
    expect(getStepDynamicLevel("mp", 1)).toBe("mf");
    expect(getStepDynamicLevel("mf", 1)).toBe("f");
    expect(getStepDynamicLevel("f", 1)).toBe("ff");
    expect(getStepDynamicLevel("ff", 1)).toBe("fff");
    expect(getStepDynamicLevel("fff", 1)).toBe("fff"); // Clamped at ceiling
  });

  it("steps down from fff to pp", () => {
    expect(getStepDynamicLevel("fff", -1)).toBe("ff");
    expect(getStepDynamicLevel("ff", -1)).toBe("f");
    expect(getStepDynamicLevel("f", -1)).toBe("mf");
    expect(getStepDynamicLevel("mf", -1)).toBe("mp");
    expect(getStepDynamicLevel("mp", -1)).toBe("p");
    expect(getStepDynamicLevel("p", -1)).toBe("pp");
    expect(getStepDynamicLevel("pp", -1)).toBe("pp"); // Clamped at floor
  });
});

describe("DSP Bypass Defaults & Macro Ratio Control", () => {
  it("has default DSP flags set (attackEnvelope disabled by default)", () => {
    expect(DEFAULT_DSP_BYPASS_FLAGS).toEqual({
      velocityScaling: true,
      timbreFilter: true,
      reverbScaling: true,
      attackEnvelope: false,
      safetyLimiter: true,
      scoreCompression: true,
    });
  });

  it("supports musical accent transient punch in scaleVelocity and decomposeVelocity", () => {
    // Normal mf note
    const normalVel = scaleVelocity(72, "mf", true, true, 0.24, false);
    expect(normalVel).toBe(72);

    // Accented mf note: boosted transient punch
    const accentedVel = scaleVelocity(72, "mf", true, true, 0.24, true);
    expect(accentedVel).toBe(Math.min(127, Math.round(72 * 1.35 + 30))); // 127
    expect(accentedVel).toBeGreaterThan(normalVel);

    const decomp = decomposeVelocity(72, "mf", true, true, 0.24, true);
    expect(decomp.isAccented).toBe(true);
    expect(decomp.final).toBe(127);
  });

  it("allows continuous adjustment of macro smoothing ratio from 0.0 to 1.0", () => {
    const rawVel = 115;
    // Ratio 0.0: completely flat (all notes centered to 72)
    expect(scaleVelocity(rawVel, "mf", true, true, 0.0)).toBe(72);
    // Ratio 0.25: heavy smoothing (72 + 43*0.25 = 83)
    expect(scaleVelocity(rawVel, "mf", true, true, 0.25)).toBe(83);
    // Ratio 0.45: default moderate smoothing (72 + 43*0.45 = 91)
    expect(scaleVelocity(rawVel, "mf", true, true, 0.45)).toBe(91);
    // Ratio 1.0: raw score dynamics (72 + 43*1.0 = 115)
    expect(scaleVelocity(rawVel, "mf", true, true, 1.0)).toBe(115);
  });
});

describe("AudioEngine Section Focus Mixing", () => {
  it("calculates correct foreground boost and background reduction multipliers", () => {
    const engine = new AudioEngine();
    // Default: no focus active
    expect(engine.getChannelFocusMultiplier(0)).toBe(1.0);
    expect(engine.getChannelFocusMultiplier(1)).toBe(1.0);

    // Focus channel 0 with focus 0.5
    engine.setSectionFocus([0], 0.5);
    expect(engine.getFocusAmount()).toBeCloseTo(0.5);
    expect(engine.getChannelFocusMultiplier(0)).toBeCloseTo(1.175);
    expect(engine.getChannelFocusMultiplier(1)).toBeCloseTo(0.725);

    // Focus channel 0 with max focus 1.0
    engine.setSectionFocus([0], 1.0);
    expect(engine.getChannelFocusMultiplier(0)).toBeCloseTo(1.35);
    expect(engine.getChannelFocusMultiplier(1)).toBeCloseTo(0.45);

    // Reset focus
    engine.setSectionFocus(null, 0);
    expect(engine.getChannelFocusMultiplier(0)).toBe(1.0);
    expect(engine.getChannelFocusMultiplier(1)).toBe(1.0);
  });
});
