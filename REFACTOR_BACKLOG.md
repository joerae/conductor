# Refactoring Backlog: Agent Iteration Speed & Code Modularity

This document catalogs high-impact architectural refactorings designed to keep files small, reduce LLM context token consumption, lower edit collision risk, and improve agent iteration speed without changing application behaviour.

---

## Priority 1: Large Controller Decompositions

### 1. `src/camera/MagicFingerController.ts` (~1,500 lines)
*Target: Split into 3-4 focused modules under 400 lines each.*
- **Stage 1 (Geometry & Hit Testing)**: Extract DOM geometry providers, rectangle conversion, ray intersection, and instrument targeting into `src/camera/magicFingerGeometry.ts`. Pure unit tests for ray-vs-rect.
- **Stage 2 (Interaction State Machine)**: Consolidate overlapping state flags (`activeTarget`, `hoverTarget`, `isLockedIn`, `lockedTarget`, `lockedValue`) into a single discriminated interaction state.
- **Stage 3 (Vertical Control Logic)**: Extract duplicated tempo and vertical-dynamics gauge processing into a shared vertical-control function.

### 2. [COMPLETED] `src/main.ts` (Reduced from ~1,412 to ~344 lines)
- Extracted keyboard shortcuts, hotkeys, and wheel handling to [`src/input/keyboardShortcuts.ts`](file:///c:/Users/jraeb/Conductor/src/input/keyboardShortcuts.ts).
- Extracted DOM elements, HUD synchronization, and UI updates to [`src/ui/appBindings.ts`](file:///c:/Users/jraeb/Conductor/src/ui/appBindings.ts).
- Extracted SVG stage generation and section node tracking to [`src/ui/orchestraStage.ts`](file:///c:/Users/jraeb/Conductor/src/ui/orchestraStage.ts).
- Extracted prompt generation to [`src/ui/promptFormatter.ts`](file:///c:/Users/jraeb/Conductor/src/ui/promptFormatter.ts).
- Extracted version modal to [`src/ui/versionModal.ts`](file:///c:/Users/jraeb/Conductor/src/ui/versionModal.ts).
- Extracted repertoire modal to [`src/ui/repertoireModal.ts`](file:///c:/Users/jraeb/Conductor/src/ui/repertoireModal.ts).
- Extracted application bootstrap to [`src/experience/appBootstrap.ts`](file:///c:/Users/jraeb/Conductor/src/experience/appBootstrap.ts).

### 3. `src/experience/ExperienceController.ts` (~1,500 lines)
*Target: Separate state coordination from UI/Audio glue.*
- **Lifecycle & Mode Coordinator**: Extract camera-to-fallback transition logic into a dedicated fallback policy helper.
- **Score Transport Coordination**: Delegate transport state machine transitions directly to `ScoreTransport`.

---

## Priority 2: Subsystem Decoupling

### 4. `src/audio/AudioEngine.ts` (~1,300 lines)
*Target: Isolate audio caching and channel dynamics.*
- **Soundfont / Sample Loading Cache**: Extract sample fetch, decode, and caching logic into `src/audio/SoundfontLoader.ts`.
- **Mixer & Voice Management**: Extract channel gain scheduling, instrument muting, and soloing into `src/audio/ChannelMixer.ts`.

### 5. `src/ui/DebugOverlay.ts` (~1,400 lines)
*Target: Decompose monolithic debug UI.*
- **Telemetry Graph & Monitor**: Separate waveform / beat timing graphs into `src/ui/debug/TelemetryGraph.ts`.
- **Mode & Feature Flag Panel**: Separate feature flag checkboxes and tuning sliders into `src/ui/debug/FeatureFlagPanel.ts`.

---

## Priority 3: CSS & Styling Modularization

### 6. `src/style.css` (74KB single stylesheet)
*Target: Break down monolithic CSS into importable component stylesheets.*
- CSS edits currently require reading/parsing the entire 74KB stylesheet.
- Modularize via CSS `@import` or Vite imports:
  - `src/styles/base.css` (tokens, typography, reset)
  - `src/styles/score.css` (score visualizer & staff)
  - `src/styles/camera.css` (camera preview & Magic Finger gauges)
  - `src/styles/warmup.css` (tutorial & onboarding)
  - `src/styles/debug.css` (debug HUD & overlays)

---

## Priority 4: Test Suite & Tooling Speedups

### 7. Suppress VexFlow Canvas Mock Noise in Vitest
- Vitest outputs hundreds of lines of `Element: No context for txtCanvas. Returning empty text metrics` in `tests/scoreVisualizer.test.ts`.
- Creating a `tests/setup.ts` to cleanly mock `HTMLCanvasElement.getContext('2d')` text metrics will speed up test run reporting, reduce log truncation, and avoid polluting agent context during test runs.
