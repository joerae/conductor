/**
 * repertoire.ts
 *
 * Defines the playable repertoire catalog for Conductor.
 */

export interface PieceSection {
  id: string;
  name: string;
  channels: number[];
  programs: number[];
  trackNames?: string[];
}

export interface PieceDefinition {
  id: string;
  title: string;
  subtitle: string;
  composer: string;
  movement: string;
  year: number;
  midiUrl: string;
  defaultBpm: number;
  timeSignature: string;
  layout: "chamber_strings" | "full_orchestra";
  description: string;
  sections: PieceSection[];
}

export const REPERTOIRE: PieceDefinition[] = [
  {
    id: "eine-kleine",
    title: "Eine Kleine Nachtmusik",
    subtitle: "Serenade No. 13 in G major, K. 525",
    composer: "W.A. Mozart",
    movement: "I. Allegro",
    year: 1787,
    midiUrl: "/midi/Eine-Kleine-Nachtmusik1.mid",
    defaultBpm: 140,
    timeSignature: "4/4",
    layout: "chamber_strings",
    description: "Mozart's celebrated serenade, opening with its iconic unison Mannheim rocket motif across all strings.",
    sections: [
      { id: "violin1", name: "Violin I", channels: [0], programs: [48, 40], trackNames: ["Violin I"] },
      { id: "violin2", name: "Violin II", channels: [3], programs: [48, 40], trackNames: ["Violin II"] },
      { id: "viola", name: "Viola", channels: [1], programs: [48, 41], trackNames: ["Viola"] },
      { id: "cello", name: "Cello / Bass", channels: [2], programs: [48, 42, 43], trackNames: ["Violoncello"] },
    ],
  },
  {
    id: "beethoven-5",
    title: "Symphony No. 5 in C minor",
    subtitle: "Op. 67 — 'Fate Knocking at the Door'",
    composer: "L.v. Beethoven",
    movement: "I. Allegro con brio",
    year: 1808,
    midiUrl: "/midi/5th-Symphony-Part-1.mid",
    defaultBpm: 108,
    timeSignature: "2/4",
    layout: "full_orchestra",
    description: "The most famous four-note motif in music history. Demands authoritative downbeats, dramatic holds, and explosive accelerandos.",
    sections: [
      { id: "woodwinds", name: "Flute & Oboe", channels: [0, 1], programs: [73, 68], trackNames: ["FLUTE", "OBOE"] },
      { id: "reeds", name: "Clarinet & Bassoon", channels: [2, 3], programs: [71, 70], trackNames: ["CLARINET", "BASSOON"] },
      { id: "horns", name: "French Horn", channels: [4], programs: [60], trackNames: ["FR.HORN"] },
      { id: "trumpets", name: "Trumpet", channels: [5], programs: [56], trackNames: ["TRUMPET"] },
      { id: "timpani", name: "Timpani", channels: [6], programs: [47], trackNames: ["TIMPANI"] },
      { id: "strings-upper", name: "Violins & Viola", channels: [7, 8], programs: [48], trackNames: ["STRINGS"] },
      { id: "strings-lower", name: "Cello & Contrabass", channels: [10, 11], programs: [48, 43], trackNames: ["STRINGS", "CONTRABASS"] },
    ],
  },
];

export function getPieceById(id: string): PieceDefinition | undefined {
  return REPERTOIRE.find(p => p.id === id);
}

export const DEFAULT_PIECE_ID = "eine-kleine";
