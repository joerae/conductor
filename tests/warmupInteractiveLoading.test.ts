import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LoadingCoordinator } from "../src/warmup/LoadingCoordinator";
import { WarmupAudioPlayer } from "../src/warmup/WarmupAudioPlayer";
import { WarmupVisuals } from "../src/warmup/WarmupVisuals";
import { WarmupManager } from "../src/warmup/WarmupManager";

// ── Minimal DOM Mock for Unit Tests in Node ───────────────────────────────────

function createMockDOMNode(tagName: string = "div"): any {
  const listeners: Record<string, Function[]> = {};
  const classes = new Set<string>();
  const children: any[] = [];
  const attributes: Record<string, string> = {};

  const node: any = {
    tagName: tagName.toUpperCase(),
    id: "",
    className: "",
    textContent: "",
    innerHTML: "",
    children,
    style: {},
    classList: {
      add: vi.fn((cls: string) => classes.add(cls)),
      remove: vi.fn((cls: string) => classes.delete(cls)),
      contains: vi.fn((cls: string) => classes.has(cls)),
      toggle: vi.fn((cls: string, force?: boolean) => {
        if (force !== undefined) {
          if (force) classes.add(cls);
          else classes.delete(cls);
        } else {
          if (classes.has(cls)) classes.delete(cls);
          else classes.add(cls);
        }
      }),
    },
    setAttribute: vi.fn((key: string, val: string) => {
      attributes[key] = val;
    }),
    getAttribute: vi.fn((key: string) => attributes[key] || null),
    addEventListener: vi.fn((evt: string, fn: Function) => {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
    }),
    removeEventListener: vi.fn((evt: string, fn: Function) => {
      if (listeners[evt]) {
        listeners[evt] = listeners[evt].filter(f => f !== fn);
      }
    }),
    appendChild: vi.fn((child: any) => {
      children.push(child);
      child.parentElement = node;
      child.parentNode = node;
      return child;
    }),
    removeChild: vi.fn((child: any) => {
      const idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
      child.parentElement = null;
      child.parentNode = null;
      return child;
    }),
    querySelector: vi.fn((selector: string) => {
      if (selector === "#warmup-progress-fill") return createMockDOMNode("div");
      if (selector === "#warmup-progress-pct") return createMockDOMNode("span");
      if (selector === "#warmup-status-text") return createMockDOMNode("span");
      if (selector === "#warmup-step-badge") return createMockDOMNode("span");
      if (selector === "#warmup-headline") return createMockDOMNode("h3");
      if (selector === "#warmup-copy") return createMockDOMNode("p");
      if (selector === "#warmup-primary-btn") return createMockDOMNode("button");
      if (selector === "#warmup-skip-btn") return createMockDOMNode("button");
      if (selector === "#warmup-step-next-btn") return createMockDOMNode("button");
      if (selector === "#warmup-live-badge") return createMockDOMNode("div");
      if (selector === ".warmup-overlay") return createMockDOMNode("div");
      if (selector === ".warmup-hands-svg") return createMockDOMNode("svg");
      return createMockDOMNode("div");
    }),
    querySelectorAll: vi.fn((_selector: string) => []),
    click: () => {
      if (listeners["click"]) {
        listeners["click"].forEach(fn => fn({ preventDefault: () => {}, stopPropagation: () => {} }));
      }
    },
  };
  return node;
}

describe("Warming Up Interactive Loading Experience", () => {
  describe("LoadingCoordinator", () => {
    it("initializes with progress starting at 0", () => {
      const coordinator = new LoadingCoordinator();
      const state = coordinator.getState();
      expect(state.progress).toBe(0);
      expect(state.isReady).toBe(false);
      expect(state.statusMessage).toBe("Preparing the stage...");
    });

    it("ensures progress is strictly monotonic and never decreases", () => {
      const coordinator = new LoadingCoordinator();
      coordinator.updateTask("shell", "ready");
      const progress1 = coordinator.getState().progress;
      expect(progress1).toBeGreaterThan(0);

      // Attempt to report pending status on another task
      coordinator.updateTask("warmupViolin", "loading");
      expect(coordinator.getState().progress).toBeGreaterThanOrEqual(progress1);
    });

    it("fires state change listeners with updated task and progress", () => {
      const coordinator = new LoadingCoordinator();
      const onStateChange = vi.fn();
      coordinator.onStateChange(onStateChange);

      coordinator.updateTask("shell", "ready", "Stage ready");
      expect(onStateChange).toHaveBeenCalled();
      const lastCall = onStateChange.mock.calls[onStateChange.mock.calls.length - 1][0];
      expect(lastCall.shell).toBe("ready");
      expect(lastCall.statusMessage).toBe("Stage ready");

      // Complete all tasks
      coordinator.updateTask("warmupViolin", "ready");
      coordinator.updateTask("cameraPermission", "ready");
      coordinator.updateTask("handTracking", "ready");
      coordinator.updateTask("score", "ready");
      coordinator.updateTask("instruments", "ready");

      expect(coordinator.getState().progress).toBe(100);
      expect(coordinator.getState().isReady).toBe(true);
    });

    it("supports fast-path flag for returning conductors", () => {
      const coordinator = new LoadingCoordinator();
      expect(coordinator.isFastPathEligible()).toBe(false);

      coordinator.setFastPathEligible(true);
      expect(coordinator.isFastPathEligible()).toBe(true);
    });
  });

  describe("WarmupAudioPlayer", () => {
    let mockContext: any;
    let mockGain: any;

    beforeEach(() => {
      mockGain = {
        gain: {
          value: 0.5,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          cancelScheduledValues: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };

      mockContext = {
        currentTime: 10.0,
        destination: {},
        createGain: vi.fn(() => ({
          gain: {
            value: 1.0,
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
            cancelScheduledValues: vi.fn(),
          },
          connect: vi.fn(),
          disconnect: vi.fn(),
        })),
        createOscillator: vi.fn(() => ({
          type: "sine",
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          disconnect: vi.fn(),
        })),
        createBiquadFilter: vi.fn(() => ({
          type: "lowpass",
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          disconnect: vi.fn(),
        })),
      };
    });

    it("initializes without errors and allows volume and mute control", () => {
      const player = new WarmupAudioPlayer();
      player.init(mockContext);

      player.setDynamics(0.8);
      expect(player.getDynamics()).toBe(0.8);

      player.setMuted(true);
      expect(player.isSoundMuted()).toBe(true);

      player.setMuted(false);
      expect(player.isSoundMuted()).toBe(false);
      player.dispose();
    });

    it("shapes tempo and playback state cleanly during warmup playback", () => {
      const player = new WarmupAudioPlayer();
      player.init(mockContext);

      player.setTempo(144);
      expect(player.getTempo()).toBe(144);

      player.start();
      expect(player.isPlaying()).toBe(true);

      player.stop();
      expect(player.isPlaying()).toBe(false);
      player.dispose();
    });
  });

  describe("WarmupVisuals & WarmupManager", () => {
    let container: any;
    let originalDocument: any;

    beforeEach(() => {
      originalDocument = (globalThis as any).document;
      container = createMockDOMNode("div");
      (globalThis as any).document = {
        createElement: vi.fn((tag: string) => createMockDOMNode(tag)),
      };
    });

    afterEach(() => {
      (globalThis as any).document = originalDocument;
    });

    it("mounts and renders SVG hand silhouettes and lesson cards", () => {
      const visuals = new WarmupVisuals();
      const overlay = visuals.mount(container);

      expect(overlay).toBeTruthy();
      expect(container.appendChild).toHaveBeenCalled();

      visuals.unmount();
      expect(container.removeChild).toHaveBeenCalled();
    });

    it("steps through Lesson 1 -> Lesson 2 -> Lesson 3 -> Ready in WarmupManager", () => {
      const onStartConducting = vi.fn();
      const onTempoDemo = vi.fn();
      const onDynamicsDemo = vi.fn();
      const onSpotlightDemo = vi.fn();

      const manager = new WarmupManager({
        onStartConducting,
        onTempoDemonstration: onTempoDemo,
        onDynamicsDemonstration: onDynamicsDemo,
        onSpotlightSection: onSpotlightDemo,
      });

      manager.mount(container);
      expect(manager.getCurrentLesson()).toBe("tempo");

      manager.advanceLesson();
      expect(manager.getCurrentLesson()).toBe("dynamics");

      manager.advanceLesson();
      expect(manager.getCurrentLesson()).toBe("spotlight");

      manager.advanceLesson();
      expect(manager.getCurrentLesson()).toBe("ready");

      manager.dispose();
    });

    it("supports replayWarmup after completion", () => {
      const manager = new WarmupManager();
      manager.mount(container);
      manager.advanceLesson();
      manager.advanceLesson();
      manager.advanceLesson();
      expect(manager.getCurrentLesson()).toBe("ready");

      // Replay warmup
      manager.replayWarmup(container);
      expect(manager.getCurrentLesson()).toBe("tempo");
      manager.dispose();
    });
  });
});
