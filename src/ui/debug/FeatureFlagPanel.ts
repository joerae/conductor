/**
 * FeatureFlagPanel.ts
 *
 * Encapsulates debug controls, feature flag checkboxes, algorithm mode buttons,
 * and real-time parameter tuning sliders for the Conductor experience.
 */

import type { DSPBypassFlags, DynamicsTelemetry } from "../../audio/dynamicsTypes";
import type { TempoMode } from "../../clock/ConductorClock";
import { MAGIC_FINGER_TUNING } from "../../camera/MagicFingerController";

export interface FeatureFlagPanelCallbacks {
  onDSPToggle?: (flag: keyof DSPBypassFlags, enabled: boolean) => void;
  onTogglePause?: () => void;
  onMacroRatioChange?: (ratio: number) => void;
  onCameraDynamicsModeChange?: (mode: "spread" | "height") => void;
  onBeatSoundToggle?: (enabled: boolean) => void;
  onTempoDeadbandChange?: (ratio: number) => void;
  onTempoModeChange?: (mode: "balanced" | "instant" | "autoplay" | "inertial" | "gestural") => void;
  onAutoplayInTempo?: () => void;
  onThumbsUpVFXToggle?: (enabled: boolean) => void;
  onFocusModeToggle?: (enabled: boolean) => void;
  onScoreVisualizerToggle?: (enabled: boolean) => void;
  onRerunTutorial?: () => void;
}

export class FeatureFlagPanel {
  private container: HTMLElement | null = null;
  private callbacks: FeatureFlagPanelCallbacks = {};
  private elements: Record<string, HTMLElement> = {};

  renderHeaderHtml(): string {
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <span class="debug-title" style="margin:0; font-size:12px;">DIAGNOSTICS & A/B DSP</span>
        <div style="display:flex; gap:6px;">
          <button id="dbg-rerun-tutorial-btn" style="
            background: rgba(110, 231, 183, 0.15);
            color: #6ee7b7;
            border: 1px solid rgba(110, 231, 183, 0.5);
            border-radius: 4px;
            padding: 4px 8px;
            font-family: inherit;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
            white-space: nowrap;
          " title="Rerun the interactive warming-up conducting tutorial">🎓 Rerun Warm Up</button>
          <button id="dbg-pause-btn" style="
            background: rgba(255, 213, 107, 0.15);
            color: #ffd56b;
            border: 1px solid rgba(255, 213, 107, 0.5);
            border-radius: 4px;
            padding: 4px 10px;
            font-family: inherit;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
            white-space: nowrap;
          ">⏸ Pause Orchestra</button>
        </div>
      </div>
    `;
  }

  renderModesHtml(): string {
    return `
      <!-- Tempo & Playback Modes (Debug Panel) -->
      <div class="debug-section-header" title="Select clock algorithm or trigger automated in-tempo playback">TEMPO & AUTOPLAY MODES</div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 5px; margin: 4px 0 10px 0;">
        <button id="dbg-mode-autoplay-btn" style="grid-column: span 2; background: rgba(52, 199, 89, 0.2); color: #5cd87e; border: 1px solid #5cd87e; border-radius: 4px; padding: 6px 8px; font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.15s ease;" title="Play piece continuously in tempo at default BPM without requiring manual conducting">⚡ Play Song in Tempo (Autoplay)</button>
        <button class="dbg-tempo-mode-btn" data-mode="gestural" style="background: rgba(255,213,107,0.25); color: #ffd56b; border: 1px solid #ffd56b; border-radius: 4px; padding: 5px; font-family: inherit; font-size: 10px; font-weight: 700; cursor: pointer;">🪄 Expressive</button>
        <button class="dbg-tempo-mode-btn" data-mode="inertial" style="background: rgba(255,255,255,0.05); color: #d0f0d0; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; padding: 5px; font-family: inherit; font-size: 10px; cursor: pointer;">🥁 Beat (Cut Time)</button>
        <button class="dbg-tempo-mode-btn" data-mode="balanced" style="background: rgba(255,255,255,0.05); color: #d0f0d0; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; padding: 5px; font-family: inherit; font-size: 10px; cursor: pointer;">⚖️ Balanced PLL</button>
        <button class="dbg-tempo-mode-btn" data-mode="instant" style="background: rgba(255,255,255,0.05); color: #d0f0d0; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; padding: 5px; font-family: inherit; font-size: 10px; cursor: pointer;">⏱️ Instant Dime</button>
      </div>
    `;
  }

  renderJitterDeadbandSliderHtml(): string {
    return `
      <!-- Interactive Jitter Deadband Protection Slider -->
      <div style="
        margin: 4px 0 8px 0;
        padding: 6px 8px;
        background: rgba(255, 255, 255, 0.04);
        border-radius: 4px;
        border: 1px solid rgba(255, 213, 107, 0.2);
      " title="Adjust the Jitter Protection Deadband: Within this threshold, the orchestra maintains a rock-solid BPM without micro-adjusting. Outside this threshold, consistent beats smoothly steer tempo.">
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:10.5px; margin-bottom:4px;">
          <span style="color:#d0f0d0;">Jitter Deadband:</span>
          <span id="dbg-jitter-deadband-val" style="color:#ffd56b; font-weight:700;">5.5% (±55ms @ 60BPM)</span>
        </div>
        <input type="range" id="dbg-deadband-slider" min="0" max="0.15" step="0.005" value="0.055" style="
          width: 100%;
          accent-color: #ffd56b;
          cursor: pointer;
          height: 4px;
          margin: 4px 0;
        " title="Drag to adjust jitter deadband between 0.0% (raw micro-tracking) and 15.0% (heavy stability)">
        <div style="display:flex; justify-content:space-between; font-size:8.5px; color:#888888;">
          <span>0.0% (Raw)</span>
          <span>5.5% (Balanced)</span>
          <span>15.0% (Heavy)</span>
        </div>
      </div>
    `;
  }

  renderDspControlsHtml(): string {
    return `
      <!-- Interactive A/B DSP Toggles & Macro Slider -->
      <div class="debug-section-header" style="margin-top: 10px;" title="Interactive A/B toggles to audition individual DSP modules on/off in real-time">A/B DSP & MACRO CONTROLS</div>
      <div class="debug-toggles-grid">
        <label class="debug-checkbox-label" title="Toggle proportional note velocity scaling across dynamic tiers (pp through fff)">
          <input type="checkbox" data-dsp-flag="velocityScaling" checked>
          <span>Velocity Scaling</span>
        </label>
        <label class="debug-checkbox-label" title="Toggle score macro-dynamics compression. When enabled, compresses baked-in MIDI swings so the conductor commands the volume">
          <input type="checkbox" data-dsp-flag="scoreCompression" checked>
          <span>Score Macro Dynamics Smoothing</span>
        </label>

        <!-- Interactive Macro Dynamics Smoothing Slider -->
        <div style="
          margin: 4px 0;
          padding: 6px 8px;
          background: rgba(255, 255, 255, 0.04);
          border-radius: 4px;
          border: 1px solid rgba(255, 213, 107, 0.2);
        " title="Adjust the strength of Score Macro Smoothing: 0.00 = completely flat (100% conductor authority), 1.00 = raw MIDI score dynamics">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:10.5px; margin-bottom:4px;">
            <span style="color:#d0f0d0;">Macro Smoothing Ratio:</span>
            <span id="dbg-macro-ratio-val" style="color:#ffd56b; font-weight:700;">0.24 (Heavy Smooth)</span>
          </div>
          <input type="range" id="dbg-macro-slider" min="0" max="1" step="0.05" value="0.24" style="
            width: 100%;
            accent-color: #ffd56b;
            cursor: pointer;
            height: 4px;
            margin: 4px 0;
          " title="Drag to adjust macro smoothing ratio between 0.0 (flat) and 1.0 (raw MIDI)">
          <div style="display:flex; justify-content:space-between; font-size:8.5px; color:#888888;">
            <span>0.0 (Flat)</span>
            <span>0.24 (Active)</span>
            <span>1.0 (Raw MIDI)</span>
          </div>
        </div>

        <label class="debug-checkbox-label" title="Toggle dynamic Low-Pass Filter and High-Shelf EQ across dynamic tiers">
          <input type="checkbox" data-dsp-flag="timbreFilter" checked>
          <span>Timbre Filter (LPF/Shelf)</span>
        </label>
        <label class="debug-checkbox-label" title="Toggle dynamic concert hall reverb wet send expansion (bloom in forte, intimate in piano)">
          <input type="checkbox" data-dsp-flag="reverbScaling" checked>
          <span>Dynamic Reverb Bloom</span>
        </label>
        <label class="debug-checkbox-label" title="Toggle per-voice dynamic attack envelope shaping (2ms fast bite vs 18ms soft swell)">
          <input type="checkbox" data-dsp-flag="attackEnvelope">
          <span>Dynamic Attack Envelope</span>
        </label>
        <label class="debug-checkbox-label" title="Toggle safety brickwall limiter (-1.0 dBFS) to prevent any DAC clipping">
          <input type="checkbox" data-dsp-flag="safetyLimiter" checked>
          <span>Safety Limiter (-1dB)</span>
        </label>
      </div>
    `;
  }

  renderCameraAxesHtml(): string {
    return `
      <!-- Camera Gesture Axes & Dynamics Sensing Mode Selector -->
      <div class="debug-section-header" style="margin-top: 10px;" title="Select which gesture modality drives speed vs volume in Camera Expressive Mode">CAMERA GESTURE AXES &amp; DYNAMICS</div>
      <div style="
        display: flex;
        flex-direction: column;
        gap: 6px;
        background: rgba(255, 255, 255, 0.04);
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid rgba(255, 213, 107, 0.2);
        margin-top: 4px;
      ">
        <label class="debug-checkbox-label" style="margin:0; cursor:pointer;" title="Classic Mode (Default): Horizontal Width ↔ controls Dynamics (Volume), Vertical Height ↕ controls Tempo (Speed). Natural and intuitive!">
          <input type="radio" name="dbg-camera-dyn-mode" value="spread" checked style="accent-color:#ffd56b; margin-right:6px;">
          <span><strong>Classic (Default)</strong>: ↔ Width: Dynamics • ↕ Height: Tempo</span>
        </label>
        <label class="debug-checkbox-label" style="margin:0; cursor:pointer;" title="Flipped Mode (Experimental): Horizontal Width ↔ controls Tempo (Speed), Vertical Height ↕ controls Dynamics (Volume).">
          <input type="radio" name="dbg-camera-dyn-mode" value="height" style="accent-color:#ffd56b; margin-right:6px;">
          <span><strong>Flipped (Experimental)</strong>: ↔ Width: Tempo • ↕ Height: Dynamics</span>
        </label>
      </div>
    `;
  }

  renderBeatAuditoryHtml(): string {
    return `
      <!-- Camera & Beat Detection Auditory Tools -->
      <div class="debug-section-header" style="margin-top: 10px;" title="Immediate auditory feedback when beats are triggered">BEAT AUDITORY DIAGNOSTICS</div>
      <div style="
        display: flex;
        flex-direction: column;
        gap: 6px;
        background: rgba(255, 255, 255, 0.04);
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid rgba(255, 213, 107, 0.2);
        margin-top: 4px;
      ">
        <label class="debug-checkbox-label" style="margin:0; cursor:pointer;" title="Play an instant orchestral crash cymbal cue the exact millisecond a beat is detected from the camera or keyboard">
          <input type="checkbox" id="dbg-beat-sound-cb" style="accent-color:#ffd56b; margin-right:6px;">
          <span><strong>🥁 Make Sound on Beat</strong> (Instant Cymbal Cue)</span>
        </label>
        <label class="debug-checkbox-label" style="margin:0; cursor:pointer;" title="Show a secondary cyan beacon needle on the stage speedometer tracking actual audio clock playback speed">
          <input type="checkbox" id="dbg-show-orchestra-needle-cb" style="accent-color:#ffd56b; margin-right:6px;">
          <span><strong>📊 Show Orchestra Speed Needle</strong> (Cyan Clock Beacon)</span>
        </label>
        <label class="debug-checkbox-label" style="margin:0; cursor:pointer;" title="Enable Camera Instrument Spotlight Focus Mode (Point Up gesture to spotlight and bring instrument section forward in mix)">
          <input type="checkbox" id="dbg-focus-mode-cb" checked style="accent-color:#ffd56b; margin-right:6px;">
          <span><strong>🪄 Instrument Spotlight Focus Mode</strong> (Point Up to Mix Section)</span>
        </label>
        <label class="debug-checkbox-label" style="margin:0; cursor:pointer;" title="Toggle Real-Time Musical Score Visualizer in Spotlight Mode (Feature Flag, S key)">
          <input type="checkbox" id="dbg-score-visualizer-cb" checked style="accent-color:#ffd56b; margin-right:6px;">
          <span><strong>🎼 Spotlight Score Visualizer</strong> (2-Bar VexFlow Notation)</span>
        </label>
      </div>
    `;
  }

  renderMagicFingerHtml(): string {
    return `
      <!-- Magic Finger: Hold to Lock & Sensitivity Controls -->
      <div class="debug-section-header" style="margin-top: 10px;" title="Configure Magic Finger Hold-to-Lock and Shake-to-Lock parameters">MAGIC FINGER: HOLD TO LOCK</div>
      <div style="
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: rgba(255, 255, 255, 0.04);
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid rgba(255, 213, 107, 0.2);
        margin-top: 4px;
      ">
        <label class="debug-checkbox-label" style="margin:0; cursor:pointer;" title="Enable Hold Steady to Lock interaction on Tempo and Dynamics controls">
          <input type="checkbox" id="dbg-mf-hold-lock-cb" checked style="accent-color:#ffd56b; margin-right:6px;">
          <span><strong>🔒 Enable Hold to Lock</strong></span>
        </label>
        <label class="debug-checkbox-label" style="margin:0; cursor:pointer;" title="Enable Fist/Hand Shake to Lock gesture">
          <input type="checkbox" id="dbg-mf-shake-lock-cb" checked style="accent-color:#ffd56b; margin-right:6px;">
          <span><strong>👋 Enable Shake to Lock</strong></span>
        </label>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
          <span>Hold Steady Delay (before charging):</span>
          <span id="dbg-mf-hold-delay-val" style="color:#ffd56b; font-weight:bold;">0.50s</span>
        </div>
        <input type="range" id="dbg-mf-hold-delay-slider" min="0.2" max="2.0" step="0.05" value="0.50" style="accent-color:#ffd56b; width:100%;">

        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
          <span>Charge Duration (ring fill speed):</span>
          <span id="dbg-mf-charge-dur-val" style="color:#ffd56b; font-weight:bold;">0.80s</span>
        </div>
        <input type="range" id="dbg-mf-charge-dur-slider" min="0.1" max="1.5" step="0.05" value="0.80" style="accent-color:#ffd56b; width:100%;">

        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
          <span>Jitter Tolerance (steady threshold):</span>
          <span id="dbg-mf-tolerance-val" style="color:#ffd56b; font-weight:bold;">±5.0 BPM / ±0.044 Dyn</span>
        </div>
        <input type="range" id="dbg-mf-tolerance-slider" min="1" max="15" step="0.2" value="5.0" style="accent-color:#ffd56b; width:100%;">
      </div>
    `;
  }

  bindControls(container: HTMLElement, callbacks: FeatureFlagPanelCallbacks): void {
    this.container = container;
    this.callbacks = callbacks;

    // Cache elements for updates
    const keys = [
      "pause-btn",
      "macro-ratio-val",
      "jitter-deadband-val",
      "score-flag",
    ];
    keys.forEach((key) => {
      const el = container.querySelector<HTMLElement>(`#dbg-${key}`);
      if (el) this.elements[key] = el;
    });

    // Wire up A/B DSP checkboxes
    const checkboxes = container.querySelectorAll<HTMLInputElement>("input[data-dsp-flag]");
    checkboxes.forEach((cb) => {
      cb.addEventListener("change", () => {
        const flag = cb.dataset.dspFlag as keyof DSPBypassFlags;
        if (flag && this.callbacks.onDSPToggle) {
          this.callbacks.onDSPToggle(flag, cb.checked);
        }
      });
    });

    // Wire up Camera Dynamics Mode radio buttons
    const dynModeRadios = container.querySelectorAll<HTMLInputElement>("input[name='dbg-camera-dyn-mode']");
    dynModeRadios.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked && this.callbacks.onCameraDynamicsModeChange) {
          this.callbacks.onCameraDynamicsModeChange(radio.value as "spread" | "height");
        }
      });
    });

    // Wire up Audible Beat Cue toggle
    const beatSoundCb = container.querySelector<HTMLInputElement>("#dbg-beat-sound-cb");
    beatSoundCb?.addEventListener("change", () => {
      this.callbacks.onBeatSoundToggle?.(beatSoundCb.checked);
    });

    // Wire up Orchestra Speed Needle on Stage toggle
    const orchNeedleCb = container.querySelector<HTMLInputElement>("#dbg-show-orchestra-needle-cb");
    orchNeedleCb?.addEventListener("change", () => {
      const gauge = document.getElementById("bpm-gauge-container");
      gauge?.classList.toggle("show-orchestra-speed", orchNeedleCb.checked);
    });

    // Wire up Thumbs Up Camera VFX Burst toggle
    const thumbsUpVfxCb = container.querySelector<HTMLInputElement>("#dbg-thumbsup-vfx-cb");
    thumbsUpVfxCb?.addEventListener("change", () => {
      this.callbacks.onThumbsUpVFXToggle?.(thumbsUpVfxCb.checked);
    });

    // Wire up Instrument Spotlight Focus Mode toggle
    const focusModeCb = container.querySelector<HTMLInputElement>("#dbg-focus-mode-cb");
    focusModeCb?.addEventListener("change", () => {
      this.callbacks.onFocusModeToggle?.(focusModeCb.checked);
    });

    // Wire up Spotlight Score Visualizer toggle
    const scoreVisCb = container.querySelector<HTMLInputElement>("#dbg-score-visualizer-cb");
    scoreVisCb?.addEventListener("change", () => {
      this.callbacks.onScoreVisualizerToggle?.(scoreVisCb.checked);
    });

    // Wire up Magic Finger Hold to Lock controls
    const holdLockCb = container.querySelector<HTMLInputElement>("#dbg-mf-hold-lock-cb");
    const shakeLockCb = container.querySelector<HTMLInputElement>("#dbg-mf-shake-lock-cb");
    const holdDelaySlider = container.querySelector<HTMLInputElement>("#dbg-mf-hold-delay-slider");
    const holdDelayVal = container.querySelector<HTMLElement>("#dbg-mf-hold-delay-val");
    const chargeDurSlider = container.querySelector<HTMLInputElement>("#dbg-mf-charge-dur-slider");
    const chargeDurVal = container.querySelector<HTMLElement>("#dbg-mf-charge-dur-val");
    const toleranceSlider = container.querySelector<HTMLInputElement>("#dbg-mf-tolerance-slider");
    const toleranceVal = container.querySelector<HTMLElement>("#dbg-mf-tolerance-val");

    holdLockCb?.addEventListener("change", () => {
      MAGIC_FINGER_TUNING.HOLD_LOCK_ENABLED = holdLockCb.checked;
    });

    shakeLockCb?.addEventListener("change", () => {
      MAGIC_FINGER_TUNING.SHAKE_LOCK_ENABLED = shakeLockCb.checked;
    });

    holdDelaySlider?.addEventListener("input", () => {
      const valSec = parseFloat(holdDelaySlider.value);
      MAGIC_FINGER_TUNING.HOLD_STEADY_TIME_MS = Math.round(valSec * 1000);
      if (holdDelayVal) holdDelayVal.textContent = `${valSec.toFixed(2)}s`;
    });

    chargeDurSlider?.addEventListener("input", () => {
      const valSec = parseFloat(chargeDurSlider.value);
      MAGIC_FINGER_TUNING.HOLD_CHARGE_DURATION_MS = Math.round(valSec * 1000);
      if (chargeDurVal) chargeDurVal.textContent = `${valSec.toFixed(2)}s`;
    });

    toleranceSlider?.addEventListener("input", () => {
      const valBpm = parseFloat(toleranceSlider.value);
      MAGIC_FINGER_TUNING.HOLD_VALUE_TOLERANCE_BPM = valBpm;
      MAGIC_FINGER_TUNING.HOLD_VALUE_TOLERANCE_DYN = parseFloat((valBpm * (0.056 / 6.4)).toFixed(3));
      if (toleranceVal) {
        toleranceVal.textContent = `±${valBpm.toFixed(1)} BPM / ±${(valBpm * (0.056 / 6.4)).toFixed(3)} Dyn`;
      }
    });

    // Pause button in header
    const pauseBtn = container.querySelector<HTMLButtonElement>("#dbg-pause-btn");
    pauseBtn?.addEventListener("click", () => {
      this.callbacks.onTogglePause?.();
    });

    // Rerun Tutorial / Warm Up button in header
    const rerunBtn = container.querySelector<HTMLButtonElement>("#dbg-rerun-tutorial-btn");
    rerunBtn?.addEventListener("click", () => {
      this.callbacks.onRerunTutorial?.();
    });

    // Macro Dynamics Smoothing Slider
    const macroSlider = container.querySelector<HTMLInputElement>("#dbg-macro-slider");
    macroSlider?.addEventListener("input", () => {
      const ratio = parseFloat(macroSlider.value);
      this.updateMacroLabel(ratio);
      this.callbacks.onMacroRatioChange?.(ratio);
    });

    // Autoplay in tempo button
    const autoplayBtn = container.querySelector<HTMLButtonElement>("#dbg-mode-autoplay-btn");
    autoplayBtn?.addEventListener("click", () => {
      this.callbacks.onAutoplayInTempo?.();
    });

    // Tempo mode buttons in debug overlay
    const modeButtons = container.querySelectorAll<HTMLButtonElement>(".dbg-tempo-mode-btn");
    modeButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode as "balanced" | "instant" | "autoplay" | "inertial" | "gestural";
        if (mode) {
          if (mode === "autoplay") {
            this.callbacks.onAutoplayInTempo?.();
          } else {
            this.callbacks.onTempoModeChange?.(mode);
          }
        }
      });
    });

    // Jitter Deadband Slider
    const deadbandSlider = container.querySelector<HTMLInputElement>("#dbg-deadband-slider");
    deadbandSlider?.addEventListener("input", () => {
      const ratio = parseFloat(deadbandSlider.value);
      this.callbacks.onTempoDeadbandChange?.(ratio);
    });
  }

  updateMacroLabel(ratio: number): void {
    const el = this.elements["macro-ratio-val"];
    if (el) {
      const desc =
        ratio === 0
          ? "0.00 (Flat Authority)"
          : ratio <= 0.25
            ? `${ratio.toFixed(2)} (Heavy Smooth)`
            : ratio <= 0.50
              ? `${ratio.toFixed(2)} (Moderate Balanced)`
              : ratio <= 0.80
                ? `${ratio.toFixed(2)} (Light Smooth)`
                : `${ratio.toFixed(2)} (Raw Score MIDI)`;
      el.textContent = desc;
    }
  }

  updateDeadbandLabel(ratio: number, periodMs: number): void {
    const el = this.elements["jitter-deadband-val"];
    if (el) {
      const msAtPeriod = (periodMs * ratio).toFixed(0);
      const desc =
        ratio === 0
          ? "0.0% (Raw Tracking — No Deadband)"
          : ratio <= 0.035
            ? `${(ratio * 100).toFixed(1)}% (±${msAtPeriod}ms — Light Filter)`
            : ratio <= 0.075
              ? `${(ratio * 100).toFixed(1)}% (±${msAtPeriod}ms — Balanced Steady)`
              : `${(ratio * 100).toFixed(1)}% (±${msAtPeriod}ms — Heavy Stability)`;
      el.textContent = desc;
    }
  }

  updatePauseButton(isPaused: boolean): void {
    const el = this.elements["pause-btn"];
    if (el) {
      el.textContent = isPaused ? "▶ Resume Playback" : "⏸ Pause Orchestra";
      el.style.background = isPaused ? "#ffd56b" : "rgba(255, 213, 107, 0.15)";
      el.style.color = isPaused ? "#0c1018" : "#ffd56b";
    }
  }

  updateTempoMode(mode: TempoMode): void {
    const modeButtons = this.container?.querySelectorAll<HTMLButtonElement>(".dbg-tempo-mode-btn");
    modeButtons?.forEach(btn => {
      const isMatch = btn.dataset.mode === mode;
      btn.style.background = isMatch ? "rgba(255, 213, 107, 0.25)" : "rgba(255, 255, 255, 0.05)";
      btn.style.borderColor = isMatch ? "#ffd56b" : "rgba(255, 255, 255, 0.15)";
      btn.style.color = isMatch ? "#ffd56b" : "#d0f0d0";
      btn.style.fontWeight = isMatch ? "700" : "400";
    });
  }

  updateDynamics(dynamics: DynamicsTelemetry): void {
    if (!this.container) return;
    const checkboxes = this.container.querySelectorAll<HTMLInputElement>("input[data-dsp-flag]");
    checkboxes.forEach((cb) => {
      const flag = cb.dataset.dspFlag as keyof DSPBypassFlags;
      if (flag && flag in dynamics.bypassFlags) {
        cb.checked = dynamics.bypassFlags[flag];
      }
    });

    const slider = this.container.querySelector<HTMLInputElement>("#dbg-macro-slider");
    if (slider && Math.abs(parseFloat(slider.value) - dynamics.macroRatio) > 0.01) {
      slider.value = String(dynamics.macroRatio);
      this.updateMacroLabel(dynamics.macroRatio);
    }
  }

  setScoreVisualizerCheckbox(enabled: boolean): void {
    if (!this.container) return;
    const cb = this.container.querySelector<HTMLInputElement>("#dbg-score-visualizer-cb");
    if (cb) cb.checked = enabled;
    if (this.elements["score-flag"]) {
      this.elements["score-flag"].textContent = enabled ? "Enabled (ON)" : "Disabled (OFF)";
      this.elements["score-flag"].style.color = enabled ? "#ffd56b" : "#888888";
    }
  }

  setOnRerunTutorial(callback: () => void): void {
    this.callbacks.onRerunTutorial = callback;
  }
}
