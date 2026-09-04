/**
 * AudioEngine.ts
 *
 * Wraps the Web Audio API. All audio events in Conductor are scheduled
 * against AudioContext.currentTime — never fired from keyboard events,
 * setTimeout callbacks, or animation frames.
 *
 * Hybrid Dynamic Modeling Architecture:
 *   - Proportional velocity scaling preserves phrasing & contrast across dynamic tiers.
 *   - Real-time Native Biquad Filters (LPF + High-Shelf) modulate timbre on audio thread.
 *   - Dynamic Impulse Response Reverb scales hall acoustics from intimate dry (pp) to blooming (ff).
 *   - Master Transparent Peak Limiter prevents clipping without squashing dynamics.
 *   - A/B Debug Bypass controls for isolating individual DSP components.
 */

import { programToWebAudioFontVar, WEBAUDIOFONT_SCRIPTS } from "./instruments";
import {
  DYNAMIC_PRESETS,
  DYNAMIC_ORDER,
  DEFAULT_DSP_BYPASS_FLAGS,
  DEFAULT_SCORE_MACRO_RATIO,
  scaleVelocity,
} from "./dynamicsTypes";
import type {
  DynamicLevel,
  DSPBypassFlags,
  DynamicsTelemetry,
  VelocityDecomposition,
} from "./dynamicsTypes";
import type { PieceSection } from "../score/repertoire";

// ─── Tuning constants ───────────────────────────────────────────────────────

/**
 * Duration of the Phase 0 click tone in seconds.
 * Short enough to feel like a click, long enough to be audible.
 */
const CLICK_DURATION_SEC = 0.025;

/** Frequency of the Phase 0 click tone. A = 880 Hz (high A, clearly audible). */
const CLICK_FREQ_HZ = 880;

/** Amplitude of the click. 0.5 leaves headroom for samples later. */
const CLICK_AMPLITUDE = 0.5;

/**
 * Time constant for the click envelope release (seconds).
 * Controls the "pluck" feel of the click tone.
 */
const CLICK_RELEASE_SEC = 0.015;

// ─── WebAudioFont types ─────────────────────────────────────────────────────

declare global {
  interface Window {
    WebAudioFontPlayer: new () => WebAudioFontPlayerInstance;
    [key: string]: unknown; // for instrument bank variables
  }
}

interface WebAudioFontEnvelope {
  cancel: () => void;
  audioBufferSourceNode?: AudioBufferSourceNode | null;
  disconnect?: () => void;
  when?: number;
  duration?: number;
  target?: AudioNode;
}

interface WebAudioFontPlayerInstance {
  loader: {
    decodeAfterLoading: (ctx: AudioContext, varName: string) => void;
  };
  queueWaveTable: (
    ctx: AudioContext,
    target: AudioNode,
    preset: unknown,
    when: number,
    pitch: number,
    duration: number,
    volume?: number
  ) => WebAudioFontEnvelope;
  cancelQueue?: (ctx: AudioContext) => void;
  envelopes?: WebAudioFontEnvelope[];
}

// ─── Active Voice & Spatial Channel Buses ──────────────────────────────────

interface ActiveVoice {
  noteId: string;
  midiNote: number;
  channel: number;
  gainNode: GainNode;
  envelope: WebAudioFontEnvelope;
  targetVolume: number;
}

export interface ChannelBus {
  channel: number;
  inputGain: GainNode;
  panner: StereoPannerNode | null;
  presenceFilter: BiquadFilterNode | null;
  defaultPan: number;
  currentPan: number;
  currentFocusGain: number;
  currentPresenceGain: number;
}

export interface AudioDiagnostics {
  totalVoicesCreated: number;
  activeVoicesCount: number;
  totalVoicesCancelled: number;
  pendingCleanupCount: number;
  channelBusCount: number;
  automationRequestsPerSec: number;
  fontEnvelopesCount: number;
}

/**
 * Safely cancels scheduled parameter changes on an AudioParam starting at `time`.
 * Uses native `cancelAndHoldAtTime` if supported, otherwise safely falls back to
 * `cancelScheduledValues` and pinning `setValueAtTime(param.value, time)`.
 */
export function safeCancelAutomation(param: AudioParam, time: number): void {
  try {
    if (typeof (param as unknown as { cancelAndHoldAtTime?: (t: number) => void }).cancelAndHoldAtTime === "function") {
      (param as unknown as { cancelAndHoldAtTime: (t: number) => void }).cancelAndHoldAtTime(time);
      return;
    }
  } catch {
    // If cancelAndHoldAtTime threw, fall through to cancelScheduledValues
  }

  try {
    const val = param.value;
    param.cancelScheduledValues(time);
    param.setValueAtTime(val, time);
  } catch {
    // Ignore audio scheduling errors
  }
}

/**
 * Generates an ultra-smooth half-cosine S-curve Float32Array from `from` down to `to`.
 * Zero derivative at peak and zero derivative at tail ensures organic acoustic decay.
 */
function makeCosineDecayCurve(from: number, to: number, steps: number = 32): Float32Array {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1); // 0.0 -> 1.0
    // Half-cosine S-curve: (1 + cos(π * t)) / 2
    const factor = (1 + Math.cos(Math.PI * t)) / 2;
    curve[i] = to + (from - to) * factor;
  }
  return curve;
}

// ─── AudioEngine ────────────────────────────────────────────────────────────

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private player: WebAudioFontPlayerInstance | null = null;
  private activeVoices: Map<string, ActiveVoice> = new Map();
  private samplesLoaded: boolean = false;

  // Master bus & Concert Hall acoustics
  private masterGain: GainNode | null = null;
  private lowPassFilter: BiquadFilterNode | null = null;
  private highShelfFilter: BiquadFilterNode | null = null;
  private reverbConvolver: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private masterVolume: number = 0.60;

  // Spatial Stereo Buses & Seating Arrangement
  private channelBuses: Map<number, ChannelBus> = new Map();
  private channelDefaultPans: Map<number, number> = new Map();

  // Dynamics & DSP State
  private dynamicLevel: DynamicLevel = "mf";
  private continuousDynamic: number = 0.5; // 0=pp, 1=fff
  private dspBypassFlags: DSPBypassFlags = { ...DEFAULT_DSP_BYPASS_FLAGS };
  private scoreMacroRatio: number = DEFAULT_SCORE_MACRO_RATIO;
  private isLoveMode: boolean = false;

  // Automation deduplication cache
  private lastAppliedFilterCutoff: number = -1;
  private lastAppliedShelfGain: number = -999;
  private lastAppliedReverbWet: number = -1;

  // Section Focus Mode State
  private focusedChannels: Set<number> | null = null;
  private focusAmount: number = 0.0;
  private lastFocusedChannelsKey: string = "";
  private lastAppliedFocusAmount: number = -1;

  // Voice lifecycle & diagnostics
  private totalVoicesCreated: number = 0;
  private totalVoicesCancelled: number = 0;
  private pendingCleanupCount: number = 0;
  private pendingCleanupTimers: Set<ReturnType<typeof setTimeout>> = new Set();
  private automationRequestTimestamps: number[] = [];
  private loadedScriptUrls: Set<string> = new Set();
  private pendingScriptLoads: Map<string, Promise<void>> = new Map();

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Must be called from a user gesture (e.g. first Space tap).
   * Creates and resumes the AudioContext with Concert Hall acoustics.
   */
  async resume(): Promise<void> {
    const isNew = !this.ctx;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.setupMasterAcoustics();
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    // Decode all loaded instrument soundfonts immediately into the newly created context
    if (isNew && this.samplesLoaded) {
      this.decodeLoadedSamples();
    }
  }

  setMasterVolume(vol: number): void {
    this.masterVolume = Math.max(0.0, Math.min(1.25, vol));
    if (this.masterGain && this.ctx) {
      safeCancelAutomation(this.masterGain.gain, this.ctx.currentTime);
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
    }
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  // ── Diagnostics & Telemetry ──────────────────────────────────────────────

  private recordAutomationRequest(): void {
    const now = performance.now();
    this.automationRequestTimestamps.push(now);
    while (
      this.automationRequestTimestamps.length > 0 &&
      now - this.automationRequestTimestamps[0] > 1000
    ) {
      this.automationRequestTimestamps.shift();
    }
  }

  getAudioDiagnostics(): AudioDiagnostics {
    const now = performance.now();
    while (
      this.automationRequestTimestamps.length > 0 &&
      now - this.automationRequestTimestamps[0] > 1000
    ) {
      this.automationRequestTimestamps.shift();
    }
    return {
      totalVoicesCreated: this.totalVoicesCreated,
      activeVoicesCount: this.activeVoices.size,
      totalVoicesCancelled: this.totalVoicesCancelled,
      pendingCleanupCount: this.pendingCleanupCount,
      channelBusCount: this.channelBuses.size,
      automationRequestsPerSec: this.automationRequestTimestamps.length,
      fontEnvelopesCount: (this.player && Array.isArray((this.player as any).envelopes))
        ? (this.player as any).envelopes.length
        : 0,
    };
  }

  // ── Dynamics & DSP Control ──────────────────────────────────────────────

  setDynamicLevel(level: DynamicLevel): void {
    this.dynamicLevel = level;
    // Snap continuousDynamic to this level's position on the 0–1 scale
    const idx = DYNAMIC_ORDER.indexOf(level);
    this.continuousDynamic = idx >= 0 ? idx / (DYNAMIC_ORDER.length - 1) : 0.5;
    this.applyDynamicPreset();
  }

  getDynamicLevel(): DynamicLevel {
    return this.dynamicLevel;
  }

  /**
   * Apply continuous dynamics from a 0–1 value (0=pp, 1=fff).
   * Interpolates all DSP parameters smoothly between the 7 preset breakpoints.
   * Updates the displayed discrete level for UI display without hard-snapping DSP.
   */
  setContinuousDynamic(value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    const idx = Math.round(clamped * (DYNAMIC_ORDER.length - 1));
    const nextLevel = DYNAMIC_ORDER[idx];

    // Deduplicate: skip if value has not meaningfully changed and discrete level is identical
    if (
      Math.abs(clamped - this.continuousDynamic) < 0.003 &&
      nextLevel === this.dynamicLevel
    ) {
      return;
    }

    this.continuousDynamic = clamped;
    this.dynamicLevel = nextLevel;
    this.applyContinuousPreset(this.continuousDynamic);
  }

  getContinuousDynamic(): number {
    return this.continuousDynamic;
  }

  setDSPBypassFlags(flags: Partial<DSPBypassFlags>): void {
    const prevLimiter = this.dspBypassFlags.safetyLimiter;
    this.dspBypassFlags = { ...this.dspBypassFlags, ...flags };
    if (flags.safetyLimiter !== undefined && flags.safetyLimiter !== prevLimiter) {
      this.updateLimiterParams();
    }
    this.applyDynamicPreset();
  }

  getDSPBypassFlags(): DSPBypassFlags {
    return { ...this.dspBypassFlags };
  }

  setScoreMacroRatio(ratio: number): void {
    this.scoreMacroRatio = Math.max(0, Math.min(1, ratio));
  }

  getScoreMacroRatio(): number {
    return this.scoreMacroRatio;
  }

  // ── Musical Accent Burst (Sforzando / Reverb Bloom) ─────────────────────

  private accentStartTime: number = 0;
  private accentDurationSec: number = 0;

  triggerAccentBurst(periodMs: number = 500): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const burstDurationSec = Math.max(0.35, Math.min(0.50, (periodMs / 1000) * 0.85));
    this.accentStartTime = now;
    this.accentDurationSec = burstDurationSec;

    const preset = DYNAMIC_PRESETS[this.dynamicLevel] || DYNAMIC_PRESETS.mf;

    // 1. Instantly open master filter & boost high-frequency transient bite, then smooth cosine decay
    if (this.lowPassFilter) {
      const targetCutoff = this.dspBypassFlags.timbreFilter ? preset.filterCutoffHz : 20000;
      safeCancelAutomation(this.lowPassFilter.frequency, now);
      this.lowPassFilter.frequency.setValueAtTime(20000, now);
      const lpfCurve = makeCosineDecayCurve(20000, targetCutoff, 32);
      try {
        this.lowPassFilter.frequency.setValueCurveAtTime(lpfCurve, now + 0.003, burstDurationSec);
      } catch {
        this.lowPassFilter.frequency.setTargetAtTime(targetCutoff, now + 0.003, burstDurationSec * 0.4);
      }
    }
    if (this.highShelfFilter) {
      const targetGain = this.dspBypassFlags.timbreFilter ? preset.highShelfGainDb : 0.0;
      safeCancelAutomation(this.highShelfFilter.gain, now);
      this.highShelfFilter.gain.setValueAtTime(4.0, now);
      const shelfCurve = makeCosineDecayCurve(4.0, targetGain, 32);
      try {
        this.highShelfFilter.gain.setValueCurveAtTime(shelfCurve, now + 0.003, burstDurationSec);
      } catch {
        this.highShelfFilter.gain.setTargetAtTime(targetGain, now + 0.003, burstDurationSec * 0.4);
      }
    }

    // 2. Instantly surge all currently active/playing voices, then smoothly cosine-decay away over 350-450ms
    for (const voice of this.activeVoices.values()) {
      try {
        const currentGain = voice.gainNode.gain.value || voice.targetVolume;
        const boostedGain = Math.min(1.0, currentGain * 1.60);
        safeCancelAutomation(voice.gainNode.gain, now);
        voice.gainNode.gain.setValueAtTime(currentGain, now);
        voice.gainNode.gain.linearRampToValueAtTime(boostedGain, now + 0.003);
        const voiceCurve = makeCosineDecayCurve(boostedGain, voice.targetVolume, 32);
        try {
          voice.gainNode.gain.setValueCurveAtTime(voiceCurve, now + 0.003, burstDurationSec);
        } catch {
          voice.gainNode.gain.setTargetAtTime(voice.targetVolume, now + 0.003, burstDurationSec * 0.4);
        }
      } catch {
        // Ignore
      }
    }
  }

  getAccentFactor(audioTime: number): number {
    if (this.accentDurationSec <= 0) return 0;
    const delta = audioTime - this.accentStartTime;
    if (delta < 0 || delta > this.accentDurationSec) return 0;
    const t = delta / this.accentDurationSec; // 0 to 1
    return (1 + Math.cos(Math.PI * t)) / 2; // Smooth sine/cosine S-curve factor 1.0 -> 0.0
  }

  isAccentActive(): boolean {
    if (!this.ctx) return false;
    return this.getAccentFactor(this.ctx.currentTime) > 0.05;
  }

  computeEffectiveVelocity(rawVelocity: number): number {
    if (!this.dspBypassFlags.velocityScaling || rawVelocity <= 0) return rawVelocity;
    const factor = this.ctx ? this.getAccentFactor(this.ctx.currentTime) : 0;
    const accentFactor = typeof factor === "number" ? Math.max(0, Math.min(1, factor)) : 0;

    // Compress score macro dynamics
    const baseVelocity = this.dspBypassFlags.scoreCompression
      ? 72 + (rawVelocity - 72) * this.scoreMacroRatio
      : rawVelocity;

    // Apply continuously interpolated velocity multiplier
    const velMult = this.getContinuousVelocityMultiplier();
    let scaled = Math.round(baseVelocity * velMult);

    // Accent transient punch
    if (accentFactor > 0) {
      scaled = Math.round(scaled * (1 + 0.35 * accentFactor) + 30 * accentFactor);
    }
    return Math.max(10, Math.min(127, scaled));
  }

  decomposeNoteVelocity(rawVelocity: number): VelocityDecomposition {
    const factor = this.ctx ? this.getAccentFactor(this.ctx.currentTime) : 0;
    // Use snap-level for decompose telemetry display; continuous multiplier for actual output
    const velMult = this.getContinuousVelocityMultiplier();
    const baseVelocity = this.dspBypassFlags.scoreCompression
      ? 72 + (rawVelocity - 72) * this.scoreMacroRatio
      : rawVelocity;
    const accentFactor = typeof factor === "number" ? Math.max(0, Math.min(1, factor)) : 0;
    let final = Math.round(baseVelocity * velMult);
    if (accentFactor > 0) {
      final = Math.round(final * (1 + 0.35 * accentFactor) + 30 * accentFactor);
    }
    final = Math.max(10, Math.min(127, final));
    return {
      raw: rawVelocity,
      macro: Math.round(baseVelocity),
      macroDelta: Math.round(baseVelocity) - rawVelocity,
      macroRatio: this.scoreMacroRatio,
      dynMultiplier: velMult,
      dynamicLevel: this.dynamicLevel,
      final,
      macroEnabled: this.dspBypassFlags.scoreCompression,
      velScalingEnabled: this.dspBypassFlags.velocityScaling,
      isAccented: accentFactor > 0.05,
    };
  }

  getDynamicsTelemetry(): DynamicsTelemetry {
    // Interpolate displayed telemetry values from continuous position
    const N = DYNAMIC_ORDER.length - 1;
    const scaled = this.continuousDynamic * N;
    const lo = Math.max(0, Math.floor(scaled));
    const hi = Math.min(N, lo + 1);
    const t = scaled - lo;
    const pLo = DYNAMIC_PRESETS[DYNAMIC_ORDER[lo]];
    const pHi = DYNAMIC_PRESETS[DYNAMIC_ORDER[hi]];
    const lerp = (a: number, b: number) => a + (b - a) * t;

    return {
      level: this.dynamicLevel,
      velocityMultiplier: this.dspBypassFlags.velocityScaling ? lerp(pLo.velocityMultiplier, pHi.velocityMultiplier) : 1.0,
      filterCutoffHz: this.dspBypassFlags.timbreFilter ? lerp(pLo.filterCutoffHz, pHi.filterCutoffHz) : 20000,
      highShelfGainDb: this.dspBypassFlags.timbreFilter ? lerp(pLo.highShelfGainDb, pHi.highShelfGainDb) : 0.0,
      reverbWet: this.dspBypassFlags.reverbScaling ? lerp(pLo.reverbWet, pHi.reverbWet) : 0.0,
      attackTimeSec: this.dspBypassFlags.attackEnvelope ? lerp(pLo.attackTimeSec, pHi.attackTimeSec) : 0.006,
      macroRatio: this.scoreMacroRatio,
      bypassFlags: { ...this.dspBypassFlags },
    };
  }

  /** Returns the interpolated velocity multiplier for the current continuous dynamic value. */
  private getContinuousVelocityMultiplier(): number {
    const N = DYNAMIC_ORDER.length - 1;
    const scaled = this.continuousDynamic * N;
    const lo = Math.max(0, Math.floor(scaled));
    const hi = Math.min(N, lo + 1);
    const t = scaled - lo;
    return DYNAMIC_PRESETS[DYNAMIC_ORDER[lo]].velocityMultiplier * (1 - t)
         + DYNAMIC_PRESETS[DYNAMIC_ORDER[hi]].velocityMultiplier * t;
  }

  private applyDynamicPreset(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const timeConstant = 0.040; // 40ms smooth acoustic transition
    const preset = DYNAMIC_PRESETS[this.dynamicLevel] || DYNAMIC_PRESETS.mf;

    // 1. Timbre filters (Low-Pass Filter + High-Shelf Harmonics)
    if (this.lowPassFilter) {
      const targetCutoff = this.dspBypassFlags.timbreFilter ? preset.filterCutoffHz : 20000;
      if (Math.abs(this.lastAppliedFilterCutoff - targetCutoff) > 5) {
        safeCancelAutomation(this.lowPassFilter.frequency, now);
        this.lowPassFilter.frequency.setTargetAtTime(targetCutoff, now, timeConstant);
        this.lastAppliedFilterCutoff = targetCutoff;
        this.recordAutomationRequest();
      }
    }
    if (this.highShelfFilter) {
      const targetGain = this.dspBypassFlags.timbreFilter ? preset.highShelfGainDb : 0.0;
      if (Math.abs(this.lastAppliedShelfGain - targetGain) > 0.05) {
        safeCancelAutomation(this.highShelfFilter.gain, now);
        this.highShelfFilter.gain.setTargetAtTime(targetGain, now, timeConstant);
        this.lastAppliedShelfGain = targetGain;
        this.recordAutomationRequest();
      }
    }

    // 2. Reverb wet gain (0.0 when bypassed, max 0.75 in Love Mode)
    if (this.reverbGain) {
      const targetReverb = this.isLoveMode
        ? 0.75
        : (this.dspBypassFlags.reverbScaling ? preset.reverbWet : 0.0);
      if (Math.abs(this.lastAppliedReverbWet - targetReverb) > 0.005) {
        safeCancelAutomation(this.reverbGain.gain, now);
        this.reverbGain.gain.setTargetAtTime(targetReverb, now, timeConstant);
        this.lastAppliedReverbWet = targetReverb;
        this.recordAutomationRequest();
      }
    }
  }

  /**
   * Interpolates all DSP parameters continuously between the 7 preset breakpoints.
   * `value` is [0, 1]: 0 = pp, 1/6 = p, 2/6 = mp, 3/6 = mf, 4/6 = f, 5/6 = ff, 1 = fff.
   */
  private applyContinuousPreset(value: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const timeConstant = 0.055; // ~55ms smooth for continuous hand control

    const N = DYNAMIC_ORDER.length - 1; // 6 segments
    const scaled = value * N;
    const lo = Math.max(0, Math.floor(scaled));
    const hi = Math.min(N, lo + 1);
    const t = scaled - lo; // fractional position within segment [0, 1]

    const presetLo = DYNAMIC_PRESETS[DYNAMIC_ORDER[lo]];
    const presetHi = DYNAMIC_PRESETS[DYNAMIC_ORDER[hi]];

    // Linearly interpolate each DSP parameter
    const lerp = (a: number, b: number) => a + (b - a) * t;
    const filterCutoff = lerp(presetLo.filterCutoffHz, presetHi.filterCutoffHz);
    const shelfGain    = lerp(presetLo.highShelfGainDb, presetHi.highShelfGainDb);
    const reverbWet    = lerp(presetLo.reverbWet, presetHi.reverbWet);

    if (this.lowPassFilter) {
      const target = this.dspBypassFlags.timbreFilter ? filterCutoff : 20000;
      if (Math.abs(this.lastAppliedFilterCutoff - target) > 5) {
        safeCancelAutomation(this.lowPassFilter.frequency, now);
        this.lowPassFilter.frequency.setTargetAtTime(target, now, timeConstant);
        this.lastAppliedFilterCutoff = target;
        this.recordAutomationRequest();
      }
    }
    if (this.highShelfFilter) {
      const target = this.dspBypassFlags.timbreFilter ? shelfGain : 0.0;
      if (Math.abs(this.lastAppliedShelfGain - target) > 0.05) {
        safeCancelAutomation(this.highShelfFilter.gain, now);
        this.highShelfFilter.gain.setTargetAtTime(target, now, timeConstant);
        this.lastAppliedShelfGain = target;
        this.recordAutomationRequest();
      }
    }
    if (this.reverbGain) {
      const target = this.isLoveMode
        ? 0.75
        : (this.dspBypassFlags.reverbScaling ? reverbWet : 0.0);
      if (Math.abs(this.lastAppliedReverbWet - target) > 0.005) {
        safeCancelAutomation(this.reverbGain.gain, now);
        this.reverbGain.gain.setTargetAtTime(target, now, timeConstant);
        this.lastAppliedReverbWet = target;
        this.recordAutomationRequest();
      }
    }
  }

  private updateLimiterParams(): void {
    if (!this.ctx || !this.limiter) return;
    const now = this.ctx.currentTime;
    this.recordAutomationRequest();
    if (this.dspBypassFlags.safetyLimiter) {
      safeCancelAutomation(this.limiter.threshold, now);
      safeCancelAutomation(this.limiter.ratio, now);
      this.limiter.threshold.setTargetAtTime(-1.0, now, 0.01);
      this.limiter.ratio.setTargetAtTime(20.0, now, 0.01);
    } else {
      safeCancelAutomation(this.limiter.threshold, now);
      safeCancelAutomation(this.limiter.ratio, now);
      this.limiter.threshold.setTargetAtTime(0.0, now, 0.01);
      this.limiter.ratio.setTargetAtTime(1.0, now, 0.01);
    }
  }

  /**
   * Sets or clears Love Mode (🤟 gesture): max lush reverb (0.75) for intimate acoustic dream.
   */
  setLoveMode(active: boolean): void {
    this.isLoveMode = active;
    if (!this.ctx || !this.reverbGain) return;
    const now = this.ctx.currentTime;
    this.recordAutomationRequest();
    if (active) {
      safeCancelAutomation(this.reverbGain.gain, now);
      this.reverbGain.gain.setTargetAtTime(0.75, now, 0.06);
      this.lastAppliedReverbWet = 0.75;
    } else {
      const preset = DYNAMIC_PRESETS[this.dynamicLevel] || DYNAMIC_PRESETS.mf;
      const target = this.dspBypassFlags.reverbScaling ? preset.reverbWet : 0.0;
      safeCancelAutomation(this.reverbGain.gain, now);
      this.reverbGain.gain.setTargetAtTime(target, now, 0.12);
      this.lastAppliedReverbWet = target;
    }
  }

  isLoveModeActive(): boolean {
    return this.isLoveMode;
  }

  /**
   * Configures natural stereo seating pan positions for each section across the stage.
   * Section 0 (leftmost) is panned left (-0.68), moving across to the rightmost section (+0.68).
   */
  setDefaultSectionPanning(sections: PieceSection[]): void {
    const count = sections.length;
    if (count === 0) return;

    sections.forEach((sec, idx) => {
      let pan = 0.0;
      if (count === 1) {
        pan = 0.0;
      } else {
        pan = -0.68 + (idx / (count - 1)) * 1.36;
      }
      pan = Math.round(pan * 100) / 100;

      for (const ch of sec.channels) {
        this.channelDefaultPans.set(ch, pan);
        const bus = this.channelBuses.get(ch);
        if (bus) {
          bus.defaultPan = pan;
          bus.currentPan = pan;
          if (bus.panner && this.ctx) {
            safeCancelAutomation(bus.panner.pan, this.ctx.currentTime);
            bus.panner.pan.setTargetAtTime(pan, this.ctx.currentTime, 0.08);
          }
        }
      }
    });
  }

  getChannelPan(channel: number): number {
    const bus = this.channelBuses.get(channel);
    return bus ? bus.currentPan : (this.channelDefaultPans.get(channel) ?? 0.0);
  }

  getOrCreateChannelBus(channel: number): ChannelBus | null {
    if (!this.ctx) return null;
    let bus = this.channelBuses.get(channel);
    if (!bus) {
      const ctx = this.ctx;
      const inputGain = ctx.createGain();
      const initialFocusGain = this.getChannelFocusMultiplier(channel);
      inputGain.gain.setValueAtTime(initialFocusGain, ctx.currentTime);

      let panner: StereoPannerNode | null = null;
      const defaultPan = this.channelDefaultPans.get(channel) ?? 0.0;
      if (typeof ctx.createStereoPanner === "function") {
        panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(defaultPan, ctx.currentTime);
      }

      let presenceFilter: BiquadFilterNode | null = null;
      if (typeof ctx.createBiquadFilter === "function") {
        presenceFilter = ctx.createBiquadFilter();
        presenceFilter.type = "highshelf";
        presenceFilter.frequency.value = 3800;
        presenceFilter.gain.value = 0.0;
      }

      // Chain: inputGain -> presenceFilter -> panner -> masterGain
      if (presenceFilter && panner) {
        inputGain.connect(presenceFilter);
        presenceFilter.connect(panner);
        panner.connect(this.masterGain || ctx.destination);
      } else if (panner) {
        inputGain.connect(panner);
        panner.connect(this.masterGain || ctx.destination);
      } else {
        inputGain.connect(this.masterGain || ctx.destination);
      }

      bus = {
        channel,
        inputGain,
        panner,
        presenceFilter,
        defaultPan,
        currentPan: defaultPan,
        currentFocusGain: initialFocusGain,
        currentPresenceGain: 0.0,
      };
      this.channelBuses.set(channel, bus);
    }
    return bus;
  }

  /**
   * Sets continuous section focus / spotlight.
   * When focusAmount > 0 and focusedChannels is provided:
   * - Spotlighted section: Volume boosted to forte tier (~1.35x, +2.6dB),
   *   stereo pan pulls smoothly to center stage (0.0), and presence opens up (+2.5dB).
   * - Other sections: Backgrounded to piano tier (~0.72x, -2.8dB),
   *   stereo pan disperses outward to the stereo sides (up to ±0.85), and presence softens.
   * - Applied entirely via persistent per-channel bus gains and filters (O(channels), NOT O(active voices)).
   */
  setSectionFocus(focusedChannels: number[] | null, focusAmount: number): void {
    const clamped = Math.max(0.0, Math.min(1.0, focusAmount));
    const hasFocus = focusedChannels && focusedChannels.length > 0 && clamped > 0.001;
    const effectiveChannels = hasFocus ? new Set(focusedChannels) : null;
    const effectiveAmount = hasFocus ? clamped : 0.0;
    const channelsKey = effectiveChannels ? Array.from(effectiveChannels).sort((a, b) => a - b).join(",") : "";

    // Deduplicate: If focused channels and focus amount have not materially changed, return immediately
    if (
      this.lastFocusedChannelsKey === channelsKey &&
      Math.abs(this.lastAppliedFocusAmount - effectiveAmount) < 0.005
    ) {
      return;
    }

    this.focusedChannels = effectiveChannels;
    this.focusAmount = effectiveAmount;
    this.lastFocusedChannelsKey = channelsKey;
    this.lastAppliedFocusAmount = effectiveAmount;

    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.recordAutomationRequest();

    // Move focus-volume control entirely onto persistent per-channel bus gain
    for (const [ch, bus] of this.channelBuses.entries()) {
      const targetFocusGain = this.getChannelFocusMultiplier(ch);
      if (Math.abs(bus.currentFocusGain - targetFocusGain) > 0.005) {
        safeCancelAutomation(bus.inputGain.gain, now);
        bus.inputGain.gain.setTargetAtTime(targetFocusGain, now, 0.04);
        bus.currentFocusGain = targetFocusGain;
      }

      // Keep stereo pan anchored to its natural seating position (no center pull or side dispersion)
      if (bus.panner && Math.abs(bus.currentPan - bus.defaultPan) > 0.005) {
        safeCancelAutomation(bus.panner.pan, now);
        bus.panner.pan.setTargetAtTime(bus.defaultPan, now, 0.06);
        bus.currentPan = bus.defaultPan;
      }

      // Presence filter enhancement for spotlighted section
      if (this.focusedChannels && this.focusAmount > 0.001) {
        if (this.focusedChannels.has(ch)) {
          const targetPres = 2.5 * this.focusAmount;
          if (bus.presenceFilter && Math.abs(bus.currentPresenceGain - targetPres) > 0.05) {
            safeCancelAutomation(bus.presenceFilter.gain, now);
            bus.presenceFilter.gain.setTargetAtTime(targetPres, now, 0.06);
            bus.currentPresenceGain = targetPres;
          }
        } else {
          const targetPres = -1.0 * this.focusAmount;
          if (bus.presenceFilter && Math.abs(bus.currentPresenceGain - targetPres) > 0.05) {
            safeCancelAutomation(bus.presenceFilter.gain, now);
            bus.presenceFilter.gain.setTargetAtTime(targetPres, now, 0.06);
            bus.currentPresenceGain = targetPres;
          }
        }
      } else {
        if (bus.presenceFilter && Math.abs(bus.currentPresenceGain - 0.0) > 0.05) {
          safeCancelAutomation(bus.presenceFilter.gain, now);
          bus.presenceFilter.gain.setTargetAtTime(0.0, now, 0.10);
          bus.currentPresenceGain = 0.0;
        }
      }
    }
  }

  getChannelFocusMultiplier(channel: number): number {
    if (!this.focusedChannels || this.focusAmount <= 0.001) return 1.0;
    if (this.focusedChannels.has(channel)) {
      // Forte foreground boost: 1.0 -> 1.35 (+2.6 dB)
      return 1.0 + 0.35 * this.focusAmount;
    } else {
      // Gentle background reduction (halved): 1.0 -> 0.72 (-2.8 dB)
      return 1.0 - 0.28 * this.focusAmount;
    }
  }

  getFocusedChannels(): Set<number> | null {
    return this.focusedChannels;
  }

  getFocusAmount(): number {
    return this.focusAmount;
  }

  private setupMasterAcoustics(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const preset = DYNAMIC_PRESETS[this.dynamicLevel] || DYNAMIC_PRESETS.mf;

    // Master output bus
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.masterVolume;

    // Dynamic Low-Pass Filter (removes harsh upper harmonics in soft dynamics, opens in forte)
    this.lowPassFilter = ctx.createBiquadFilter();
    this.lowPassFilter.type = "lowpass";
    this.lowPassFilter.frequency.value = this.dspBypassFlags.timbreFilter ? preset.filterCutoffHz : 20000;
    this.lowPassFilter.Q.value = 0.707;
    this.lastAppliedFilterCutoff = this.lowPassFilter.frequency.value;

    // Dynamic High-Shelf Filter (boosts piercing brass/string brilliance in ff/f, softens in p/pp)
    this.highShelfFilter = ctx.createBiquadFilter();
    this.highShelfFilter.type = "highshelf";
    this.highShelfFilter.frequency.value = 4500;
    this.highShelfFilter.gain.value = this.dspBypassFlags.timbreFilter ? preset.highShelfGainDb : 0.0;
    this.lastAppliedShelfGain = this.highShelfFilter.gain.value;

    // Master Safety Peak Limiter: Transparent soft limiter at -1.0 dBFS (no squash on natural dynamics)
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.knee.value = 3.0;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.05;
    this.updateLimiterParams();

    // Synthesize clean, warm concert hall stereo impulse response
    const rate = ctx.sampleRate;
    const duration = 1.2; // 1.2s crisp concert hall acoustic decay
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    let prevL = 0;
    let prevR = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const decay = Math.exp(-t / 0.28) * Math.max(0, 1 - t / duration);
      const rawL = (Math.random() * 2 - 1) * decay;
      const rawR = (Math.random() * 2 - 1) * decay;
      // High-frequency air absorption damping
      prevL = prevL * 0.35 + rawL * 0.65;
      prevR = prevR * 0.35 + rawR * 0.65;
      left[i] = prevL;
      right[i] = prevR;
    }

    this.reverbConvolver = ctx.createConvolver();
    this.reverbConvolver.normalize = true;
    this.reverbConvolver.buffer = impulse;

    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = this.dspBypassFlags.reverbScaling ? preset.reverbWet : 0.0;
    this.lastAppliedReverbWet = this.reverbGain.gain.value;

    // Routing:
    // masterGain -> lowPassFilter -> highShelfFilter -> limiter -> destination
    //                                      └-> reverbConvolver -> reverbGain -> limiter
    this.masterGain.connect(this.lowPassFilter);
    this.lowPassFilter.connect(this.highShelfFilter);

    this.highShelfFilter.connect(this.limiter);
    this.highShelfFilter.connect(this.reverbConvolver);
    this.reverbConvolver.connect(this.reverbGain);
    this.reverbGain.connect(this.limiter);

    this.limiter.connect(ctx.destination);
  }

  /**
   * Returns AudioContext.currentTime in seconds.
   * Suitable for injection into ConductorClock.
   * Returns 0 if the context hasn't been created yet.
   */
  getAudioTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /**
   * Load all WebAudioFont sample banks needed for Phase 1/2/3.
   * Downloads scripts and initializes the player.
   * Can be called during app initialization (does not require user gesture).
   */
  async loadSamples(): Promise<void> {
    if (this.samplesLoaded) return;

    // Load the WebAudioFontPlayer script if not already present
    await this.loadScript(
      "https://surikov.github.io/webaudiofont/npm/dist/WebAudioFontPlayer.js"
    );

    // Instantiate the player
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.player = new (window as any).WebAudioFontPlayer();

    // Load all instrument sample scripts in parallel
    await Promise.all(
      WEBAUDIOFONT_SCRIPTS.map(url => this.loadScript(url))
    );

    // If context is already created, decode sample buffers
    if (this.ctx && this.player) {
      this.decodeLoadedSamples();
    }

    this.samplesLoaded = true;
  }

  private decodeLoadedSamples(): void {
    if (!this.ctx || !this.player) return;
    for (const url of WEBAUDIOFONT_SCRIPTS) {
      const varName = this.urlToVarName(url);
      if (varName && (window as any)[varName]) {
        this.player.loader.decodeAfterLoading(this.ctx, varName);
      }
    }
  }

  // ── Phase 0: Click ──────────────────────────────────────────────────────

  /**
   * Schedule a short click tone at the given AudioContext time.
   * Uses a plain oscillator — no samples needed for Phase 0.
   *
   * @param audioTime AudioContext.currentTime in seconds.
   */
  scheduleClick(audioTime: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.frequency.value = CLICK_FREQ_HZ;
    osc.type = "sine";

    // Short attack + exponential release for a "click" feel
    gain.gain.setValueAtTime(0, audioTime);
    gain.gain.linearRampToValueAtTime(CLICK_AMPLITUDE, audioTime + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, audioTime + CLICK_DURATION_SEC);

    osc.connect(gain);
    gain.connect(this.masterGain || ctx.destination);

    osc.start(audioTime);
    osc.stop(audioTime + CLICK_DURATION_SEC + CLICK_RELEASE_SEC);
  }

  // ── Phase 1/2/3: Sampled notes & Dynamic voice control ────────────────────

  /**
   * Shared helper to schedule cleanup of an active voice node once its
   * audio-time fade has fully completed.
   */
  private cleanupVoiceAfter(
    voice: ActiveVoice,
    fadeEndTime: number,
    safetyMarginMs: number = 50
  ): void {
    const now = this.ctx ? this.ctx.currentTime : 0;
    const delayMs = Math.max(0, (fadeEndTime - now) * 1000) + safetyMarginMs;
    this.pendingCleanupCount++;

    const timer = setTimeout(() => {
      this.pendingCleanupCount = Math.max(0, this.pendingCleanupCount - 1);
      this.pendingCleanupTimers.delete(timer);
      try {
        if (voice.envelope) {
          try {
            voice.envelope.cancel();
          } catch {
            // Ignore
          }
          const src = (voice.envelope as any).audioBufferSourceNode;
          if (src) {
            try {
              src.stop(0);
              src.disconnect();
            } catch {
              // Ignore
            }
            (voice.envelope as any).audioBufferSourceNode = null;
          }
          try {
            voice.envelope.disconnect?.();
          } catch {
            // Ignore
          }
          // Prune envelope from WebAudioFont player queue to prevent unbounded memory growth
          if (this.player && Array.isArray((this.player as any).envelopes)) {
            const envelopes: any[] = (this.player as any).envelopes;
            const idx = envelopes.indexOf(voice.envelope);
            if (idx !== -1) {
              envelopes.splice(idx, 1);
            }
          }
        }
        voice.gainNode.disconnect();
        this.totalVoicesCancelled++;
      } catch {
        // Ignore if already disconnected
      }
    }, delayMs);

    this.pendingCleanupTimers.add(timer);
  }

  /**
   * Schedule a note-on event using the WebAudioFont sample bank.
   * Applies proportional velocity scaling, dynamic attack shaping, and voice management.
   *
   * @param noteId      Unique identifier for the note instance
   * @param midiNote    0–127
   * @param velocity    0–127
   * @param channel     MIDI channel 0–15
   * @param program     MIDI program 0–127
   * @param audioTime   When to start (AudioContext seconds)
   */
  scheduleNoteOn(
    noteId: string,
    midiNote: number,
    velocity: number,
    channel: number,
    program: number,
    audioTime: number
  ): void {
    if (!this.ctx || !this.player) {
      // Fallback: click if samples aren't ready yet
      this.scheduleClick(audioTime);
      return;
    }

    const varName = programToWebAudioFontVar(program, channel);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const preset = typeof window !== "undefined" ? (window as any)[varName] : (globalThis as any)[varName];
    if (!preset) {
      // Samples not yet decoded — fall back to a click so there is always audio feedback
      this.scheduleClick(audioTime);
      return;
    }

    const ctx = this.ctx;

    // Pitch Collision Truncation: If a previous voice on the same pitch is still ringing,
    // fade it out quickly (15ms) so the new note is crisp and doesn't pile up
    for (const [existingId, voice] of this.activeVoices.entries()) {
      if (voice.channel === channel && voice.midiNote === midiNote) {
        try {
          safeCancelAutomation(voice.gainNode.gain, audioTime);
          voice.gainNode.gain.setValueAtTime(voice.targetVolume, audioTime);
          voice.gainNode.gain.linearRampToValueAtTime(0.0001, audioTime + 0.015);
          if (voice.envelope && (voice.envelope as any).audioBufferSourceNode) {
            try {
              (voice.envelope as any).audioBufferSourceNode.stop(audioTime + 0.020);
            } catch {
              // Ignore
            }
          }
          this.cleanupVoiceAfter(voice, audioTime + 0.015, 50);
          this.activeVoices.delete(existingId);
        } catch {
          // Ignore
        }
      }
    }

    // Proportional velocity scaling + macro-dynamics compression + smooth cosine accent curve
    const accentFactor = this.getAccentFactor(audioTime);
    const effectiveVelocity = scaleVelocity(
      velocity,
      this.dynamicLevel,
      this.dspBypassFlags.velocityScaling,
      this.dspBypassFlags.scoreCompression,
      this.scoreMacroRatio,
      accentFactor
    );

    const rawVelRatio = Math.max(0.08, effectiveVelocity / 127);
    const baseVolume = Math.min(1.0, Math.pow(rawVelRatio, 1.15) * 1.05);
    // Note: Volume is baseVolume; focus multiplier is applied directly by ChannelBus.inputGain
    const volume = baseVolume;

    // Dynamic Attack Time: Bite on loud notes, gentle swell on quiet notes
    const dynamicPreset = DYNAMIC_PRESETS[this.dynamicLevel] || DYNAMIC_PRESETS.mf;
    const attackTime = this.dspBypassFlags.attackEnvelope
      ? dynamicPreset.attackTimeSec
      : 0.006;

    // Create dedicated GainNode for this voice connected to dedicated channel spatial sub-bus
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, audioTime);
    gainNode.gain.linearRampToValueAtTime(volume, audioTime + attackTime);
    const bus = this.getOrCreateChannelBus(channel);
    gainNode.connect(bus ? bus.inputGain : (this.masterGain || ctx.destination));

    // Queue note with open duration (managed by scheduleNoteOff)
    const envelope = this.player.queueWaveTable(
      ctx,
      gainNode,
      preset,
      audioTime,
      midiNote,
      999,
      1.0
    );

    this.activeVoices.set(noteId, {
      noteId,
      midiNote,
      channel,
      gainNode,
      envelope,
      targetVolume: volume,
    });
    this.totalVoicesCreated++;
  }

  /**
   * Schedule a note-off event with a smooth, musical release.
   *
   * @param noteId    Unique identifier for the note instance
   * @param audioTime When to start release (AudioContext seconds)
   */
  scheduleNoteOff(noteId: string, audioTime: number): void {
    const voice = this.activeVoices.get(noteId);
    if (!voice || !this.ctx) return;

    const { gainNode, targetVolume } = voice;
    const releaseTime = 0.06; // 60ms natural orchestral release

    try {
      const startTime = Math.max(this.ctx.currentTime, audioTime);
      safeCancelAutomation(gainNode.gain, startTime);
      gainNode.gain.setValueAtTime(targetVolume, startTime);
      gainNode.gain.linearRampToValueAtTime(0.0001, startTime + releaseTime);

      // Explicitly schedule the underlying AudioBufferSourceNode to stop at release end
      const stopAudioTime = startTime + releaseTime + 0.010;
      if (voice.envelope && (voice.envelope as any).audioBufferSourceNode) {
        try {
          (voice.envelope as any).audioBufferSourceNode.stop(stopAudioTime);
        } catch {
          // Ignore if already stopped
        }
      }

      // Clean up after release completes using audio-time base
      this.cleanupVoiceAfter(voice, startTime + releaseTime, 50);
    } catch {
      // Ignore audio scheduling error
    }

    this.activeVoices.delete(noteId);
  }

  /**
   * Immediately synthesizes a crisp orchestral crash / cymbal cue
   * with zero scheduler latency, for auditory beat feedback and debugging.
   */
  playImmediateBeatCymbal(volume: number = 0.55): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    try {
      // 1. White noise generator for metallic wash
      const bufferSize = Math.floor(ctx.sampleRate * 0.32);
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      // 2. High-pass filter for crisp metallic brightness (5200 Hz)
      const hpFilter = ctx.createBiquadFilter();
      hpFilter.type = "highpass";
      hpFilter.frequency.setValueAtTime(5200, now);

      // 3. Band-pass filter for cymbal body (7200 Hz, Q=2.5)
      const bpFilter = ctx.createBiquadFilter();
      bpFilter.type = "bandpass";
      bpFilter.frequency.setValueAtTime(7200, now);
      bpFilter.Q.setValueAtTime(2.5, now);

      // 4. Sharp envelope: 1ms instantaneous attack, 240ms exponential decay
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(volume * 0.85, now);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

      whiteNoise.connect(hpFilter);
      hpFilter.connect(bpFilter);
      bpFilter.connect(gainNode);
      gainNode.connect(this.masterGain || ctx.destination);

      // 5. Add metallic overtone pings (detuned square waves)
      const freqs = [387, 541, 789, 1120];
      freqs.forEach(freq => {
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.setValueAtTime(freq, now);
        const oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(volume * 0.12, now);
        oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.10);
        osc.connect(oscGain);
        oscGain.connect(hpFilter);
        osc.start(now);
        osc.stop(now + 0.12);
      });

      whiteNoise.start(now);
      whiteNoise.stop(now + 0.26);
    } catch {
      // AudioContext may not yet be running
    }
  }

  /**
   * Cancel all currently active audio voices immediately (e.g. on pause, stop, restart).
   */
  stopAllNotes(): void {
    const now = this.ctx?.currentTime ?? 0;
    for (const voice of this.activeVoices.values()) {
      try {
        safeCancelAutomation(voice.gainNode.gain, now);
        voice.gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.02);
        if (voice.envelope) {
          try { voice.envelope.cancel(); } catch {}
          const src = (voice.envelope as any).audioBufferSourceNode;
          if (src) {
            try { src.stop(now + 0.02); src.disconnect(); } catch {}
            (voice.envelope as any).audioBufferSourceNode = null;
          }
          try { voice.envelope.disconnect?.(); } catch {}
        }
        voice.gainNode.disconnect();
        this.totalVoicesCancelled++;
      } catch {
        // Ignore if already completed
      }
    }
    this.activeVoices.clear();

    if (this.player && Array.isArray((this.player as any).envelopes)) {
      try {
        if (this.ctx && typeof this.player.cancelQueue === "function") {
          this.player.cancelQueue(this.ctx);
        }
      } catch {}
      (this.player as any).envelopes.length = 0;
    }

    // Clear all pending voice cleanup timers
    for (const timer of this.pendingCleanupTimers) {
      clearTimeout(timer);
    }
    this.pendingCleanupTimers.clear();
    this.pendingCleanupCount = 0;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private loadScript(url: string): Promise<void> {
    if (this.loadedScriptUrls.has(url)) {
      return Promise.resolve();
    }
    const pending = this.pendingScriptLoads.get(url);
    if (pending) {
      return pending;
    }

    if (typeof document === "undefined") {
      return Promise.resolve();
    }

    const existing = document.querySelector(`script[src="${url}"]`) as HTMLScriptElement | null;
    if (existing && existing.dataset.loaded === "true") {
      this.loadedScriptUrls.add(url);
      return Promise.resolve();
    }

    const loadPromise = new Promise<void>((resolve, reject) => {
      const script = existing || document.createElement("script");
      script.src = url;

      const cleanup = () => {
        this.pendingScriptLoads.delete(url);
      };

      script.onload = () => {
        script.dataset.loaded = "true";
        this.loadedScriptUrls.add(url);
        cleanup();
        resolve();
      };

      script.onerror = () => {
        cleanup();
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
        reject(new Error(`Failed to load script: ${url}`));
      };

      if (!existing) {
        document.head.appendChild(script);
      }
    });

    this.pendingScriptLoads.set(url, loadPromise);
    return loadPromise;
  }

  private urlToVarName(url: string): string | null {
    // Match the full filename stem before .js, e.g. "0400_FluidR3_GM_sf2_file"
    const match = url.match(/\/([^/]+)\.js$/);
    if (!match) return null;
    return `_tone_${match[1]}`;
  }
}
