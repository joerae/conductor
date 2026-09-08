import { describe, it, expect, beforeEach, vi } from "vitest";
import { FeatureFlagPanel } from "../src/ui/debug/FeatureFlagPanel";
import { TelemetryGraph } from "../src/ui/debug/TelemetryGraph";
import type { DebugSnapshot } from "../src/ui/debug/TelemetryGraph";

interface MockElement {
  id: string;
  className: string;
  style: Record<string, string>;
  textContent: string;
  innerHTML: string;
  value: string;
  checked: boolean;
  dataset: Record<string, string>;
  listeners: Record<string, Function[]>;
  children: MockElement[];
  addEventListener: (event: string, fn: Function) => void;
  dispatchEvent: (event: { type: string }) => void;
  click: () => void;
  querySelector: <T = MockElement>(sel: string) => T | null;
  querySelectorAll: <T = MockElement>(sel: string) => T[];
}

function createMockEl(id: string = "", className: string = ""): MockElement {
  const listeners: Record<string, Function[]> = {};
  const children: MockElement[] = [];

  const el: MockElement = {
    id,
    className,
    style: {},
    textContent: "",
    innerHTML: "",
    value: "",
    checked: false,
    dataset: {},
    listeners,
    children,
    addEventListener: (evt: string, fn: Function) => {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
    },
    dispatchEvent: (event: { type: string }) => {
      listeners[event.type]?.forEach((fn) => fn(event));
    },
    click: () => {
      listeners["click"]?.forEach((fn) => fn({ type: "click" }));
    },
    querySelector: (sel: string) => {
      const all = el.querySelectorAll(sel);
      return all.length > 0 ? (all[0] as any) : null;
    },
    querySelectorAll: (sel: string) => {
      const results: MockElement[] = [];
      const match = (item: MockElement) => {
        if (sel.startsWith("#") && item.id === sel.slice(1)) return true;
        if (sel.startsWith(".") && item.className.split(" ").includes(sel.slice(1))) return true;
        if (sel.startsWith("input[data-dsp-flag") && item.dataset.dspFlag) return true;
        if (sel.startsWith("input[name='dbg-camera-dyn-mode']") && item.id.includes("camera-dyn")) return true;
        if (sel.includes("[data-mode=") && item.dataset.mode) {
          const matchVal = sel.match(/\[data-mode='([^']+)'\]/);
          if (matchVal && item.dataset.mode === matchVal[1]) return true;
        }
        return false;
      };

      const search = (nodes: MockElement[]) => {
        for (const n of nodes) {
          if (match(n)) results.push(n);
          search(n.children);
        }
      };
      search(el.children);
      return results as any;
    },
  };

  return el;
}

describe("DebugOverlay Modular Components", () => {
  describe("FeatureFlagPanel", () => {
    let panel: FeatureFlagPanel;
    let container: MockElement;
    let pauseBtn: MockElement;
    let dspCb: MockElement;
    let macroSlider: MockElement;
    let modeBtn: MockElement;
    let deadbandSlider: MockElement;
    let scoreVisCb: MockElement;

    beforeEach(() => {
      panel = new FeatureFlagPanel();
      container = createMockEl("container");

      pauseBtn = createMockEl("dbg-pause-btn");
      dspCb = createMockEl("dbg-dsp-cb");
      dspCb.dataset.dspFlag = "velocityScaling";
      dspCb.checked = true;

      macroSlider = createMockEl("dbg-macro-slider");
      macroSlider.value = "0.24";

      modeBtn = createMockEl("dbg-mode-instant", "dbg-tempo-mode-btn");
      modeBtn.dataset.mode = "instant";

      deadbandSlider = createMockEl("dbg-deadband-slider");
      deadbandSlider.value = "0.055";

      scoreVisCb = createMockEl("dbg-score-visualizer-cb");
      scoreVisCb.checked = true;

      const scoreFlag = createMockEl("dbg-score-flag");
      const macroRatioVal = createMockEl("dbg-macro-ratio-val");
      const deadbandVal = createMockEl("dbg-jitter-deadband-val");

      container.children.push(
        pauseBtn,
        dspCb,
        macroSlider,
        modeBtn,
        deadbandSlider,
        scoreVisCb,
        scoreFlag,
        macroRatioVal,
        deadbandVal
      );
    });

    it("generates HTML markup containing required elements", () => {
      const headerHtml = panel.renderHeaderHtml();
      expect(headerHtml).toContain("dbg-pause-btn");
      expect(headerHtml).toContain("dbg-rerun-tutorial-btn");

      const modesHtml = panel.renderModesHtml();
      expect(modesHtml).toContain("dbg-mode-autoplay-btn");
      expect(modesHtml).toContain("dbg-tempo-mode-btn");

      const dspHtml = panel.renderDspControlsHtml();
      expect(dspHtml).toContain("data-dsp-flag=\"velocityScaling\"");
      expect(dspHtml).toContain("dbg-macro-slider");

      const mfHtml = panel.renderMagicFingerHtml();
      expect(mfHtml).toContain("dbg-mf-hold-lock-cb");
    });

    it("dispatches callback events when controls are interacted with", () => {
      const onDSPToggle = vi.fn();
      const onTogglePause = vi.fn();
      const onMacroRatioChange = vi.fn();
      const onTempoModeChange = vi.fn();
      const onTempoDeadbandChange = vi.fn();

      panel.bindControls(container as any, {
        onDSPToggle,
        onTogglePause,
        onMacroRatioChange,
        onTempoModeChange,
        onTempoDeadbandChange,
      });

      // 1. Pause button click
      pauseBtn.click();
      expect(onTogglePause).toHaveBeenCalledTimes(1);

      // 2. DSP checkbox change
      dspCb.checked = false;
      dspCb.dispatchEvent({ type: "change" });
      expect(onDSPToggle).toHaveBeenCalledWith("velocityScaling", false);

      // 3. Macro slider input
      macroSlider.value = "0.50";
      macroSlider.dispatchEvent({ type: "input" });
      expect(onMacroRatioChange).toHaveBeenCalledWith(0.50);

      // 4. Mode button click
      modeBtn.click();
      expect(onTempoModeChange).toHaveBeenCalledWith("instant");

      // 5. Deadband slider input
      deadbandSlider.value = "0.08";
      deadbandSlider.dispatchEvent({ type: "input" });
      expect(onTempoDeadbandChange).toHaveBeenCalledWith(0.08);
    });

    it("updates pause button text and style", () => {
      panel.bindControls(container as any, {});
      panel.updatePauseButton(true);
      expect(pauseBtn.textContent).toContain("Resume Playback");

      panel.updatePauseButton(false);
      expect(pauseBtn.textContent).toContain("Pause Orchestra");
    });
  });

  describe("TelemetryGraph", () => {
    let graph: TelemetryGraph;
    let container: MockElement;
    let bpmEl: MockElement;
    let periodEl: MockElement;
    let dynLevelEl: MockElement;
    let jitterStatusEl: MockElement;
    let camH0El: MockElement;
    let camBeatLogEl: MockElement;
    let voicesActiveEl: MockElement;
    let beatsAcceptedEl: MockElement;

    beforeEach(() => {
      graph = new TelemetryGraph();
      container = createMockEl("container");

      bpmEl = createMockEl("dbg-bpm");
      periodEl = createMockEl("dbg-period");
      dynLevelEl = createMockEl("dbg-dyn-level");
      jitterStatusEl = createMockEl("dbg-jitter-status");
      camH0El = createMockEl("dbg-cam-h0");
      camBeatLogEl = createMockEl("dbg-cam-beat-log");
      voicesActiveEl = createMockEl("dbg-voices-active");
      beatsAcceptedEl = createMockEl("dbg-beats-accepted");

      container.children.push(
        bpmEl,
        periodEl,
        dynLevelEl,
        jitterStatusEl,
        camH0El,
        camBeatLogEl,
        voicesActiveEl,
        beatsAcceptedEl
      );
    });

    it("generates HTML markup for diagnostics and monitors", () => {
      const jitterHtml = graph.renderJitterTelemetryHtml();
      expect(jitterHtml).toContain("dbg-jitter-last");
      expect(jitterHtml).toContain("dbg-jitter-status");

      const decompHtml = graph.renderVelocityDecompHtml();
      expect(decompHtml).toContain("dbg-decomp-raw");
      expect(decompHtml).toContain("dbg-decomp-final");

      const dynHtml = graph.renderDynamicsTelemetryHtml();
      expect(dynHtml).toContain("dbg-dyn-level");
      expect(dynHtml).toContain("dbg-vel-scale");

      const camHtml = graph.renderCameraKinematicsHtml();
      expect(camHtml).toContain("dbg-cam-h0");
      expect(camHtml).toContain("dbg-cam-beat-log");
    });

    it("renders snapshot metrics into cached DOM elements", () => {
      const elements = graph.cacheElements(container as any);
      const snapshot: DebugSnapshot = {
        tempoMode: "Expressive",
        bpm: 124.5,
        periodMs: 482.0,
        nextBeatAudioTime: 12.345,
        phaseErrorMs: 2.1,
        confidence: 0.95,
        acceptedBeatCount: 42,
        lastTapStatus: "✓ ACCEPTED",
        scoreBeat: 16.5,
        schedulerHorizon: 13.5,
        schedulerCommitted: 64,
        audioLatencyMs: 15.2,
        audioOutputLatencyMs: 22.0,
        isPaused: false,
        tempoDeadband: 0.05,
        lastJitterMs: 4.2,
        lastJitterPercent: 0.87,
        averageJitterMs: 3.5,
        averageJitterPercent: 0.72,
        jitterStatus: "steady",
        activeVoicesCount: 8,
        pendingCleanupCount: 2,
        channelBusCount: 4,
        fontEnvelopesCount: 8,
        automationRequestsPerSec: 12,
        schedTickMs: 0.45,
        schedEventsExamined: 10,
        schedLateEvents: 0,
        dynamics: {
          level: "f",
          velocityMultiplier: 1.25,
          filterCutoffHz: 16000,
          highShelfGainDb: 2.0,
          reverbWet: 0.28,
          attackTimeSec: 0.005,
          macroRatio: 0.35,
          bypassFlags: {
            velocityScaling: true,
            timbreFilter: true,
            reverbScaling: true,
            attackEnvelope: true,
            safetyLimiter: true,
            scoreCompression: true,
          },
        },
      };

      graph.render(snapshot, elements);

      expect(bpmEl.textContent).toBe("124.5");
      expect(periodEl.textContent).toBe("482.0 ms");
      expect(dynLevelEl.innerHTML).toContain("f (Forte)");
      expect(voicesActiveEl.textContent).toBe("8");
      expect(beatsAcceptedEl.textContent).toBe("42");
    });

    it("updates rolling camera beat log", () => {
      const elements = graph.cacheElements(container as any);
      graph.updateCameraTelemetry({
        handsDetected: 1,
        beatDebug: [
          {
            handIndex: 0,
            direction: "DOWN",
            currentY: 0.72,
            currentVy: -1.2,
            peakY: 0.85,
            troughY: 0.45,
          },
        ],
        lastBeat: {
          handIndex: 0,
          direction: "trough",
          timeMs: 1500,
          amplitude: 0.40,
        },
      } as any, elements);

      expect(camBeatLogEl.innerHTML).toContain("Hand 0");
      expect(camBeatLogEl.innerHTML).toContain("Trough");
    });
  });
});
