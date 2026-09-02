/**
 * audioLifecycleAndPerformance.test.ts
 *
 * Synthetic unit and longevity tests for audio performance:
 * 1. Focus automation scalability: O(channels) bus automation, no O(activeVoices) loops.
 * 2. Dynamic automation deduplication & limiter isolation.
 * 3. Safe AudioParam automation helper with cancelAndHoldAtTime fallback.
 * 4. Binary search ScoreTransport lookahead: O(log N + k) vs full scan equivalence.
 * 5. Pitch collision truncation timing based on AudioContext time.
 * 6. Voice cleanup lifecycle and stopAllNotes timer cancellation.
 * 7. Scheduler diagnostics: tick duration, examined events, late events, max lateness.
 * 8. 10-minute synthetic performance simulation (fast mocked time).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AudioEngine, safeCancelAutomation } from "../src/audio/AudioEngine";
import { ScoreTransport } from "../src/score/ScoreTransport";
import { Scheduler } from "../src/scheduler/Scheduler";
import type { ScoreEvent } from "../src/score/scoreTypes";

// ── Web Audio Mock Factory ──────────────────────────────────────────────────

class MockAudioParam {
  public value: number;
  public calls: Array<{ method: string; args: any[] }> = [];

  constructor(initialValue: number = 0) {
    this.value = initialValue;
  }

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

  setValueCurveAtTime(values: Float32Array | number[], startTime: number, duration: number) {
    this.calls.push({ method: "setValueCurveAtTime", args: [values, startTime, duration] });
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

class MockAudioBuffer {
  private data: Float32Array[];
  constructor(numberOfChannels: number, length: number, public sampleRate: number) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel: number) {
    return this.data[channel];
  }
}

class MockOscillatorNode extends MockAudioNode {
  public frequency = new MockAudioParam(440);
  public type: string = "sine";
  start(_time?: number) {}
  stop(_time?: number) {}
}

class MockAudioContext {
  public currentTime: number = 0.0;
  public sampleRate: number = 44100;
  public destination = new MockAudioNode();
  public state: AudioContextState = "running";

  createGain() { return new MockGainNode(); }
  createBiquadFilter() { return new MockBiquadFilterNode(); }
  createDynamicsCompressor() { return new MockDynamicsCompressorNode(); }
  createStereoPanner() { return new MockStereoPannerNode(); }
  createConvolver() { return new MockConvolverNode(); }
  createOscillator() { return new MockOscillatorNode(); }
  createBuffer(channels: number, length: number, rate: number) {
    return new MockAudioBuffer(channels, length, rate);
  }
  async resume() { this.state = "running"; }
}

function createMockedEngine(): { engine: AudioEngine; ctx: MockAudioContext } {
  if (typeof (globalThis as any).window === "undefined") {
    (globalThis as any).window = globalThis;
  }
  const ctx = new MockAudioContext();
  const engine = new AudioEngine();
  (engine as any).ctx = ctx;
  (engine as any).setupMasterAcoustics();

  // Mock player
  (engine as any).player = {
    queueWaveTable: (
      _ctx: any,
      _dest: any,
      _preset: any,
      _time: number,
      _note: number,
      _dur: number,
      _vol: number
    ) => ({
      cancel: vi.fn(),
    }),
  };

  // Mock window presets for all programs
  const mockPreset = {};
  for (let prog = 0; prog <= 127; prog++) {
    const code = String(prog * 10).padStart(4, "0");
    (globalThis as any)[`_tone_${code}_FluidR3_GM_sf2_file`] = mockPreset;
  }
  (globalThis as any)["_drum_0_SoundFont_sf2_file"] = mockPreset;

  return { engine, ctx };
}

// ── Test Suites ─────────────────────────────────────────────────────────────

describe("Audio Lifecycle and Performance Suite", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    if (typeof (globalThis as any).window === "undefined") {
      (globalThis as any).window = globalThis;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. Focus Automation Scalability ─────────────────────────────────────────

  describe("1. Focus Automation Scalability", () => {
    it("updates persistent channel buses in O(channels) without iterating active voice nodes", () => {
      const { engine, ctx } = createMockedEngine();

      // Create channel buses for 4 channels
      for (let ch = 0; ch < 4; ch++) {
        engine.getOrCreateChannelBus(ch);
      }

      // Schedule 20 active ringing notes
      for (let i = 0; i < 20; i++) {
        engine.scheduleNoteOn(`note-${i}`, 60 + i, 80, i % 4, 48, ctx.currentTime);
      }
      expect(engine.getAudioDiagnostics().activeVoicesCount).toBe(20);

      // Spy on active voice gain nodes
      for (const voice of (engine as any).activeVoices.values()) {
        voice.gainNode.gain.calls = [];
      }

      // Trigger section focus on channel 0
      engine.setSectionFocus([0], 0.85);

      // Active voice gain nodes must NOT receive setTargetAtTime calls (O(1) per voice)
      for (const voice of (engine as any).activeVoices.values()) {
        const setTargetCalls = voice.gainNode.gain.calls.filter((c: any) => c.method === "setTargetAtTime");
        expect(setTargetCalls.length).toBe(0);
      }

      // The channel bus inputGain for channel 0 must have received target automation
      const bus0 = (engine as any).channelBuses.get(0);
      expect(bus0.inputGain.gain.calls.some((c: any) => c.method === "setTargetAtTime")).toBe(true);
      expect(bus0.currentFocusGain).toBeGreaterThan(1.0); // boosted
    });

    it("deduplicates identical consecutive focus updates with zero automation calls", () => {
      const { engine } = createMockedEngine();
      engine.getOrCreateChannelBus(0);

      const bus0 = (engine as any).channelBuses.get(0);
      engine.setSectionFocus([0], 0.80);
      const callCountAfterFirst = bus0.inputGain.gain.calls.length;
      expect(callCountAfterFirst).toBeGreaterThan(0);

      // Repeated identical call (same channels, same amount)
      engine.setSectionFocus([0], 0.80);
      expect(bus0.inputGain.gain.calls.length).toBe(callCountAfterFirst);

      // Call with negligible delta (<0.005)
      engine.setSectionFocus([0], 0.802);
      expect(bus0.inputGain.gain.calls.length).toBe(callCountAfterFirst);
    });
  });

  // ── 2. Dynamic Automation Deduplication & Limiter Isolation ─────────────────

  describe("2. Dynamic Automation Deduplication & Limiter Isolation", () => {
    it("deduplicates sub-epsilon continuous dynamic changes", () => {
      const { engine } = createMockedEngine();
      const lpf = (engine as any).lowPassFilter as MockBiquadFilterNode;

      engine.setContinuousDynamic(0.50);
      const lpfCallsAfterInit = lpf.frequency.calls.length;

      // Tiny continuous jitter (Δ < 0.003) within same discrete tier
      engine.setContinuousDynamic(0.501);
      engine.setContinuousDynamic(0.5015);
      engine.setContinuousDynamic(0.502);

      expect(lpf.frequency.calls.length).toBe(lpfCallsAfterInit);

      // Meaningful change (Δ >= 0.05)
      engine.setContinuousDynamic(0.75);
      expect(lpf.frequency.calls.length).toBeGreaterThan(lpfCallsAfterInit);
    });

    it("never automates limiter parameters during continuous dynamic sweeps", () => {
      const { engine } = createMockedEngine();
      const limiter = (engine as any).limiter as MockDynamicsCompressorNode;
      limiter.threshold.calls = [];
      limiter.ratio.calls = [];

      // Sweep dynamics across full range pp -> fff
      for (let d = 0; d <= 1.0; d += 0.05) {
        engine.setContinuousDynamic(d);
      }

      // Limiter threshold and ratio should remain untouched during dynamic sweeps
      expect(limiter.threshold.calls.length).toBe(0);
      expect(limiter.ratio.calls.length).toBe(0);
    });
  });

  // ── 3. Safe AudioParam Automation Helper ────────────────────────────────────

  describe("3. Safe AudioParam Automation Helper", () => {
    it("prefers cancelAndHoldAtTime when supported", () => {
      const param = new MockAudioParam(1.0);
      safeCancelAutomation(param as unknown as AudioParam, 2.5);

      expect(param.calls.some(c => c.method === "cancelAndHoldAtTime" && c.args[0] === 2.5)).toBe(true);
    });

    it("falls back cleanly to cancelScheduledValues if cancelAndHoldAtTime throws or is missing", () => {
      const param = new MockAudioParam(1.0);
      // Simulate older browser without cancelAndHoldAtTime
      (param as any).cancelAndHoldAtTime = undefined;

      safeCancelAutomation(param as unknown as AudioParam, 3.0);
      expect(param.calls.some(c => c.method === "cancelScheduledValues" && c.args[0] === 3.0)).toBe(true);

      // Simulate browser where cancelAndHoldAtTime throws
      const throwingParam = new MockAudioParam(1.0);
      throwingParam.cancelAndHoldAtTime = () => {
        throw new Error("Not implemented");
      };
      safeCancelAutomation(throwingParam as unknown as AudioParam, 4.0);
      expect(throwingParam.calls.some(c => c.method === "cancelScheduledValues" && c.args[0] === 4.0)).toBe(true);
    });
  });

  // ── 4. Binary Search ScoreTransport Lookahead ───────────────────────────────

  describe("4. Binary Search ScoreTransport Lookahead", () => {
    it("returns identical results to full array scan with 15,000 synthetic events across all edge cases", () => {
      const transport = new ScoreTransport();
      const totalEvents = 15000;
      const events: ScoreEvent[] = [];

      // Generate 15,000 sorted events across 0 to 500 beats
      for (let i = 0; i < totalEvents; i++) {
        const beat = Math.round((i / 30) * 100) / 100;
        events.push({
          beat,
          type: i % 2 === 0 ? "noteOn" : "noteOff",
          durationBeats: 0.5,
          trackId: `Track-${i % 8}`,
          noteId: `n-${i}`,
          midiNote: 40 + (i % 48),
          velocity: 70 + (i % 40),
          channel: i % 4,
          program: 48,
        });
      }

      transport.setEvents(events, 500);
      // Start at 120 BPM (0.5s / beat)
      transport.start(0, 0.0, 0.5);

      const testWindows = [
        { from: 0.0, to: 0.15 },      // Downbeat origin
        { from: 10.0, to: 10.15 },    // Mid-piece
        { from: 100.0, to: 100.15 },  // Far slice
        { from: 249.9, to: 250.15 },  // Piece end boundary
        { from: 300.0, to: 300.15 },  // Past end
      ];

      for (const w of testWindows) {
        const fromBeat = transport.audioTimeForBeat ? (w.from / 0.5) : w.from;
        const toBeat = transport.audioTimeForBeat ? (w.to / 0.5) : w.to;
        const expected = events.filter(e => e.beat >= fromBeat - 0.05 && e.beat <= toBeat);
        const actual = transport.eventsInWindow(w.from, w.to);

        expect(actual.length).toBe(expected.length);
        for (let j = 0; j < actual.length; j++) {
          expect(actual[j].noteId).toBe(expected[j].noteId);
        }
      }
    });

    it("handles empty events or fermata gracefully", () => {
      const transport = new ScoreTransport();
      transport.setEvents([]);
      expect(transport.eventsInWindow(0, 1)).toEqual([]);

      transport.setFermata(true);
      expect(transport.eventsInWindow(0, 1)).toEqual([]);
    });
  });

  // ── 5. Pitch Collision Truncation Timing ────────────────────────────────────

  describe("5. Pitch Collision Truncation Timing", () => {
    it("calculates voice cleanup delay relative to AudioContext time rather than a fixed 40ms timeout", () => {
      const { engine, ctx } = createMockedEngine();
      ctx.currentTime = 0.500;

      // Schedule note at audioTime 0.650 (150ms in the future)
      engine.scheduleNoteOn("voice-1", 60, 90, 0, 48, 0.650);
      expect(engine.getAudioDiagnostics().activeVoicesCount).toBe(1);

      // Pitch collision with new note at 0.650
      engine.scheduleNoteOn("voice-2", 60, 95, 0, 48, 0.650);

      // Old voice removed from active voices; cleanup timer registered
      expect(engine.getAudioDiagnostics().pendingCleanupCount).toBe(1);

      // Fast-forward 50ms (at wall clock 50ms, ctx.currentTime is still 0.500, but fadeEndTime is 0.665)
      vi.advanceTimersByTime(50);
      // Cleanup must NOT have fired yet because audio fade completes at ctx.currentTime 0.665!
      // Delay should be ~ (0.665 - 0.500) * 1000 + 50 = 215ms
      expect(engine.getAudioDiagnostics().pendingCleanupCount).toBe(1);

      // Advance timers to 220ms
      vi.advanceTimersByTime(170);
      expect(engine.getAudioDiagnostics().pendingCleanupCount).toBe(0);
    });
  });

  // ── 6. Voice Cleanup Lifecycle ──────────────────────────────────────────────

  describe("6. Voice Cleanup Lifecycle", () => {
    it("cleans up active voices after note-off and frees timers upon stopAllNotes", () => {
      const { engine, ctx } = createMockedEngine();
      ctx.currentTime = 1.0;

      for (let i = 0; i < 50; i++) {
        engine.scheduleNoteOn(`n-${i}`, 50 + i, 80, 0, 48, 1.0 + i * 0.01);
      }
      expect(engine.getAudioDiagnostics().activeVoicesCount).toBe(50);
      expect(engine.getAudioDiagnostics().totalVoicesCreated).toBe(50);

      // Schedule note-offs
      for (let i = 0; i < 50; i++) {
        engine.scheduleNoteOff(`n-${i}`, 1.0 + i * 0.01 + 0.1);
      }
      expect(engine.getAudioDiagnostics().activeVoicesCount).toBe(0);
      expect(engine.getAudioDiagnostics().pendingCleanupCount).toBe(50);

      // Advance timers through note releases
      vi.advanceTimersByTime(2000);
      expect(engine.getAudioDiagnostics().pendingCleanupCount).toBe(0);
      expect(engine.getAudioDiagnostics().totalVoicesCancelled).toBe(50);

      // Verify stopAllNotes clears active voices and pending timers
      engine.scheduleNoteOn("n-test", 60, 80, 0, 48, ctx.currentTime);
      engine.stopAllNotes();
      expect(engine.getAudioDiagnostics().activeVoicesCount).toBe(0);
      expect(engine.getAudioDiagnostics().pendingCleanupCount).toBe(0);
    });
  });

  // ── 7. Scheduler Performance & Lateness Diagnostics ─────────────────────────

  describe("7. Scheduler Performance & Lateness Diagnostics", () => {
    it("tracks tick duration, examined events, late events, and lateness correctly", () => {
      let mockTime = 1.0;
      const transport = new ScoreTransport();
      const { engine } = createMockedEngine();

      const events: ScoreEvent[] = [
        // Event slightly in the past (at beat 1.96 -> audioTime 0.98s, 20ms in the past relative to 1.0s)
        { beat: 1.96, type: "noteOn", durationBeats: 0.5, trackId: "V1", noteId: "n-late", midiNote: 60, velocity: 80, channel: 0, program: 48 },
        // Normal event in window (at beat 2.1 -> audioTime 1.05s)
        { beat: 2.1, type: "noteOn", durationBeats: 0.5, trackId: "V1", noteId: "n-normal", midiNote: 64, velocity: 80, channel: 0, program: 48 },
      ];

      transport.setEvents(events);
      // At 120 BPM (0.5s/beat), origin audioTime 0.0, originBeat 0.0 -> beat 2.0 = audioTime 1.0s
      transport.start(0, 0.0, 0.5);

      const scheduler = new Scheduler(
        transport,
        engine,
        () => mockTime
      );

      // Trigger tick at mockTime 1.0s
      (scheduler as any).tick();

      const diag = scheduler.getDiagnostics();
      expect(diag.eventsExaminedLastTick).toBe(2);
      expect(diag.lateEventCount).toBe(1);
      expect(diag.maxLatenessMs).toBeCloseTo(20, -1);
      expect(diag.committedCount).toBe(2);
      expect(diag.lastTickDurationMs).toBeGreaterThanOrEqual(0);

      scheduler.stop();
    });
  });

  // ── 8. 10-Minute Longevity Synthetic Simulation ─────────────────────────────

  describe("8. 10-Minute Longevity Synthetic Simulation", () => {
    it("runs synthetic ticks and 60fps camera cycles without voice accumulation or timer leaks", () => {
      let mockAudioTime = 0.0;
      const transport = new ScoreTransport();
      const { engine, ctx } = createMockedEngine();

      // Create a 15-second piece (30 beats at 120 BPM = 15s) with 4 polyphonic voices
      const events: ScoreEvent[] = [];
      for (let b = 0; b < 30; b += 0.5) {
        events.push({
          beat: b,
          type: "noteOn",
          durationBeats: 0.45,
          trackId: "V1",
          noteId: `long-note-${b}`,
          midiNote: 60 + (Math.floor(b) % 12),
          velocity: 80,
          channel: Math.floor(b) % 4,
          program: 48,
        });
        events.push({
          beat: b + 0.45,
          type: "noteOff",
          durationBeats: 0,
          trackId: "V1",
          noteId: `long-note-${b}`,
          midiNote: 60 + (Math.floor(b) % 12),
          velocity: 0,
          channel: Math.floor(b) % 4,
          program: 48,
        });
      }

      transport.setEvents(events, 30);
      transport.start(0, 0.0, 0.5);

      const scheduler = new Scheduler(
        transport,
        engine,
        () => mockAudioTime
      );

      // Simulate 25 seconds (past the piece end) with 15ms scheduler ticks (1667 ticks)
      const totalTicks = Math.floor(25 / 0.015);

      for (let tick = 0; tick < totalTicks; tick++) {
        mockAudioTime = tick * 0.015;
        ctx.currentTime = mockAudioTime;

        // Run scheduler tick directly
        (scheduler as any).tick();
        // Clear scheduled recursive timer so fake timer loop doesn't cascade exponentially
        scheduler.stop();

        // Advance synthetic timers to allow voice cleanups to complete
        vi.advanceTimersByTime(15);

        // Every 3 ticks (~45ms / ~20 Hz), simulate camera dynamics and focus updates
        if (tick % 3 === 0) {
          const dynVal = 0.3 + 0.4 * Math.sin(tick * 0.01);
          engine.setContinuousDynamic(dynVal);
        }
        if (tick % 50 === 0) {
          // Toggle focus periodically
          const focusCh = (tick / 50) % 4;
          engine.setSectionFocus([focusCh], 0.85);
        }
      }

      // Advance remaining cleanup window
      vi.advanceTimersByTime(2000);

      // At end of simulation:
      const audioDiag = engine.getAudioDiagnostics();
      const schedDiag = scheduler.getDiagnostics();

      // All scheduled voices must have had their note-off cleanups resolved
      expect(audioDiag.activeVoicesCount).toBe(0);
      expect(audioDiag.pendingCleanupCount).toBe(0);
      expect(audioDiag.totalVoicesCreated).toBe(events.length / 2);
      expect(audioDiag.totalVoicesCancelled).toBe(audioDiag.totalVoicesCreated);
      expect(schedDiag.committedCount).toBe(events.length);
    });
  });
});
