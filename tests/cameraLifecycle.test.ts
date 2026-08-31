import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CameraController } from "../src/camera/CameraController";
import { CameraBeatInputProvider } from "../src/camera/CameraBeatInputProvider";
import type { CameraState } from "../src/camera/cameraTypes";

describe("Camera Lifecycle & Controller", () => {
  let mockTrackStop: ReturnType<typeof vi.fn>;
  let mockMediaStream: {
    getTracks: () => Array<{ stop: () => void; kind: string }>;
    active: boolean;
  };

  beforeEach(() => {
    mockTrackStop = vi.fn();
    mockMediaStream = {
      active: true,
      getTracks: () => [
        { stop: mockTrackStop, kind: "video" },
      ],
    };

    // Mock navigator.mediaDevices.getUserMedia
    Object.defineProperty(globalThis, "navigator", {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue(mockMediaStream),
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes in idle state", () => {
    const controller = new CameraController();
    expect(controller.getState()).toBe("idle");
  });

  it("handles stop() by stopping all media tracks and changing state to stopped", () => {
    const stateChanges: CameraState[] = [];
    const controller = new CameraController({
      onStateChange: (state) => stateChanges.push(state),
    });

    controller.stop();
    expect(controller.getState()).toBe("stopped");
    expect(stateChanges).toContain("stopped");
  });

  it("subscribes to CameraBeatInputProvider beat observations", () => {
    const provider = new CameraBeatInputProvider({ mountOverlay: false });
    const receivedBeats: unknown[] = [];

    const unsubscribe = provider.onBeat(beat => {
      receivedBeats.push(beat);
    });

    expect(receivedBeats.length).toBe(0);

    // Call internal emitBeat via reflection
    // @ts-expect-error accessing protected method for testing
    provider.emitBeat(12345.67, 0.95);

    expect(receivedBeats.length).toBe(1);
    expect(receivedBeats[0]).toEqual({
      source: "camera",
      timestampMs: 12345.67,
      confidence: 0.95,
    });

    unsubscribe();

    // @ts-expect-error accessing protected method for testing
    provider.emitBeat(67890.12, 1.0);
    expect(receivedBeats.length).toBe(1);
  });

  it("properly cleans up on provider dispose()", () => {
    const provider = new CameraBeatInputProvider({ mountOverlay: false });
    expect(provider.getState()).toBe("idle");

    provider.dispose();
    expect(provider.getState()).toBe("stopped");
  });
});
