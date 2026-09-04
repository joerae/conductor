import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NoteVisualManager } from "../src/ui/NoteVisualManager";
import { bpmToPercent, initBpmGaugeTicks } from "../src/ui/bpmGauge";

function createMockElement(tag: string = "div"): any {
  const classes = new Set<string>();
  return {
    tagName: tag.toUpperCase(),
    textContent: "",
    style: {
      bottom: "",
    },
    classList: {
      add: vi.fn((cls: string) => classes.add(cls)),
      remove: vi.fn((cls: string) => classes.delete(cls)),
      contains: vi.fn((cls: string) => classes.has(cls)),
    },
  };
}

describe("Visual Timers, Overlapping Notes & BPM Mapping (Issues 14, 15, 16)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Issue 14: stale note-visual timers are cancelled and cannot cross playback sessions", () => {
    const manager = new NoteVisualManager();
    const mockSection = createMockElement("div");
    const mockEgg = createMockElement("ellipse");

    const resolver = {
      getSection: vi.fn().mockReturnValue(mockSection),
      getMusicianEgg: vi.fn().mockReturnValue(mockEgg),
    };

    // Schedule a note visual event with 200ms delay
    manager.handleNoteVisual(
      {
        type: "noteOn",
        midiNote: 60,
        velocity: 80,
        channel: 0,
        trackId: 0,
        delayMs: 200,
        decomp: {
          dynamicLevel: "mf",
          dynMultiplier: 1.0,
          raw: 80,
          macro: 80,
          macroDelta: 0,
          macroEnabled: false,
        },
      },
      resolver
    );

    expect(manager.getPendingTimersCount()).toBe(1);

    // Now piece switches or user restarts before 200ms
    manager.clearAll();
    expect(manager.getPendingTimersCount()).toBe(0);
    expect(manager.getCurrentSessionId()).toBe(1);

    // Advance timers past the original 200ms
    vi.advanceTimersByTime(300);

    // Stale callback must NOT execute on DOM elements
    expect(mockSection.classList.contains("playing")).toBe(false);
    expect(mockEgg.classList.contains("playing")).toBe(false);
    expect(manager.getEggActiveCount(mockEgg)).toBe(0);
  });

  it("Issue 15: overlapping note visuals are reference-counted and stay active until all notes end", () => {
    const manager = new NoteVisualManager();
    const mockSection = createMockElement("div");
    const mockEgg = createMockElement("ellipse");

    const resolver = {
      getSection: vi.fn().mockReturnValue(mockSection),
      getMusicianEgg: vi.fn().mockReturnValue(mockEgg),
    };

    const dummyDecomp = {
      dynamicLevel: "mf",
      dynMultiplier: 1.0,
      raw: 80,
      macro: 80,
      macroDelta: 0,
      macroEnabled: false,
    };

    // 1. NoteOn 1 arrives immediately
    manager.handleNoteVisual(
      { type: "noteOn", midiNote: 60, velocity: 80, channel: 0, trackId: 0, delayMs: 0, decomp: dummyDecomp },
      resolver
    );
    vi.advanceTimersByTime(1);

    expect(manager.getEggActiveCount(mockEgg)).toBe(1);
    expect(mockEgg.classList.contains("playing")).toBe(true);
    expect(mockSection.classList.contains("playing")).toBe(true);

    // 2. NoteOn 2 arrives for the same egg before note 1 ends
    manager.handleNoteVisual(
      { type: "noteOn", midiNote: 72, velocity: 90, channel: 0, trackId: 0, delayMs: 0, decomp: dummyDecomp },
      resolver
    );
    vi.advanceTimersByTime(1);

    expect(manager.getEggActiveCount(mockEgg)).toBe(2);
    expect(mockEgg.classList.contains("playing")).toBe(true);

    // 3. NoteOff for note 1 arrives: count drops to 1, egg STILL playing!
    manager.handleNoteVisual(
      { type: "noteOff", midiNote: 60, velocity: 0, channel: 0, trackId: 0, delayMs: 0, decomp: dummyDecomp },
      resolver
    );
    vi.advanceTimersByTime(1);

    expect(manager.getEggActiveCount(mockEgg)).toBe(1);
    expect(mockEgg.classList.contains("playing")).toBe(true);
    expect(mockSection.classList.contains("playing")).toBe(true);

    // 4. NoteOff for note 2 arrives: count drops to 0, egg and section removed
    manager.handleNoteVisual(
      { type: "noteOff", midiNote: 72, velocity: 0, channel: 0, trackId: 0, delayMs: 0, decomp: dummyDecomp },
      resolver
    );
    vi.advanceTimersByTime(1);

    expect(manager.getEggActiveCount(mockEgg)).toBe(0);
    expect(mockEgg.classList.contains("playing")).toBe(false);
    expect(mockSection.classList.contains("playing")).toBe(false);
  });

  it("Issue 16: BPM gauge mapping function and tick label positioning", () => {
    // 1. Check linear formula ((bpm - 40) / 180) * 100
    expect(bpmToPercent(40)).toBeCloseTo(0.0, 3);
    expect(bpmToPercent(75)).toBeCloseTo(19.444, 2);
    expect(bpmToPercent(108)).toBeCloseTo(37.778, 2);
    expect(bpmToPercent(140)).toBeCloseTo(55.556, 2);
    expect(bpmToPercent(180)).toBeCloseTo(77.778, 2);
    expect(bpmToPercent(220)).toBeCloseTo(100.0, 3);

    // Out of bounds clamped
    expect(bpmToPercent(30)).toBe(0);
    expect(bpmToPercent(250)).toBe(100);

    // 2. Test initBpmGaugeTicks dynamically updating tick elements
    const tickValues = ["220", "180", "140", "108", "75", "40"];
    const mockTicks = tickValues.map(val => {
      const el = createMockElement("span");
      el.textContent = val;
      return el;
    });

    const mockContainer = {
      querySelectorAll: vi.fn().mockReturnValue(mockTicks),
    } as any;

    initBpmGaugeTicks(mockContainer);

    expect(mockTicks[0].style.bottom).toBe("100.00%");
    expect(mockTicks[1].style.bottom).toBe("77.78%");
    expect(mockTicks[2].style.bottom).toBe("55.56%");
    expect(mockTicks[3].style.bottom).toBe("37.78%");
    expect(mockTicks[4].style.bottom).toBe("19.44%");
    expect(mockTicks[5].style.bottom).toBe("0.00%");
  });
});
