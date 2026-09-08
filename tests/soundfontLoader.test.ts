import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SoundfontLoader } from "../src/audio/SoundfontLoader";

describe("SoundfontLoader", () => {
  let loader: SoundfontLoader;
  let originalDocument: any;

  beforeEach(() => {
    loader = new SoundfontLoader();
    originalDocument = (globalThis as any).document;
  });

  afterEach(() => {
    (globalThis as any).document = originalDocument;
    vi.restoreAllMocks();
  });

  it("converts script URL to tone variable name", () => {
    const url = "https://example.com/soundfonts/0400_FluidR3_GM_sf2_file.js";
    expect(loader.urlToVarName(url)).toBe("_tone_0400_FluidR3_GM_sf2_file");

    const invalid = "https://example.com/soundfonts/invalid.css";
    expect(loader.urlToVarName(invalid)).toBeNull();
  });

  it("deduplicates in-flight loadScript calls for the same URL", async () => {
    const createdScripts: any[] = [];
    const mockHead = {
      appendChild: vi.fn((el: any) => {
        el.parentNode = mockHead;
        setTimeout(() => {
          if (el.onload) el.onload();
        }, 5);
      }),
      removeChild: vi.fn((el: any) => {
        el.parentNode = null;
      }),
    };

    (globalThis as any).document = {
      createElement: vi.fn(() => {
        const s: any = {
          dataset: {},
          src: "",
          parentNode: null,
          onload: null,
          onerror: null,
        };
        createdScripts.push(s);
        return s;
      }),
      querySelector: vi.fn(() => null),
      head: mockHead,
    };

    const p1 = loader.loadScript("https://example.com/test-script.js");
    const p2 = loader.loadScript("https://example.com/test-script.js");

    await Promise.all([p1, p2]);

    expect(createdScripts.length).toBe(1);
    expect(mockHead.appendChild).toHaveBeenCalledTimes(1);
  });

  it("allows retrying script load after failure by cleaning up pending promises", async () => {
    const createdScripts: any[] = [];
    const mockHead = {
      appendChild: vi.fn((el: any) => {
        el.parentNode = mockHead;
      }),
      removeChild: vi.fn((el: any) => {
        el.parentNode = null;
      }),
    };

    (globalThis as any).document = {
      createElement: vi.fn(() => {
        const s: any = {
          dataset: {},
          src: "",
          parentNode: null,
          onload: null,
          onerror: null,
        };
        createdScripts.push(s);
        return s;
      }),
      querySelector: vi.fn(() => null),
      head: mockHead,
    };

    const testUrl = "https://example.com/fail-then-succeed.js";

    // Attempt 1: fails
    const p1 = loader.loadScript(testUrl);
    expect(createdScripts.length).toBe(1);
    createdScripts[0].onerror();
    await expect(p1).rejects.toThrow("Failed to load script");
    expect(mockHead.removeChild).toHaveBeenCalledWith(createdScripts[0]);

    // Attempt 2: succeeds
    const p2 = loader.loadScript(testUrl);
    expect(createdScripts.length).toBe(2);
    createdScripts[1].onload();
    await expect(p2).resolves.toBeUndefined();

    // Subsequent call: cached
    await expect(loader.loadScript(testUrl)).resolves.toBeUndefined();
    expect(createdScripts.length).toBe(2);
  });
});
