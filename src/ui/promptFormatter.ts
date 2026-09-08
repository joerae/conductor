/**
 * promptFormatter.ts
 *
 * Generates user instruction prompts based on current experience state,
 * input source, and tempo mode.
 */

import type { ExperienceState, InputSource } from "../experience/ExperienceController";
import type { TempoMode } from "../clock/ConductorClock";

export function getPromptText(
  state: ExperienceState,
  pausedBeat: number,
  inputSource: InputSource = "keyboard",
  tempoMode?: TempoMode
): string {
  if (inputSource === "camera") {
    if (tempoMode === "magic") {
      switch (state) {
        case "loading":
          return "Preparing orchestra and loading hand tracking AI model…";
        case "ready":
          return "Raise your hand (point) to begin conducting";
        case "preparing":
          return "Magic finger active — starting orchestra…";
        case "playing":
          return "👆 Aim laser pointer at Tempo Gauge, Dynamics Ribbon, or Orchestra Sections";
        case "paused":
          return `Orchestra paused at beat ${pausedBeat.toFixed(1)}. Raise hand to resume.`;
        case "completed":
          return "Bravo! Masterpiece concluded. Raise hand to conduct again.";
      }
    }

    if (tempoMode === "gestural") {
      switch (state) {
        case "loading":
          return "Preparing orchestra and loading hand tracking AI model…";
        case "ready":
          return "Raise your hands to begin";
        case "preparing":
          return "Hands raised — starting orchestra…";
        case "playing":
          return "Playing! 👎 Thumb down for dramatic cutoff • ✌️✌️ Double Peace for Party Mode!";
        case "paused":
          return `Orchestra paused at beat ${pausedBeat.toFixed(1)}. Raise hands to resume.`;
        case "completed":
          return "Bravo! Masterpiece concluded. Raise hands to conduct again.";
      }
    }

    if (tempoMode === "inertial") {
      switch (state) {
        case "loading":
          return "Preparing orchestra and loading hand tracking AI model…";
        case "ready":
          return "Camera active. Conduct in 2 (1 stroke = 2 beats) to set the tempo!";
        case "preparing":
          return pausedBeat > 0
            ? `Resume conducting from beat ${pausedBeat.toFixed(1)} (cut time)…`
            : "Beat once more to establish tempo…";
        case "playing":
          return "Conducting in cut time (1 stroke = 2 beats). Steer tempo or coast freely.";
        case "paused":
          return `Orchestra paused at beat ${pausedBeat.toFixed(1)}. Conduct two beats to resume.`;
        case "completed":
          return "Bravo! Masterpiece concluded. Conduct again in cut time.";
      }
    }

    switch (state) {
      case "loading":
        return "Preparing orchestra and loading hand tracking AI model…";
      case "ready":
        return "Camera active. Move your hand down and back up to conduct.";
      case "preparing":
        return pausedBeat > 0
          ? `Resume motion from beat ${pausedBeat.toFixed(1)}…`
          : "Good — continue your conducting motion…";
      case "playing":
        return "Orchestra following your motion. Keep conducting.";
      case "paused":
        return `Orchestra paused at beat ${pausedBeat.toFixed(1)}. Move your hands to resume.`;
      case "completed":
        return "Bravo! Masterpiece concluded. Conduct again.";
    }
  }

  // Keyboard input source
  if (tempoMode === "magic") {
    switch (state) {
      case "loading":
        return "Preparing the orchestra and instruments…";
      case "ready":
        return "Magic Finger active. Switch to Camera (C) to point, or press SPACE to begin.";
      case "preparing":
        return "Starting orchestra…";
      case "playing":
        return "Playing! Switch to Camera (C) to use laser pointer, or press SPACE / P to pause.";
      case "paused":
        return `Orchestra paused at beat ${pausedBeat.toFixed(1)}. Press SPACE or P to resume.`;
      case "completed":
        return "Bravo! Masterpiece concluded. Press SPACE to conduct again.";
    }
  }

  if (tempoMode === "gestural") {
    switch (state) {
      case "loading":
        return "Preparing the orchestra and instruments…";
      case "ready":
        return "Keyboard active. Press SPACE or P to begin, ← / → for tempo, ↑ / ↓ for volume.";
      case "preparing":
        return "Starting orchestra…";
      case "playing":
        return "Playing! Use ← / → for tempo (accelerando/rallentando), ↑ / ↓ for volume, P to pause.";
      case "paused":
        return `Orchestra paused at beat ${pausedBeat.toFixed(1)}. Press SPACE or P to resume.`;
      case "completed":
        return "Bravo! Masterpiece concluded. Press SPACE to conduct again.";
    }
  }

  switch (state) {
    case "loading":
      return "Preparing the orchestra and instruments…";
    case "ready":
      return "Tap SPACE twice to set the pulse (1 tap = 1 beat).";
    case "preparing":
      return pausedBeat > 0
        ? `Tap SPACE once more to resume from beat ${pausedBeat.toFixed(1)}…`
        : "Good — tap SPACE once more to begin…";
    case "playing":
      return "Orchestra is playing. Tap SPACE to steer the tempo (1 tap = 1 beat).";
    case "paused":
      return `Orchestra paused at beat ${pausedBeat.toFixed(1)}. Tap SPACE twice to resume from here.`;
    case "completed":
      return "Bravo! Masterpiece concluded. Tap SPACE twice to conduct again.";
  }
  return "Tap SPACE to conduct.";
}
