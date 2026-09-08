# Refactoring Backlog: Agent Iteration Speed & Code Modularity

This document catalogs high-impact architectural refactorings designed to keep files small, reduce LLM context token consumption, lower edit collision risk, and improve agent iteration speed without changing application behaviour.

---

## Priority 1: Large Controller Decompositions

### 1. `src/camera/MagicFingerController.ts` (~1,500 lines)
*Target: Split into 3-4 focused modules under 400 lines each.*
- **Stage 1 (Geometry & Hit Testing)**: Extract DOM geometry providers, rectangle conversion, ray intersection, and instrument targeting into `src/camera/magicFingerGeometry.ts`. Pure unit tests for ray-vs-rect.
- **Stage 2 (Interaction State Machine)**: Consolidate overlapping state flags (`activeTarget`, `hoverTarget`, `isLockedIn`, `lockedTarget`, `lockedValue`) into a single discriminated interaction state.
- **Stage 3 (Vertical Control Logic)**: Extract duplicated tempo and vertical-dynamics gauge processing into a shared vertical-control function.

### 2. `src/main.ts` (~1,400 lines)
*Target: Turn `main.ts` into a lightweight orchestrator (< 250 lines).*
- **Keyboard & Shortcut Handler**: Extract keyboard shortcuts, playback hotkeys, and mode toggles into `src/input/keyboardShortcuts.ts`.
- **UI Binding & Mount Orchestration**: Extract manual DOM element lookups and event-listener wiring into a dedicated setup module (`src/ui/appBindings.ts`).
- **Telemetry & Mode Toggles**: Extract debug mode wiring into a dedicated bridge.

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
