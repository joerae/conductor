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
  const queryMap: Record<string, any> = {};

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
      if (queryMap[selector]) return queryMap[selector];
      let created: any;
      if (selector === "#warmup-progress-fill") created = createMockDOMNode("div");
      else if (selector === "#warmup-progress-pct") created = createMockDOMNode("span");
      else if (selector === "#warmup-status-text") created = createMockDOMNode("span");
      else if (selector === "#warmup-step-badge") created = createMockDOMNode("span");
      else if (selector === "#warmup-headline") created = createMockDOMNode("h3");
      else if (selector === "#warmup-copy") created = createMockDOMNode("p");
      else if (selector.includes("btn")) created = createMockDOMNode("button");
      else if (selector === "#pill-tempo" || selector === "#pill-dynamics") created = createMockDOMNode("button");
      else if (selector === ".warmup-hands-svg") created = createMockDOMNode("svg");
      else created = createMockDOMNode("div");
      queryMap[selector] = created;
      return created;
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

      const manager = new WarmupManager({
        onStartConducting,
        onTempoDemonstration: onTempoDemo,
        onDynamicsDemonstration: onDynamicsDemo,
      });

      manager.mount(container);
      expect(manager.getCurrentLesson()).toBe("tempo");

      manager.advanceLesson();
      expect(manager.getCurrentLesson()).toBe("dynamics");

      manager.advanceLesson();
      expect(manager.getCurrentLesson()).toBe("ready");

      manager.dispose();
    });

    it("supports replayWarmup after completion", () => {
      const manager = new WarmupManager();
      manager.mount(container);
      manager.advanceLesson();
      manager.advanceLesson();
      expect(manager.getCurrentLesson()).toBe("ready");

      // Replay warmup
      manager.replayWarmup(container);
      expect(manager.getCurrentLesson()).toBe("tempo");
      manager.dispose();
    });

    it("drives tempo and dynamics with deliberate values and enables manual lesson switching", () => {
      const onStartWarmup = vi.fn();
      const onSkipWarmup = vi.fn();
      const onStartConducting = vi.fn();
      const onContinueKeyboard = vi.fn();
      const onRetryCamera = vi.fn();
      const onToggleMute = vi.fn();

      const visuals = new WarmupVisuals({
        onStartWarmup,
        onSkipWarmup,
        onStartConducting,
        onContinueKeyboard,
        onRetryCamera,
        onToggleMute,
      });

      const tempoSyncValues: number[] = [];
      const dynamicsSyncLevels: string[] = [];
      const dynamicsSyncVals: number[] = [];

      visuals.onTempoSync = (bpm) => tempoSyncValues.push(bpm);
      visuals.onDynamicsSync = (level, continuous) => {
        dynamicsSyncLevels.push(level);
        dynamicsSyncVals.push(continuous);
      };

      visuals.mount(container);

      // Simulate animation steps for tempo lesson
      visuals.setLesson("tempo");
      (visuals as any).animateStep(1000);
      (visuals as any).animateStep(2350);
      (visuals as any).animateStep(3700);

      expect(tempoSyncValues.length).toBeGreaterThan(0);
      tempoSyncValues.forEach((bpm) => {
        expect(bpm).toBeGreaterThanOrEqual(52);
        expect(bpm).toBeLessThanOrEqual(162);
      });

      // Switch to dynamics lesson
      visuals.setLesson("dynamics");
      (visuals as any).animateStep(1000);
      (visuals as any).animateStep(2350);
      (visuals as any).animateStep(3700);

      expect(dynamicsSyncVals.length).toBeGreaterThan(0);
      dynamicsSyncVals.forEach((val) => {
        expect(val).toBeGreaterThanOrEqual(0.05);
        expect(val).toBeLessThanOrEqual(0.95);
      });

      // Verify ready state transition
      visuals.setDisplayState("ready");
      visuals.unmount();
    });

    it("returning conductor flow hides synthetic animation stage and lesson pills", () => {
      const visuals = new WarmupVisuals();
      visuals.setReturningUser(true);
      const overlay = visuals.mount(container);

      const animStage = overlay.querySelector("#warmup-animation-stage");
      const pills = overlay.querySelector("#warmup-lesson-pills");
      const skipBtn = overlay.querySelector("#warmup-skip-btn");

      expect(animStage.style.display).toBe("none");
      expect(pills.style.display).toBe("none");
      expect(skipBtn.style.display).toBe("none");

      // Animate step does not emit synthetic tempo sync when returning user
      const tempoSyncSpy = vi.fn();
      visuals.onTempoSync = tempoSyncSpy;
      visuals.setLesson("tempo");
      (visuals as any).animateStep(1000);
      expect(tempoSyncSpy).not.toHaveBeenCalled();

      visuals.unmount();
    });

    it("prompts 'Raise your hands to begin' in camera mode and 'Press SPACE to begin' in keyboard mode", () => {
      let currentMode: "camera" | "keyboard" = "camera";
      const visuals = new WarmupVisuals({}, () => "classic", () => currentMode);
      const overlay = visuals.mount(container);

      visuals.setDisplayState("ready");
      const copy = overlay.querySelector("#warmup-copy");
      const readyBtn = overlay.querySelector("#warmup-ready-btn");

      expect(copy.textContent).toBe("Raise your hands to begin");
      expect(readyBtn.textContent).toContain("RAISE HANDS TO BEGIN");
      expect(copy.textContent).not.toContain("SPACE");

      // Now switch to keyboard mode
      currentMode = "keyboard";
      visuals.setDisplayState("ready");
      expect(copy.textContent).toBe("Press SPACE to begin");
      expect(readyBtn.textContent).toContain("PRESS SPACE TO BEGIN");

      visuals.unmount();
    });

    it("exits warm up into live conducting when hands are raised and coordinator is ready", () => {
      const onStartConducting = vi.fn();
      const manager = new WarmupManager({ onStartConducting });
      manager.mount(container);

      // Raise hands before coordinator is ready
      manager.handleLiveSample({ isHandsRaised: true });
      expect(onStartConducting).not.toHaveBeenCalled();

      // Complete coordinator tasks to become ready
      manager.getCoordinator().updateTask("shell", "ready");
      manager.getCoordinator().updateTask("warmupViolin", "ready");
      manager.getCoordinator().updateTask("cameraPermission", "ready");
      manager.getCoordinator().updateTask("handTracking", "ready");
      manager.getCoordinator().updateTask("score", "ready");
      manager.getCoordinator().updateTask("instruments", "ready");
      expect(manager.getCoordinator().getState().isReady).toBe(true);

      // Now raising hands triggers live conducting exit
      manager.handleLiveSample({ isHandsRaised: true });
      expect(onStartConducting).toHaveBeenCalled();

      manager.dispose();
    });

    it("dynamically modulates warm up audio tempo and dynamic level from live camera samples", () => {
      const onTempo = vi.fn();
      const onDyn = vi.fn();
      const manager = new WarmupManager({
        onTempoDemonstration: onTempo,
        onDynamicsDemonstration: onDyn,
      });
      manager.mount(container);

      manager.handleLiveSample({
        tempoBpm: 156,
        dynamicLevel: "ff",
        dynamicContinuous: 0.88,
      });

      expect(manager.getAudioPlayer().getTempo()).toBe(156);
      expect(onTempo).toHaveBeenCalledWith(156, false);
      expect(onDyn).toHaveBeenCalledWith("ff", 0.88);

      manager.dispose();
    });

    it("does not include a sound toggle button in the warmup template", () => {
      const visuals = new WarmupVisuals();
      visuals.mount(container);
      expect(container.innerHTML).not.toContain("warmup-mute-btn");
      visuals.unmount();
    });

    it("positions visual hand silhouettes based on live camera hand points", () => {
      const visuals = new WarmupVisuals();
      const overlay = visuals.mount(container);

      // Supply 2 live hand points
      visuals.setLiveHandPoints([
        { x: 180, y: 140 },
        { x: 420, y: 150 },
      ]);

      (visuals as any).animateStep(1000);

      const leftHand = overlay?.querySelector("#warmup-hand-left");
      const rightHand = overlay?.querySelector("#warmup-hand-right");
      expect(leftHand?.getAttribute("transform")).toBe("translate(180, 140)");
      expect(rightHand?.getAttribute("transform")).toBe("translate(420, 150)");

      visuals.unmount();
    });

    it("does not prematurely exit warmup while user is practicing during lessons", () => {
      const onStartConducting = vi.fn();
      const manager = new WarmupManager({ onStartConducting });
      manager.mount(container);

      // Loading finishes in background
      manager.getCoordinator().updateTask("shell", "ready");
      manager.getCoordinator().updateTask("warmupViolin", "ready");
      manager.getCoordinator().updateTask("score", "ready");
      manager.getCoordinator().updateTask("instruments", "ready");
      manager.getCoordinator().updateTask("cameraPermission", "ready");
      manager.getCoordinator().updateTask("handTracking", "ready");

      // But user is in the middle of lesson 1
      (manager as any).visuals?.setDisplayState("lesson");

      // Raising hands during lesson does NOT exit
      manager.handleLiveSample({ isHandsRaised: true });
      expect(onStartConducting).not.toHaveBeenCalled();

      // When ready state is reached, raising hands exits
      (manager as any).visuals?.setDisplayState("ready");
      manager.handleLiveSample({ isHandsRaised: true });
      expect(onStartConducting).toHaveBeenCalled();

      manager.dispose();
    });
  });

  describe("Piece Definitions Key Signatures", () => {
    it("defines key signatures in repertoire definitions", async () => {
      const { REPERTOIRE } = await import("../src/score/repertoire");
      const eineKleine = REPERTOIRE.find(p => p.id === "eine-kleine");
      const beethoven5 = REPERTOIRE.find(p => p.id === "beethoven-5");

      expect(eineKleine?.keySignature).toBe("G");
      expect(beethoven5?.keySignature).toBe("Cm");
    });
  });
});
