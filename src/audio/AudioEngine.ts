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
  DEFAULT_DSP_BYPASS_FLAGS,
  scaleVelocity,
  decomposeVelocity,
} from "./dynamicsTypes";
import type {
  DynamicLevel,
  DSPBypassFlags,
  DynamicsTelemetry,
  VelocityDecomposition,
} from "./dynamicsTypes";

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
  ) => { cancel: () => void };
}

// ─── Active Voice ──────────────────────────────────────────────────────────

interface ActiveVoice {
  noteId: string;
  midiNote: number;
  channel: number;
  gainNode: GainNode;
  envelope: { cancel: () => void };
  targetVolume: number;
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

  // Dynamics & DSP State
  private dynamicLevel: DynamicLevel = "mf";
  private dspBypassFlags: DSPBypassFlags = { ...DEFAULT_DSP_BYPASS_FLAGS };

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
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
    }
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  // ── Dynamics & DSP Control ──────────────────────────────────────────────

  setDynamicLevel(level: DynamicLevel): void {
    this.dynamicLevel = level;
    this.applyDynamicPreset();
  }

  getDynamicLevel(): DynamicLevel {
    return this.dynamicLevel;
  }

  setDSPBypassFlags(flags: Partial<DSPBypassFlags>): void {
    this.dspBypassFlags = { ...this.dspBypassFlags, ...flags };
    this.applyDynamicPreset();
  }

  getDSPBypassFlags(): DSPBypassFlags {
    return { ...this.dspBypassFlags };
  }

  computeEffectiveVelocity(rawVelocity: number): number {
    return scaleVelocity(
      rawVelocity,
      this.dynamicLevel,
      this.dspBypassFlags.velocityScaling,
      this.dspBypassFlags.scoreCompression
    );
  }

  decomposeNoteVelocity(rawVelocity: number): VelocityDecomposition {
    return decomposeVelocity(
      rawVelocity,
      this.dynamicLevel,
      this.dspBypassFlags.velocityScaling,
      this.dspBypassFlags.scoreCompression
    );
  }

  getDynamicsTelemetry(): DynamicsTelemetry {
    const preset = DYNAMIC_PRESETS[this.dynamicLevel] || DYNAMIC_PRESETS.mf;
    return {
      level: this.dynamicLevel,
      velocityMultiplier: this.dspBypassFlags.velocityScaling ? preset.velocityMultiplier : 1.0,
      filterCutoffHz: this.dspBypassFlags.timbreFilter ? preset.filterCutoffHz : 20000,
      highShelfGainDb: this.dspBypassFlags.timbreFilter ? preset.highShelfGainDb : 0.0,
      reverbWet: this.dspBypassFlags.reverbScaling ? preset.reverbWet : 0.0,
      attackTimeSec: this.dspBypassFlags.attackEnvelope ? preset.attackTimeSec : 0.006,
      bypassFlags: { ...this.dspBypassFlags },
    };
  }

  private applyDynamicPreset(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const timeConstant = 0.040; // 40ms smooth acoustic transition
    const preset = DYNAMIC_PRESETS[this.dynamicLevel] || DYNAMIC_PRESETS.mf;

    // 1. Timbre filters (Low-Pass Filter + High-Shelf Harmonics)
    if (this.lowPassFilter) {
      const targetCutoff = this.dspBypassFlags.timbreFilter ? preset.filterCutoffHz : 20000;
      this.lowPassFilter.frequency.setTargetAtTime(targetCutoff, now, timeConstant);
    }
    if (this.highShelfFilter) {
      const targetGain = this.dspBypassFlags.timbreFilter ? preset.highShelfGainDb : 0.0;
      this.highShelfFilter.gain.setTargetAtTime(targetGain, now, timeConstant);
    }

    // 2. Reverb wet gain (0.0 when bypassed)
    if (this.reverbGain) {
      const targetReverb = this.dspBypassFlags.reverbScaling ? preset.reverbWet : 0.0;
      this.reverbGain.gain.setTargetAtTime(targetReverb, now, timeConstant);
    }

    // 3. Safety Peak Limiter (Transparent protection against 0dBFS DAC clipping)
    if (this.limiter) {
      if (this.dspBypassFlags.safetyLimiter) {
        this.limiter.threshold.setTargetAtTime(-1.0, now, 0.01);
        this.limiter.ratio.setTargetAtTime(20.0, now, 0.01);
      } else {
        this.limiter.threshold.setTargetAtTime(0.0, now, 0.01);
        this.limiter.ratio.setTargetAtTime(1.0, now, 0.01);
      }
    }
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

    // Dynamic High-Shelf Filter (boosts piercing brass/string brilliance in ff/f, softens in p/pp)
    this.highShelfFilter = ctx.createBiquadFilter();
    this.highShelfFilter.type = "highshelf";
    this.highShelfFilter.frequency.value = 4500;
    this.highShelfFilter.gain.value = this.dspBypassFlags.timbreFilter ? preset.highShelfGainDb : 0.0;

    // Master Safety Peak Limiter: Transparent soft limiter at -1.0 dBFS (no squash on natural dynamics)
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = this.dspBypassFlags.safetyLimiter ? -1.0 : 0.0;
    this.limiter.knee.value = 3.0;
    this.limiter.ratio.value = this.dspBypassFlags.safetyLimiter ? 20.0 : 1.0;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.05;

    // Synthesize clean, warm concert hall stereo impulse response
    const rate = ctx.sampleRate;
    const duration = 1.8; // 1.8s warm concert hall decay
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    let prevL = 0;
    let prevR = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const decay = Math.exp(-t / 0.40) * Math.max(0, 1 - t / duration);
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
    const preset = (window as any)[varName];
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
          voice.gainNode.gain.cancelScheduledValues(audioTime);
          voice.gainNode.gain.setValueAtTime(voice.targetVolume, audioTime);
          voice.gainNode.gain.linearRampToValueAtTime(0.0001, audioTime + 0.015);
          setTimeout(() => {
            try {
              voice.envelope.cancel();
              voice.gainNode.disconnect();
            } catch {
              // Ignore
            }
          }, 40);
          this.activeVoices.delete(existingId);
        } catch {
          // Ignore
        }
      }
    }

    // Proportional velocity scaling + macro-dynamics compression
    const effectiveVelocity = scaleVelocity(
      velocity,
      this.dynamicLevel,
      this.dspBypassFlags.velocityScaling,
      this.dspBypassFlags.scoreCompression
    );

    const rawVelRatio = Math.max(0.08, effectiveVelocity / 127);
    const volume = Math.min(1.0, Math.pow(rawVelRatio, 1.15) * 1.05);

    // Dynamic Attack Time: Bite on loud notes, gentle swell on quiet notes
    const dynamicPreset = DYNAMIC_PRESETS[this.dynamicLevel] || DYNAMIC_PRESETS.mf;
    const attackTime = this.dspBypassFlags.attackEnvelope
      ? dynamicPreset.attackTimeSec
      : 0.006;

    // Create dedicated GainNode for this voice connected to master bus
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, audioTime);
    gainNode.gain.linearRampToValueAtTime(volume, audioTime + attackTime);
    gainNode.connect(this.masterGain || ctx.destination);

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

    const { gainNode, envelope, targetVolume } = voice;
    const releaseTime = 0.06; // 60ms natural orchestral release

    try {
      const startTime = Math.max(this.ctx.currentTime, audioTime);
      gainNode.gain.setValueAtTime(targetVolume, startTime);
      gainNode.gain.linearRampToValueAtTime(0.0001, startTime + releaseTime);

      // Clean up after release completes
      setTimeout(() => {
        try {
          envelope.cancel();
          gainNode.disconnect();
        } catch {
          // Ignore if already disconnected
        }
      }, Math.max(0, (startTime + releaseTime - this.ctx!.currentTime) * 1000) + 50);
    } catch {
      // Ignore audio scheduling error
    }

    this.activeVoices.delete(noteId);
  }

  /**
   * Cancel all currently active audio voices immediately (e.g. on pause, stop, restart).
   */
  stopAllNotes(): void {
    const now = this.ctx?.currentTime ?? 0;
    for (const voice of this.activeVoices.values()) {
      try {
        voice.gainNode.gain.cancelScheduledValues(now);
        voice.gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.02);
        voice.envelope.cancel();
        voice.gainNode.disconnect();
      } catch {
        // Ignore if already completed
      }
    }
    this.activeVoices.clear();
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private loadScript(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${url}"]`)) {
        resolve(); // Already loaded
        return;
      }
      const script = document.createElement("script");
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
      document.head.appendChild(script);
    });
  }

  private urlToVarName(url: string): string | null {
    // Match the full filename stem before .js, e.g. "0400_FluidR3_GM_sf2_file"
    const match = url.match(/\/([^/]+)\.js$/);
    if (!match) return null;
    return `_tone_${match[1]}`;
  }
}
