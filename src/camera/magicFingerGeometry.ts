/**
 * magicFingerGeometry.ts
 *
 * Screen geometry abstractions, bounding box extraction from DOM,
 * ray-box intersection routines, and instrument section target projections.
 */

import type { PieceSection } from "../score/repertoire";

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface InstrumentSectionTarget {
  id: string;
  rect: ScreenRect;
}

export interface MagicFingerGeometryProvider {
  getCanvasRect(): ScreenRect | null;
  getSvgOverlayRect(): ScreenRect | null;
  getTempoTrackRect(): ScreenRect | null;
  getDynamicsTrackRect(): ScreenRect | null;
  getTempoContainerRect?(): ScreenRect | null;
  getDynamicsContainerRect?(): ScreenRect | null;
  getInstrumentSections(): InstrumentSectionTarget[];
}

export class DefaultDOMGeometryProvider implements MagicFingerGeometryProvider {
  getCanvasRect(): ScreenRect | null {
    if (typeof document === "undefined") return null;
    const el = document.getElementById("camera-canvas") || document.querySelector(".camera-canvas");
    return el ? el.getBoundingClientRect() : null;
  }

  getSvgOverlayRect(): ScreenRect | null {
    if (typeof document === "undefined") return null;
    const el = document.getElementById("stage-spotlight-ray-overlay");
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && el.parentElement) {
      return el.parentElement.getBoundingClientRect();
    }
    return rect;
  }

  getTempoTrackRect(): ScreenRect | null {
    if (typeof document === "undefined") return null;
    const el = document.querySelector<HTMLElement>(".bpm-gauge-track");
    return el ? el.getBoundingClientRect() : null;
  }

  getTempoContainerRect(): ScreenRect | null {
    if (typeof document === "undefined") return null;
    const el = document.getElementById("bpm-gauge-container") || document.querySelector<HTMLElement>(".bpm-vertical-gauge");
    return el ? el.getBoundingClientRect() : this.getTempoTrackRect();
  }

  getDynamicsTrackRect(): ScreenRect | null {
    if (typeof document === "undefined") return null;
    const verticalEl = document.getElementById("dynamic-vertical-analogue-track");
    if (verticalEl && verticalEl.offsetParent !== null) {
      return verticalEl.getBoundingClientRect();
    }
    const el = document.getElementById("dynamic-analogue-track");
    return el ? el.getBoundingClientRect() : null;
  }

  getDynamicsContainerRect(): ScreenRect | null {
    if (typeof document === "undefined") return null;
    const el = document.getElementById("dynamic-vertical-gauge-container") || document.querySelector<HTMLElement>(".dynamic-vertical-gauge-container");
    return el ? el.getBoundingClientRect() : this.getDynamicsTrackRect();
  }

  getInstrumentSections(): InstrumentSectionTarget[] {
    if (typeof document === "undefined") return [];
    const sections: InstrumentSectionTarget[] = [];
    const els = document.querySelectorAll<HTMLElement>(".instrument-section");
    els.forEach(el => {
      const dataId = el.getAttribute("data-section-id");
      const id = dataId || el.id.replace(/^section-/, "");
      sections.push({ id, rect: el.getBoundingClientRect() });
    });
    return sections;
  }
}

/**
 * Slab-method 2D ray vs Axis-Aligned Bounding Box intersection test.
 * Returns true if ray P(t) = (startX + t*dirX, startY + t*dirY) for t >= 0 intersects box.
 */
export function doesRayIntersectBox(
  startX: number,
  startY: number,
  dirX: number,
  dirY: number,
  box: { left: number; right: number; top: number; bottom: number },
  pad: number = 0
): boolean {
  const left = box.left - pad;
  const right = box.right + pad;
  const top = box.top - pad;
  const bottom = box.bottom + pad;

  let tMin = 0;
  let tMax = Infinity;

  if (Math.abs(dirX) < 1e-6) {
    if (startX < left || startX > right) return false;
  } else {
    const t1 = (left - startX) / dirX;
    const t2 = (right - startX) / dirX;
    const tNear = Math.min(t1, t2);
    const tFar = Math.max(t1, t2);
    tMin = Math.max(tMin, tNear);
    tMax = Math.min(tMax, tFar);
    if (tMin > tMax) return false;
  }

  if (Math.abs(dirY) < 1e-6) {
    if (startY < top || startY > bottom) return false;
  } else {
    const t1 = (top - startY) / dirY;
    const t2 = (bottom - startY) / dirY;
    const tNear = Math.min(t1, t2);
    const tFar = Math.max(t1, t2);
    tMin = Math.max(tMin, tNear);
    tMax = Math.min(tMax, tFar);
    if (tMin > tMax) return false;
  }

  return tMax > 0 && tMin <= tMax;
}

/**
 * Projects an upward pointing ray toward stage orchestra sections, finding
 * the closest intersecting section.
 */
export function getTargetedInstrumentSection(
  rayDirX: number,
  rayDirY: number,
  startX: number,
  startY: number,
  svgRect: ScreenRect,
  instrumentSections: InstrumentSectionTarget[],
  repertoireSections: PieceSection[] = []
): { sectionId: string; projectedHitX: number; projectedHitY: number } | null {
  if (rayDirY >= -0.10) return null;

  let effectiveSections: InstrumentSectionTarget[] = instrumentSections;
  if (effectiveSections.length === 0 && repertoireSections.length > 0) {
    const count = repertoireSections.length;
    const totalW = svgRect.width || 1000;
    effectiveSections = repertoireSections.map((sec, idx) => {
      const secW = (totalW * 0.76) / count;
      const left = (svgRect.left || 0) + totalW * 0.12 + idx * secW;
      return {
        id: sec.id,
        rect: {
          left,
          right: left + secW,
          top: (svgRect.top || 0) + 10,
          bottom: (svgRect.top || 0) + 120,
          width: secW,
          height: 110,
        },
      };
    });
  }

  if (effectiveSections.length === 0) return null;

  let targetBaselineY = 60;
  if (effectiveSections[0]) {
    const firstRect = effectiveSections[0].rect;
    targetBaselineY = (firstRect.top - svgRect.top) + firstRect.height * 0.78;
  }

  const rayDist = (startY - targetBaselineY) / (-rayDirY);
  const projectedHitX = startX + rayDirX * rayDist;
  const projectedHitY = startY + rayDirY * rayDist;

  let bestSectionId: string | null = null;
  let minDistance = Infinity;

  for (const sec of effectiveSections) {
    const secLeft = sec.rect.left - svgRect.left;
    const secRight = sec.rect.right - svgRect.left;
    const secCenterX = (secLeft + secRight) / 2;

    // Generous hit testing pad (15% on each side)
    const padX = (secRight - secLeft) * 0.15;
    if (projectedHitX >= secLeft - padX && projectedHitX <= secRight + padX) {
      const dist = Math.abs(projectedHitX - secCenterX);
      if (dist < minDistance) {
        minDistance = dist;
        bestSectionId = sec.id;
      }
    }
  }

  if (bestSectionId) {
    const numIdx = parseInt(bestSectionId, 10);
    if (!isNaN(numIdx) && repertoireSections[numIdx]) {
      bestSectionId = repertoireSections[numIdx].id;
    }
    return { sectionId: bestSectionId, projectedHitX, projectedHitY };
  }

  return null;
}
