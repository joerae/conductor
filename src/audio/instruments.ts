/**
 * instruments.ts
 *
 * Maps MIDI program numbers (0–127) and channels to instrument names.
 * Used by the AudioEngine to select the right WebAudioFont voice.
 *
 * GM (General MIDI) program map — selected entries relevant to Eine Kleine:
 *   0–7:   Piano family
 *   40:    Violin
 *   41:    Viola
 *   42:    Cello
 *   43:    Contrabass
 *   44:    Tremolo strings
 *   48:    String ensemble 1
 *   49:    String ensemble 2
 *   56:    Trumpet
 *   57:    Trombone
 *   68:    Oboe
 *   71:    Clarinet
 *   73:    Flute
 *
 * Channel 9 is always percussion (GM spec).
 *
 * WebAudioFont variable names follow the pattern:
 *   _drum_N_SoundFont_sf2_file  (percussion)
 *   _tone_NNNNN_SoundFont_sf2_file  (melodic)
 * These are defined on window by the loaded JSON scripts.
 */

/** GM program family names for display purposes. */
export function programName(program: number): string {
  const names: Record<number, string> = {
    0: "Acoustic Grand Piano",
    1: "Bright Acoustic Piano",
    6: "Harpsichord",
    13: "Marimba",
    24: "Nylon Guitar",
    40: "Violin",
    41: "Viola",
    42: "Cello",
    43: "Contrabass",
    44: "Tremolo Strings",
    47: "Timpani",
    48: "String Ensemble 1",
    49: "String Ensemble 2",
    56: "Trumpet",
    57: "Trombone",
    60: "French Horn",
    68: "Oboe",
    70: "Bassoon",
    71: "Clarinet",
    73: "Flute",
  };
  return names[program] ?? `Program ${program}`;
}

/**
 * Maps a MIDI program number to a WebAudioFont variable name.
 * Falls back to String Ensemble 1 for unknown orchestral programs.
 * Variable names follow the pattern: _tone_PPPP_FluidR3_GM_sf2_file
 * where PPPP = program number × 10, zero-padded to 4 digits.
 */
export function programToWebAudioFontVar(program: number, channel: number): string {
  if (channel === 9) return "_drum_0_SoundFont_sf2_file";
  // Zero-pad program*10 to 4 digits
  const code = String(program * 10).padStart(4, "0");
  return `_tone_${code}_FluidR3_GM_sf2_file`;
}

/**
 * All WebAudioFont CDN script URLs needed for full symphony orchestra repertoire.
 * Using FluidR3_GM — high quality General MIDI SoundFont bank.
 * Variable names: _tone_PPPP_FluidR3_GM_sf2_file
 */
export const WEBAUDIOFONT_SCRIPTS: string[] = [
  // Piano (fallback)
  "https://surikov.github.io/webaudiofontdata/sound/0000_FluidR3_GM_sf2_file.js",
  // Strings
  "https://surikov.github.io/webaudiofontdata/sound/0400_FluidR3_GM_sf2_file.js",   // Violin   (prog 40)
  "https://surikov.github.io/webaudiofontdata/sound/0410_FluidR3_GM_sf2_file.js",   // Viola    (prog 41)
  "https://surikov.github.io/webaudiofontdata/sound/0420_FluidR3_GM_sf2_file.js",   // Cello    (prog 42)
  "https://surikov.github.io/webaudiofontdata/sound/0430_FluidR3_GM_sf2_file.js",   // Contrabass (prog 43)
  "https://surikov.github.io/webaudiofontdata/sound/0480_FluidR3_GM_sf2_file.js",   // String Ensemble 1 (prog 48)
  "https://surikov.github.io/webaudiofontdata/sound/0490_FluidR3_GM_sf2_file.js",   // String Ensemble 2 (prog 49)
  // Percussion
  "https://surikov.github.io/webaudiofontdata/sound/0470_FluidR3_GM_sf2_file.js",   // Timpani  (prog 47)
  // Winds & Reeds
  "https://surikov.github.io/webaudiofontdata/sound/0680_FluidR3_GM_sf2_file.js",   // Oboe     (prog 68)
  "https://surikov.github.io/webaudiofontdata/sound/0700_FluidR3_GM_sf2_file.js",   // Bassoon  (prog 70)
  "https://surikov.github.io/webaudiofontdata/sound/0710_FluidR3_GM_sf2_file.js",   // Clarinet (prog 71)
  "https://surikov.github.io/webaudiofontdata/sound/0730_FluidR3_GM_sf2_file.js",   // Flute    (prog 73)
  // Brass
  "https://surikov.github.io/webaudiofontdata/sound/0560_FluidR3_GM_sf2_file.js",   // Trumpet  (prog 56)
  "https://surikov.github.io/webaudiofontdata/sound/0600_FluidR3_GM_sf2_file.js",   // French Horn (prog 60)
];
