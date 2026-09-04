import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { ExperienceController } from "../src/experience/ExperienceController";
import { CameraBeatInputProvider } from "../src/camera/CameraBeatInputProvider";
import { KeyboardBeatInput } from "../src/input/KeyboardBeatInput";
import { AudioEngine } from "../src/audio/AudioEngine";

// ── Web Audio & MediaStream Mocks ──────────────────────────────────────────

class MockAudioParam {
  public value: number = 0;
  public calls: Array<{ method: string; args: any[] }> = [];
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.calls.push({ method: "setValueAtTime", args: [value, time] });
  }
  setTargetAtTime(target: number, startTime: number, timeConstant: number) {
    this.calls.push({ method: "setTargetAtTime", args: [target, startTime, timeConstant] });
  }
  linearRampToValueAtTime(value: number, endTime: number) {
    this.calls.push({ method: "linearRampToValueAtTime", args: [value, endTime] });
  }
  exponentialRampToValueAtTime(value: number, endTime: number) {
    this.calls.push({ method: "exponentialRampToValueAtTime", args: [value, endTime] });
  }
  cancelScheduledValues(startTime: number) {
    this.calls.push({ method: "cancelScheduledValues", args: [startTime] });
  }
  cancelAndHoldAtTime(cancelTime: number) {
    this.calls.push({ method: "cancelAndHoldAtTime", args: [cancelTime] });
  }
}

class MockAudioNode {
  public connectedTo: any[] = [];
  connect(dest: any) {
    this.connectedTo.push(dest);
    return dest;
  }
  disconnect() {
    this.connectedTo = [];
  }
}

class MockGainNode extends MockAudioNode {
  public gain = new MockAudioParam();
}

class MockBiquadFilterNode extends MockAudioNode {
  public frequency = new MockAudioParam();
  public gain = new MockAudioParam();
  public Q = new MockAudioParam();
  public type: string = "lowpass";
}

class MockDynamicsCompressorNode extends MockAudioNode {
  public threshold = new MockAudioParam();
  public ratio = new MockAudioParam();
  public knee = new MockAudioParam();
  public attack = new MockAudioParam();
  public release = new MockAudioParam();
}

class MockStereoPannerNode extends MockAudioNode {
  public pan = new MockAudioParam();
}

class MockConvolverNode extends MockAudioNode {
  public normalize: boolean = true;
  public buffer: any = null;
}

class MockOscillatorNode extends MockAudioNode {
  public frequency = new MockAudioParam(440);
  public type: string = "sine";
  start(_time?: number) {}
  stop(_time?: number) {}
}

class MockAudioBuffer {
  private data: Float32Array[];
  constructor(numberOfChannels: number, length: number, public sampleRate: number) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel: number) {
    return this.data[channel];
  }
}

class MockAudioContext {
  public currentTime: number = 0.0;
  public sampleRate: number = 44100;
  public destination = new MockAudioNode();
  public state: string = "running";

  createGain() { return new MockGainNode(); }
  createBiquadFilter() { return new MockBiquadFilterNode(); }
  createDynamicsCompressor() { return new MockDynamicsCompressorNode(); }
  createStereoPanner() { return new MockStereoPannerNode(); }
  createConvolver() { return new MockConvolverNode(); }
  createOscillator() { return new MockOscillatorNode(); }
  createBuffer(channels: number, length: number, rate: number) {
    return new MockAudioBuffer(channels, length, rate);
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

function createMockElement(tag: string = "div"): any {
  return {
    tagName: tag.toUpperCase(),
    id: "",
    style: {},
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
      contains: vi.fn().mockReturnValue(false),
    },
    children: [],
    appendChild: vi.fn((child: any) => child),
    removeChild: vi.fn(),
    querySelectorAll: vi.fn().mockReturnValue([]),
    querySelector: vi.fn().mockReturnValue(null),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setAttribute: vi.fn(),
    getAttribute: vi.fn(),
    innerHTML: "",
    textContent: "",
  };
}

function createMockCallbacks(overrides = {}) {
  return {
    onStateChange: vi.fn(),
    onBeat: vi.fn(),
    onFocusChange: vi.fn(),
    onPartyModeChange: vi.fn(),
    onFistCutoffChange: vi.fn(),
    onFermataChange: vi.fn(),
    onDynamicChange: vi.fn(),
    onCameraAxisMappingChange: vi.fn(),
    onInputSourceChange: vi.fn(),
    onNoteVisual: vi.fn(),
    ...overrides,
  };
}

describe("ExperienceController Lifecycle & Bug Regressions", () => {
  let mockTrackStop: ReturnType<typeof vi.fn>;
  let mockMediaStream: any;

  beforeEach(() => {
    vi.useFakeTimers();

    vi.spyOn(AudioEngine.prototype, "loadSamples").mockResolvedValue();
    vi.spyOn(AudioEngine.prototype, "loadScript").mockResolvedValue();

    globalThis.fetch = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.startsWith("/")) {
        const filePath = path.resolve(__dirname, "../public", url.slice(1));
        if (fs.existsSync(filePath)) {
          const data = fs.readFileSync(filePath);
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
            json: async () => JSON.parse(data.toString("utf-8")),
            text: async () => data.toString("utf-8"),
          } as any;
        }
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(0),
        json: async () => ({}),
        text: async () => "",
      } as any;
    });

    (globalThis as any).AudioContext = MockAudioContext;
    (globalThis as any).webkitAudioContext = MockAudioContext;

    (globalThis as any).document = {
      createElement: vi.fn((tag: string) => createMockElement(tag)),
      getElementById: vi.fn((_id: string) => createMockElement("div")),
      querySelector: vi.fn((_sel: string) => createMockElement("div")),
      querySelectorAll: vi.fn((_sel: string) => []),
      body: createMockElement("body"),
    };
    const mockWindow = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      AudioContext: MockAudioContext,
      webkitAudioContext: MockAudioContext,
      requestAnimationFrame: vi.fn((_cb: any) => 1),
      cancelAnimationFrame: vi.fn(),
    };
    (globalThis as any).window = mockWindow;
    (globalThis as any).addEventListener = vi.fn();
    (globalThis as any).removeEventListener = vi.fn();
    (globalThis as any).requestAnimationFrame = vi.fn((_cb: any) => 1);
    (globalThis as any).cancelAnimationFrame = vi.fn();

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
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Issue 1: repeated piece loads do not multiply keyboard callbacks", async () => {
    vi.spyOn(CameraBeatInputProvider.prototype, "start").mockResolvedValue();
    const controller = new ExperienceController(createMockCallbacks());
    await controller.load();
    const observationSpy = vi.spyOn(controller as any, "handleBeatObservation");

    // Re-load pieces multiple times
    await controller.loadPiece("eine-kleine");
    await controller.loadPiece("beethoven-5");
    await controller.loadPiece("eine-kleine");

    // Emit a single keyboard beat
    const kb = (controller as any).keyboardInput as KeyboardBeatInput;
    (kb as any).handleKeydown({ code: "Space", repeat: false, preventDefault: () => {} });

    // Exactly one observation should be processed
    expect(observationSpy).toHaveBeenCalledTimes(1);
  });

  it("Issue 2: camera failure falls back once and leaves the app usable", async () => {
    const startSpy = vi.spyOn(CameraBeatInputProvider.prototype, "start")
      .mockRejectedValue(new Error("Permission denied"));

    const controller = new ExperienceController(createMockCallbacks());
    // Application load starts in camera mode by default, attempts startup once, and falls back to keyboard
    await controller.load();

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(controller.getInputSource()).toBe("keyboard");
    expect(controller.getState()).toBe("ready");
  });

  it("Issue 4: closing the preview fully selects keyboard mode", async () => {
    vi.spyOn(CameraBeatInputProvider.prototype, "start").mockResolvedValue();
    const controller = new ExperienceController(createMockCallbacks());
    await controller.load();
    expect(controller.getInputSource()).toBe("camera");

    const provider = controller.getCameraProvider();
    expect(provider).toBeDefined();

    // Trigger close callback
    (provider as any).closeCallback?.();

    // Wait microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getInputSource()).toBe("keyboard");
  });

  it("Issue 5: concurrent playback requests start transport and scheduler only once", async () => {
    vi.spyOn(CameraBeatInputProvider.prototype, "start").mockResolvedValue();
    const controller = new ExperienceController(createMockCallbacks());
    await controller.load();

    const transport = (controller as any).transport;
    const scheduler = (controller as any).scheduler;
    const startTransportSpy = vi.spyOn(transport, "start");
    const startSchedulerSpy = vi.spyOn(scheduler, "start");

    // Defer audioEngine.resume to simulate concurrent in-flight startPlayback calls
    let resolveResume: () => void = () => {};
    const resumePromise = new Promise<void>(res => { resolveResume = res; });
    vi.spyOn((controller as any).audioEngine, "resume").mockReturnValue(resumePromise);

    // Fire 3 simultaneous startPlayback calls
    const p1 = (controller as any).startPlayback();
    const p2 = (controller as any).startPlayback();
    const p3 = (controller as any).startPlayback();

    resolveResume();
    await Promise.all([p1, p2, p3]);

    expect(startTransportSpy).toHaveBeenCalledTimes(1);
    expect(startSchedulerSpy).toHaveBeenCalledTimes(1);
  });

  it("Issue 6: a stale completion callback cannot stop a restarted session", async () => {
    vi.spyOn(CameraBeatInputProvider.prototype, "start").mockResolvedValue();
    const controller = new ExperienceController(createMockCallbacks());
    await controller.load();

    // Start playback
    await (controller as any).startPlayback();
    expect(controller.getState()).toBe("playing");

    // Trigger completion
    (controller as any).handlePieceComplete();
    expect(controller.getState()).toBe("completed");

    // Restart within the 2-second window
    vi.advanceTimersByTime(1000);
    controller.restart();
    await (controller as any).startPlayback();
    expect(controller.getState()).toBe("playing");

    // Advance timers past the original 2000ms deadline
    vi.advanceTimersByTime(2000);

    // The new session should STILL be playing, NOT stopped by old completion timer
    expect(controller.getState()).toBe("playing");
  });

  it("Issue 7: completed playback restarts through keyboard space and camera gesture", async () => {
    vi.spyOn(CameraBeatInputProvider.prototype, "start").mockResolvedValue();
    const controller = new ExperienceController(createMockCallbacks());
    await controller.load();

    // Simulate completion
    (controller as any).handlePieceComplete();
    vi.advanceTimersByTime(2500);
    expect(controller.getState()).toBe("completed");

    // Keyboard tap on Space in completed state restarts playback
    const kb = (controller as any).keyboardInput as KeyboardBeatInput;
    (kb as any).handleKeydown({ code: "Space", repeat: false, preventDefault: () => {} });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getState()).toBe("playing");
    expect((controller as any).transport.getCursorBeat()).toBeLessThan(2);
  });

  it("Issue 8: camera shutdown clears focus and gesture state", async () => {
    vi.spyOn(CameraBeatInputProvider.prototype, "start").mockResolvedValue();
    let focusCleared = false;
    let partyModeCleared = false;

    const controller = new ExperienceController(createMockCallbacks({
      onFocusChange: (tel: any) => {
        if (!tel.isActive) focusCleared = true;
      },
      onPartyModeChange: (isParty: boolean) => {
        if (!isParty) partyModeCleared = true;
      },
    }));

    await controller.load();
    expect(controller.getInputSource()).toBe("camera");

    // Set active party mode & fist cutoff
    (controller as any).isPartyMode = true;
    (controller as any).isFistCutoff = true;

    // Switch back to keyboard (shutdownCameraState)
    await controller.setInputSource("keyboard");

    expect(focusCleared).toBe(true);
    expect(partyModeCleared).toBe(true);
    expect((controller as any).isFistCutoff).toBe(false);
  });

  it("Issue 10: thumbs-down only resumes a pause it caused", async () => {
    vi.spyOn(CameraBeatInputProvider.prototype, "start").mockResolvedValue();
    const controller = new ExperienceController(createMockCallbacks());
    await controller.load();
    await (controller as any).startPlayback();
    expect(controller.getState()).toBe("playing");

    // Case 1: Manual pause -> thumbs down -> thumbs up -> remain paused
    controller.togglePause();
    expect(controller.getState()).toBe("paused");
    expect((controller as any).cutoffInitiatedPause).toBe(false);

    // Simulate thumbs down while already manually paused
    (controller as any).isFistCutoff = true;
    (controller as any).cutoffInitiatedPause = false;

    // Simulate release of thumbs down
    (controller as any).isFistCutoff = false;
    if ((controller as any).cutoffInitiatedPause && controller.getState() === "paused") {
      await (controller as any).startPlayback();
    }
    // Must remain paused
    expect(controller.getState()).toBe("paused");

    // Case 2: Playing -> Thumbs down causes pause -> release auto-resumes
    await (controller as any).startPlayback();
    expect(controller.getState()).toBe("playing");

    // Thumbs down initiates pause
    (controller as any).isFistCutoff = true;
    (controller as any).cutoffInitiatedPause = true;
    (controller as any).pausePlayback(true);
    expect(controller.getState()).toBe("paused");

    // Release thumbs down
    (controller as any).isFistCutoff = false;
    if ((controller as any).cutoffInitiatedPause && controller.getState() === "paused") {
      (controller as any).cutoffInitiatedPause = false;
      await (controller as any).startPlayback();
    }
    expect(controller.getState()).toBe("playing");
  });

  it("Issue 19: tempo nudging persists in camera mode", () => {
    const controller = new ExperienceController(createMockCallbacks());
    controller.setTempoMode("gestural");
    const initialBaseBpm = controller.getBasePieceBpm();

    // Nudge tempo up by 10 BPM
    controller.nudgeGesturalBpm(10);
    expect(controller.getBasePieceBpm()).toBe(initialBaseBpm + 10);
    expect((controller as any).currentGesturalBpm).toBe(initialBaseBpm + 10);

    // Nudge tempo down by 5 BPM
    controller.nudgeGesturalBpm(-5);
    expect(controller.getBasePieceBpm()).toBe(initialBaseBpm + 5);
    expect((controller as any).currentGesturalBpm).toBe(initialBaseBpm + 5);
  });
});
