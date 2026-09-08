/**
 * orchestraStage.ts
 *
 * Handles dynamic SVG rendering for the orchestra stage, musician eggs,
 * section text elements, and velocity history.
 */

import type { PieceDefinition } from "../score/repertoire";
import type { VelocityDecomposition } from "../audio/dynamicsTypes";

export class OrchestraStage {
  private channelToSectionMap: Map<number, HTMLElement> = new Map();
  private trackNameToSectionMap: Map<string, HTMLElement> = new Map();
  private sectionMusicianEggsMap: Map<HTMLElement, SVGElement[]> = new Map();
  private sectionTextMap: Map<HTMLElement, {
    mainText: SVGTextElement | null;
    decompText: SVGTextElement | null;
    histText: SVGTextElement | null;
  }> = new Map();
  private sectionVelocityHistory = new Map<string, number[]>();

  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  clear(): void {
    this.channelToSectionMap.clear();
    this.trackNameToSectionMap.clear();
    this.sectionMusicianEggsMap.clear();
    this.sectionTextMap.clear();
    this.sectionVelocityHistory.clear();
  }

  renderPiece(piece: PieceDefinition, onClearVisuals: () => void): void {
    onClearVisuals();
    this.clear();

    let sectionsSvg = "";

    if (piece.layout === "chamber_strings") {
      // 4 sections in spacious classical semi-circle
      const positions = [
        { x: 160, labelX: 160, eggs: [{ cx: 115, cy: 74, rx: 22, ry: 32 }, { cx: 160, cy: 65, rx: 25, ry: 36 }, { cx: 205, cy: 74, rx: 22, ry: 32 }] },
        { x: 380, labelX: 380, eggs: [{ cx: 335, cy: 68, rx: 22, ry: 32 }, { cx: 380, cy: 60, rx: 25, ry: 36 }, { cx: 425, cy: 68, rx: 22, ry: 32 }] },
        { x: 620, labelX: 620, eggs: [{ cx: 575, cy: 68, rx: 22, ry: 32 }, { cx: 620, cy: 60, rx: 25, ry: 36 }, { cx: 665, cy: 68, rx: 22, ry: 32 }] },
        { x: 840, labelX: 840, eggs: [{ cx: 795, cy: 74, rx: 22, ry: 32 }, { cx: 840, cy: 65, rx: 25, ry: 36 }, { cx: 885, cy: 74, rx: 22, ry: 32 }] },
      ];

      piece.sections.forEach((sec, idx) => {
        const pos = positions[idx] || positions[0];
        sectionsSvg += `
          <g id="section-${sec.id}" class="instrument-section" data-section-id="${sec.id}">
            <g class="section-debug-hud">
              <rect x="${pos.labelX - 75}" y="0" width="150" height="52" rx="6" class="debug-vel-pill" />
              <text x="${pos.labelX}" y="17" text-anchor="middle" class="debug-vel-main">v: —</text>
              <text x="${pos.labelX}" y="31" text-anchor="middle" class="debug-vel-decomp">Raw — ➔ Macro —</text>
              <text x="${pos.labelX}" y="43" text-anchor="middle" class="debug-vel-history">History: —</text>
            </g>
            ${pos.eggs.map((e, ei) => `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" class="musician ${sec.id} egg-${ei}" />`).join("")}
            <text x="${pos.labelX}" y="122" text-anchor="middle" class="section-label">${sec.name}</text>
          </g>
        `;
      });
    } else {
      // 7 sections for Full Symphony Orchestra with 140px clean breathing room
      const positions7 = [
        { centerX: 75,  cy: 74 },
        { centerX: 215, cy: 68 },
        { centerX: 355, cy: 62 },
        { centerX: 500, cy: 58 },
        { centerX: 645, cy: 62 },
        { centerX: 785, cy: 68 },
        { centerX: 925, cy: 74 },
      ];

      piece.sections.forEach((sec, idx) => {
        const p = positions7[idx] || { centerX: 75 + idx * 140, cy: 68 };
        const centerX = p.centerX;
        const cy = p.cy;

        sectionsSvg += `
          <g id="section-${sec.id}" class="instrument-section" data-section-id="${sec.id}">
            <g class="section-debug-hud">
              <rect x="${centerX - 55}" y="0" width="110" height="52" rx="6" class="debug-vel-pill" />
              <text x="${centerX}" y="17" text-anchor="middle" class="debug-vel-main" style="font-size:11.5px;">v: —</text>
              <text x="${centerX}" y="31" text-anchor="middle" class="debug-vel-decomp" style="font-size:8.5px;">Raw —</text>
              <text x="${centerX}" y="43" text-anchor="middle" class="debug-vel-history" style="font-size:8px;">—</text>
            </g>
            <ellipse cx="${centerX - 21}" cy="${cy + 6}" rx="15" ry="23" class="musician ${sec.id} egg-0" />
            <ellipse cx="${centerX}" cy="${cy}" rx="17" ry="27" class="musician ${sec.id} egg-1" />
            <ellipse cx="${centerX + 21}" cy="${cy + 6}" rx="15" ry="23" class="musician ${sec.id} egg-2" />
            <text x="${centerX}" y="122" text-anchor="middle" class="section-label" style="font-size: 10px; letter-spacing: 0.05em;">${sec.name}</text>
          </g>
        `;
      });
    }

    this.container.innerHTML = `
      <svg viewBox="0 0 1000 140" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
        ${sectionsSvg}
        <!-- Stage floor -->
        <rect x="20" y="134" width="960" height="4" rx="2" class="stage-floor" />
      </svg>
    `;

    // Build mapping from channel & trackName to DOM section and pre-cache SVG child nodes
    piece.sections.forEach(sec => {
      const el = document.getElementById(`section-${sec.id}`);
      if (el) {
        sec.channels.forEach(ch => this.channelToSectionMap.set(ch, el));
        if (sec.trackNames) {
          sec.trackNames.forEach(tn => this.trackNameToSectionMap.set(tn.toUpperCase(), el));
        }
        const eggs = Array.from(el.querySelectorAll<SVGElement>(".musician"));
        this.sectionMusicianEggsMap.set(el, eggs);

        this.sectionTextMap.set(el, {
          mainText: el.querySelector<SVGTextElement>(".debug-vel-main"),
          decompText: el.querySelector<SVGTextElement>(".debug-vel-decomp"),
          histText: el.querySelector<SVGTextElement>(".debug-vel-history"),
        });
      }
    });
  }

  renderWarmup(onClearVisuals: () => void): void {
    onClearVisuals();
    this.clear();

    const centerX = 500;
    const cy = 68;
    const secId = "warmup-violin";

    const sectionsSvg = `
      <g id="section-${secId}" class="instrument-section" data-section-id="${secId}">
        <g class="section-debug-hud">
          <rect x="${centerX - 65}" y="0" width="130" height="42" rx="6" class="debug-vel-pill" />
          <text x="${centerX}" y="17" text-anchor="middle" class="debug-vel-main" style="font-size:11px;">Warm Up Soloist</text>
          <text x="${centerX}" y="31" text-anchor="middle" class="debug-vel-decomp" style="font-size:8.5px;">Concertmaster Violin</text>
        </g>
        <ellipse cx="${centerX - 24}" cy="${cy + 6}" rx="16" ry="24" class="musician violin egg-0" />
        <ellipse cx="${centerX}" cy="${cy}" rx="19" ry="29" class="musician violin egg-1" />
        <ellipse cx="${centerX + 24}" cy="${cy + 6}" rx="16" ry="24" class="musician violin egg-2" />
        <text x="${centerX}" y="122" text-anchor="middle" class="section-label" style="font-size: 13px; font-weight: 600; letter-spacing: 0.08em;">Violin</text>
      </g>
    `;

    this.container.innerHTML = `
      <svg viewBox="0 0 1000 140" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
        ${sectionsSvg}
        <!-- Stage floor -->
        <rect x="20" y="134" width="960" height="4" rx="2" class="stage-floor" />
      </svg>
    `;

    const el = document.getElementById(`section-${secId}`);
    if (el) {
      const eggs = Array.from(el.querySelectorAll<SVGElement>(".musician"));
      this.sectionMusicianEggsMap.set(el, eggs);
    }
  }

  getSection(channel: number, trackId: number | string): HTMLElement | null {
    return (
      this.channelToSectionMap.get(channel) ||
      this.trackNameToSectionMap.get(String(trackId).toUpperCase()) ||
      document.querySelector<HTMLElement>(".instrument-section")
    );
  }

  getMusicianEgg(section: HTMLElement, midiNote: number): SVGElement | null {
    const eggs =
      this.sectionMusicianEggsMap.get(section) ||
      Array.from(section.querySelectorAll<SVGElement>(".musician"));
    const eggIndex = Math.abs(midiNote) % Math.max(1, eggs.length);
    return eggs[eggIndex] || eggs[0] || null;
  }

  updateVelocityHistory(section: HTMLElement, velocity: number, decomp: VelocityDecomposition): void {
    const sectionKey = section.dataset.sectionId || "sec";
    let history = this.sectionVelocityHistory.get(sectionKey);
    if (!history) {
      history = [];
      this.sectionVelocityHistory.set(sectionKey, history);
    }
    history.unshift(velocity);
    if (history.length > 3) history.pop();

    const textElements = this.sectionTextMap.get(section);
    const mainText = textElements?.mainText || section.querySelector<SVGTextElement>(".debug-vel-main");
    const decompText = textElements?.decompText || section.querySelector<SVGTextElement>(".debug-vel-decomp");
    const histText = textElements?.histText || section.querySelector<SVGTextElement>(".debug-vel-history");

    if (mainText) {
      mainText.textContent = `v: ${velocity} (${decomp.dynamicLevel} ×${decomp.dynMultiplier.toFixed(2)})`;
    }
    if (decompText) {
      const deltaStr = decomp.macroDelta >= 0 ? `+${decomp.macroDelta}` : `${decomp.macroDelta}`;
      const macroStr = decomp.macroEnabled ? `Macro ${decomp.macro} (${deltaStr})` : `Raw ${decomp.raw}`;
      decompText.textContent = `Raw ${decomp.raw} ➔ ${macroStr}`;
    }
    if (histText) {
      histText.textContent = `History: ${history.join(" • ")}`;
    }
  }

  pulseWarmupViolin(): void {
    const secEl = document.getElementById("section-warmup-violin") || document.querySelector<HTMLElement>(".instrument-section");
    if (secEl) {
      const eggs =
        this.sectionMusicianEggsMap.get(secEl) ||
        Array.from(secEl.querySelectorAll<SVGElement>(".musician"));
      eggs.forEach(egg => egg.classList.add("playing"));
      setTimeout(() => eggs.forEach(egg => egg.classList.remove("playing")), 320);
    }
  }
}
