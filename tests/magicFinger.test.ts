import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MagicFingerController,
  type MagicFingerGeometryProvider,
  type ScreenRect,
  type InstrumentSectionTarget,
} from "../src/camera/MagicFingerController";
import type { HandSample } from "../src/camera/cameraTypes";
import { ConductorClock } from "../src/clock/ConductorClock";

class MockGeometryProvider implements MagicFingerGeometryProvider {
  constructor(
    public canvasRect: ScreenRect = { left: 100, top: 100, right: 300, bottom: 300, width: 200, height: 200 },
    public svgRect: ScreenRect = { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 },
    public tempoRect: ScreenRect = { left: 320, top: 100, right: 360, bottom: 500, width: 40, height: 400 },
    public dynamicsRect: ScreenRect = { left: 100, top: 320, right: 500, bottom: 360, width: 400, height: 40 },
    public sections: InstrumentSectionTarget[] = [
      { id: "violins1", rect: { left: 150, top: 10, right: 250, bottom: 80, width: 100, height: 70 } },
      { id: "cellos", rect: { left: 300, top: 10, right: 400, bottom: 80, width: 100, height: 70 } },
    ]
  ) {}

  getCanvasRect(): ScreenRect | null {
    return this.canvasRect;
  }
  getSvgOverlayRect(): ScreenRect | null {
    return this.svgRect;
  }
  getTempoTrackRect(): ScreenRect | null {
    return this.tempoRect;
  }
  getDynamicsTrackRect(): ScreenRect | null {
    return this.dynamicsRect;
  }
  getInstrumentSections(): InstrumentSectionTarget[] {
    return this.sections;
  }
}

function createSample(
  gesture: "Pointing" | "Pointing_Up" | "Open_Palm",
  tipX: number,
  tipY: number,
  pipX: number,
  pipY: number,
  handIndex: number = 0
): HandSample {
  const landmarks = Array(21).fill({ x: 0.5, y: 0.5, z: 0 });
  // index finger tip is landmark 8
  landmarks[8] = { x: tipX, y: tipY, z: 0 };
  // index finger pip is landmark 6
  landmarks[6] = { x: pipX, y: pipY, z: 0 };
  // index finger mcp is landmark 5
  landmarks[5] = { x: pipX, y: pipY + 0.05, z: 0 };
  // middle finger mcp is landmark 9
  landmarks[9] = { x: pipX + 0.03, y: pipY + 0.05, z: 0 };
  // wrist is landmark 0
  landmarks[0] = { x: pipX, y: pipY + 0.15, z: 0 };

  return {
    handIndex,
    timestampMs: 1000,
    handedness: "Right",
    confidence: 0.95,
    landmarks,
    conductorX: tipX,
    conductorY: tipY,
    speed: 0,
    acceleration: 0,
    direction: { x: 0, y: 0 },
    gesture,
  };
}

describe("MagicFingerController", () => {
  let mockGeo: MockGeometryProvider;
  let controller: MagicFingerController;

  beforeEach(() => {
    mockGeo = new MockGeometryProvider();
    controller = new MagicFingerController(mockGeo);
  });

  it("returns idle state when no pointing gestures are active", () => {
    const sample = createSample("Open_Palm", 0.5, 0.5, 0.5, 0.6);
    const tel = controller.update({
      samples: [sample],
      indicatedBpm: 100,
      continuousDynamic: 0.5,
    });

    expect(tel.isActive).toBe(false);
    expect(tel.state).toBe("idle");
    expect(tel.ray).toBeNull();
  });

  it("activates ray when Pointing or Pointing_Up is detected", () => {
    const sample = createSample("Pointing", 0.5, 0.3, 0.5, 0.5);
    const tel = controller.update({
      samples: [sample],
      indicatedBpm: 100,
      continuousDynamic: 0.5,
      isMirrored: false,
    });

    expect(tel.isActive).toBe(true);
    expect(tel.ray).not.toBeNull();
    expect(tel.ray?.startX).toBeCloseTo(200, 0);
  });

  it("hovers over tempo gauge without acquiring if ray is far from indicated BPM", () => {
    const onBpmChange = vi.fn();
    controller.setCallbacks({ onBpmChange });

    // Ray hits at y=200 -> 75% -> 175 BPM
    const sample = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);

    // Indicated BPM is 100, so diff is 75 BPM (> 22 capture delta)
    const tel = controller.update({
      samples: [sample],
      indicatedBpm: 100,
      continuousDynamic: 0.5,
      isMirrored: false,
    });

    expect(tel.state).toBe("pointing");
    expect(tel.hoverTarget).toBe("tempo");
    expect(tel.activeTarget).toBeNull();
    expect(tel.ray?.isAcquired).toBe(false);
    expect(onBpmChange).not.toHaveBeenCalled();
  });

  it("safely acquires tempo gauge when ray intersects near indicated BPM", () => {
    const onBpmChange = vi.fn();
    controller.setCallbacks({ onBpmChange });

    // Ray hits at y=200 -> 75% -> 175 BPM
    const sample = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);

    // Indicated BPM is 175, so diff is 0 (< 22 capture delta)
    const tel = controller.update({
      samples: [sample],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
    });

    expect(tel.state).toBe("tempo_acquired");
    expect(tel.activeTarget).toBe("tempo");
    expect(tel.ray?.isAcquired).toBe(true);
    expect(tel.liveBpm).toBe(175);
    expect(onBpmChange).toHaveBeenCalledWith(175);
  });

  it("hovers over dynamics ribbon without acquiring if far from indicated dynamic", () => {
    const onDynamicChange = vi.fn();
    controller.setCallbacks({ onDynamicChange });

    // Ray hits at x=200 -> 25% continuous dynamic
    const sample = createSample("Pointing", 0.5, 0.8, 0.5, 0.4);

    // Continuous dynamic is 0.8 (diff is 0.55 > 0.16 capture delta)
    const tel = controller.update({
      samples: [sample],
      indicatedBpm: 120,
      continuousDynamic: 0.8,
      isMirrored: false,
    });

    expect(tel.state).toBe("pointing");
    expect(tel.hoverTarget).toBe("dynamics");
    expect(tel.activeTarget).toBeNull();
    expect(tel.ray?.isAcquired).toBe(false);
    expect(onDynamicChange).not.toHaveBeenCalled();
  });

  it("safely acquires dynamics ribbon when ray intersects near indicated dynamic", () => {
    const onDynamicChange = vi.fn();
    controller.setCallbacks({ onDynamicChange });

    // Ray hits at x=200 -> 25% continuous dynamic
    const sample = createSample("Pointing", 0.5, 0.8, 0.5, 0.4);

    // Continuous dynamic is 0.25 (diff is 0 < 0.16 capture delta)
    const tel = controller.update({
      samples: [sample],
      indicatedBpm: 120,
      continuousDynamic: 0.25,
      isMirrored: false,
    });

    expect(tel.state).toBe("dynamics_acquired");
    expect(tel.activeTarget).toBe("dynamics");
    expect(tel.ray?.isAcquired).toBe(true);
    expect(tel.liveDynamic).toBeCloseTo(0.25, 2);
    expect(onDynamicChange).toHaveBeenCalled();
  });

  it("spotlights instrument section when ray points at an orchestra section", () => {
    const onSpotlightChange = vi.fn();
    controller.setCallbacks({ onSpotlightChange });

    const sample = createSample("Pointing_Up", 0.5, 0.2, 0.5, 0.6);

    const tel = controller.update({
      samples: [sample],
      indicatedBpm: 120,
      continuousDynamic: 0.5,
      isMirrored: false,
    });

    expect(tel.targetedSectionId).toBe("violins1");
    expect(onSpotlightChange).toHaveBeenCalledWith("violins1");
  });

  it("supports vertical dynamics ribbon on the left when pointing left", () => {
    const onDynamicChange = vi.fn();
    // Configure vertical dynamics track on the left of camera
    mockGeo.dynamicsRect = { left: 40, top: 100, right: 80, bottom: 500, width: 40, height: 400 };
    controller.setCallbacks({ onDynamicChange });

    // Pointing left: tipX = 0.2, pipX = 0.6 (rayDirX < 0)
    // Ray originates at canvas x=140, y=200, points left towards x=60
    const sample = createSample("Pointing", 0.2, 0.5, 0.6, 0.5);

    // Continuous dynamic is 0.75 (y=200 on track from 100 to 500 -> (500 - 200) / 400 = 0.75)
    const tel = controller.update({
      samples: [sample],
      indicatedBpm: 120,
      continuousDynamic: 0.75,
      isMirrored: false,
    });

    expect(tel.state).toBe("dynamics_acquired");
    expect(tel.hoverTarget).toBe("dynamics");
    expect(tel.activeTarget).toBe("dynamics");
    expect(tel.ray?.isAcquired).toBe(true);
    expect(tel.liveDynamic).toBeCloseTo(0.75, 2);
    expect(onDynamicChange).toHaveBeenCalled();
  });

  it("hovers over left vertical dynamics ribbon without acquiring if far from current dynamic", () => {
    const onDynamicChange = vi.fn();
    mockGeo.dynamicsRect = { left: 40, top: 100, right: 80, bottom: 500, width: 40, height: 400 };
    controller.setCallbacks({ onDynamicChange });

    // Ray intersects at y=200 -> hitVal = 0.75
    const sample = createSample("Pointing", 0.2, 0.5, 0.6, 0.5);

    // Current dynamic is 0.2 (diff is 0.55 > 0.16 capture delta)
    const tel = controller.update({
      samples: [sample],
      indicatedBpm: 120,
      continuousDynamic: 0.2,
      isMirrored: false,
    });

    expect(tel.state).toBe("pointing");
    expect(tel.hoverTarget).toBe("dynamics");
    expect(tel.activeTarget).toBeNull();
    expect(tel.ray?.isAcquired).toBe(false);
    expect(onDynamicChange).not.toHaveBeenCalled();
  });

  it("guarantees ray start point is clamped within canvas bounds even with out-of-range landmarks", () => {
    // Landmark far outside camera [0, 1] range (e.g. -0.5, 1.8)
    const extremeSample = createSample("Pointing", -0.5, 1.8, 0.5, 0.5);
    const tel = controller.update({
      samples: [extremeSample],
      indicatedBpm: 120,
      continuousDynamic: 0.5,
      isMirrored: false,
    });

    expect(tel.ray).not.toBeNull();
    // canvasRect is left: 100, top: 100, width: 200, height: 200
    // startX must be clamped to canvas bounds [100, 300]
    expect(tel.ray!.startX).toBeGreaterThanOrEqual(100);
    expect(tel.ray!.startX).toBeLessThanOrEqual(300);
    expect(tel.ray!.startY).toBeGreaterThanOrEqual(100);
    expect(tel.ray!.startY).toBeLessThanOrEqual(300);
  });

  it("releases instantly when finger is retracted", () => {
    const onSpotlightChange = vi.fn();
    controller.setCallbacks({ onSpotlightChange });

    const pointSample = createSample("Pointing", 0.5, 0.2, 0.5, 0.6);
    controller.update({
      samples: [pointSample],
      indicatedBpm: 120,
      continuousDynamic: 0.5,
      isMirrored: false,
    });

    const openSample = createSample("Open_Palm", 0.5, 0.5, 0.5, 0.6);
    const tel = controller.update({
      samples: [openSample],
      indicatedBpm: 120,
      continuousDynamic: 0.5,
      isMirrored: false,
    });

    expect(tel.isActive).toBe(false);
    expect(tel.state).toBe("idle");
    expect(tel.ray).toBeNull();
    expect(onSpotlightChange).toHaveBeenCalledWith(null);
  });

  it("acquires tempo gauge via dwell hold when holding steady on gauge for >= DWELL_ACQUIRE_MS", () => {
    const onBpmChange = vi.fn();
    controller.setCallbacks({ onBpmChange });

    // Aim at tempo gauge: y=200 -> 75% -> 175 BPM
    const sample = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);

    // Frame 1: diff is 75 BPM (> 35 delta), initial hover
    const tel1 = controller.update({
      samples: [sample],
      indicatedBpm: 100,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1000,
    });
    expect(tel1.state).toBe("pointing");
    expect(tel1.hoverTarget).toBe("tempo");
    expect(tel1.activeTarget).toBeNull();

    // Frame 2: 300ms later (>= 280ms dwell) -> acquires automatically!
    const tel2 = controller.update({
      samples: [sample],
      indicatedBpm: 100,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1300,
    });
    expect(tel2.state).toBe("tempo_acquired");
    expect(tel2.activeTarget).toBe("tempo");
    expect(tel2.liveBpm).toBe(175);
    expect(onBpmChange).toHaveBeenCalledWith(175);
  });

  it("acquires left vertical dynamics gauge via dwell hold when holding steady", () => {
    const onDynamicChange = vi.fn();
    mockGeo.dynamicsRect = { left: 40, top: 100, right: 80, bottom: 500, width: 40, height: 400 };
    controller.setCallbacks({ onDynamicChange });

    // Pointing left: tipX = 0.2, pipX = 0.6 -> hitVal = 0.75
    const sample = createSample("Pointing", 0.2, 0.5, 0.6, 0.5);

    // Frame 1: Current dynamic is 0.1 (diff is 0.65 > 0.25 delta), hovering
    const tel1 = controller.update({
      samples: [sample],
      indicatedBpm: 120,
      continuousDynamic: 0.1,
      isMirrored: false,
      nowMs: 1000,
    });
    expect(tel1.state).toBe("pointing");
    expect(tel1.hoverTarget).toBe("dynamics");
    expect(tel1.activeTarget).toBeNull();

    // Frame 2: 350ms later -> acquires automatically!
    const tel2 = controller.update({
      samples: [sample],
      indicatedBpm: 120,
      continuousDynamic: 0.1,
      isMirrored: false,
      nowMs: 1350,
    });
    expect(tel2.state).toBe("dynamics_acquired");
    expect(tel2.activeTarget).toBe("dynamics");
    expect(tel2.liveDynamic).toBeCloseTo(0.75, 2);
    expect(onDynamicChange).toHaveBeenCalled();
  });

  it("selects finger closest to the right edge when multiple hands point right towards tempo", () => {
    // Hand 0: centered, pointing right (tipX: 0.6, pipX: 0.4)
    const hand0 = createSample("Pointing", 0.6, 0.5, 0.4, 0.5, 0);
    // Hand 1: further to the right edge, pointing right (tipX: 0.85, pipX: 0.7)
    const hand1 = createSample("Pointing", 0.85, 0.5, 0.7, 0.5, 1);

    const tel = controller.update({
      samples: [hand0, hand1],
      indicatedBpm: 120,
      continuousDynamic: 0.5,
      isMirrored: false,
    });

    expect(tel.pointingHandIndex).toBe(1);
  });

  it("selects finger closest to the left edge when multiple hands point left towards dynamics", () => {
    // Hand 0: moderately left, pointing left (tipX: 0.35, pipX: 0.5)
    const hand0 = createSample("Pointing", 0.35, 0.5, 0.5, 0.5, 0);
    // Hand 1: further to the left edge, pointing left (tipX: 0.15, pipX: 0.3)
    const hand1 = createSample("Pointing", 0.15, 0.5, 0.3, 0.5, 1);

    const tel = controller.update({
      samples: [hand0, hand1],
      indicatedBpm: 120,
      continuousDynamic: 0.5,
      isMirrored: false,
    });

    expect(tel.pointingHandIndex).toBe(1);
  });

  it("selects finger closest to the top (highest hand) when multiple hands point up towards orchestra", () => {
    // Hand 0: pointing up at mid-height (tipY: 0.4, pipY: 0.6)
    const hand0 = createSample("Pointing_Up", 0.5, 0.4, 0.5, 0.6, 0);
    // Hand 1: pointing up higher near the top (tipY: 0.15, pipY: 0.35)
    const hand1 = createSample("Pointing_Up", 0.5, 0.15, 0.5, 0.35, 1);

    const tel = controller.update({
      samples: [hand0, hand1],
      indicatedBpm: 120,
      continuousDynamic: 0.5,
      isMirrored: false,
    });

    expect(tel.pointingHandIndex).toBe(1);
  });

  it("does not snap laser endpoint to section center when pointing up at orchestra sections and turns gold", () => {
    const onSpotlightChange = vi.fn();
    controller.setCallbacks({ onSpotlightChange });

    // Aiming up with slight angle: tipX = 0.46, pipX = 0.48 (ray points slightly leftwards towards violins1)
    const sample = createSample("Pointing_Up", 0.46, 0.2, 0.48, 0.6);

    const tel = controller.update({
      samples: [sample],
      indicatedBpm: 120,
      continuousDynamic: 0.5,
      isMirrored: false,
    });

    expect(tel.targetedSectionId).toBe("violins1");
    expect(tel.ray?.isAcquired).toBe(true); // Turns energetic gold!
    expect(tel.ray?.targetType).toBe("instrument");
    // Center of violins1 is 200. With free-aiming ray, endX should NOT snap to exactly 200
    expect(tel.ray?.endX).not.toBe(200);
    expect(onSpotlightChange).toHaveBeenCalledWith("violins1");
  });

  it("safely releases tempo gauge on upward flick exit without jumping to max 220 BPM", () => {
    const onBpmChange = vi.fn();
    controller.setCallbacks({ onBpmChange });

    // Step 1: Acquire tempo at moderate BPM (~120 BPM)
    // Tempo track is from top: 100 to bottom: 500 (height 400).
    // Middle y=300 -> 50% -> 130 BPM
    // Aim hits at y=200 on tempo gauge -> 75% -> 175 BPM
    const aimSample = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
    const telAcquire = controller.update({
      samples: [aimSample],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1000,
    });
    expect(telAcquire.state).toBe("tempo_acquired");
    expect(telAcquire.activeTarget).toBe("tempo");
    const acquiredBpm = telAcquire.liveBpm;
    expect(acquiredBpm).toBe(175);

    // Step 2: Flick finger quickly UP towards orchestra (rayDirY strongly negative < -0.32)
    const flickSample = createSample("Pointing_Up", 0.7, 0.2, 0.5, 0.6);
    const telFlick = controller.update({
      samples: [flickSample],
      indicatedBpm: acquiredBpm!,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1050,
    });

    // Must release cleanly and NOT spike to 220 BPM
    expect(telFlick.activeTarget).toBeNull();
    expect(telFlick.liveBpm).toBeNull();
    expect(controller.getLastBpm()).toBe(acquiredBpm);
    expect(controller.getLastBpm()).not.toBe(220);
  });

  it("safely releases left vertical dynamics gauge on upward flick exit without jumping to max dynamic", () => {
    const onDynamicChange = vi.fn();
    mockGeo.dynamicsRect = { left: 40, top: 100, right: 80, bottom: 500, width: 40, height: 400 };
    controller.setCallbacks({ onDynamicChange });

    // Step 1: Acquire dynamics at y=200 on track -> (500 - 200)/400 = 0.75
    // Pointing left: tipX = 0.2, pipX = 0.6
    const aimSample = createSample("Pointing", 0.2, 0.5, 0.6, 0.5);
    const telAcquire = controller.update({
      samples: [aimSample],
      indicatedBpm: 120,
      continuousDynamic: 0.75,
      isMirrored: false,
      nowMs: 1000,
    });
    expect(telAcquire.state).toBe("dynamics_acquired");
    expect(telAcquire.activeTarget).toBe("dynamics");
    expect(telAcquire.liveDynamic).toBeCloseTo(0.75, 2);

    // Step 2: Flick finger quickly UP towards orchestra
    const flickSample = createSample("Pointing_Up", 0.3, 0.2, 0.4, 0.6);
    const telFlick = controller.update({
      samples: [flickSample],
      indicatedBpm: 120,
      continuousDynamic: 0.75,
      isMirrored: false,
      nowMs: 1050,
    });

    // Must release cleanly and NOT spike to 1.0 (fff)
    expect(telFlick.activeTarget).toBeNull();
    expect(telFlick.liveDynamic).toBeNull();
    expect(controller.getLastDynamic()).toBeCloseTo(0.75, 2);
    expect(controller.getLastDynamic()).not.toBe(1.0);
  });

  it("shake-to-lock-in gesture triggers lock-in, fires onLockIn event, and disables laser", () => {
    const onLockIn = vi.fn();
    controller.setCallbacks({ onLockIn });

    // Step 1: Acquire tempo at 175 BPM
    const aimSample = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
    const telAcquire = controller.update({
      samples: [aimSample],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1000,
    });
    expect(telAcquire.state).toBe("tempo_acquired");
    expect(telAcquire.activeTarget).toBe("tempo");

    // Step 2: Shake hand (4 points oscillating with reversals)
    const shakePoints = [0.5, 0.45, 0.53, 0.46];
    let telShake;
    for (let i = 0; i < shakePoints.length; i++) {
      const s = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
      s.landmarks[0] = { x: shakePoints[i], y: 0.5, z: 0 };
      s.conductorPoint = { x: shakePoints[i], y: 0.5 };
      telShake = controller.update({
        samples: [s],
        indicatedBpm: 175,
        continuousDynamic: 0.5,
        isMirrored: false,
        nowMs: 1000 + i * 50,
      });
    }

    expect(controller.isLockInActive()).toBe(true);
    expect(controller.getLockedTarget()).toBe("tempo");
    expect(telShake?.isLockedIn).toBe(true);
    expect(telShake?.isActive).toBe(false);
    expect(telShake?.ray?.isDimmed).toBe(true);
    expect(onLockIn).toHaveBeenCalledWith(expect.objectContaining({
      target: "tempo",
      value: 175,
      source: "shake",
    }));
  });

  it("clears lock-in when retracting finger", () => {
    // Acquire and lock in
    const aimSample = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
    controller.update({
      samples: [aimSample],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1000,
    });
    const shakePoints = [0.5, 0.45, 0.53, 0.46];
    for (let i = 0; i < shakePoints.length; i++) {
      const s = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
      s.landmarks[0] = { x: shakePoints[i], y: 0.5, z: 0 };
      controller.update({
        samples: [s],
        indicatedBpm: 175,
        continuousDynamic: 0.5,
        isMirrored: false,
        nowMs: 1000 + i * 50,
      });
    }
    expect(controller.isLockInActive()).toBe(true);

    // Retract finger (no pointing hands)
    const openSample = createSample("Open_Palm", 0.5, 0.5, 0.5, 0.6);
    controller.update({
      samples: [openSample],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1300,
    });
    expect(controller.isLockInActive()).toBe(false);

    // Point again: laser re-arms and is active
    const pointAgain = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
    const telAfter = controller.update({
      samples: [pointAgain],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1350,
    });
    expect(telAfter.isActive).toBe(true);
    expect(telAfter.ray).not.toBeNull();
  });

  it("clears lock-in when repointing to opposite side or orchestra", () => {
    // Acquire and lock in on tempo (right)
    const aimSample = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
    controller.update({
      samples: [aimSample],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1000,
    });
    const shakePoints = [0.5, 0.45, 0.53, 0.46];
    for (let i = 0; i < shakePoints.length; i++) {
      const s = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
      s.landmarks[0] = { x: shakePoints[i], y: 0.5, z: 0 };
      controller.update({
        samples: [s],
        indicatedBpm: 175,
        continuousDynamic: 0.5,
        isMirrored: false,
        nowMs: 1000 + i * 50,
      });
    }
    expect(controller.isLockInActive()).toBe(true);

    // Point left towards dynamics (tipX = 0.2, pipX = 0.5 -> rawDirX = -0.3 < -0.15)
    const repointSample = createSample("Pointing", 0.2, 0.5, 0.5, 0.5);
    const telRepoint = controller.update({
      samples: [repointSample],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1300,
    });
    expect(controller.isLockInActive()).toBe(false);
    expect(telRepoint.isActive).toBe(true);
    expect(telRepoint.ray).not.toBeNull();
  });

  it("fist curl collapsing extension releases without dragging value down", () => {
    // Step 1: Acquire tempo at 175 BPM
    const aimSample = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
    controller.update({
      samples: [aimSample],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1000,
    });
    expect(controller.getActiveTarget()).toBe("tempo");

    // Step 2: Curl finger into fist (tip collapses close to mcp)
    const curlSample = createSample("Pointing", 0.42, 0.54, 0.4, 0.5);
    const telCurl = controller.update({
      samples: [curlSample],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1050,
    });

    expect(telCurl.activeTarget).toBeNull();
    expect(controller.getLastBpm()).toBe(175);
  });

  it("pointing at orchestra section triggers onSpotlightChange with section id", () => {
    const onSpotlightChange = vi.fn();
    controller.setCallbacks({ onSpotlightChange });
    controller.setSections([
      { id: "violins1", name: "Violin I", channels: [0], programs: [40], trackNames: ["VIOLIN"] },
      { id: "cellos", name: "Cello", channels: [1], programs: [42], trackNames: ["CELLO"] },
    ]);

    // Point up towards violins1 (rect left: 150, right: 250)
    // startX = 100 + 0.5*200 = 200, rayDirX = 0, rayDirY = -0.5
    const aimSample = createSample("Pointing_Up", 0.5, 0.2, 0.5, 0.5);
    const tel = controller.update({
      samples: [aimSample],
      indicatedBpm: 120,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1000,
    });

    expect(tel.targetedSectionId).toBe("violins1");
    expect(onSpotlightChange).toHaveBeenCalledWith("violins1");

    // Point in open space (down)
    const downSample = createSample("Pointing", 0.5, 0.8, 0.5, 0.5);
    for (let frame = 1; frame <= 4; frame++) {
      controller.update({
        samples: [downSample],
        indicatedBpm: 120,
        continuousDynamic: 0.5,
        isMirrored: false,
        nowMs: 1000 + frame * 33,
      });
    }

    expect(onSpotlightChange).toHaveBeenCalledWith(null);
  });

  it("hold steady for 0.85s begins charging and completes lock-in", () => {
    const onLockIn = vi.fn();
    controller.setCallbacks({ onLockIn });

    // Step 1: Acquire tempo at 150 BPM
    const aimSample = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
    let tel = controller.update({
      samples: [aimSample],
      indicatedBpm: 150,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1000,
    });
    expect(tel.activeTarget).toBe("tempo");
    expect(tel.chargeProgress).toBe(0);

    // Step 2: Hold steady for 400ms (steadyDuration = 400ms < 595ms -> not charging yet)
    tel = controller.update({
      samples: [aimSample],
      indicatedBpm: 150,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1400,
    });
    expect(tel.chargeProgress).toBe(0);
    expect(controller.isLockInActive()).toBe(false);

    // Step 3: At 900ms (steadyDuration = 900ms > 500ms -> 400ms of charge elapsed / 800ms = 50%)
    tel = controller.update({
      samples: [aimSample],
      indicatedBpm: 150,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1900,
    });
    expect(tel.chargeProgress).toBeCloseTo(0.5, 1);
    expect(tel.chargeTarget).toBe("tempo");
    expect(controller.isLockInActive()).toBe(false);

    // Step 4: At 1300ms+ (steadyDuration >= 1300ms -> charge completes 100% and triggers lock-in)
    tel = controller.update({
      samples: [aimSample],
      indicatedBpm: 150,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 2350,
    });
    expect(controller.isLockInActive()).toBe(true);
    expect(controller.getLockedTarget()).toBe("tempo");
    expect(tel.isLockedIn).toBe(true);
    expect(tel.ray?.isDimmed).toBe(true);
    expect(onLockIn).toHaveBeenCalledWith(expect.objectContaining({
      target: "tempo",
      source: "hold",
    }));
  });

  it("normal jitter within tolerance allows hold-to-lock to complete", () => {
    const onLockIn = vi.fn();
    controller.setCallbacks({ onLockIn });

    // Acquire tempo
    const aimSample = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
    controller.update({
      samples: [aimSample],
      indicatedBpm: 140,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1000,
    });

    // Small jitter between 138 and 142 BPM (within ±6.4 BPM tolerance)
    const jitterOffsets = [0, 0.001, -0.001, 0.0015, -0.001];
    let tel;
    for (let i = 1; i <= 30; i++) {
      const offset = jitterOffsets[i % jitterOffsets.length];
      const s = createSample("Pointing", 0.8, 0.5 + offset, 0.4, 0.5);
      tel = controller.update({
        samples: [s],
        indicatedBpm: 140,
        continuousDynamic: 0.5,
        isMirrored: false,
        nowMs: 1000 + i * 50, // Advances to 2500ms (1500ms steady)
      });
    }

    expect(controller.isLockInActive()).toBe(true);
    expect(onLockIn).toHaveBeenCalledWith(expect.objectContaining({
      target: "tempo",
      source: "hold",
    }));
  });

  it("deliberate adjustment resets charge immediately", () => {
    // Acquire tempo
    const aimSample = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
    controller.update({
      samples: [aimSample],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1000,
    });

    // Hold for 900ms (charging is active, ~50%)
    let tel = controller.update({
      samples: [aimSample],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1900,
    });
    expect(tel.chargeProgress).toBeGreaterThan(0.3);

    // Deliberate jump: move finger downward significantly
    const movedSample = createSample("Pointing", 0.8, 0.8, 0.4, 0.5);
    tel = controller.update({
      samples: [movedSample],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1950,
    });

    // Charge progress must reset immediately
    expect(tel.chargeProgress).toBe(0);
    expect(controller.isLockInActive()).toBe(false);
  });

  it("pointing upward towards high tempo on gauge does not rearm, only pointing to instrument section rearms", () => {
    const onSpotlightChange = vi.fn();
    controller.setCallbacks({ onSpotlightChange });

    // Step 1: Lock in tempo at 150 BPM
    const aimSample = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
    controller.update({
      samples: [aimSample],
      indicatedBpm: 150,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1000,
    });
    controller.update({
      samples: [aimSample],
      indicatedBpm: 150,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 2300,
    });
    expect(controller.isLockInActive()).toBe(true);

    // Step 2: Aim upward towards higher tempo on the tempo track (tipY = 0.2, pipY = 0.4 -> upward ray, but aimed right towards tempo gauge)
    // Canvas left: 100, width: 200 -> startX = 260. tipX: 0.8, pipX: 0.4 -> rayDirX > 0 (aiming to tempo track at x=340)
    const highTempoSample = createSample("Pointing", 0.8, 0.2, 0.4, 0.4);
    const telHigh = controller.update({
      samples: [highTempoSample],
      indicatedBpm: 150,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 2350,
    });

    // Must NOT rearm because user is still pointing along the tempo gauge column, not at instrument sections!
    expect(controller.isLockInActive()).toBe(true);
    expect(telHigh.isLockedIn).toBe(true);
    expect(telHigh.ray?.isDimmed).toBe(true);
    expect(telHigh.liveBpm).toBe(175); // Frozen at locked 175 BPM, not jumping to 220!

    // Step 3: Now deliberately point at violins1 in orchestra (straight up at x=200, inside violins1 left 150..250)
    const upSample = createSample("Pointing_Up", 0.5, 0.2, 0.5, 0.5);
    controller.update({
      samples: [upSample],
      indicatedBpm: 150,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 2400,
    });
    const telRearm = controller.update({
      samples: [upSample],
      indicatedBpm: 150,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 2450,
    });

    // Laser rearms immediately because user is actually pointing at an instrument section!
    expect(controller.isLockInActive()).toBe(false);
    expect(telRearm.isLockedIn).toBe(false);
    expect(telRearm.ray?.isDimmed).toBe(false);
    expect(telRearm.state).toBe("instrument_targeted");
    expect(onSpotlightChange).toHaveBeenCalledWith(expect.any(String));
  });

  it("prevents false orchestra exit and release when pointing at high tempo (180-220 BPM)", () => {
    const onBpmChange = vi.fn();
    controller.setCallbacks({ onBpmChange });

    // Acquire tempo at 175 BPM
    const sampleAcquire = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
    controller.update({
      samples: [sampleAcquire],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1000,
    });
    expect(controller.getActiveTarget()).toBe("tempo");

    // Point up towards 210 BPM: tipY = 0.45, pipY = 0.50 (rayDirY is negative)
    const sampleHigh = createSample("Pointing", 0.8, 0.45, 0.4, 0.50);
    const telHigh = controller.update({
      samples: [sampleHigh],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1050,
    });

    // Must remain acquired on tempo and NOT falsely release or target orchestra!
    expect(telHigh.activeTarget).toBe("tempo");
    expect(telHigh.state).toBe("tempo_acquired");
    expect(telHigh.targetedSectionId).toBeNull();
  });

  it("debounces transient out-of-bounds frame to prevent slider release jitter", () => {
    // Acquire tempo at 175 BPM
    const sampleAcquire = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
    controller.update({
      samples: [sampleAcquire],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1000,
    });
    expect(controller.getActiveTarget()).toBe("tempo");

    // Frame 1: Slow jitter slightly past the release pad boundary (hitY < tempoTrackTop - pad)
    // with downward/gentle angle so it's not a flick exit (rayDirY > -0.30)
    // tipY = 0.38, pipY = 0.45 -> startY = 176, rawHitY = -24 (past 0px pad), rayDirY = -0.15 (> -0.35)
    const sampleDrift = createSample("Pointing", 0.8, 0.38, 0.4, 0.45);
    const telDrift = controller.update({
      samples: [sampleDrift],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1033,
    });

    // Still acquired because of 3-frame debounce!
    expect(telDrift.activeTarget).toBe("tempo");

    // Frame 2: Back in normal range
    const telRecovered = controller.update({
      samples: [sampleAcquire],
      indicatedBpm: 175,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1066,
    });
    expect(telRecovered.activeTarget).toBe("tempo");
    expect(telRecovered.state).toBe("tempo_acquired");
  });

  it("tempo lock does not disappear when pointing right at the top of the tempo bar (220 BPM)", () => {
    // 1. Lock in tempo at 150 BPM
    const aimSample = createSample("Pointing", 0.8, 0.5, 0.4, 0.5);
    controller.update({
      samples: [aimSample],
      indicatedBpm: 150,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 1000,
    });
    controller.update({
      samples: [aimSample],
      indicatedBpm: 150,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 2300,
    });
    expect(controller.isLockInActive()).toBe(true);

    // 2. Point right at the top of the tempo bar (tempoRect: left: 320, right: 360, top: 100, bottom: 500)
    // Canvas left: 100, width: 200 -> startX = 260.
    // To hit top of tempo gauge (x=340, y=105): dx = 80, dy = -95 (from startX=260, startY=200)
    // Tip at (0.8, 0.1), Pip at (0.4, 0.25) -> rayDirX > 0, rayDirY < 0 pointing directly at top of tempo bar
    const topBarSample = createSample("Pointing", 0.8, 0.1, 0.4, 0.25);
    const tel = controller.update({
      samples: [topBarSample],
      indicatedBpm: 150,
      continuousDynamic: 0.5,
      isMirrored: false,
      nowMs: 2400,
    });

    // The lock MUST NOT disappear when pointing at the top of the tempo bar!
    expect(controller.isLockInActive()).toBe(true);
    expect(tel.isLockedIn).toBe(true);
    expect(tel.ray?.isDimmed).toBe(true);
    expect(tel.liveBpm).toBe(175); // Stays at locked value, does not flick to 220 BPM!
  });

  it("setInitialBpm sets lastBpm and lastValidInBoundsBpm", () => {
    controller.setInitialBpm(140);
    expect(controller.getLastBpm()).toBe(140);
  });
});

describe("ConductorClock magic mode", () => {
  it("supports magic tempo mode in ConductorClock", () => {
    const clock = new ConductorClock(120);
    expect(clock.getTempoMode()).toBe("balanced");

    clock.setTempoMode("magic");
    expect(clock.getTempoMode()).toBe("magic");

    clock.setBpm(160);
    expect(clock.getState().bpm).toBe(160);
  });
});
