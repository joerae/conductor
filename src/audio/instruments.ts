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
    48: "String Ensemble 1",
    49: "String Ensemble 2",
    56: "Trumpet",
    57: "Trombone",
    60: "French Horn",
    68: "Oboe",
    71: "Clarinet",
    73: "Flute",
  };
  return names[program] ?? `Program ${program}`;
}

/**
 * Maps a MIDI program number to a WebAudioFont variable name.
 * Falls back to String Ensemble 1 for unknown orchestral programs.
 */
export function programToWebAudioFontVar(program: number, channel: number): string {
  if (channel === 9) return "_drum_0_SoundFont_sf2_file";
  const map: Record<number, string> = {
    0:  "_tone_0000_SoundFont_sf2_file",
    1:  "_tone_0010_SoundFont_sf2_file",
    40: "_tone_0400_SoundFont_sf2_file",
    41: "_tone_0410_SoundFont_sf2_file",
    42: "_tone_0420_SoundFont_sf2_file",
    43: "_tone_0430_SoundFont_sf2_file",
    44: "_tone_0440_SoundFont_sf2_file",
    48: "_tone_0480_SoundFont_sf2_file",
    49: "_tone_0490_SoundFont_sf2_file",
    56: "_tone_0560_SoundFont_sf2_file",
    57: "_tone_0570_SoundFont_sf2_file",
    60: "_tone_0600_SoundFont_sf2_file",
    68: "_tone_0680_SoundFont_sf2_file",
    71: "_tone_0710_SoundFont_sf2_file",
    73: "_tone_0730_SoundFont_sf2_file",
  };
  // Default: String Ensemble 1
  return map[program] ?? "_tone_0480_SoundFont_sf2_file";
}

/**
 * All WebAudioFont CDN script URLs needed for Eine Kleine.
 * These define sample banks on window when loaded as <script> tags.
 */
export const WEBAUDIOFONT_SCRIPTS: string[] = [
  "https://surikov.github.io/webaudiofontdata/sound/0000_SoundFont_sf2_file.js",   // Piano
  "https://surikov.github.io/webaudiofontdata/sound/0400_SoundFont_sf2_file.js",   // Violin
  "https://surikov.github.io/webaudiofontdata/sound/0410_SoundFont_sf2_file.js",   // Viola
  "https://surikov.github.io/webaudiofontdata/sound/0420_SoundFont_sf2_file.js",   // Cello
  "https://surikov.github.io/webaudiofontdata/sound/0430_SoundFont_sf2_file.js",   // Contrabass
  "https://surikov.github.io/webaudiofontdata/sound/0480_SoundFont_sf2_file.js",   // String Ensemble 1
  "https://surikov.github.io/webaudiofontdata/sound/0490_SoundFont_sf2_file.js",   // String Ensemble 2
  "https://surikov.github.io/webaudiofontdata/sound/0560_SoundFont_sf2_file.js",   // Trumpet
  "https://surikov.github.io/webaudiofontdata/sound/0600_SoundFont_sf2_file.js",   // French Horn
  "https://surikov.github.io/webaudiofontdata/sound/0680_SoundFont_sf2_file.js",   // Oboe
  "https://surikov.github.io/webaudiofontdata/sound/0710_SoundFont_sf2_file.js",   // Clarinet
  "https://surikov.github.io/webaudiofontdata/sound/0730_SoundFont_sf2_file.js",   // Flute
];
