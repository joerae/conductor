# Refactoring Backlog: Agent Iteration Speed & Code Modularity

This document catalogs high-impact architectural refactorings designed to keep files small, reduce LLM context token consumption, lower edit collision risk, and improve agent iteration speed without changing application behaviour.

---

## Priority 1: Large Controller Decompositions

### 1. [COMPLETED] `src/camera/MagicFingerController.ts` (Reduced from ~1,549 to ~590 lines)
- Extracted DOM geometry providers, ray-vs-AABB intersection, and orchestra targeting to [`src/camera/magicFingerGeometry.ts`](file:///c:/Users/jraeb/Conductor/src/camera/magicFingerGeometry.ts) (216 lines).
- Extracted pointing gesture arbitration, fist curl detection, and angular velocity direction smoothing to [`src/camera/magicFingerMotion.ts`](file:///c:/Users/jraeb/Conductor/src/camera/magicFingerMotion.ts) (278 lines).
- Extracted vertical and horizontal slider tracking, trajectory smoothing, and hold-to-lock charge tracking to [`src/camera/magicFingerGauges.ts`](file:///c:/Users/jraeb/Conductor/src/camera/magicFingerGauges.ts) (376 lines).
- Extracted locked-in state evaluation, rearming checks, and dimmed ray generation to [`src/camera/magicFingerLock.ts`](file:///c:/Users/jraeb/Conductor/src/camera/magicFingerLock.ts) (160 lines).
- Extracted active target slider control to [`src/camera/magicFingerActive.ts`](file:///c:/Users/jraeb/Conductor/src/camera/magicFingerActive.ts) (354 lines).
- Extracted safe dwell/delta gauge & spotlight acquisition to [`src/camera/magicFingerAcquisition.ts`](file:///c:/Users/jraeb/Conductor/src/camera/magicFingerAcquisition.ts) (289 lines).
- Added comprehensive unit tests for ray and geometry math in [`tests/magicFingerGeometry.test.ts`](file:///c:/Users/jraeb/Conductor/tests/magicFingerGeometry.test.ts).

### 2. [COMPLETED] `src/main.ts` (Reduced from ~1,412 to ~344 lines)
- Extracted keyboard shortcuts, hotkeys, and wheel handling to [`src/input/keyboardShortcuts.ts`](file:///c:/Users/jraeb/Conductor/src/input/keyboardShortcuts.ts).
- Extracted DOM elements, HUD synchronization, and UI updates to [`src/ui/appBindings.ts`](file:///c:/Users/jraeb/Conductor/src/ui/appBindings.ts).
- Extracted SVG stage generation and section node tracking to [`src/ui/orchestraStage.ts`](file:///c:/Users/jraeb/Conductor/src/ui/orchestraStage.ts).
- Extracted prompt generation to [`src/ui/promptFormatter.ts`](file:///c:/Users/jraeb/Conductor/src/ui/promptFormatter.ts).
- Extracted version modal to [`src/ui/versionModal.ts`](file:///c:/Users/jraeb/Conductor/src/ui/versionModal.ts).
- Extracted repertoire modal to [`src/ui/repertoireModal.ts`](file:///c:/Users/jraeb/Conductor/src/ui/repertoireModal.ts).
- Extracted application bootstrap to [`src/experience/appBootstrap.ts`](file:///c:/Users/jraeb/Conductor/src/experience/appBootstrap.ts).

### 3. [COMPLETED] `src/experience/ExperienceController.ts` (Reduced from ~1,671 to ~552 lines)
- Extracted camera-driven tempo math (Classic height vs Flipped span and beating hand variance detection) to [`src/experience/gesturalTempoMath.ts`](file:///c:/Users/jraeb/Conductor/src/experience/gesturalTempoMath.ts) (116 lines).
- Extracted real-time camera gesture processing (hands-down fade/grace period, thumbs-down cutoff, double victory party mode, gestural tempo slew filter) to [`src/experience/cameraGestureHandler.ts`](file:///c:/Users/jraeb/Conductor/src/experience/cameraGestureHandler.ts) (218 lines).
- Extracted camera provider lifecycle and telemetry streams (loading coordinator tasks, dynamic ladder rate limiting, section focus mixing, spotlight panning) to [`src/experience/cameraWiring.ts`](file:///c:/Users/jraeb/Conductor/src/experience/cameraWiring.ts) (196 lines).
- Extracted playback lifecycle and transport coordination (`startPlayback`, `pausePlayback`, `restartPlayback`, `handlePieceComplete`, `handleClockEvent`, `handleBeatObservation`) to [`src/experience/playbackCoordinator.ts`](file:///c:/Users/jraeb/Conductor/src/experience/playbackCoordinator.ts) (274 lines).
- Added comprehensive unit tests for gestural tempo math in [`tests/gesturalTempoMath.test.ts`](file:///c:/Users/jraeb/Conductor/tests/gesturalTempoMath.test.ts).

---

## Priority 2: Subsystem Decoupling

### 4. [COMPLETED] `src/audio/AudioEngine.ts` (Reduced from ~1,436 to ~1,086 lines)
- Extracted WebAudioFont player lifecycle, script tag injection, promise deduplication, and soundfont buffer decoding to [`src/audio/SoundfontLoader.ts`](file:///c:/Users/jraeb/Conductor/src/audio/SoundfontLoader.ts) (240 lines).
- Extracted spatial stereo bus allocation, seating pan distribution, and section focus / spotlight dynamics to [`src/audio/ChannelMixer.ts`](file:///c:/Users/jraeb/Conductor/src/audio/ChannelMixer.ts) (281 lines).
- Added comprehensive unit tests for script loading and channel mixing in [`tests/soundfontLoader.test.ts`](file:///c:/Users/jraeb/Conductor/tests/soundfontLoader.test.ts) and [`tests/channelMixer.test.ts`](file:///c:/Users/jraeb/Conductor/tests/channelMixer.test.ts).

### 5. [COMPLETED] `src/ui/DebugOverlay.ts` (Reduced from ~1,152 to ~301 lines)
- Extracted debug controls, feature flag checkboxes, algorithm mode buttons, and tuning sliders to [`src/ui/debug/FeatureFlagPanel.ts`](file:///c:/Users/jraeb/Conductor/src/ui/debug/FeatureFlagPanel.ts) (514 lines).
- Extracted real-time telemetry tables, kinematics monitors, and rolling beat logs to [`src/ui/debug/TelemetryGraph.ts`](file:///c:/Users/jraeb/Conductor/src/ui/debug/TelemetryGraph.ts) (480 lines).
- Added comprehensive unit tests for panel controls and telemetry rendering in [`tests/debugOverlayComponents.test.ts`](file:///c:/Users/jraeb/Conductor/tests/debugOverlayComponents.test.ts).

---

## Priority 3: CSS & Styling Modularization

### 6. [COMPLETED] `src/style.css` (Reduced from 74KB monolithic stylesheet to clean modular imports)
- Modularized styles into 5 focused component stylesheets in `src/styles/`:
  - [`src/styles/base.css`](file:///c:/Users/jraeb/Conductor/src/styles/base.css) (Design system tokens, typography, reset, stage layout, piece info, footer, and modals - 27.5KB)
  - [`src/styles/camera.css`](file:///c:/Users/jraeb/Conductor/src/styles/camera.css) (Camera preview overlay, vertical BPM & dynamics speedometers, dynamic ribbons, Magic Finger lock bursts, gesture banners, and spotlight laser rays - 29.1KB)
  - [`src/styles/score.css`](file:///c:/Users/jraeb/Conductor/src/styles/score.css) (Spotlight mode score visualizer panel and VexFlow stave note states - 4.4KB)
  - [`src/styles/warmup.css`](file:///c:/Users/jraeb/Conductor/src/styles/warmup.css) (Interactive warming up tutorial and minimal loading cards - 10.7KB)
  - [`src/styles/debug.css`](file:///c:/Users/jraeb/Conductor/src/styles/debug.css) (Diagnostic HUD overlays and section velocity telemetry - 2.6KB)
- Streamlined [`src/style.css`](file:///c:/Users/jraeb/Conductor/src/style.css) into a clean, single-entrypoint stylesheet importing all modules.

---

## Priority 4: Test Suite & Tooling Speedups

### 7. [COMPLETED] Suppress VexFlow Canvas Mock Noise in Vitest
- Created [`tests/setup.ts`](file:///c:/Users/jraeb/Conductor/tests/setup.ts) providing a lightweight 2D canvas context mock for `Element.setTextMeasurementCanvas` across ESM and CommonJS VexFlow instances, and filtering the fallback text metric warning in console.warn.
- Configured `setupFiles: ["tests/setup.ts"]` in [`vitest.config.ts`](file:///c:/Users/jraeb/Conductor/vitest.config.ts).
- Cleaned up test output across all 28 test suites, eliminating hundreds of lines of noise and accelerating test reporting.
