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

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private player: WebAudioFontPlayerInstance | null = null;
  private activeNotes: Map<string, { cancel: () => void }> = new Map();
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
   * Resolves when all scripts are loaded (but samples may still decode async).
   */
  async loadSamples(): Promise<void> {
    if (this.samplesLoaded) return;
    if (!this.ctx) throw new Error("Call resume() before loadSamples()");

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

    // Trigger decoding for each loaded bank
    for (const url of WEBAUDIOFONT_SCRIPTS) {
      const varName = this.urlToVarName(url);
      if (varName) {
        this.player!.loader.decodeAfterLoading(this.ctx!, varName);
      }
    }

    this.samplesLoaded = true;
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
   * The note continues until scheduleNoteOff is called with the same midiNote+channel.
   *
   * @param midiNote   0–127
   * @param velocity   0–127
   * @param channel    MIDI channel 0–15
   * @param program    MIDI program 0–127
   * @param audioTime  When to start (AudioContext seconds)
   */
  scheduleNoteOn(
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
    if (!preset) return;

    const volume = velocity / 127;
    // Duration is intentionally long — we rely on noteOff to cancel it
    const envelope = this.player.queueWaveTable(
      this.ctx,
      this.ctx.destination,
      preset,
      audioTime,
      midiNote,
      999, // Will be cancelled by noteOff
      volume
    );

    const key = `${channel}:${midiNote}`;
    // Cancel any existing note on this key (just in case)
    this.activeNotes.get(key)?.cancel();
    this.activeNotes.set(key, envelope);
  }

  /**
   * Schedule a note-off event. Cancels the active note envelope.
   *
   * @param midiNote   0–127
   * @param channel    MIDI channel 0–15
   * @param audioTime  When to stop (AudioContext seconds, currently immediate)
   */
  scheduleNoteOff(midiNote: number, channel: number, _audioTime: number): void {
    const key = `${channel}:${midiNote}`;
    const envelope = this.activeNotes.get(key);
    if (envelope) {
      envelope.cancel();
      this.activeNotes.delete(key);
    }
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
    // e.g. ".../0400_SoundFont_sf2_file.js" → "_tone_0400_SoundFont_sf2_file"
    const match = url.match(/(\d+_\w+)\.js$/);
    if (!match) return null;
    return `_tone_${match[1]}`;
  }
}
