import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChannelMixer, safeCancelAutomation } from "../src/audio/ChannelMixer";

class MockParam {
  public value: number;
  public calls: Array<{ method: string; args: any[] }> = [];
  constructor(initial: number = 0) { this.value = initial; }
  setValueAtTime(v: number, t: number) { this.value = v; this.calls.push({ method: "setValueAtTime", args: [v, t] }); }
  setTargetAtTime(target: number, start: number, tc: number) { this.calls.push({ method: "setTargetAtTime", args: [target, start, tc] }); }
  cancelScheduledValues(t: number) { this.calls.push({ method: "cancelScheduledValues", args: [t] }); }
  cancelAndHoldAtTime(t: number) { this.calls.push({ method: "cancelAndHoldAtTime", args: [t] }); }
}

class MockAudioNode {
  public connectedTo: any[] = [];
  connect(dest: any) { this.connectedTo.push(dest); return dest; }
  disconnect() { this.connectedTo = []; }
}

class MockGainNode extends MockAudioNode {
  public gain = new MockParam(1.0);
}

class MockBiquadFilterNode extends MockAudioNode {
  public frequency = new MockParam(3800);
  public gain = new MockParam(0.0);
  public type = "highshelf";
}

class MockStereoPannerNode extends MockAudioNode {
  public pan = new MockParam(0.0);
}

class MockContext {
  public currentTime = 10.0;
  public destination = new MockAudioNode();
  createGain() { return new MockGainNode(); }
  createBiquadFilter() { return new MockBiquadFilterNode(); }
  createStereoPanner() { return new MockStereoPannerNode(); }
}

describe("ChannelMixer", () => {
  let mixer: ChannelMixer;
  let ctx: MockContext;

  beforeEach(() => {
    mixer = new ChannelMixer();
    ctx = new MockContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calculates stereo seating pan distribution from left (-0.68) to right (+0.68)", () => {
    const sections = [
      { id: "v1", name: "Violin I", channels: [0], pan: 0, gain: 1 },
      { id: "v2", name: "Violin II", channels: [1], pan: 0, gain: 1 },
      { id: "va", name: "Viola", channels: [2], pan: 0, gain: 1 },
      { id: "vc", name: "Cello", channels: [3], pan: 0, gain: 1 },
    ];

    mixer.setDefaultSectionPanning(sections as any, ctx as any);

    expect(mixer.getChannelPan(0)).toBe(-0.68);
    expect(mixer.getChannelPan(3)).toBe(0.68);
    expect(mixer.getChannelPan(1)).toBeCloseTo(-0.23, 2);
    expect(mixer.getChannelPan(2)).toBeCloseTo(0.23, 2);
  });

  it("creates and caches channel bus node chain", () => {
    const bus = mixer.getOrCreateChannelBus(0, ctx as any);
    expect(bus).toBeDefined();
    expect(bus.channel).toBe(0);
    expect(bus.inputGain).toBeInstanceOf(MockGainNode);
    expect(bus.presenceFilter).toBeInstanceOf(MockBiquadFilterNode);
    expect(bus.panner).toBeInstanceOf(MockStereoPannerNode);

    // Calling again returns the cached instance
    const busAgain = mixer.getOrCreateChannelBus(0, ctx as any);
    expect(busAgain).toBe(bus);
    expect(mixer.getChannelBusCount()).toBe(1);
  });

  it("applies section focus gain and presence boosting vs background attenuation", () => {
    const bus0 = mixer.getOrCreateChannelBus(0, ctx as any);
    const bus1 = mixer.getOrCreateChannelBus(1, ctx as any);

    mixer.setSectionFocus([0], 0.80, ctx as any);

    // Focused channel 0 should have boosted focus gain (> 1.0) and positive presence
    expect(bus0.currentFocusGain).toBeCloseTo(1.0 + 0.35 * 0.80, 2);
    expect(bus0.currentPresenceGain).toBeCloseTo(2.5 * 0.80, 2);

    // Unfocused channel 1 should be background attenuated (< 1.0) and softened presence
    expect(bus1.currentFocusGain).toBeCloseTo(1.0 - 0.46 * 0.80, 2);
    expect(bus1.currentPresenceGain).toBeCloseTo(-1.0 * 0.80, 2);
  });

  it("deduplicates identical consecutive focus calls", () => {
    const bus0 = mixer.getOrCreateChannelBus(0, ctx as any);
    let automationCount = 0;
    const onAuto = () => { automationCount++; };

    mixer.setSectionFocus([0], 0.50, ctx as any, onAuto);
    expect(automationCount).toBe(1);

    const callCountAfterFirst = bus0.inputGain.gain.calls.length;

    // Repeating exact same focus should be a no-op
    mixer.setSectionFocus([0], 0.50, ctx as any, onAuto);
    expect(automationCount).toBe(1);
    expect(bus0.inputGain.gain.calls.length).toBe(callCountAfterFirst);
  });

  it("safeCancelAutomation falls back cleanly when cancelAndHoldAtTime is not present or throws", () => {
    const mockParam = new MockParam(0.75);
    // Remove cancelAndHoldAtTime
    (mockParam as any).cancelAndHoldAtTime = undefined;

    safeCancelAutomation(mockParam as any, 12.0);
    expect(mockParam.calls.some(c => c.method === "cancelScheduledValues")).toBe(true);
    expect(mockParam.calls.some(c => c.method === "setValueAtTime")).toBe(true);
  });
});
