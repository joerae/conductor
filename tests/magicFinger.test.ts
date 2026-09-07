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
  pipY: number
): HandSample {
  const landmarks = Array(21).fill({ x: 0.5, y: 0.5, z: 0 });
  // index finger tip is landmark 8
  landmarks[8] = { x: tipX, y: tipY, z: 0 };
  // index finger pip is landmark 6
  landmarks[6] = { x: pipX, y: pipY, z: 0 };
  // wrist is landmark 0
  landmarks[0] = { x: pipX, y: pipY + 0.1, z: 0 };

  return {
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
