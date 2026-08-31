/**
 * dynamics.test.ts
 *
 * Tests for the Hybrid Dynamic Modeling System:
 * proportional velocity scaling, boundary clamping, ladder stepping,
 * and preset acoustic parameters.
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
  it("defines all 6 canonical dynamic levels in correct musical order", () => {
    expect(DYNAMIC_ORDER).toEqual(["pp", "p", "mp", "mf", "f", "ff"]);
  });

  it("ensures filter cutoffs scale monotonically with dynamic intensity", () => {
    let lastCutoff = 0;
    for (const level of DYNAMIC_ORDER) {
      const preset = DYNAMIC_PRESETS[level];
      expect(preset.filterCutoffHz).toBeGreaterThan(lastCutoff);
      expect(preset.filterCutoffHz).toBeGreaterThanOrEqual(5000);
      expect(preset.filterCutoffHz).toBeLessThanOrEqual(20000);
      lastCutoff = preset.filterCutoffHz;
    }
  });

  it("ensures reverb wet ratio expands monotonically from pp to ff", () => {
    let lastWet = 0;
    for (const level of DYNAMIC_ORDER) {
      const preset = DYNAMIC_PRESETS[level];
      expect(preset.reverbWet).toBeGreaterThan(lastWet);
      expect(preset.reverbWet).toBeGreaterThanOrEqual(0.05);
      expect(preset.reverbWet).toBeLessThanOrEqual(0.35);
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

describe("Proportional Velocity Scaling", () => {
  it("preserves score baseline at mf", () => {
    expect(scaleVelocity(95, "mf")).toBe(95);
    expect(scaleVelocity(60, "mf")).toBe(60);
  });

  it("scales velocity up proportionally in f and ff", () => {
    const fLead = scaleVelocity(95, "f");
    const fAcc = scaleVelocity(60, "f");
    expect(fLead).toBe(112);
    expect(fAcc).toBe(71);

    const ffLead = scaleVelocity(95, "ff");
    const ffAcc = scaleVelocity(60, "ff");
    expect(ffLead).toBe(127); // clamped to 127
    expect(ffAcc).toBe(82);

    // Dynamic contrast is preserved (Lead - Acc is still 45 points in ff)
    expect(ffLead - ffAcc).toBe(45);
  });

  it("scales velocity down smoothly in p and pp", () => {
    const pLead = scaleVelocity(95, "p");
    const pAcc = scaleVelocity(60, "p");
    expect(pLead).toBe(65);
    expect(pAcc).toBe(41);

    const ppLead = scaleVelocity(95, "pp");
    const ppAcc = scaleVelocity(60, "pp");
    expect(ppLead).toBe(48);
    expect(ppAcc).toBe(30);
  });

  it("enforces minimum clamp of 18 and maximum clamp of 127", () => {
    // Ultra soft note scaled at pp does not drop to inaudible 0
    expect(scaleVelocity(20, "pp")).toBe(18);
    expect(scaleVelocity(10, "pp")).toBe(18);

    // Forte accents clamp cleanly at 127 without overflow
    expect(scaleVelocity(120, "ff")).toBe(127);
    expect(scaleVelocity(127, "ff")).toBe(127);
  });

  it("respects bypass flag when velocity scaling is disabled", () => {
    expect(scaleVelocity(95, "ff", false)).toBe(95);
    expect(scaleVelocity(60, "pp", false)).toBe(60);
  });
});

describe("Dynamic Ladder Stepping", () => {
  it("steps up one dynamic level correctly", () => {
    expect(getStepDynamicLevel("pp", 1)).toBe("p");
    expect(getStepDynamicLevel("p", 1)).toBe("mp");
    expect(getStepDynamicLevel("mp", 1)).toBe("mf");
    expect(getStepDynamicLevel("mf", 1)).toBe("f");
    expect(getStepDynamicLevel("f", 1)).toBe("ff");
    expect(getStepDynamicLevel("ff", 1)).toBe("ff"); // Clamped at ceiling
  });

  it("steps down one dynamic level correctly", () => {
    expect(getStepDynamicLevel("ff", -1)).toBe("f");
    expect(getStepDynamicLevel("f", -1)).toBe("mf");
    expect(getStepDynamicLevel("mf", -1)).toBe("mp");
    expect(getStepDynamicLevel("mp", -1)).toBe("p");
    expect(getStepDynamicLevel("p", -1)).toBe("pp");
    expect(getStepDynamicLevel("pp", -1)).toBe("pp"); // Clamped at floor
  });
});

describe("DSP Bypass Defaults", () => {
  it("has all DSP modules enabled by default", () => {
    expect(DEFAULT_DSP_BYPASS_FLAGS).toEqual({
      velocityScaling: true,
      timbreFilter: true,
      reverbScaling: true,
      attackEnvelope: true,
      safetyLimiter: true,
    });
  });
});
