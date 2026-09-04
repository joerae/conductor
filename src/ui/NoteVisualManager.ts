/**
 * NoteVisualManager.ts
 *
 * Manages note visualization callbacks, session-based timer cancellation,
 * and reference counting for overlapping notes on orchestra musicians.
 */

import type { VelocityDecomposition } from "../audio/dynamicsTypes";

export interface NoteVisualEvent {
  type: "noteOn" | "noteOff";
  midiNote: number;
  velocity: number;
  channel: number;
  trackId: number | string;
  delayMs: number;
  decomp: VelocityDecomposition;
}

export interface ElementResolver {
  getSection: (channel: number, trackId: number | string) => Element | null;
  getMusicianEgg: (section: Element, midiNote: number) => Element | null;
  onVelocityHistory?: (section: Element, velocity: number, decomp: VelocityDecomposition) => void;
}

export class NoteVisualManager {
  private currentSessionId = 0;
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private eggActiveNotes = new Map<Element, number>();
  private sectionActiveNotes = new Map<Element, number>();

  getCurrentSessionId(): number {
    return this.currentSessionId;
  }

  getEggActiveCount(egg: Element): number {
    return this.eggActiveNotes.get(egg) || 0;
  }

  getSectionActiveCount(section: Element): number {
    return this.sectionActiveNotes.get(section) || 0;
  }

  getPendingTimersCount(): number {
    return this.pendingTimers.size;
  }

  clearAll(): void {
    this.currentSessionId++;
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.eggActiveNotes.clear();
    this.sectionActiveNotes.clear();

    if (typeof document !== "undefined") {
      document.querySelectorAll(".musician.playing, .instrument-section.playing").forEach(el => {
        el.classList.remove("playing");
      });
    }
  }

  handleNoteVisual(event: NoteVisualEvent, resolver: ElementResolver): void {
    const sessionId = this.currentSessionId;
    let timerId: ReturnType<typeof setTimeout>;

    timerId = setTimeout(() => {
      this.pendingTimers.delete(timerId);
      if (sessionId !== this.currentSessionId) return;

      const section = resolver.getSection(event.channel, event.trackId);
      if (!section) return;

      const targetEgg = resolver.getMusicianEgg(section, event.midiNote);

      if (event.type === "noteOn") {
        const secCount = (this.sectionActiveNotes.get(section) || 0) + 1;
        this.sectionActiveNotes.set(section, secCount);
        section.classList.add("playing");

        if (targetEgg) {
          const eggCount = (this.eggActiveNotes.get(targetEgg) || 0) + 1;
          this.eggActiveNotes.set(targetEgg, eggCount);
          targetEgg.classList.add("playing");
        }

        resolver.onVelocityHistory?.(section, event.velocity, event.decomp);
      } else {
        if (targetEgg) {
          const eggCount = Math.max(0, (this.eggActiveNotes.get(targetEgg) || 1) - 1);
          if (eggCount === 0) {
            this.eggActiveNotes.delete(targetEgg);
            targetEgg.classList.remove("playing");
          } else {
            this.eggActiveNotes.set(targetEgg, eggCount);
          }
        }

        const secCount = Math.max(0, (this.sectionActiveNotes.get(section) || 1) - 1);
        if (secCount === 0) {
          this.sectionActiveNotes.delete(section);
          section.classList.remove("playing");
        } else {
          this.sectionActiveNotes.set(section, secCount);
        }
      }
    }, event.delayMs);

    this.pendingTimers.add(timerId);
  }
}
