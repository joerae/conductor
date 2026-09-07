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
  // wrist is landmark 0
  landmarks[0] = { x: pipX, y: pipY + 0.1, z: 0 };

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
