/**
 * ChannelMixer.ts
 *
 * Manages spatial stereo seating positions, per-channel sub-bus routing,
 * and real-time section focus / spotlight dynamics (boosted foreground vs softened background).
 */

import type { PieceSection } from "../score/repertoire";

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

export class ChannelMixer {
  public channelBuses: Map<number, ChannelBus> = new Map();
  public channelDefaultPans: Map<number, number> = new Map();

  // Section Focus Mode State
  private focusedChannels: Set<number> | null = null;
  private focusAmount: number = 0.0;
  private lastFocusedChannelsKey: string = "";
  private lastAppliedFocusAmount: number = -1;

  /**
   * Configures natural stereo seating pan positions for each section across the stage.
   * Section 0 (leftmost) is panned left (-0.68), moving across to the rightmost section (+0.68).
   */
  setDefaultSectionPanning(
    sections: PieceSection[],
    ctx: AudioContext | null,
    destination?: AudioNode | null
  ): void {
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
        if (ctx) {
          const bus = this.getOrCreateChannelBus(ch, ctx, destination);
          bus.defaultPan = pan;
          bus.currentPan = pan;
          if (bus.panner) {
            safeCancelAutomation(bus.panner.pan, ctx.currentTime);
            bus.panner.pan.setTargetAtTime(pan, ctx.currentTime, 0.08);
          }
        }
      }
    });
  }

  getChannelPan(channel: number): number {
    const bus = this.channelBuses.get(channel);
    return bus ? bus.currentPan : (this.channelDefaultPans.get(channel) ?? 0.0);
  }

  getOrCreateChannelBus(
    channel: number,
    ctx: AudioContext,
    destination?: AudioNode | null
  ): ChannelBus {
    let bus = this.channelBuses.get(channel);
    if (!bus) {
      const inputGain = ctx.createGain();
      const initialFocusGain = this.getChannelFocusMultiplier(channel);
      inputGain.gain.setValueAtTime(initialFocusGain, ctx.currentTime);

      let panner: StereoPannerNode | null = null;
      const defaultPan = this.channelDefaultPans.get(channel) ?? 0.0;
      if (typeof ctx.createStereoPanner === "function") {
        panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(defaultPan, ctx.currentTime);
      }

      let initialPresenceGain = 0.0;
      if (this.focusedChannels && this.focusAmount > 0.001) {
        initialPresenceGain = this.focusedChannels.has(channel)
          ? (2.5 * this.focusAmount)
          : (-1.0 * this.focusAmount);
      }

      let presenceFilter: BiquadFilterNode | null = null;
      if (typeof ctx.createBiquadFilter === "function") {
        presenceFilter = ctx.createBiquadFilter();
        presenceFilter.type = "highshelf";
        presenceFilter.frequency.value = 3800;
        presenceFilter.gain.value = initialPresenceGain;
      }

      const outNode = destination || ctx.destination;

      // Chain: inputGain -> presenceFilter -> panner -> outNode
      if (presenceFilter && panner) {
        inputGain.connect(presenceFilter);
        presenceFilter.connect(panner);
        panner.connect(outNode);
      } else if (panner) {
        inputGain.connect(panner);
        panner.connect(outNode);
      } else {
        inputGain.connect(outNode);
      }

      bus = {
        channel,
        inputGain,
        panner,
        presenceFilter,
        defaultPan,
        currentPan: defaultPan,
        currentFocusGain: initialFocusGain,
        currentPresenceGain: initialPresenceGain,
      };
      this.channelBuses.set(channel, bus);
    }
    return bus;
  }

  /**
   * Sets continuous section focus / spotlight.
   * When focusAmount > 0 and focusedChannels is provided:
   * - Spotlighted section: Volume boosted to forte tier (~1.35x, +2.6dB),
   *   presence opens up (+2.5dB).
   * - Other sections: Backgrounded to piano tier (~0.54x, -5.35dB, extra 25% quieter),
   *   presence softens.
   * - Applied entirely via persistent per-channel bus gains and filters (O(channels), NOT O(active voices)).
   */
  setSectionFocus(
    focusedChannels: number[] | null,
    focusAmount: number,
    ctx: AudioContext | null,
    onAutomationRequest?: () => void
  ): void {
    const clamped = Math.max(0.0, Math.min(1.0, focusAmount));
    const hasFocus = focusedChannels && focusedChannels.length > 0 && clamped > 0.001;
    const effectiveChannels = hasFocus ? new Set(focusedChannels) : null;
    const effectiveAmount = hasFocus ? clamped : 0.0;
    const channelsKey = effectiveChannels
      ? Array.from(effectiveChannels).sort((a, b) => a - b).join(",")
      : "";

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

    if (!ctx) return;
    const now = ctx.currentTime;
    onAutomationRequest?.();

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
      // Background reduction (extra 25% quieter): 1.0 -> 0.54 (-5.35 dB)
      return 1.0 - 0.46 * this.focusAmount;
    }
  }

  getFocusedChannels(): Set<number> | null {
    return this.focusedChannels;
  }

  getFocusAmount(): number {
    return this.focusAmount;
  }

  getChannelBusCount(): number {
    return this.channelBuses.size;
  }

  reset(): void {
    for (const bus of this.channelBuses.values()) {
      try {
        bus.inputGain.disconnect();
        bus.presenceFilter?.disconnect();
        bus.panner?.disconnect();
      } catch {
        // Ignore
      }
    }
    this.channelBuses.clear();
    this.channelDefaultPans.clear();
    this.focusedChannels = null;
    this.focusAmount = 0.0;
    this.lastFocusedChannelsKey = "";
    this.lastAppliedFocusAmount = -1;
  }
}
