/**
 * dynamics.test.ts
 *
 * Tests for the Hybrid Dynamic Modeling System:
 * proportional velocity scaling, macro-dynamics compression,
 * boundary clamping, ladder stepping, and preset acoustic parameters.
 */

import { describe, it, expect } from "vitest";
import {
  DYNAMIC_ORDER,
  DYNAMIC_PRESETS,
  scaleVelocity,
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
    expect(theme1Lead).toBe(91);
    expect(theme1Acc).toBe(82);
    expect(theme1Lead).toBeGreaterThan(theme1Acc);

    // In raw MIDI: Piano theme lead is 55, accomp is 40
    const theme2Lead = scaleVelocity(55, "mf", true, true);
    const theme2Acc = scaleVelocity(40, "mf", true, true);
    expect(theme2Lead).toBe(64);
    expect(theme2Acc).toBe(58);
    expect(theme2Lead).toBeGreaterThan(theme2Acc);

    // Notice: The gap between theme 1 (91) and theme 2 (64) is now a smooth 27 points
    // instead of an unmanageable 60 points in raw MIDI, allowing conductor dynamics to dominate!
  });

  it("gives conductor commanding control across dynamic tiers", () => {
    // In pp: entire orchestra (even loud theme 1) plays softly
    expect(scaleVelocity(115, "pp", true, true)).toBe(27);
    expect(scaleVelocity(55, "pp", true, true)).toBe(19);

    // In ff: entire orchestra plays with powerful volume
    expect(scaleVelocity(115, "ff", true, true)).toBe(126);
    expect(scaleVelocity(55, "ff", true, true)).toBe(89);

    // In fff (overburn): pushes to peak limit
    expect(scaleVelocity(115, "fff", true, true)).toBe(127);
    expect(scaleVelocity(55, "fff", true, true)).toBe(100);
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

describe("DSP Bypass Defaults", () => {
  it("has all DSP modules enabled by default including scoreCompression", () => {
    expect(DEFAULT_DSP_BYPASS_FLAGS).toEqual({
      velocityScaling: true,
      timbreFilter: true,
      reverbScaling: true,
      attackEnvelope: true,
      safetyLimiter: true,
      scoreCompression: true,
    });
  });
});
