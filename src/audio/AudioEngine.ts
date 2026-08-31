/**
 * AudioEngine.ts
 *
 * Wraps the Web Audio API. All audio events in Conductor are scheduled
 * against AudioContext.currentTime — never fired from keyboard events,
 * setTimeout callbacks, or animation frames.
 *
 * Phase 0: scheduleClick() for the timing spike (oscillator-based, no samples).
 * Phase 1: scheduleNoteOn() / scheduleNoteOff() using WebAudioFont sample banks.
 *
 * One shared AudioContext is created on first resume (requires a user gesture).
 * The AudioContext is exposed as getAudioTime() for injection into ConductorClock.
 *
 * WebAudioFont integration:
 *   - Sample banks are loaded as CDN script tags that define arrays on window.
 *   - We use WebAudioFontPlayer from the same CDN for sample playback.
 *   - Each active note is tracked in a Map so we can release it precisely.
 */

import { programToWebAudioFontVar, WEBAUDIOFONT_SCRIPTS } from "./instruments";

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

// The WebAudioFontPlayer library defines itself on window
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

// ─── AudioEngine ────────────────────────────────────────────────────────────

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

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Must be called from a user gesture (e.g. first Space tap).
   * Creates and resumes the AudioContext.
   */
  async resume(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
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
   * Load all WebAudioFont sample banks needed for Phase 1.
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
   * @param audioTime  AudioContext.currentTime in seconds.
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
    gain.connect(ctx.destination);

    osc.start(audioTime);
    osc.stop(audioTime + CLICK_DURATION_SEC + CLICK_RELEASE_SEC);
  }

  // ── Phase 1: Sampled notes ───────────────────────────────────────────────

  /**
   * Schedule a note-on event using the WebAudioFont sample bank.
   * The note is sustained indefinitely until its score noteOff arrives,
   * allowing the conductor to hold notes across any tempo change.
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
    const volume = Math.max(0.1, velocity / 127);

    // Create a dedicated GainNode for this voice to control its attack, sustain, and release
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, audioTime);
    gainNode.gain.linearRampToValueAtTime(volume, audioTime + 0.008);
    gainNode.connect(ctx.destination);

    // Queue note into the gain node with indefinite hold (duration = 999)
    const envelope = this.player.queueWaveTable(
      ctx,
      gainNode,
      preset,
      audioTime,
      midiNote,
      999, // Sustains until release is scheduled via scheduleNoteOff
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
    const releaseTime = 0.08; // 80ms musical release

    try {
      // Smoothly fade the gain out starting at audioTime
      gainNode.gain.setValueAtTime(targetVolume, Math.max(this.ctx.currentTime, audioTime));
      gainNode.gain.linearRampToValueAtTime(0.0001, Math.max(this.ctx.currentTime, audioTime) + releaseTime);

      // Clean up the WebAudioFont envelope after release completes
      setTimeout(() => {
        try {
          envelope.cancel();
          gainNode.disconnect();
        } catch {
          // Ignore if already disconnected
        }
      }, Math.max(0, (audioTime + releaseTime - this.ctx!.currentTime) * 1000) + 50);
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
