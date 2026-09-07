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
    8: "Celesta",
    9: "Glockenspiel",
    13: "Marimba",
    24: "Nylon Guitar",
    40: "Violin",
    41: "Viola",
    42: "Cello",
    43: "Contrabass",
    44: "Tremolo Strings",
    46: "Orchestral Harp",
    47: "Timpani",
    48: "String Ensemble 1",
    49: "String Ensemble 2",
    56: "Trumpet",
    57: "Trombone",
    58: "Tuba",
    60: "French Horn",
    68: "Oboe",
    69: "English Horn",
    70: "Bassoon",
    71: "Clarinet",
    72: "Piccolo",
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
  // Keyboard / Mallet / Percussion
  "https://surikov.github.io/webaudiofontdata/sound/0000_FluidR3_GM_sf2_file.js",   // Grand Piano (prog 0)
  "https://surikov.github.io/webaudiofontdata/sound/0080_FluidR3_GM_sf2_file.js",   // Celesta (prog 8)
  "https://surikov.github.io/webaudiofontdata/sound/0090_FluidR3_GM_sf2_file.js",   // Glockenspiel (prog 9)
  "https://surikov.github.io/webaudiofontdata/sound/0460_FluidR3_GM_sf2_file.js",   // Orchestral Harp (prog 46)
  "https://surikov.github.io/webaudiofontdata/sound/0470_FluidR3_GM_sf2_file.js",   // Timpani (prog 47)
  // Strings
  "https://surikov.github.io/webaudiofontdata/sound/0400_FluidR3_GM_sf2_file.js",   // Violin (prog 40)
  "https://surikov.github.io/webaudiofontdata/sound/0410_FluidR3_GM_sf2_file.js",   // Viola (prog 41)
  "https://surikov.github.io/webaudiofontdata/sound/0420_FluidR3_GM_sf2_file.js",   // Cello (prog 42)
  "https://surikov.github.io/webaudiofontdata/sound/0430_FluidR3_GM_sf2_file.js",   // Contrabass (prog 43)
  "https://surikov.github.io/webaudiofontdata/sound/0480_FluidR3_GM_sf2_file.js",   // String Ensemble 1 (prog 48)
  "https://surikov.github.io/webaudiofontdata/sound/0490_FluidR3_GM_sf2_file.js",   // String Ensemble 2 (prog 49)
  // Winds & Reeds
  "https://surikov.github.io/webaudiofontdata/sound/0680_FluidR3_GM_sf2_file.js",   // Oboe (prog 68)
  "https://surikov.github.io/webaudiofontdata/sound/0690_FluidR3_GM_sf2_file.js",   // English Horn (prog 69)
  "https://surikov.github.io/webaudiofontdata/sound/0700_FluidR3_GM_sf2_file.js",   // Bassoon (prog 70)
  "https://surikov.github.io/webaudiofontdata/sound/0710_FluidR3_GM_sf2_file.js",   // Clarinet (prog 71)
  "https://surikov.github.io/webaudiofontdata/sound/0720_FluidR3_GM_sf2_file.js",   // Piccolo (prog 72)
  "https://surikov.github.io/webaudiofontdata/sound/0730_FluidR3_GM_sf2_file.js",   // Flute (prog 73)
  // Brass
  "https://surikov.github.io/webaudiofontdata/sound/0560_FluidR3_GM_sf2_file.js",   // Trumpet (prog 56)
  "https://surikov.github.io/webaudiofontdata/sound/0570_FluidR3_GM_sf2_file.js",   // Trombone (prog 57)
  "https://surikov.github.io/webaudiofontdata/sound/0580_FluidR3_GM_sf2_file.js",   // Tuba (prog 58)
  "https://surikov.github.io/webaudiofontdata/sound/0600_FluidR3_GM_sf2_file.js",   // French Horn (prog 60)
];

export const WEBAUDIOFONT_PLAYER_URL =
  "https://surikov.github.io/webaudiofont/npm/dist/WebAudioFontPlayer.js";

export const VIOLIN_SCRIPT_URL =
  "https://surikov.github.io/webaudiofontdata/sound/0400_FluidR3_GM_sf2_file.js";

export function getProgramScriptUrl(program: number): string {
  const code = String(program * 10).padStart(4, "0");
  return `https://surikov.github.io/webaudiofontdata/sound/${code}_FluidR3_GM_sf2_file.js`;
}

/**
 * Returns only the WebAudioFont script URLs required for the given piece.
 * Always includes piano fallback (prog 0) and violin (prog 40).
 */
export function getScriptsForPiece(piece: { sections: Array<{ programs: number[] }> }): string[] {
  const neededPrograms = new Set<number>([0, 40]);
  for (const section of piece.sections) {
    for (const prog of section.programs) {
      neededPrograms.add(prog);
    }
  }

  const scripts: string[] = [];
  for (const prog of neededPrograms) {
    const url = getProgramScriptUrl(prog);
    if (!scripts.includes(url)) {
      scripts.push(url);
    }
  }
  return scripts;
}

/**
 * Infers a General MIDI program number (0-127) from an instrument or track name string.
 * Used as a fallback when MIDI files lack Program Change events and default to 0 (Piano).
 */
export function inferProgramFromTrackName(name: string): number | null {
  if (!name || typeof name !== "string") return null;
  const lower = name.toLowerCase();

  // Percussion & Mallets (checked first so compound names like "Piccolo Snares" match percussion)
  if (lower.includes("snare") || lower.includes("cymbal") || lower.includes("drum") || lower.includes("percussion") || lower.includes("piatti")) return 47;
  if (lower.includes("timpani") || lower.includes("kettledrum") || lower.includes("pauken")) return 47;
  if (lower.includes("glockenspiel") || lower.includes("bells")) return 9;
  if (lower.includes("celeste") || lower.includes("celesta")) return 8;
  if (lower.includes("harp") || lower.includes("harfe") || lower.includes("arpa")) return 46;

  // Woodwinds
  if (lower.includes("piccolo")) return 72;
  if (lower.includes("cor anglais") || lower.includes("english horn")) return 69;
  if (lower.includes("flute") || lower.includes("flauto")) return 73;
  if (lower.includes("oboe") || lower.includes("hautbois")) return 68;
  if (lower.includes("clarinet") || lower.includes("klarinette")) return 71;
  if (lower.includes("bassoon") || lower.includes("fagott")) return 70;

  // Brass
  if (lower.includes("french horn") || lower.includes("corno") || lower.includes("horn")) return 60;
  if (lower.includes("trumpet") || lower.includes("tromba") || lower.includes("trompete")) return 56;
  if (lower.includes("trombone") || lower.includes("posaune")) return 57;
  if (lower.includes("tuba")) return 58;

  // Strings
  if (lower.includes("violin") || lower.includes("violine") || lower.includes("violino") || lower.includes("vln")) return 40;
  if (lower.includes("viola") || lower.includes("bratsche") || lower.includes("vla")) return 41;
  if (lower.includes("violoncello") || lower.includes("cello") || lower.includes("vlc")) return 42;
  if (lower.includes("contrabass") || lower.includes("contra bass") || lower.includes("double bass") || lower.includes("kontrabass") || lower.includes("bass")) return 43;
  if (lower.includes("string") || lower.includes("streicher") || lower.includes("archi")) return 48;

  return null;
}

