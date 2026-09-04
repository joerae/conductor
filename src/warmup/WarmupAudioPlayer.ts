/**
 * WarmupAudioPlayer.ts
 *
 * Isolated audio transport and player for the Conductor Warming Up Experience.
 * Plays a short, singable Ode to Joy phrase on violin with continuous tempo and dynamics responsiveness.
 * Strictly decoupled from ScoreTransport, preserving bounded voice lifetimes and zero memory leaks.
 */

export interface WarmupNote {
  beat: number;
  midi: number;
  durationBeats: number;
  channel?: number;
  program?: number;
}

// 4-measure Beethoven's Ode to Joy opening phrase in G-major (16 beats, ~8s at 120 BPM)
export const WARMUP_VIOLIN_PHRASE: WarmupNote[] = [
  // Measure 1
  { beat: 0, midi: 71, durationBeats: 0.92 }, // B4
  { beat: 1, midi: 71, durationBeats: 0.92 }, // B4
  { beat: 2, midi: 72, durationBeats: 0.92 }, // C5
  { beat: 3, midi: 74, durationBeats: 0.92 }, // D5
  // Measure 2
  { beat: 4, midi: 74, durationBeats: 0.92 }, // D5
  { beat: 5, midi: 72, durationBeats: 0.92 }, // C5
  { beat: 6, midi: 71, durationBeats: 0.92 }, // B4
  { beat: 7, midi: 69, durationBeats: 0.92 }, // A4
  // Measure 3
  { beat: 8, midi: 67, durationBeats: 0.92 }, // G4
  { beat: 9, midi: 67, durationBeats: 0.92 }, // G4
  { beat: 10, midi: 69, durationBeats: 0.92 }, // A4
  { beat: 11, midi: 71, durationBeats: 0.92 }, // B4
  // Measure 4 (Cadence with breath)
  { beat: 12, midi: 69, durationBeats: 1.42 }, // A4
  { beat: 13.5, midi: 67, durationBeats: 0.45 }, // G4
  { beat: 14, midi: 67, durationBeats: 1.85 }, // G4
  // Beat 16 is loop boundary
];

// Optional accompanying cello line for Spotlight lesson
export const WARMUP_CELLO_ACCOMPANIMENT: WarmupNote[] = [
  { beat: 0, midi: 55, durationBeats: 3.8, channel: 2, program: 42 }, // G3
  { beat: 4, midi: 54, durationBeats: 3.8, channel: 2, program: 42 }, // F#3
  { beat: 8, midi: 52, durationBeats: 3.8, channel: 2, program: 42 }, // E3
  { beat: 12, midi: 50, durationBeats: 3.8, channel: 2, program: 42 }, // D3
];

export const TOTAL_PHRASE_BEATS = 16;

export class WarmupAudioPlayer {
  private ctx: AudioContext | null = null;
  private masterBus: GainNode | null = null;
  private violinBus: GainNode | null = null;
  private accompanimentBus: GainNode | null = null;

  private isRunning: boolean = false;
  private isMuted: boolean = false;
  private currentBpm: number = 108;
  private currentDynamicValue: number = 0.5; // 0=pp, 1=fff
  private currentBeatPosition: number = 0;
  private lastTickAudioTime: number = 0;

  private timerId: ReturnType<typeof setTimeout> | null = null;
  private activeVoices: Set<{ stop: () => void }> = new Set();
  private isAccompanimentEnabled: boolean = false;

  public onNotePlay?: (note: WarmupNote, audioTime: number, durationSec: number) => void;

  constructor() {}

  /**
   * Initializes audio routing using the provided AudioContext.
   */
  init(ctx: AudioContext): void {
    this.ctx = ctx;

    // Dedicated warmup master bus
    this.masterBus = ctx.createGain();
    this.masterBus.gain.setValueAtTime(this.isMuted ? 0 : 0.65, ctx.currentTime);
    this.masterBus.connect(ctx.destination);

    // Violin solo bus
    this.violinBus = ctx.createGain();
    this.violinBus.gain.setValueAtTime(1.0, ctx.currentTime);
    this.violinBus.connect(this.masterBus);

    // Accompaniment bus
    this.accompanimentBus = ctx.createGain();
    this.accompanimentBus.gain.setValueAtTime(0.35, ctx.currentTime);
    this.accompanimentBus.connect(this.masterBus);
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.masterBus && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterBus.gain.cancelScheduledValues(now);
      this.masterBus.gain.setValueAtTime(this.masterBus.gain.value, now);
      this.masterBus.gain.linearRampToValueAtTime(muted ? 0 : 0.65, now + 0.05);
    }
  }

  isSoundMuted(): boolean {
    return this.isMuted;
  }

  setTempo(bpm: number): void {
    this.currentBpm = Math.max(40, Math.min(240, bpm));
  }

  getTempo(): number {
    return this.currentBpm;
  }

  setDynamic(_level: string, continuous: number): void {
    this.currentDynamicValue = Math.max(0.05, Math.min(1.0, continuous));
    if (this.violinBus && this.ctx) {
      const now = this.ctx.currentTime;
      // Exponential volume curve
      const vol = Math.pow(this.currentDynamicValue, 1.2) * 1.1;
      this.violinBus.gain.cancelScheduledValues(now);
      this.violinBus.gain.setValueAtTime(this.violinBus.gain.value, now);
      this.violinBus.gain.linearRampToValueAtTime(Math.min(1.2, vol), now + 0.05);
    }
  }

  setDynamics(continuous: number): void {
    this.setDynamic("mf", continuous);
  }

  getDynamics(): number {
    return this.currentDynamicValue;
  }

  setSpotlightSection(sectionId: string | null): void {
    if (!this.accompanimentBus || !this.ctx) return;
    const now = this.ctx.currentTime;
    const targetVol = sectionId === "cello" || sectionId === "strings-lower" ? 0.9 : 0.35;
    this.accompanimentBus.gain.cancelScheduledValues(now);
    this.accompanimentBus.gain.setValueAtTime(this.accompanimentBus.gain.value, now);
    this.accompanimentBus.gain.linearRampToValueAtTime(targetVol, now + 0.08);
  }

  enableAccompaniment(enabled: boolean): void {
    this.isAccompanimentEnabled = enabled;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.currentBeatPosition = 0;
    this.lastTickAudioTime = this.ctx ? this.ctx.currentTime : 0;
    this.scheduleLoop();
  }

  isPlaying(): boolean {
    return this.isRunning;
  }

  private scheduleLoop(): void {
    if (!this.isRunning || !this.ctx) return;

    const now = this.ctx.currentTime;
    const lookaheadSec = 0.25; // 250ms lookahead
    const secPerBeat = 60 / this.currentBpm;

    // Advance beat position based on elapsed time since last tick
    const elapsedSec = Math.max(0, now - this.lastTickAudioTime);
    this.lastTickAudioTime = now;
    this.currentBeatPosition = (this.currentBeatPosition + (elapsedSec / secPerBeat)) % TOTAL_PHRASE_BEATS;

    // Find notes falling within the current lookahead window
    const windowStartBeat = this.currentBeatPosition;
    const windowEndBeat = windowStartBeat + (lookaheadSec / secPerBeat);

    const checkPhrase = (notes: WarmupNote[]) => {
      for (const note of notes) {
        let noteBeat = note.beat;
        // Normalize relative to current window
        if (noteBeat < windowStartBeat && windowEndBeat >= TOTAL_PHRASE_BEATS) {
          noteBeat += TOTAL_PHRASE_BEATS;
        }

        if (noteBeat >= windowStartBeat && noteBeat < windowEndBeat) {
          const deltaBeats = noteBeat - windowStartBeat;
          const scheduleTime = now + (deltaBeats * secPerBeat);
          this.playNote(note, scheduleTime, note.durationBeats * secPerBeat);
        }
      }
    };

    checkPhrase(WARMUP_VIOLIN_PHRASE);
    if (this.isAccompanimentEnabled) {
      checkPhrase(WARMUP_CELLO_ACCOMPANIMENT);
    }

    this.timerId = setTimeout(() => this.scheduleLoop(), 100);
  }

  private playNote(note: WarmupNote, audioTime: number, durationSec: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    // Trigger visual note play callback in sync with audio time
    const deltaMs = Math.max(0, (audioTime - ctx.currentTime) * 1000);
    setTimeout(() => {
      if (this.isRunning) {
        this.onNotePlay?.(note, audioTime, durationSec);
      }
    }, deltaMs);

    // Check if WebAudioFont violin preset is available
    const win = typeof window !== "undefined" ? (window as any) : (globalThis as any);
    const player = win.WebAudioFontPlayer ? win._conductorWebAudioFontPlayer : null;
    const violinPreset = win._tone_0400_FluidR3_GM_sf2_file;

    const bus = (note.channel === 2 ? this.accompanimentBus : this.violinBus) || this.masterBus || ctx.destination;

    if (player && violinPreset) {
      try {
        const envelope = player.queueWaveTable(
          ctx,
          bus,
          violinPreset,
          audioTime,
          note.midi,
          durationSec,
          1.0
        );

        const voiceRef = {
          stop: () => {
            try {
              if (envelope?.audioBufferSourceNode) {
                envelope.audioBufferSourceNode.stop();
                envelope.audioBufferSourceNode.disconnect();
              }
            } catch {
              // Ignore
            }
          },
        };
        this.activeVoices.add(voiceRef);
        setTimeout(() => this.activeVoices.delete(voiceRef), (durationSec + 0.5) * 1000);
        return;
      } catch (err) {
        console.warn("WarmupAudioPlayer: WebAudioFont note error, using synthesis fallback:", err);
      }
    }

    // Synthesis fallback: Warm string harmonic oscillator with gentle bow attack
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    const freq = 440 * Math.pow(2, (note.midi - 69) / 12);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, audioTime);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.min(3800, freq * 3.5), audioTime);

    gain.gain.setValueAtTime(0, audioTime);
    gain.gain.linearRampToValueAtTime(0.32, audioTime + 0.04);
    gain.gain.setValueAtTime(0.32, audioTime + Math.max(0.05, durationSec - 0.05));
    gain.gain.exponentialRampToValueAtTime(0.001, audioTime + durationSec);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bus);

    osc.start(audioTime);
    osc.stop(audioTime + durationSec + 0.05);

    const synthVoice = {
      stop: () => {
        try {
          osc.stop();
          osc.disconnect();
          gain.disconnect();
        } catch {
          // Ignore
        }
      },
    };
    this.activeVoices.add(synthVoice);
    setTimeout(() => {
      synthVoice.stop();
      this.activeVoices.delete(synthVoice);
    }, (durationSec + 0.1) * 1000);
  }

  stop(): void {
    void this.fadeAndStop(0);
  }

  /**
   * Smoothly fades out warm-up audio and cleans up all active voices and timers.
   */
  async fadeAndStop(durationMs: number = 200): Promise<void> {
    this.isRunning = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    if (this.masterBus && this.ctx) {
      const now = this.ctx.currentTime;
      const fadeSec = durationMs / 1000;
      this.masterBus.gain.cancelScheduledValues(now);
      this.masterBus.gain.setValueAtTime(this.masterBus.gain.value, now);
      this.masterBus.gain.linearRampToValueAtTime(0.0001, now + fadeSec);

      await new Promise(resolve => setTimeout(resolve, durationMs));
    }

    this.dispose();
  }

  dispose(): void {
    this.isRunning = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    for (const voice of this.activeVoices) {
      try {
        voice.stop();
      } catch {
        // Ignore
      }
    }
    this.activeVoices.clear();

    if (this.masterBus) {
      try {
        this.masterBus.disconnect();
      } catch {
        // Ignore
      }
      this.masterBus = null;
    }
    if (this.violinBus) {
      try {
        this.violinBus.disconnect();
      } catch {
        // Ignore
      }
      this.violinBus = null;
    }
    if (this.accompanimentBus) {
      try {
        this.accompanimentBus.disconnect();
      } catch {
        // Ignore
      }
      this.accompanimentBus = null;
    }
  }
}
