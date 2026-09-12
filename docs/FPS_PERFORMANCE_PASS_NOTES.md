# FPS Performance Pass Notes

## Purpose

This is a starting backlog for a dedicated frame-rate and responsiveness pass. The items below were noticed while implementing responsive layout. They are static code observations, not yet profiler-confirmed bottlenecks, so the first performance task should measure them on representative low/mid-range Chromebook hardware before changing behavior.

## Target and measurement baseline

Suggested targets:

- Sustain a visually smooth 30 FPS camera/tracking experience on the minimum supported Chromebook.
- Keep main-thread frame work below 16.7ms when aiming for 60Hz UI updates, and below 33.3ms under camera inference load.
- Avoid long tasks over 50ms during active conducting.
- Do not trade away gesture latency or audio scheduling stability merely to raise the displayed FPS number.

Capture separate traces for Expressive, Magic Finger, score popover, warmup, party/love effects, and debug-overlay states. Record camera FPS, inference FPS, inference duration, long tasks, rendering/painting time, GPU activity where available, and dropped frames.

## Candidate issues, in investigation order

### P0 — Gauge UI writes run on every animation frame

Evidence:

- `src/main.ts` runs `gaugeRenderLoop()` continuously with `requestAnimationFrame`.
- Each frame calls `updateBpmGaugeUI()` and `updateAnalogueDynamicUI()`.
- Those methods repeatedly assign text, inline positions, target-zone styles, and display values even when the underlying values have not changed.
- During warmup, `updateDynamicLadderUI()` can also toggle button classes and remove/re-add every stage dynamics class each frame.

Why it may matter: redundant style/text mutations can cause style invalidation and compete with MediaPipe and canvas work on the main thread.

Experiment:

1. Add last-rendered value caches and skip identical DOM writes.
2. Update slow-changing labels at a lower cadence while retaining smooth marker movement.
3. Compare scripting/render time and gesture latency before and after.

### P0 — Camera overlay performs DOM queries and layout reads during live rendering

Evidence:

- `CameraPreviewOverlay.render()` runs for every completed hand inference.
- In laser modes it repeatedly calls `document.getElementById`, multiple `querySelector` calls, and `getBoundingClientRect()` for the canvas, stage overlay, and instrument section.
- The same path then writes many SVG attributes in the same frame.
- Video opacity and transition inline styles are assigned on every render even if laser state has not changed.

Why it may matter: interleaving live layout reads with DOM/SVG writes can force synchronous layout or prevent the browser from coalescing work.

Experiment:

1. Cache stable SVG/DOM element references when the overlay mounts.
2. Cache geometry once per frame or until a resize/layout-state invalidation.
3. Only write opacity/transition when laser state changes.
4. Profile layout/recalculate-style events and pointer latency before and after.

### P1 — Score animation scans and mutates note DOM every display frame

Evidence:

- The score popover starts its own perpetual `requestAnimationFrame` loop while visible.
- Every frame queries the playhead element and iterates every rendered note reference.
- Each note receives three `classList.toggle()` calls regardless of whether its state changed.
- A full VexFlow SVG rebuild occurs whenever the measure window advances.

Why it may matter: the score is visible during a gesture-heavy mode, so its per-frame SVG work overlaps camera inference, canvas drawing, ray rendering, and audio UI updates.

Experiment:

1. Cache the playhead element and each note's last visual state.
2. Stop or reduce the loop while transport is paused and no visual state is changing.
3. Consider advancing highlights only when cursor progress crosses a meaningful threshold.
4. Measure the full VexFlow rebuild separately; retain it if its once-per-measure cost is negligible.

### P1 — Multiple independent animation loops compete on the main thread

Evidence:

- Hand tracking has a `requestAnimationFrame` loop and performs synchronous `detectForVideo()` for each new video frame.
- Gauges have a separate always-running animation loop.
- The score adds another loop while visible.
- The debug overlay has an always-scheduled animation loop; it skips rendering while hidden but still schedules every frame.

Why it may matter: independently scheduled loops duplicate timing overhead and can bunch work into the same frame.

Experiment:

1. Instrument each loop's duration before consolidating anything.
2. Evaluate a shared visual-frame coordinator for lightweight UI work while keeping inference scheduling separately controllable.
3. Stop scheduling optional loops entirely while their UI is hidden.

### P1 — Camera inference can run at every delivered video frame up to 60 FPS

Evidence:

- Camera constraints request 30 FPS as ideal but allow 60 FPS maximum.
- `HandTracker` calls synchronous `detectForVideo()` whenever `video.currentTime` advances, with no explicit inference budget or adaptive cap.

Why it may matter: some webcams may deliver more frames than a Chromebook can infer smoothly, consuming main-thread time without improving usable gesture resolution.

Experiment:

1. Measure inference time and delivered camera rate by device.
2. Test an adaptive inference cadence that targets available frame budget (for example, 30 FPS normally and lower only under sustained overload).
3. Measure end-to-end gesture latency; do not assume fewer inferences are automatically better.

### P2 — Large blurred/translucent surfaces and glow effects may be GPU-expensive

Evidence:

- Camera, gauges, score, selectors, modals, and warmup cards use multiple `backdrop-filter: blur(...)` layers and broad shadows.
- Score note highlights stack multiple drop shadows.
- Party and love modes animate large stage-sized gradient/filter layers continuously.
- Several status and celebration effects animate shadows or filters indefinitely.

Why it may matter: integrated Chromebook GPUs can struggle with large backdrop sampling regions, animated filters, and high-radius shadows, especially over live video.

Experiment:

1. Use Chrome paint flashing/layer tools and GPU traces to identify repainted regions.
2. Compare a `prefers-reduced-transparency`/low-effects style variant or targeted Chromebook-quality tier.
3. Replace only profiler-confirmed expensive effects; preserve the stage aesthetic elsewhere.

### P2 — High-frequency telemetry fan-out may duplicate work

Evidence:

- Every hand result updates the camera overlay and invokes telemetry, sample, focus, dynamics, and Magic Finger callback sets.
- Several callbacks ultimately update visible DOM that is also touched by the gauge animation loop.

Why it may matter: the same logical value can be formatted or written through more than one update path per frame.

Experiment:

1. Trace callback duration and count by subscriber.
2. Separate high-frequency motion data from low-frequency labels/telemetry.
3. Coalesce visual updates at the next animation frame while leaving audio/control decisions immediate.

### P2 — The production JavaScript ships as one large chunk

Evidence:

- The responsive-pass production build emitted a single 1,584.28 kB minified / 816.24 kB gzipped JavaScript chunk and triggered Vite's chunk-size warning.
- MediaPipe, VexFlow, MIDI/audio code, debug UI, warmup, and the main experience currently enter through the same application bundle.

Why it may matter: this is primarily a startup/parse/compile concern rather than a proven steady-state FPS issue, but slower Chromebook CPUs may experience extra main-thread pressure and memory use during initialization.

Experiment:

1. Use a bundle visualizer or build metafile to attribute the chunk before splitting it.
2. Evaluate lazy-loading optional/debug surfaces and loading score engraving only when the popover feature is first used.
3. Treat MediaPipe loading carefully so code splitting does not delay camera readiness or cause a mid-performance compile pause.
4. Compare startup long tasks, time-to-interactive, memory, and first-use latency—not just transfer size.

## Suggested performance-pass sequence

1. Establish reproducible traces on a Chromebook and a desktop reference machine.
2. Add lightweight timing markers around inference, overlay drawing, gauge updates, score animation, and debug rendering.
3. Eliminate identical DOM writes in the gauge loop.
4. Cache camera overlay elements and invalidate geometry only on resize/reflow/state changes.
5. Reduce score DOM churn.
6. Evaluate inference cadence only after UI overhead is separated from model cost.
7. Attribute the production bundle and test low-risk lazy-loading boundaries.
8. Tune visual effects last, based on GPU/paint evidence.
9. Re-run gesture latency, audio stability, and all visual modes after each optimization.

## Guardrails

- Preserve the camera's full uncropped frame and canvas alignment.
- Preserve live Magic Finger target accuracy after any geometry caching; all responsive layout changes must invalidate caches.
- Keep audio scheduling independent from visual throttling.
- Do not use the telemetry FPS counter alone as success criteria; include responsiveness, frame pacing, and long tasks.
- Prefer conditional work and cached values over reducing visual fidelity globally.
