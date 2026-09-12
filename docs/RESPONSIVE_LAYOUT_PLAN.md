# Responsive Performance Layout Plan

## Goal

Make the Orchestra performance screen usable across large desktops, Chromebook-sized windows, tablets, and phones without losing access to the camera, orchestra, tempo, dynamics, score, or primary controls.

The layout should respond to both **width and height**. A 1366 × 768 Chromebook and a tall 768 × 1024 tablet have similar pixel counts but need different arrangements.

## What the screenshots and current code show

The compact desktop screenshot is not primarily a camera bug. Several independent minimum sizes and overlays combine to make the page feel fixed-size:

- The camera slot has a `min-height` of 380px, increased to 480px during warmup.
- Both vertical gauges have a 520px minimum height and a nominal height of 616px.
- The performance row stays horizontal at all widths. Only the bottom mode selectors currently have responsive breakpoints.
- The stage scrolls, but the fixed footer can cover content instead of participating in the layout.
- The score card is viewport-positioned and can cover the title or orchestra. Its card width becomes responsive, but the notation renderer still enforces a 520px internal minimum, so it can overflow a narrow card.
- Camera width is capped at 720px, but it is not constrained by the remaining viewport height. On a short landscape screen, its natural video aspect ratio can therefore consume most of the page.

The useful foundations are already present:

- The camera video and hand canvas scale together.
- The canvas retains the camera's intrinsic resolution, so reducing its displayed size need not reduce tracking accuracy.
- Magic Finger and instrument targeting use current `getBoundingClientRect()` values. Reflowed targets should remain correct as long as resize and state-change behavior is tested.
- The stage already allows vertical scrolling, which provides a safe fallback for exceptionally small windows.

## Recommended responsive model

Use layout capabilities rather than device detection. Exact breakpoint values should be tuned in-browser, but implementation should begin with these test profiles.

| Profile | Initial viewport range | Layout behavior |
| --- | --- | --- |
| Spacious landscape | width ≥ 1200px and height ≥ 800px | Keep the current three-column performance row: optional dynamics gauge, camera, tempo gauge. Preserve the full visual treatment. |
| Compact landscape / Chromebook | width ≥ 900px or landscape aspect, with height < 800px | Keep gauges beside the camera, but reduce chrome, orchestra height, gaps, and camera size from a shared viewport-height budget. Compact the controls and footer. This is the priority tier. |
| Narrow tablet / split window | roughly 600–899px wide | Give the camera the main row. Move supporting readouts into a compact secondary row or stack them without horizontal overflow. Keep every primary control reachable. |
| Phone portrait | < 600px wide and portrait | Preserve the working tall-camera behavior, use a single-column flow, and allow deliberate vertical scrolling. Avoid forcing the landscape camera ratio or desktop gauge dimensions onto this tier. |
| Very short landscape | height < 600px | Use the compactest title/orchestra/control variants and a height-capped camera. Secondary explanatory text can collapse, but live values and controls remain available. |

Breakpoints should be expressed with a small set of CSS custom properties and combined width/height media queries. Avoid scaling the whole application with `transform: scale(...)`: it produces blurred text, awkward scrolling, and harder-to-reason-about interaction coordinates.

## Proposed layout behavior

### 1. Establish a viewport budget

Define shared responsive tokens on the stage for:

- outer padding and vertical gaps;
- title/header allowance;
- orchestra height;
- control/footer allowance;
- gauge width;
- camera maximum inline size and block size.

Use `100dvh` for the available height and remove the camera/gauge hard minimums in compact tiers. Size the camera from the smaller of its available width and available height while retaining the source frame's aspect ratio.

The camera must show the entire source frame (`object-fit: contain` behavior), because cropping edges could hide conducting hands. Letterboxing is preferable to cropping. Portrait camera streams should retain their tall shape rather than being forced to 4:3.

### 2. Make the performance row a real responsive grid

Convert `.stage-camera-row` from a permanently horizontal flex row into an explicit grid with named areas for dynamics, camera, and tempo.

- Spacious and Chromebook landscape: `dynamics | camera | tempo` (with the dynamics column absent in Expressive mode).
- Narrow/tablet: camera first; supporting gauges/readouts in a second row.
- Phone portrait: a single-column flow using the existing successful mobile camera behavior.

The camera column should use `minmax(0, 1fr)` so its contents are permitted to shrink. Side gauges should derive their height from the camera card rather than imposing a minimum height on the row.

For Magic Finger mode, keep the two target regions visually large and spatially distinct. If vertical gauges become too short to label legibly, use a compact gauge variant with fewer persistent labels rather than shrinking all text indiscriminately. The live BPM and dynamic value remain visible in every tier.

### 3. Compact by priority, not by hiding functionality

On short Chromebook windows, reclaim height in this order:

1. Reduce stage padding and gaps.
2. Reduce the orchestra illustration height while keeping all four target sections distinct.
3. Reduce camera header/telemetry padding and the dynamics ribbon's vertical chrome.
4. Hide verbose shortcut explanations while keeping the actual input and mode buttons.
5. Collapse nonessential footer credit/debug copy into the normal document flow.
6. Only then allow page scrolling as the fallback.

Do not hide the orchestra, camera, current tempo, current dynamics, input selector, or conducting-mode selector at the Chromebook target sizes.

Buttons should retain a usable target size even when their visual padding is reduced. Labels may shorten responsively (for example, a compact hint instead of the full Expressive Mode sentence), but accessible names and tooltips should retain the full wording.

### 4. Fix the score card as part of the same work

The score needs both positioning and rendering changes:

- Remove the renderer's 520px internal minimum and render to the actual card width.
- Keep two measures where there is room; switch to a one-measure compact rendering when notation would otherwise become illegible.
- Re-render when the score container changes size, not only on a window resize. A `ResizeObserver` with a guarded/debounced callback is suitable.
- In spacious layouts, the score can remain visually associated with the selected section.
- In compact layouts, dock it into reserved space above the orchestra (or another agreed location) instead of letting a fixed overlay cover the title, orchestra, or camera.
- Clamp both axes to the visual viewport and account for safe-area insets.

This keeps the score readable instead of merely squeezing a desktop SVG into a smaller box.

### 5. Put bottom content back into the layout

Change the fixed footer so it cannot cover performance content. On normal and compact screens it should be an in-flow footer; on short screens its credit and debug hint can be collapsed or placed behind the version control.

Keep the input/mode controls in flow and visible. On compact landscape screens, use a dense single row when it fits. On narrow portrait screens, use the existing stacked selector treatment.

Account for browser UI and device safe areas with `dvh` and `env(safe-area-inset-*)` where supported.

### 6. Cover every UI state

Responsive rules must be checked in each materially different state:

- warmup/loading, including its 480px camera minimum;
- Expressive camera mode with the horizontal dynamics ribbon;
- Magic Finger mode with both vertical gauges;
- focused instrument with the spotlight ray and score visible;
- camera collapsed, camera off, and keyboard input;
- paused and completed states with action buttons;
- repertoire/version modals;
- debug overlay open.

Warmup should use the same camera sizing tokens as the main experience instead of reinstating a large fixed minimum.

## Implementation sequence

### Phase 1 — Responsive shell and camera

Files: `src/styles/base.css`, `src/styles/camera.css`, and `src/styles/warmup.css`.

- Add the shared layout sizing tokens.
- Replace fixed camera/gauge minimum heights with responsive constraints.
- Introduce the grid areas and compact landscape rules.
- Preserve the portrait/mobile flow.
- Move the footer into flow and compact secondary text by priority.

Deliverable: the camera, orchestra, tempo/dynamics, and selectors are all reachable with no horizontal overflow at the agreed Chromebook minimum.

### Phase 2 — Score responsiveness

Files: `src/ui/SpotlightScoreVisualizer.ts`, `src/styles/score.css`, and `tests/scoreVisualizer.test.ts`.

- Render from measured available width.
- Add the compact one-measure representation.
- Add container-resize handling and compact docking.
- Test narrow widths and viewport-edge clamping.

Deliverable: the score never overflows its card or obscures a primary performance surface.

### Phase 3 — Interaction and state hardening

Files: `src/camera/CameraPreviewOverlay.ts` only if resize lifecycle work is needed; geometry tests under `tests/`.

- Verify canvas/video alignment after every reflow.
- Verify Magic Finger targeting for instruments, tempo, and dynamics in each layout tier.
- Verify that switching modes while already at a compact size recalculates layout and targeting immediately.
- Check collapsed/off-camera states and warmup transitions.

Deliverable: responsive visual changes do not alter gesture recognition or target selection.

### Phase 4 — Browser tuning

- Tune breakpoints against content pressure rather than particular device user agents.
- Check text truncation, focus states, touch targets, scrolling, and browser zoom at 100%, 125%, and 150%.
- Test ChromeOS-style landscape dimensions and phone portrait/landscape rotations.

## Acceptance criteria

At minimum, verify these viewports:

| Viewport | Purpose |
| --- | --- |
| 1920 × 1080 | Large desktop regression |
| 1366 × 768 | Common Chromebook target |
| 1280 × 720 | Short laptop / Chromebook |
| 1024 × 768 | Narrow Chromebook or split window |
| 1024 × 600 | Proposed minimum compact landscape target |
| 768 × 1024 | Tablet portrait |
| 844 × 390 | Phone landscape / very short viewport |
| 390 × 844 | Phone portrait regression |

For every applicable viewport and mode:

- No horizontal page overflow.
- No primary controls or live values are covered by the footer or score.
- The complete camera frame is visible; camera and canvas edges coincide.
- Orchestra sections remain visible and individually targetable.
- Tempo and dynamics remain readable and targetable.
- The score stays inside the viewport/card and its notes remain legible.
- Mode/input controls are reachable without browser zooming out.
- At the Chromebook target, the primary performance UI fits in one viewport if that is the chosen product requirement; otherwise the next required content is obvious and reachable with one vertical scroll.
- Resizing or rotating does not require a reload.

## Verification plan

Automated checks:

- Extend `tests/scoreVisualizer.test.ts` with narrow-card, one-measure, resize, and viewport-clamping cases.
- Extend `tests/magicFingerGeometry.test.ts` with representative rectangles from desktop, compact landscape, and stacked layouts.
- Add a focused camera overlay DOM test if sizing behavior requires TypeScript lifecycle code.
- Run the relevant individual Vitest files and `npm run typecheck` after TypeScript changes.
- Run a production build if the implementation changes markup or component structure.

Browser checks are required because this work affects camera, layout, and gesture targeting. Exercise the viewport matrix in Chrome responsive mode, then do a final pass on a real Chromebook if one is available. During camera tests, move hands to all four frame edges and target every orchestra/gauge region to expose cropping or coordinate drift.

## Product questions and recommended defaults

1. **What is the smallest Chromebook viewport we promise to support?**  
   Confirmed: 1024 × 600 CSS pixels at 100% browser zoom, with 1366 × 768 as the main quality target.

2. **Must the entire primary experience fit without scrolling on that minimum viewport?**  
   Confirmed: Recommended default: yes for orchestra, camera, live tempo/dynamics, input, and mode controls. Allow one short scroll for prompts, restart/switch-piece actions, and footer metadata on 1024 × 600.

3. **May verbose help text and footer credits collapse on short windows?**  
   Confirmed - we can click to see more Recommended default: yes. Keep controls, live values, accessible labels, and the current prompt; collapse repeated shortcut prose and nonessential credits first.

4. **Should the compact score show one readable measure or two smaller measures?**  
   Keep to measures, we aren't really hurting for space in the score. It is just an overlay popover that happens in certain states.

5. **Is docking the score above the orchestra acceptable on compact layouts?**  
  No, it is a popover that only occurs when the finger is pointing, so it is OK that it goes on top of other stuff. But we do need to see what instrument is playing that score.

6. **Should a short landscape phone receive the full Chromebook layout or a simplified mobile layout?**  
   Recommended default: simplified mobile layout with vertical scrolling. Trying to fit the complete Chromebook composition into roughly 390px of height would make the camera and targets too small.

7. **Is full camera framing more important than filling every pixel of the camera card?**  
   Recommended default: yes. Use contain/letterbox behavior so hands near an edge are never cropped.

8. **Are there school accessibility or browser-zoom requirements beyond the viewport targets above?**  
   Recommended default: support 150% browser zoom without horizontal overflow or loss of controls, even if the page then scrolls vertically.

9. **Can the final validation include a physical Chromebook, and if so which model/resolution?**  
   I'm ok to just check scaling stuff in my browser, and I have my own Chromebook to test. 

Unless answers change the intended behavior, implementation can proceed using the recommended defaults above.
