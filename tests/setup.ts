/**
 * tests/setup.ts
 *
 * Vitest setup file:
 * Suppresses VexFlow canvas text measurement noise in headless Node environment
 * by providing a 2D canvas context mock for Element.setTextMeasurementCanvas
 * on both ESM and CommonJS VexFlow instances, and filtering the fallback console.warn.
 */

import { createRequire } from "module";
import { Element as EsmElement } from "vexflow";

const require = createRequire(import.meta.url);

const mockContext2D = {
  font: "",
  measureText: (text: string = "") => ({
    width: (text?.length ?? 1) * 8,
    actualBoundingBoxAscent: 10,
    actualBoundingBoxDescent: 2,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: (text?.length ?? 1) * 8,
    fontBoundingBoxAscent: 10,
    fontBoundingBoxDescent: 2,
  }),
};

const mockCanvas = {
  getContext: (type: string) => {
    if (type === "2d") return mockContext2D;
    return null;
  },
};

// 1. Set on ESM VexFlow
if (EsmElement && typeof EsmElement.setTextMeasurementCanvas === "function") {
  EsmElement.setTextMeasurementCanvas(mockCanvas as any);
}

// 2. Set on CJS VexFlow
try {
  const cjsVexFlow = require("vexflow");
  if (cjsVexFlow?.Element && typeof cjsVexFlow.Element.setTextMeasurementCanvas === "function") {
    cjsVexFlow.Element.setTextMeasurementCanvas(mockCanvas as any);
  }
} catch {
  // Ignore if CJS vexflow cannot be resolved
}

// 3. Filter txtCanvas console.warn in tests
const originalWarn = console.warn;
console.warn = (...args: any[]) => {
  if (typeof args[0] === "string" && args[0].includes("No context for txtCanvas")) {
    return;
  }
  originalWarn.apply(console, args);
};
