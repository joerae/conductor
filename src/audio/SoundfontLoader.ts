/**
 * SoundfontLoader.ts
 *
 * Handles WebAudioFont player initialization, external instrument script tag
 * injection with deduplication and retry resilience, and audio buffer decoding.
 */

import {
  WEBAUDIOFONT_SCRIPTS,
  WEBAUDIOFONT_PLAYER_URL,
  VIOLIN_SCRIPT_URL,
  getScriptsForPiece,
} from "./instruments";

// ─── WebAudioFont types ─────────────────────────────────────────────────────

declare global {
  interface Window {
    WebAudioFontPlayer: new () => WebAudioFontPlayerInstance;
    [key: string]: unknown; // for instrument bank variables
  }
}

export interface WebAudioFontEnvelope {
  cancel: () => void;
  audioBufferSourceNode?: AudioBufferSourceNode | null;
  disconnect?: () => void;
  when?: number;
  duration?: number;
  target?: AudioNode;
}

export interface WebAudioFontPlayerInstance {
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
  ) => WebAudioFontEnvelope;
  cancelQueue?: (ctx: AudioContext) => void;
  envelopes?: WebAudioFontEnvelope[];
}

export type ScriptLoaderFn = (url: string) => Promise<void>;

export class SoundfontLoader {
  public player: WebAudioFontPlayerInstance | null = null;
  public samplesLoaded: boolean = false;
  private loadedScriptUrls: Set<string> = new Set();
  private pendingScriptLoads: Map<string, Promise<void>> = new Map();

  /**
   * Initializes the global WebAudioFontPlayer instance.
   */
  async ensurePlayer(scriptLoader: ScriptLoaderFn = (url) => this.loadScript(url)): Promise<WebAudioFontPlayerInstance | null> {
    if (this.player) return this.player;
    await scriptLoader(WEBAUDIOFONT_PLAYER_URL);
    if (!this.player && typeof window !== "undefined" && (window as any).WebAudioFontPlayer) {
      this.player = new (window as any).WebAudioFontPlayer();
      (window as any)._conductorWebAudioFontPlayer = this.player;
    }
    return this.player;
  }

  /**
   * Loads an external script by injecting a <script> tag into document.head.
   * Handles in-flight promise deduplication and removes failed tags on error
   * to allow genuine retries.
   */
  loadScript(url: string): Promise<void> {
    if (this.loadedScriptUrls.has(url)) {
      return Promise.resolve();
    }
    const pending = this.pendingScriptLoads.get(url);
    if (pending) {
      return pending;
    }

    if (typeof document === "undefined") {
      return Promise.resolve();
    }

    const existing = document.querySelector(`script[src="${url}"]`) as HTMLScriptElement | null;
    if (existing && (existing.dataset?.loaded === "true" || existing.getAttribute("data-loaded") === "true")) {
      this.loadedScriptUrls.add(url);
      return Promise.resolve();
    }

    const loadPromise = new Promise<void>((resolve, reject) => {
      const script = existing || document.createElement("script");
      script.src = url;

      const cleanup = () => {
        this.pendingScriptLoads.delete(url);
      };

      script.onload = () => {
        if (script.dataset) {
          script.dataset.loaded = "true";
        } else {
          script.setAttribute("data-loaded", "true");
        }
        this.loadedScriptUrls.add(url);
        cleanup();
        resolve();
      };

      script.onerror = () => {
        cleanup();
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
        reject(new Error(`Failed to load script: ${url}`));
      };

      if (!existing) {
        document.head.appendChild(script);
      }
    });

    this.pendingScriptLoads.set(url, loadPromise);
    return loadPromise;
  }

  /**
   * Converts an instrument script URL into its global window variable name.
   * Example: ".../0400_FluidR3_GM_sf2_file.js" -> "_tone_0400_FluidR3_GM_sf2_file"
   */
  urlToVarName(url: string): string | null {
    const match = url.match(/\/([^/]+)\.js$/);
    if (!match) return null;
    return `_tone_${match[1]}`;
  }

  /**
   * Decodes a loaded script soundfont into the given AudioContext.
   */
  decodeScriptUrl(url: string, ctx: AudioContext): void {
    if (!this.player) return;
    const varName = this.urlToVarName(url);
    if (varName && (window as any)[varName]) {
      this.player.loader.decodeAfterLoading(ctx, varName);
    }
  }

  /**
   * Decodes all known WebAudioFont sample banks into the given AudioContext.
   */
  decodeLoadedSamples(ctx: AudioContext): void {
    if (!this.player) return;
    for (const url of WEBAUDIOFONT_SCRIPTS) {
      this.decodeScriptUrl(url, ctx);
    }
  }

  /**
   * Load the WebAudioFontPlayer and prioritized violin sample bank (Prog 40)
   * so the warm-up interactive loop can begin as early as possible.
   */
  async loadWarmupViolin(
    ctx?: AudioContext | null,
    scriptLoader: ScriptLoaderFn = (url) => this.loadScript(url)
  ): Promise<void> {
    await this.ensurePlayer(scriptLoader);
    await scriptLoader(VIOLIN_SCRIPT_URL);

    if (ctx && this.player) {
      this.decodeScriptUrl(VIOLIN_SCRIPT_URL, ctx);
    }
  }

  /**
   * Load only the instrument sample banks required for the given piece.
   */
  async loadPieceSamples(
    piece: { sections: Array<{ programs: number[] }> },
    ctx?: AudioContext | null,
    scriptLoader: ScriptLoaderFn = (url) => this.loadScript(url)
  ): Promise<void> {
    await this.ensurePlayer(scriptLoader);
    const urls = getScriptsForPiece(piece);
    await Promise.all(urls.map(url => scriptLoader(url)));

    if (ctx && this.player) {
      for (const url of urls) {
        this.decodeScriptUrl(url, ctx);
      }
    }
    this.samplesLoaded = true;
  }

  /**
   * Load all WebAudioFont sample banks needed for Phase 1/2/3.
   */
  async loadSamples(
    ctx?: AudioContext | null,
    scriptLoader: ScriptLoaderFn = (url) => this.loadScript(url)
  ): Promise<void> {
    if (this.samplesLoaded) return;
    await this.ensurePlayer(scriptLoader);

    await Promise.all(WEBAUDIOFONT_SCRIPTS.map(url => scriptLoader(url)));

    if (ctx && this.player) {
      this.decodeLoadedSamples(ctx);
    }

    this.samplesLoaded = true;
  }

  /**
   * Preload remaining repertoire soundfonts during browser idle time.
   */
  preloadRemainingSamples(
    ctx?: AudioContext | null,
    scriptLoader: ScriptLoaderFn = (url) => this.loadScript(url)
  ): void {
    const loadIdle = () => {
      Promise.all(WEBAUDIOFONT_SCRIPTS.map(url => scriptLoader(url)))
        .then(() => {
          if (ctx && this.player) {
            this.decodeLoadedSamples(ctx);
          }
        })
        .catch(err => console.warn("Background SoundFont preload idle warning:", err));
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      (window as any).requestIdleCallback(loadIdle);
    } else {
      setTimeout(loadIdle, 3000);
    }
  }
}
