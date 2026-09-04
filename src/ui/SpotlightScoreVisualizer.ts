/**
 * SpotlightScoreVisualizer.ts
 *
 * Real-time Musical Score Visualizer for Conductor Spotlight Focus Mode:
 * - Powered by VexFlow 5 (professional music engraving).
 * - Full authentic note rendering: crotchets, quavers (single flags), semiquavers (double flags),
 *   demisemiquavers (triple flags), dotted notes (augmentation dots), and automated beaming.
 * - Displays 2-bar moving musical score for the spotlighted instrument section.
 * - Positioned dynamically ABOVE the spotlighted instrument section so the musicians remain fully visible.
 * - Real-time golden timeline playhead and live note highlighting.
 */

import type { MidiScore } from "../score/MidiScore";
import type { ScoreTransport } from "../score/ScoreTransport";
import type { PieceDefinition } from "../score/repertoire";
import {
  Renderer,
  Stave,
  StaveNote,
  Beam,
  Dot,
  Accidental,
  Formatter,
  Voice,
  Barline,
} from "vexflow";

export interface VisualNote {
  noteId: string;
  midiNote: number;
  beat: number;
  durationBeats: number;
  velocity: number;
  channel: number;
  trackId: string;
}

export type ClefType = "treble" | "bass" | "alto";

export interface VexDurationInfo {
  duration: string;
  dots: number;
}

export interface VexKeyInfo {
  key: string;
  accidental: string | null;
}

export function getClefForSection(sectionId: string): ClefType {
  const id = sectionId.toLowerCase();
  if (
    id.includes("cello") ||
    id.includes("bass") ||
    id.includes("timpani") ||
    id === "strings-lower"
  ) {
    return "bass";
  }
  if (id.includes("viola")) {
    return "alto";
  }
  return "treble";
}

/**
 * Converts MIDI note number (0–127) to VexFlow key string (e.g. "c/4", "f/4") and accidental ("#" or "b").
 */
export function midiNoteToVexKey(midiNote: number): VexKeyInfo {
  const noteLetters = ["c", "c", "d", "e", "e", "f", "f", "g", "g", "a", "b", "b"];
  const accidentals = ["", "#", "", "b", "", "", "#", "", "#", "", "b", ""];
  const pitchClass = ((midiNote % 12) + 12) % 12;
  const octave = Math.floor(midiNote / 12) - 1;
  const letter = noteLetters[pitchClass];
  const accidental = accidentals[pitchClass] || null;
  const key = `${letter}/${octave}`;
  return { key, accidental };
}

/**
 * Quantizes duration in beats (where 1 beat = quarter note / crotchet)
 * into VexFlow duration codes and augmentation dot count.
 */
export function durationToBeatsToVexDuration(durationBeats: number): VexDurationInfo {
  if (durationBeats >= 3.5) {
    return { duration: "w", dots: 0 }; // semibreve / whole note (4 beats)
  } else if (durationBeats >= 2.6) {
    return { duration: "h", dots: 1 }; // dotted minim / dotted half note (3 beats)
  } else if (durationBeats >= 1.7) {
    return { duration: "h", dots: 0 }; // minim / half note (2 beats)
  } else if (durationBeats >= 1.25) {
    return { duration: "q", dots: 1 }; // dotted crotchet / dotted quarter note (1.5 beats)
  } else if (durationBeats >= 0.8) {
    return { duration: "q", dots: 0 }; // crotchet / quarter note (1 beat)
  } else if (durationBeats >= 0.6) {
    return { duration: "8", dots: 1 }; // dotted quaver / dotted 8th note (0.75 beats)
  } else if (durationBeats >= 0.38) {
    return { duration: "8", dots: 0 }; // quaver / 8th note (0.5 beats) — single flag
  } else if (durationBeats >= 0.28) {
    return { duration: "16", dots: 1 }; // dotted semiquaver / dotted 16th note (0.375 beats)
  } else if (durationBeats >= 0.18) {
    return { duration: "16", dots: 0 }; // semiquaver / 16th note (0.25 beats) — double flag
  } else {
    return { duration: "32", dots: 0 }; // demisemiquaver / 32nd note (0.125 beats) — triple flag
  }
}

interface NoteRef {
  staveNote: StaveNote;
  note: VisualNote;
}

export interface BeatGroup {
  beat: number;
  durationBeats: number;
  notes: VisualNote[];
}

/**
 * Groups simultaneous MIDI notes (within 0.05 beats) into single chord events.
 * This prevents sequential note collision in monophonic voices and eliminates duplicate stems.
 */
export function groupNotesByBeat(notes: VisualNote[]): BeatGroup[] {
  const groups: BeatGroup[] = [];
  for (const n of notes) {
    const existing = groups.find(g => Math.abs(g.beat - n.beat) < 0.05);
    if (existing) {
      existing.notes.push(n);
      existing.durationBeats = Math.min(existing.durationBeats, n.durationBeats);
    } else {
      groups.push({
        beat: n.beat,
        durationBeats: n.durationBeats,
        notes: [n],
      });
    }
  }
  groups.sort((a, b) => a.beat - b.beat);
  return groups;
}

export class SpotlightScoreVisualizer {
  private container: HTMLElement | null = null;
  private currentSectionId: string | null = null;
  private currentSectionNotes: VisualNote[] = [];
  private beatsPerBar: number = 4;
  private timeSignatureText: string = "4/4";
  private timeSigNum: number = 4;
  private timeSigDen: number = 4;
  private isVisible: boolean = false;
  private isEnabled: boolean = true;
  private lastRenderedBar: number = -1;
  private animFrameId: number | null = null;

  // Track rendered VexFlow notes and playhead metrics
  private currentNoteRefs: NoteRef[] = [];
  private staveMetrics = { startX: 10, totalWidth: 360 };

  // Dependencies provided dynamically by ExperienceController / main.ts
  private getMidiScore: () => MidiScore | null;
  private getTransport: () => ScoreTransport | null;
  private getCurrentPiece: () => PieceDefinition | null;

  constructor(options: {
    getMidiScore: () => MidiScore | null;
    getTransport: () => ScoreTransport | null;
    getCurrentPiece: () => PieceDefinition | null;
  }) {
    this.getMidiScore = options.getMidiScore;
    this.getTransport = options.getTransport;
    this.getCurrentPiece = options.getCurrentPiece;

    this.initDOM();

    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.ready.then(() => {
        if (this.isVisible) {
          this.render();
          this.updatePosition();
        }
      });
    }
  }

  private initDOM(): void {
    if (typeof document === "undefined") return;

    let panel = document.getElementById("spotlight-score-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "spotlight-score-panel";
      panel.className = "spotlight-score-panel";
      panel.style.display = "none";

      const anchorParent =
        document.getElementById("stage-center-column") ||
        document.getElementById("stage-main-area") ||
        document.getElementById("stage") ||
        document.body;

      anchorParent.appendChild(panel);
    }
    this.container = panel;
  }

  /**
   * Enable or disable the score visualizer feature flag.
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled && this.isVisible) {
      this.hide();
    }
  }

  getIsEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Activate score visualizer for a spotlighted instrument section.
   */
  show(sectionId: string): void {
    if (!this.isEnabled) {
      console.info(`[SpotlightScoreVisualizer] SHOW suppressed — Feature flag is OFF for section="${sectionId}"`);
      this.hide();
      return;
    }

    this.currentSectionId = sectionId;
    this.isVisible = true;
    this.lastRenderedBar = -1;

    this.extractSectionNotes(sectionId);

    console.info(
      `[SpotlightScoreVisualizer] 🎼 SHOW called for section="${sectionId}". ` +
      `Feature Flag isEnabled=${this.isEnabled}. Notes extracted: ${this.currentSectionNotes.length}`
    );

    this.render();

    if (this.container) {
      this.container.style.display = "flex";
      void this.container.offsetWidth;
      this.container.classList.add("visible");
      this.updatePosition();
    }

    if (typeof document !== "undefined" && document.fonts && !document.fonts.check("16px Bravura")) {
      document.fonts.ready.then(() => {
        if (this.isVisible) {
          this.render();
          this.updatePosition();
        }
      });
    }

    this.startAnimationLoop();
  }

  /**
   * Hide the score visualizer when spotlight mode exits.
   */
  hide(): void {
    if (this.isVisible) {
      console.info(`[SpotlightScoreVisualizer] 🎼 HIDE called. Exiting score visualizer`);
    }
    this.isVisible = false;
    this.stopAnimationLoop();

    if (this.container) {
      this.container.classList.remove("visible");
      setTimeout(() => {
        if (!this.isVisible && this.container) {
          this.container.style.display = "none";
        }
      }, 200);
    }
  }

  getIsVisible(): boolean {
    return this.isVisible;
  }

  getCurrentSectionId(): string | null {
    return this.currentSectionId;
  }

  getCurrentNotes(): VisualNote[] {
    return this.currentSectionNotes;
  }

  getDebugTelemetry() {
    return {
      isEnabled: this.isEnabled,
      isVisible: this.isVisible,
      sectionId: this.currentSectionId,
      notesCount: this.currentSectionNotes.length,
      left: this.container ? parseInt(this.container.style.left) || 0 : 0,
      top: this.container ? parseInt(this.container.style.top) || 0 : 0,
      width: this.container ? parseInt(this.container.style.width) || 0 : 0,
      height: this.container ? this.container.offsetHeight || 0 : 0,
      display: this.container ? this.container.style.display : "none",
      hasVisibleClass: this.container ? this.container.classList.contains("visible") : false,
      zIndex: "120 (position: fixed)",
    };
  }

  private extractSectionNotes(sectionId: string): void {
    const piece = this.getCurrentPiece();
    const midiScore = this.getMidiScore();

    if (!piece || !midiScore) {
      this.currentSectionNotes = [];
      return;
    }

    let tsNum = 4;
    let tsDen = 4;
    try {
      const meta = midiScore.getMetadata();
      tsNum = meta.timeSignatureNumerator || 4;
      tsDen = meta.timeSignatureDenominator || 4;
    } catch {
      if (piece.timeSignature) {
        const parts = piece.timeSignature.split("/").map(Number);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          tsNum = parts[0];
          tsDen = parts[1];
        }
      }
    }

    this.timeSigNum = tsNum;
    this.timeSigDen = tsDen;
    this.beatsPerBar = tsNum * (4 / tsDen);
    this.timeSignatureText = `${tsNum}/${tsDen}`;

    const section = piece.sections.find(s => s.id === sectionId);
    if (!section) {
      this.currentSectionNotes = [];
      return;
    }

    const channelSet = new Set(section.channels);
    const trackNamesUpper = (section.trackNames || []).map(n => n.toUpperCase());

    const allEvents = midiScore.getEvents();
    const notes: VisualNote[] = [];

    for (const ev of allEvents) {
      if (ev.type !== "noteOn") continue;

      const chMatch = channelSet.has(ev.channel);
      let nameMatch = false;
      const trackNameStr = (ev as any).trackName || ev.trackId;
      if (trackNameStr) {
        const evTrackUpper = String(trackNameStr).toUpperCase();
        nameMatch = trackNamesUpper.some(tn => evTrackUpper.includes(tn) || tn.includes(evTrackUpper));
      }

      if (chMatch || nameMatch) {
        notes.push({
          noteId: `${ev.noteId}_${ev.channel}_${ev.beat}`,
          midiNote: ev.midiNote ?? (ev as any).noteNumber ?? 60,
          beat: ev.beat,
          durationBeats: ev.durationBeats || 1,
          velocity: ev.velocity,
          channel: ev.channel,
          trackId: ev.trackId || "",
        });
      }
    }

    notes.sort((a, b) => a.beat - b.beat || a.midiNote - b.midiNote);
    this.currentSectionNotes = notes;
  }

  /**
   * Position the score card directly ABOVE the orchestra silhouette.
   * Uses viewport-bounded coordinates with position: fixed so it never clips off-screen
   * and never overlaps the pointed musician silhouettes.
   */
  updatePosition(): void {
    if (!this.container || !this.currentSectionId || typeof document === "undefined") return;

    const sectionEl =
      document.getElementById(`section-${this.currentSectionId}`) ||
      document.querySelector(`[data-section-id="${this.currentSectionId}"]`) ||
      document.querySelector(`[data-track-name="${this.currentSectionId}"]`) ||
      (this.currentSectionId === "violin1" ? document.getElementById("section-0") : null) ||
      (this.currentSectionId === "violin2" ? document.getElementById("section-1") : null) ||
      (this.currentSectionId === "viola" ? document.getElementById("section-2") : null) ||
      (this.currentSectionId === "cello" ? document.getElementById("section-3") : null);

    const orchEl = document.getElementById("orchestra-silhouette");

    const winW = typeof window !== "undefined" ? window.innerWidth : 1000;
    const winH = typeof window !== "undefined" ? window.innerHeight : 800;
    const cardWidth = Math.min(580, winW - 32);
    const cardHeight = this.container.offsetHeight || 135;

    let secRect: DOMRect | { left: number; right: number; top: number; bottom: number };
    if (sectionEl) {
      secRect = sectionEl.getBoundingClientRect();
    } else {
      secRect = { left: winW / 2 - 50, right: winW / 2 + 50, top: 180, bottom: 240 };
    }

    const orchRect = orchEl ? orchEl.getBoundingClientRect() : secRect;

    // Center horizontally on the targeted instrument section, clamped inside viewport
    const secCenterX = (secRect.left + secRect.right) / 2;
    let targetLeft = secCenterX - cardWidth / 2;
    targetLeft = Math.max(16, Math.min(winW - cardWidth - 16, targetLeft));

    // Place directly ABOVE the orchestra silhouette.
    // Minimum 12px from viewport top so it is NEVER pushed off screen.
    let targetTop = orchRect.top - cardHeight - 8;
    if (targetTop < 12) {
      targetTop = 12;
    }
    // If space above orchestra is generous, keep it cleanly above the musicians
    if (orchRect.top > cardHeight + 16) {
      targetTop = Math.min(targetTop, orchRect.top - cardHeight - 6);
    }

    this.container.style.position = "fixed";
    this.container.style.zIndex = "120";
    this.container.style.left = `${Math.round(targetLeft)}px`;
    this.container.style.top = `${Math.round(targetTop)}px`;
    this.container.style.width = `${Math.round(cardWidth)}px`;

    console.info(
      `[SpotlightScoreVisualizer] 🎼 PIXEL PLACEMENT & STACKING: ` +
      `section="${this.currentSectionId}", ` +
      `pixel=(X: ${Math.round(targetLeft)}px, Y: ${Math.round(targetTop)}px, W: ${Math.round(cardWidth)}px, H: ${Math.round(cardHeight)}px) | ` +
      `orchTop=${Math.round(orchRect.top)}px, window=(${winW}×${winH}px) | ` +
      `z-index=120 (position: fixed, display: ${this.container.style.display}, visible: ${this.container.classList.contains("visible")})`
    );
  }

  private startAnimationLoop(): void {
    if (this.animFrameId !== null) return;

    const update = () => {
      if (!this.isVisible) {
        this.animFrameId = null;
        return;
      }

      this.updateScoreAnimation();
      if (typeof requestAnimationFrame !== "undefined") {
        this.animFrameId = requestAnimationFrame(update);
      }
    };

    if (typeof requestAnimationFrame !== "undefined") {
      this.animFrameId = requestAnimationFrame(update);
    }
  }

  private stopAnimationLoop(): void {
    if (this.animFrameId !== null) {
      if (typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(this.animFrameId);
      }
      this.animFrameId = null;
    }
  }

  /**
   * Render 2 measures using VexFlow 5 engraving.
   */
  render(): void {
    if (!this.container || !this.currentSectionId || typeof document === "undefined") return;

    try {
      const piece = this.getCurrentPiece();
      const section = piece?.sections.find(s => s.id === this.currentSectionId);
      const sectionName = section?.name || "Instrument";
      const clef = getClefForSection(this.currentSectionId);

    const transport = this.getTransport();
    const cursorBeat = transport ? transport.getCursorBeat() : 0;
    const currentBar = Math.floor(Math.max(0, cursorBeat) / this.beatsPerBar);

    this.lastRenderedBar = currentBar;

    const bar1 = currentBar;
    const bar2 = currentBar + 1;
    const bar1StartBeat = bar1 * this.beatsPerBar;
    const bar1EndBeat = (bar1 + 1) * this.beatsPerBar;
    const bar2StartBeat = bar2 * this.beatsPerBar;
    const bar2EndBeat = (bar2 + 1) * this.beatsPerBar;

    let clefBadge = "Treble";
    if (clef === "bass") clefBadge = "Bass";
    else if (clef === "alto") clefBadge = "Alto";

    // Set up card structure with clean header (no "Spotlight score" text)
    this.container.innerHTML = `
      <div class="score-card-header">
        <div class="score-card-title-wrap">
          <span class="score-card-icon">🎻</span>
          <span class="score-card-section-name">${sectionName}</span>
          <span class="score-card-badge clef-badge">${clefBadge}</span>
        </div>
        <div class="score-card-meta">
          <span class="score-card-badge bar-badge">m. ${bar1 + 1}–${bar2 + 1}</span>
        </div>
      </div>
      <div class="score-svg-wrap"></div>
    `;

    const svgWrap = this.container.querySelector(".score-svg-wrap") as HTMLElement;
    if (!svgWrap) return;

    // Dimensions: generous width to fit all notes comfortably
    const totalW = Math.max(500, Math.min(580, this.container.clientWidth || 560));
    const totalH = 100;
    const barWidth = Math.floor((totalW - 20) / 2);
    this.staveMetrics = { startX: 10, totalWidth: barWidth * 2 };

    // Initialize VexFlow SVG Renderer
    const renderer = new Renderer(svgWrap as HTMLDivElement, Renderer.Backends.SVG);
    renderer.resize(totalW, totalH);
    const context = renderer.getContext();

    // Stave 1 (Bar 1) with Clef, Time Signature, and Start/End barlines
    const stave1 = new Stave(10, 0, barWidth);
    stave1.addClef(clef).addTimeSignature(this.timeSignatureText);
    stave1.setBegBarType(Barline.type.SINGLE);
    stave1.setEndBarType(Barline.type.SINGLE);
    stave1.setSection(`m. ${bar1 + 1}`, 0);
    stave1.setContext(context).draw();

    // Stave 2 (Bar 2) with Start barline and Double end barline
    const stave2 = new Stave(10 + barWidth, 0, barWidth);
    stave2.setBegBarType(Barline.type.SINGLE);
    stave2.setEndBarType(Barline.type.DOUBLE);
    stave2.setSection(`m. ${bar2 + 1}`, 0);
    stave2.setContext(context).draw();

    this.currentNoteRefs = [];

    // Render Bar 1 notes
    this.renderBarNotes(
      bar1StartBeat,
      bar1EndBeat,
      clef,
      stave1,
      context,
      barWidth
    );

    // Render Bar 2 notes
    this.renderBarNotes(
      bar2StartBeat,
      bar2EndBeat,
      clef,
      stave2,
      context,
      barWidth
    );

    // Append Playhead Group directly into VexFlow's SVG element
    const svgEl = svgWrap.querySelector("svg");
    if (svgEl) {
      const playheadGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
      playheadGroup.id = "score-playhead";
      playheadGroup.setAttribute("class", "score-playhead-group");

      const glowBeam = document.createElementNS("http://www.w3.org/2000/svg", "line");
      glowBeam.setAttribute("x1", "0");
      glowBeam.setAttribute("y1", "15");
      glowBeam.setAttribute("x2", "0");
      glowBeam.setAttribute("y2", "88");
      glowBeam.setAttribute("stroke", "rgba(255, 213, 107, 0.40)");
      glowBeam.setAttribute("stroke-width", "5");
      glowBeam.setAttribute("stroke-linecap", "round");

      const coreBeam = document.createElementNS("http://www.w3.org/2000/svg", "line");
      coreBeam.setAttribute("x1", "0");
      coreBeam.setAttribute("y1", "12");
      coreBeam.setAttribute("x2", "0");
      coreBeam.setAttribute("y2", "90");
      coreBeam.setAttribute("stroke", "#ffd56b");
      coreBeam.setAttribute("stroke-width", "2");
      coreBeam.setAttribute("stroke-linecap", "round");

      const pip = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      pip.setAttribute("points", "-3.5,12 3.5,12 0,17");
      pip.setAttribute("fill", "#ffffff");

      playheadGroup.appendChild(glowBeam);
      playheadGroup.appendChild(coreBeam);
      playheadGroup.appendChild(pip);

      svgEl.appendChild(playheadGroup);
    }
  } catch (err) {
    console.error(`[SpotlightScoreVisualizer] ❌ Error in render() for section "${this.currentSectionId}":`, err);
  }
}

  private renderBarNotes(
    startBeat: number,
    endBeat: number,
    clef: ClefType,
    stave: Stave,
    context: any,
    barWidth: number
  ): void {
    const barNotes = this.currentSectionNotes.filter(
      n => n.beat >= startBeat - 0.05 && n.beat < endBeat
    );

    if (barNotes.length === 0) {
      // Whole measure rest
      const restKey = clef === "bass" ? "d/3" : (clef === "alto" ? "c/4" : "b/4");
      const restNote = new StaveNote({ keys: [restKey], duration: "wr", clef });
      const voice = new Voice({ numBeats: this.timeSigNum, beatValue: this.timeSigDen });
      voice.setMode(Voice.Mode.SOFT);
      voice.addTickables([restNote]);
      new Formatter().joinVoices([voice]).format([voice], Math.max(60, barWidth - 40));
      voice.draw(context, stave);
      return;
    }

    // Group simultaneous notes within 0.05 beat into single chord columns
    const noteGroups = groupNotesByBeat(barNotes);
    const staveNotes: StaveNote[] = [];

    for (const group of noteGroups) {
      // Sort notes in chord by midiNote ascending (VexFlow requirement)
      group.notes.sort((a, b) => a.midiNote - b.midiNote);

      const keys: string[] = [];
      const accidentals: { index: number; acc: string }[] = [];
      const seenKeys = new Set<string>();

      for (const n of group.notes) {
        const { key, accidental } = midiNoteToVexKey(n.midiNote);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          keys.push(key);
          const idx = keys.length - 1;
          if (accidental) {
            accidentals.push({ index: idx, acc: accidental });
          }
        }
      }

      if (keys.length === 0) {
        keys.push(clef === "bass" ? "d/3" : (clef === "alto" ? "c/4" : "b/4"));
      }

      const { duration, dots } = durationToBeatsToVexDuration(group.durationBeats);
      const sn = new StaveNote({ keys, duration, clef });
      for (const { index, acc } of accidentals) {
        sn.addModifier(new Accidental(acc), index);
      }
      if (dots > 0) {
        Dot.buildAndAttach([sn]);
      }

      staveNotes.push(sn);
      for (const n of group.notes) {
        this.currentNoteRefs.push({ staveNote: sn, note: n });
      }
    }

    // Auto-beam consecutive flagged notes (8th, 16th, 32nd) within each quarter-note beat
    const beams: Beam[] = [];
    let currentBeamGroup: StaveNote[] = [];
    let currentBeatBucket = -1;

    for (let i = 0; i < noteGroups.length; i++) {
      const g = noteGroups[i];
      const sn = staveNotes[i];
      const dur = sn.getDuration();
      const isFlagged = dur.includes("8") || dur.includes("16") || dur.includes("32");
      const beatBucket = Math.floor(Math.max(0, g.beat - startBeat + 0.01));

      if (isFlagged && (currentBeatBucket === -1 || currentBeatBucket === beatBucket)) {
        currentBeamGroup.push(sn);
        currentBeatBucket = beatBucket;
      } else {
        if (currentBeamGroup.length >= 2) {
          try {
            beams.push(new Beam(currentBeamGroup));
          } catch {}
        }
        currentBeamGroup = isFlagged ? [sn] : [];
        currentBeatBucket = isFlagged ? beatBucket : -1;
      }
    }
    if (currentBeamGroup.length >= 2) {
      try {
        beams.push(new Beam(currentBeamGroup));
      } catch {}
    }

    const voice = new Voice({ numBeats: this.timeSigNum, beatValue: this.timeSigDen });
    voice.setMode(Voice.Mode.SOFT);
    voice.addTickables(staveNotes);

    new Formatter().joinVoices([voice]).format([voice], Math.max(80, barWidth - 35));

    // Draw voice AFTER beams are linked (so VexFlow knows to suppress individual flags!)
    voice.draw(context, stave);

    // Draw horizontal beams
    beams.forEach(b => {
      try {
        b.setContext(context).draw();
      } catch {}
    });
  }

  /**
   * Lightweight per-frame animation updating playhead position and note highlights.
   */
  private updateScoreAnimation(): void {
    if (!this.container || !this.isVisible || typeof document === "undefined") return;

    const transport = this.getTransport();
    const cursorBeat = transport ? transport.getCursorBeat() : 0;
    const currentBar = Math.floor(Math.max(0, cursorBeat) / this.beatsPerBar);

    // If measure window advances, re-render full VexFlow score
    if (currentBar !== this.lastRenderedBar) {
      this.render();
      return;
    }

    // Update playhead X coordinate
    const bar1StartBeat = currentBar * this.beatsPerBar;
    const beatInSystem = cursorBeat - bar1StartBeat;
    const playheadFrac = Math.max(0, Math.min(1.0, beatInSystem / (2 * this.beatsPerBar)));
    const playheadX = this.staveMetrics.startX + playheadFrac * this.staveMetrics.totalWidth;

    const playheadEl = this.container.querySelector("#score-playhead");
    if (playheadEl) {
      playheadEl.setAttribute("transform", `translate(${playheadX.toFixed(2)}, 0)`);
    }

    // Update note highlight classes on VexFlow SVG elements
    for (const ref of this.currentNoteRefs) {
      const el = ref.staveNote.getSVGElement();
      if (!el) continue;

      const isSounding =
        cursorBeat >= ref.note.beat - 0.05 &&
        cursorBeat < ref.note.beat + Math.max(0.25, ref.note.durationBeats);
      const isPast = cursorBeat >= ref.note.beat + Math.max(0.25, ref.note.durationBeats);

      el.classList.toggle("sounding", isSounding);
      el.classList.toggle("past", isPast);
      el.classList.toggle("upcoming", !isSounding && !isPast);
    }
  }
}
