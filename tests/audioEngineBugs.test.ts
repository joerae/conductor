import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AudioEngine } from "../src/audio/AudioEngine";

// ── Web Audio Mocks ──────────────────────────────────────────────────────────

class MockAudioParam {
  public value: number = 0;
  public calls: Array<{ method: string; args: any[] }> = [];
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.calls.push({ method: "setValueAtTime", args: [value, time] });
  }
  setTargetAtTime(target: number, startTime: number, timeConstant: number) {
    this.value = target;
    this.calls.push({ method: "setTargetAtTime", args: [target, startTime, timeConstant] });
  }
  linearRampToValueAtTime(value: number, endTime: number) {
    this.value = value;
    this.calls.push({ method: "linearRampToValueAtTime", args: [value, endTime] });
  }
  exponentialRampToValueAtTime(value: number, endTime: number) {
    this.value = value;
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
  public gain = new MockAudioParam(1.0);
}

class MockBiquadFilterNode extends MockAudioNode {
  public frequency = new MockAudioParam(20000);
  public gain = new MockAudioParam(0.0);
  public Q = new MockAudioParam(0.707);
  public type: string = "lowpass";
}

class MockDynamicsCompressorNode extends MockAudioNode {
  public threshold = new MockAudioParam(-1.0);
  public ratio = new MockAudioParam(20.0);
  public knee = new MockAudioParam(3.0);
  public attack = new MockAudioParam(0.001);
  public release = new MockAudioParam(0.05);
}

class MockStereoPannerNode extends MockAudioNode {
  public pan = new MockAudioParam(0.0);
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
  public currentTime: number = 10.0;
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

describe("AudioEngine Bug Regressions (Issues 10, 11, 16, 17)", () => {
  beforeEach(() => {
    (globalThis as any).AudioContext = MockAudioContext;
    (globalThis as any).webkitAudioContext = MockAudioContext;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Issue 10: section focus gain is consistent and does not alter natural stereo seating pan", async () => {
    const engine = new AudioEngine();
    await engine.resume();

    // Set default panning for channels: channel 0 at left (-0.6), channel 1 at right (0.6)
    const sections = [
      { id: "violins", name: "Violin I", channels: [0], pan: -0.6, gain: 1.0 },
      { id: "cellos", name: "Violoncello", channels: [1], pan: 0.6, gain: 1.0 },
    ];
    engine.setDefaultSectionPanning(sections as any);

    const bus0 = (engine as any).getOrCreateChannelBus(0);
    const bus1 = (engine as any).getOrCreateChannelBus(1);

    expect(bus0.defaultPan).toBeCloseTo(-0.68, 2);
    expect(bus1.defaultPan).toBeCloseTo(0.68, 2);

    // Mock player for scheduling notes
    (engine as any).player = {
      queueWaveTable: vi.fn().mockReturnValue({
        audioBufferSourceNode: { stop: vi.fn() },
      }),
    };
    const preset = {};
    (globalThis as any)["_tone_0480_FluidR3_GM_sf2_file"] = preset;
    if (typeof window !== "undefined") {
      (window as any)["_tone_0480_FluidR3_GM_sf2_file"] = preset;
    }

    // 1. Schedule note on channel 0 BEFORE focus
    engine.scheduleNoteOn("note-before", 60, 80, 0, 48, 10.0);
    const voiceBefore = (engine as any).activeVoices.get("note-before");
    expect(voiceBefore).toBeDefined();
    const baseTargetVolume = voiceBefore.targetVolume;

    // 2. Apply section focus on channel 0 (amount 0.8)
    engine.setSectionFocus([0], 0.8);

    // Verify channel 0 receives focus boost on bus.inputGain, and channel 1 receives background damping
    expect(bus0.currentFocusGain).toBeGreaterThan(1.0);
    expect(bus1.currentFocusGain).toBeLessThan(1.0);

    // Crucial requirement: Spotlight pan remains at natural seating pan (-0.68), NOT pulled to center (0.0)!
    expect(bus0.currentPan).toBeCloseTo(-0.68, 2);
    expect(bus1.currentPan).toBeCloseTo(0.68, 2);

    // 3. Schedule note on channel 0 DURING focus
    engine.scheduleNoteOn("note-during", 62, 80, 0, 48, 10.1);
    const voiceDuring = (engine as any).activeVoices.get("note-during");
    expect(voiceDuring).toBeDefined();

    // Voice target volumes must be identical (no double focus multiplier on new voices!)
    expect(voiceDuring.targetVolume).toBeCloseTo(baseTargetVolume, 4);

    // 4. Clear focus
    engine.setSectionFocus(null, 0);
    expect(bus0.currentFocusGain).toBeCloseTo(1.0, 2);
    expect(bus1.currentFocusGain).toBeCloseTo(1.0, 2);

    // Panners still unchanged
    expect(bus0.currentPan).toBeCloseTo(-0.68, 2);
    expect(bus1.currentPan).toBeCloseTo(0.68, 2);
  });

  it("Issue 11: accent trigger audio triggers immediately", async () => {
    const engine = new AudioEngine();
    await engine.resume();

    const now = 10.0;
    // Before triggerAccentBurst, accent factor is 0
    expect(engine.getAccentFactor(now)).toBe(0);

    // Trigger accent burst
    engine.triggerAccentBurst(500);

    // At now, accent factor is peak (~1.0)
    expect(engine.getAccentFactor(now)).toBeGreaterThan(0.9);

    // Decomposition reflects accented state immediately
    const decomp = engine.decomposeNoteVelocity(80);
    expect(decomp.isAccented).toBe(true);
  });

  it("Issue 17: failed script loading removes failed element and allows genuine retry", async () => {
    const engine = new AudioEngine();

    const createdScripts: any[] = [];
    const mockHead = {
      appendChild: vi.fn((el: any) => {
        el.parentNode = mockHead;
      }),
      removeChild: vi.fn((el: any) => {
        el.parentNode = null;
      }),
    };

    (globalThis as any).document = {
      createElement: vi.fn(() => {
        const s: any = {
          dataset: {},
          src: "",
          parentNode: null,
          onload: null,
          onerror: null,
        };
        createdScripts.push(s);
        return s;
      }),
      querySelector: vi.fn(() => null),
      head: mockHead,
    };

    const testUrl = "https://example.com/soundfont.js";

    // Attempt 1: Fails
    const loadPromise1 = (engine as any).loadScript(testUrl);
    expect(createdScripts.length).toBe(1);
    const script1 = createdScripts[0];

    // Trigger onerror
    script1.onerror();

    await expect(loadPromise1).rejects.toThrow("Failed to load script");
    expect(mockHead.removeChild).toHaveBeenCalledWith(script1);

    // Attempt 2: Genuine retry
    const loadPromise2 = (engine as any).loadScript(testUrl);
    expect(createdScripts.length).toBe(2);
    const script2 = createdScripts[1];

    // Trigger onload on retry
    script2.onload();
    await expect(loadPromise2).resolves.toBeUndefined();

    // Subsequent call succeeds immediately from cached loaded URL
    await expect((engine as any).loadScript(testUrl)).resolves.toBeUndefined();
    expect(createdScripts.length).toBe(2); // No 3rd script element created
  });
});
