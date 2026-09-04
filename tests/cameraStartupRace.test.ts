import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HandTracker } from "../src/camera/HandTracker";
import { CameraBeatInputProvider } from "../src/camera/CameraBeatInputProvider";

describe("Camera Model-Loading Cancellation Race (Issue 3)", () => {
  let mockTrackStop: ReturnType<typeof vi.fn>;
  let mockMediaStream: any;
  let rafSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockTrackStop = vi.fn();
    mockMediaStream = {
      active: true,
      getTracks: () => [{ stop: mockTrackStop, kind: "video" }],
    };

    Object.defineProperty(globalThis, "navigator", {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue(mockMediaStream),
        },
      },
      writable: true,
      configurable: true,
    });

    rafSpy = vi.fn((_cb: any) => 123);
    (globalThis as any).requestAnimationFrame = rafSpy;
    (globalThis as any).cancelAnimationFrame = vi.fn();

    (globalThis as any).document = {
      createElement: vi.fn(() => ({
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        srcObject: null,
        readyState: 4,
        videoWidth: 640,
        videoHeight: 480,
      })),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("HandTracker: stopping during model initialization prevents inference loop from starting", async () => {
    const tracker = new HandTracker();

    let resolveModelInit: () => void = () => {};
    const modelInitPromise = new Promise<void>((resolve) => {
      resolveModelInit = resolve;
    });

    // Intercept initModel to simulate deferred model loading
    vi.spyOn(tracker as any, "initModel").mockReturnValue(modelInitPromise);

    const mockVideo = {
      readyState: 4,
      videoWidth: 640,
      videoHeight: 480,
    } as unknown as HTMLVideoElement;

    const onResults = vi.fn();

    // 1. Begin startup
    const startPromise = tracker.start(mockVideo, onResults);

    // 2. Stop tracker while model loading is in flight
    tracker.stop();
    expect(tracker.isTrackingRunning()).toBe(false);

    // 3. Resolve the deferred model loading
    resolveModelInit();
    await startPromise;

    // 4. Verify tracking is NOT running and requestAnimationFrame was NEVER called
    expect(tracker.isTrackingRunning()).toBe(false);
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it("CameraBeatInputProvider: stopping provider during camera or model startup aborts tracking", async () => {
    const provider = new CameraBeatInputProvider({ mountOverlay: false });

    let resolveModelInit: () => void = () => {};
    const modelInitPromise = new Promise<void>((resolve) => {
      resolveModelInit = resolve;
    });

    const handTracker = (provider as any).handTracker;
    vi.spyOn(handTracker, "initModel").mockReturnValue(modelInitPromise);

    // Start provider
    const startPromise = provider.start();

    // Stop provider immediately while start is pending
    provider.stop();
    expect(provider.getState()).toBe("stopped");

    // Resolve deferred model init
    resolveModelInit();
    await startPromise;

    // Tracker must not be running
    expect(handTracker.isTrackingRunning()).toBe(false);
    expect(rafSpy).not.toHaveBeenCalled();
  });
});
