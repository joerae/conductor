# Conductor Warming Up Experience

## Product goal

Replace the passive "Preparing the orchestra..." spinner with an interactive **Warming Up** sequence. It should appear immediately, clearly show that the application is loading, and teach the essential camera controls while the score, instrument samples, and hand-tracking model load in the background.

As soon as one lightweight violin sound is ready and the user has enabled audio, begin a short musical warm-up phrase. The user should hear that phrase respond to the gestures being demonstrated. The loading experience should therefore be useful, playful, and musically expressive without ever delaying a user whose application is already ready.

## Core idea

**Warm up the orchestra while it finishes loading.**

Render the recognisable Conductor stage immediately. Keep the orchestra sections, central camera frame, vertical tempo gauge, and horizontal dynamics ribbon visible in a simplified loading state. Use animated golden hand silhouettes inside the camera frame to demonstrate each gesture, with the corresponding part of the real interface and the audible warm-up phrase responding.

Keep a clearly labelled loading bar visible throughout. This should feel like the beginning of the experience, but it must still be obvious that the full orchestra is loading in the background.

## What the user learns

The warm-up teaches three things only:

1. **Tempo:** move hands higher to go faster and lower to go slower.
2. **Dynamics:** move two hands apart for louder and together for softer.
3. **Spotlight:** hold one index finger upright, then aim towards an orchestra section to spotlight it.

The tutorial must derive its tempo and dynamics wording from the active camera-axis mapping. The statements above describe the current default `classic` mapping. If the user has selected the flipped mapping, demonstrate and describe the reversed controls instead.

Do not teach every shortcut or special gesture during initial loading. Cutoff, Party Mode, Beat Mode, keyboard controls, repertoire selection, and advanced dynamics can be discovered in the main experience.

## Experience principles

- Something attractive and intelligible should render within 500 ms of the HTML arriving.
- Clearly label the experience `Warming up` and show a visible loading bar.
- Loading progress must reflect real readiness work. Never invent progress merely to keep the bar moving.
- Never hold the user back after the application is ready.
- Loading progress and tutorial progress are separate.
- The user should not be required to perform gestures successfully to continue.
- Sound must start only after a user interaction has unlocked the AudioContext.
- The warm-up music must stop cleanly before the selected piece begins.
- Camera failure must not make the whole experience fail.
- Returning users should receive a much shorter version.
- All instructions must match the currently selected control mapping.
- The visual language should match the existing dark concert-hall interface, gold highlights, restrained typography, and glowing orchestra sections.

## Layout

Use the existing stage geometry as the loading composition:

### Header

Show the selected piece title and composer as soon as repertoire metadata is available. Before then, reserve the same space with a subtle skeleton rather than shifting the layout later.

### Orchestra row

Show the egg-shaped orchestra sections in their normal positions, initially dimmed. They can softly illuminate in sequence as instrument banks become ready.

This illumination is decorative feedback, not a literal one-section-per-download progress meter unless the implementation can truthfully associate the section with a loaded bank.

### Camera frame

Use the large central camera frame as the tutorial stage.

Before camera permission or tracking is available, show a dark, softly textured field with animated outline hands. Do not show a blank black rectangle or spinner.

Once the camera is ready, crossfade from the animated demonstration to the real preview. If hand tracking becomes ready while audio is still loading, the user can try the demonstrated gestures and see the interface react.

### Tempo gauge

Keep the real vertical gauge visible on the right. During the tempo demonstration, animate its marker in sync with the demonstration hands. Mark this clearly as a demonstration, not a measured BPM.

### Dynamics ribbon

Keep the real dynamics control beneath the camera. During the dynamics demonstration, animate the marker from softer levels towards louder levels as the demonstration hands move together and apart.

### Instruction card

Place one compact instruction card inside the lower portion of the camera frame, above the telemetry footer:

- Small step label, such as `WARMING UP 1 OF 3`
- Short headline
- One sentence of explanation
- A small `Skip warm-up` control
- Honest background status, such as `Loading orchestra: Tuning strings...`

The instruction must remain readable over both the animated background and a live camera image. Use a translucent dark panel with the existing gold border treatment.

### Loading bar

Show a prominent but elegant loading bar directly beneath the `Warming up` label. It should remain in a stable position throughout the sequence.

Recommended presentation:

```text
WARMING UP THE ORCHESTRA                         42%
[=================------------------------]
Tuning the string section...
```

The percentage and bar must represent real application readiness. Update it from structured loading milestones or byte progress when available. Animate visually between reported values, but do not advance the underlying value on a fake timer.

The bar should reach 100% only when everything required for the currently selected input mode is ready. If camera input fails and the user selects keyboard mode, recalculate readiness around the keyboard requirements without making the displayed percentage move backwards.

## Detailed sequence

### Phase 0: immediate shell

Target: visible within 500 ms.

Display:

- Piece title area or stable skeleton
- Dim orchestra row
- Empty camera frame with animated gold particles or a subtle stage-light sweep
- Tempo gauge and dynamics ribbon in muted form
- Heading: `Warming up the orchestra`
- A real loading bar and current loading status
- Supporting line: `Try the controls while the full orchestra gets ready`

Start score, current-piece instrument, and camera dependencies in parallel. Do not wait for them before rendering this shell.

Prioritise loading the small warm-up violin asset before the full instrument set. If camera permission has not already been granted, show a clear button that also provides the required user gesture for unlocking audio:

`Start musical warm-up`

After it is selected:

- Resume or create the AudioContext.
- Request camera permission.
- Begin the violin phrase as soon as its asset is ready.
- If the violin is still loading, keep the button in a short `Tuning violin...` state rather than accepting repeated clicks.

Secondary action:

`Use keyboard instead`

The audio and score downloads should already be progressing while the user considers the permission request.

### The warm-up music

Create a short, self-contained string warm-up tune specifically for this sequence. It must not be the opening of the selected repertoire piece, because repeating or manipulating that opening would weaken the real performance entrance.

Recommended default: a simplified first phrase of Beethoven's public-domain `Ode to Joy`, encoded directly as note data in the project. It is familiar, works clearly on one violin, uses an even pulse that makes tempo changes easy to hear, and accepts simple accompanying parts as more instruments become available. Do not download or copy a third-party MIDI arrangement.

If the team prefers a tune with no additional composition association, substitute a similarly simple original G-major phrase. Keep the musical and technical constraints below.

Recommended musical shape:

- Approximately six to ten seconds at the neutral tempo
- Clear, singable violin line
- Mostly stepwise motion with one small arpeggio
- A definite cadence or breath before looping
- Neutral starting dynamic around `mf`
- Pleasant across the full supported tempo range
- Sparse enough that changes in tempo and volume are immediately audible

Represent it as a small in-code note sequence or tiny local MIDI asset. It should not require the full selected score to be parsed.

Use one lightweight, locally hosted violin patch as the first-priority audio dependency. Do not fetch all orchestra banks before the warm-up can begin.

Run the warm-up through an explicitly separate tutorial transport or session and a separate gain bus. It may reuse safe AudioEngine primitives, but it must not share uncontrolled note IDs, timers, or completion state with the repertoire transport.

The warm-up player must support:

- Continuous tempo changes without losing its musical position
- Continuous dynamics changes with smoothing
- Clean looping at a phrase boundary
- Immediate mute and unmute
- A short musical fade when the main experience starts
- Complete source and node cleanup after exit
- The same bounded voice lifetimes used by the resolved audio-jitter fix

Display a small sound control beside the loading status: `Sound on` or `Muted`. Never begin sound before user interaction, and remember a mute choice for the current session.

### Lesson 1: control tempo

Suggested duration: approximately 2.5 seconds, but it may end early if the user chooses to start.

Default classic-mapping copy:

**Shape the tempo**

`Move your hands higher to speed up. Lower them to slow down. Hear the violin follow you.`

Animation:

- Two simple glowing hand silhouettes rise slowly inside the camera frame.
- The tempo marker travels upward at the same time.
- The violin phrase accelerates smoothly without restarting.
- The hands descend and the marker follows.
- The phrase slows smoothly.
- Add a small `faster` label near the top and `slower` near the bottom.

If the mapping is flipped, demonstrate horizontal hand spacing instead and substitute accurate copy.

### Lesson 2: control dynamics

Suggested duration: approximately 2.5 seconds.

Default classic-mapping copy:

**Shape the sound**

`Move your hands apart for louder. Bring them together for softer.`

Animation:

- Two hand silhouettes begin near the centre.
- They spread horizontally.
- The dynamics marker moves from `p` through `mf` towards `ff`.
- Orchestra eggs brighten slightly as the sound becomes louder.
- The violin phrase becomes audibly louder using the same smoothed dynamics response as the real orchestra.
- The hands return towards the centre and the marker softens.
- The violin becomes audibly softer without disappearing completely at `pp`.

Use the musical terms already present in the interface, but always pair them with plain language. For example, `forte, louder` rather than relying on `f` alone.

If the mapping is flipped, demonstrate vertical movement and substitute accurate copy.

### Lesson 3: spotlight an instrument

Suggested duration: approximately 3 seconds.

Copy:

**Spotlight the orchestra**

`Hold one finger upright, then aim at a section to bring it forward.`

Animation:

- Show one hand changing into a clear upright-index-finger pose.
- After a brief hold, draw the existing gold pointing ray.
- Sweep the ray from Violin I to Viola or between two other visible sections.
- The intersected section gains the same glow used by the real Spotlight mode.
- Other sections subtly recede.
- Add a small transient label such as `VIOLA SPOTLIGHTED`.

If enough current-piece instruments have loaded, progressively add one or two quiet accompanying parts to the warm-up before this lesson. Pointing should bring the selected part forward so the effect is genuinely audible.

If only the initial violin sound is ready, the visual spotlight demonstration may proceed without pretending that a multi-section audio mix exists. Never delay overall readiness to load tutorial-only accompaniment.

Do not teach a pinch interaction unless the current implementation genuinely requires one. The current controller appears to select the section automatically after a stable pointing intersection, so the tutorial should describe that actual behavior.

### Ready state

As soon as all dependencies required for the selected input mode are ready, replace the status area with:

**Your orchestra is ready**

Primary action:

`Start conducting`

Supporting instruction:

`Raise your hands when you are ready.`

If audio becomes ready halfway through any lesson, show the Start button immediately without removing the current instruction. The user can start now or watch the remaining demonstration.

Do not force a minimum tutorial duration.

When Start is selected, stop accepting tutorial gesture input, fade the warm-up phrase over approximately 150 to 250 ms, cancel its future notes, dispose its audio nodes, reset the main tempo and dynamics to their intended starting state, then begin the selected piece through the normal playback path.

If the user is already moving tracked hands when the application becomes ready, do not start the orchestra underneath the tutorial unexpectedly. Require the Start button on first-time onboarding, then return to the normal raise-hands auto-start behavior on later visits.

## Returning users

Store a versioned completion marker, for example:

```text
conductor:onboarding-version = 1
```

For returning users:

- Render the same immediate stage shell.
- Show one compact animated tip rather than the full three-part warm-up.
- Rotate the tip between visits if desired.
- Enter the application automatically as soon as required assets are ready.
- Do not automatically play the warm-up phrase unless the user has interacted and explicitly left sound enabled for this visit.
- Keep a `How to conduct` control available in the main interface so the warm-up can be replayed.

Increment the onboarding version only when the core controls materially change.

## Loading and readiness model

Do not model this as one undifferentiated `Promise.all()`.

Expose structured task state:

```ts
type LoadTaskStatus = "pending" | "loading" | "ready" | "error";

interface ConductorLoadState {
  shell: LoadTaskStatus;
  warmupViolin: LoadTaskStatus;
  score: LoadTaskStatus;
  instruments: LoadTaskStatus;
  cameraPermission: LoadTaskStatus;
  handTracking: LoadTaskStatus;
  progress: number;
  statusMessage: string;
}
```

The loading UI should receive state changes through a typed callback or observable interface rather than reaching into private controller fields.

### Calculating progress

Prefer byte-level progress for resources that expose reliable `Content-Length` values. For tasks where byte progress is unavailable, use documented readiness weights rather than elapsed time.

A reasonable initial weighting to validate against real load profiles is:

| Task | Weight |
| --- | ---: |
| Immediate shell and metadata | 5% |
| Warm-up violin asset | 10% |
| Selected score | 15% |
| Selected-piece instrument banks and decoding | 40% |
| Camera permission and stream | 10% |
| Hand-tracking runtime and model | 20% |

These weights are implementation starting points, not permanent product truth. Adjust them using measured cold-load durations and transferred bytes.

Rules:

- Progress must be monotonic within one load session.
- A completed task contributes its full weight.
- A failed optional task is removed only after a fallback mode is selected.
- The bar may pause honestly on a long task.
- Show the current task label so a paused bar does not look broken.
- Do not reach 100% before the selected input mode is genuinely usable.

Suggested honest status messages:

| State | Message |
| --- | --- |
| Warm-up violin loading | `Tuning the first violin...` |
| Warm-up available | `Violin ready. Try the controls.` |
| Score loading | `Opening the score...` |
| Current-piece banks loading | `Tuning the orchestra...` |
| Awaiting camera permission | `Waiting for camera permission...` |
| Hand model loading | `Teaching the camera to see your hands...` |
| Everything required ready | `Your orchestra is ready` |
| Camera failed, keyboard available | `Camera unavailable. Keyboard conducting is ready.` |

Do not expose technical terms such as MediaPipe, WASM, soundfont, model weights, or JavaScript to ordinary users.

## Required versus optional readiness

For camera conducting, the primary Start action requires:

- Score parsed
- Instrument banks required by the selected piece decoded
- Camera permission granted
- Camera stream active
- Hand tracking ready

For keyboard conducting, Start requires only:

- Score parsed
- Instrument banks required by the selected piece decoded

Camera failure must reveal `Continue with keyboard` and must not reject the entire application load.

The warm-up phrase has a deliberately smaller readiness threshold:

- AudioContext unlocked by user interaction
- Warm-up violin asset decoded
- Tutorial transport ready

It should begin without waiting for the selected score, the rest of the orchestra, or hand tracking. Until hand tracking is available, its tempo and dynamics can follow the demonstration animation. When live hands become available, crossfade control from the demonstration to the user.

AudioContext activation may require a user gesture. The permission or Start button can perform the resume operation. Do not represent AudioContext suspension as a failed download.

## Actual loading improvements within scope

The experience should improve real startup time as well as perceived time:

1. Load only instrument banks required for the initially selected piece.
2. Prioritise a small locally hosted violin asset that makes the warm-up interactive quickly.
3. Lazy-load the other piece's banks when that piece is selected or during browser idle time after the current experience is ready.
4. Render the stage shell before awaiting score, instruments, or camera.
5. Begin score and audio downloads before waiting for camera permission.
6. Where practical, self-host and version the required WebAudioFont assets so caching and availability are under the project's control.
7. Give hashed static assets long-lived immutable cache headers.
8. Fix the existing camera fallback flow so one failed start is not immediately retried and does not fail the whole load.

Do not bundle all repertoire instrument banks into the initial application payload merely to reduce the number of requests.

## Visual design guidance

- Preserve the existing near-black background and warm gold accent.
- Reuse the real orchestra, tempo, dynamics, ray, and focus visual treatments.
- Demonstration hands should be elegant line silhouettes, not emoji or realistic stock hands.
- Use motion that feels conducted: smooth acceleration, slight follow-through, and soft settling.
- Give the loading bar enough contrast and prominence that users immediately understand they are still loading.
- Let the orchestra row visually "wake up" as loading advances, without implying false one-to-one progress.
- Avoid a generic carousel floating in the middle of an unrelated loading screen.
- Avoid large paragraphs.
- Avoid a permanently full-screen modal once the stage is ready.
- Crossfade into the live interface without a hard layout change.

## Responsive behavior

On narrower screens:

- Keep the camera demonstration as the primary area.
- Place the instruction card below it if overlay readability becomes poor.
- Represent the tempo and dynamics reactions as compact edge gauges.
- Never crop the demonstrated hands in a way that obscures the motion.

## Accessibility

- All gesture demonstrations require equivalent text.
- Respect `prefers-reduced-motion`; replace repeated hand animation with two or three static keyframes and gentle fades.
- Buttons must be keyboard accessible and visibly focused.
- Announce meaningful readiness and failure changes through an `aria-live="polite"` region.
- Do not use colour as the only indicator of louder, softer, faster, or slower.
- Maintain sufficient contrast over a live camera image.
- Provide a visible mute control and do not rely on sound alone to teach any gesture.

## Failure and slow-network behavior

### Camera denied or unavailable

Keep teaching with animated hands, then offer:

`Continue with keyboard`

Secondary action:

`Try camera again`

Retry only after an explicit user action.

### Audio or score still loading after all three lessons

Hold on a calm practice state rather than looping the tutorial aggressively:

**Nearly ready**

`Keep shaping the warm-up while the orchestra finishes tuning.`

If live tracking is available, let the tempo and dynamics controls react without starting playback.

### An instrument bank fails

Report a friendly recoverable error and offer retry. If a deliberate fallback sound exists and is musically acceptable, explain that the user can continue. Do not silently substitute clicks for an orchestra without telling the user.

## Analytics and success measures

Capture anonymous product events only if the project already has an accepted analytics mechanism. Do not add a new analytics vendor solely for this feature.

Useful events:

- Loading shell shown
- Camera permission requested, granted, or denied
- Each lesson viewed
- Rehearsal skipped
- Application ready
- Warm-up violin ready
- Warm-up audio started, muted, or stopped
- First live tempo or dynamics response during warm-up
- Start conducting selected
- Keyboard fallback selected
- Time from navigation to shell
- Time from navigation to ready
- Time from ready to first conducting action

Primary success measures:

- Reduced blank or spinner-only time
- Fewer exits during initial loading
- More users successfully reaching first playback
- Fewer users confused about tempo and dynamics controls
- No increase in camera-permission abandonment
- More users producing an audible gesture response before the full orchestra is ready

## Acceptance criteria

1. The stage-shaped loading shell appears before heavy dependencies finish.
2. The screen is clearly titled `Warming up` and displays a real loading bar plus current task label.
3. No passive spinner is shown as the primary experience.
4. The initial violin phrase can begin before the full score, orchestra, and hand model are ready.
5. The warm-up phrase audibly responds to demonstrated or live tempo and dynamics input.
6. The three demonstrations use the actual interface geometry and visual language.
7. Tutorial text always matches the active axis mapping.
8. Readiness is never delayed solely to finish an animation or musical phrase.
9. Starting the real piece cleanly stops and disposes the warm-up audio.
10. First-time users can skip or mute the warm-up.
11. Returning users are not forced through the full warm-up.
12. Camera denial leads to a working keyboard experience.
13. Only the selected piece's required instrument banks block initial readiness.
14. The loading bar never moves backwards or claims false completion.
15. The layout does not jump when transitioning into the live experience.
16. Reduced-motion and keyboard navigation work.
17. Automated tests use mocked dependencies and fake timers, completing in seconds rather than waiting for real loading.

## Tests

Add focused tests for:

- Shell renders before dependency promises resolve.
- Each load task updates its own status.
- Loading progress is monotonic and reaches 100% only at genuine readiness.
- The warm-up violin can become playable while other dependencies remain pending.
- Browser autoplay restrictions are respected.
- Demonstration control changes affect warm-up tempo and dynamics.
- Live hand control replaces demonstration control when tracking becomes ready.
- Starting, skipping, failing, or restarting disposes every warm-up voice and timer.
- Ready action appears immediately when required dependencies resolve.
- Ready is not held back by tutorial timing.
- Camera error exposes keyboard fallback and does not fail the application.
- Repeated camera retry occurs only after user action.
- Classic and flipped mappings produce the correct lesson text and animation configuration.
- Returning users receive the abbreviated experience.
- Changing the onboarding version causes the full warm-up to appear again.
- Skip proceeds as soon as dependencies are ready.
- Old loading callbacks cannot affect a newly selected piece or restarted load session.

## Out of scope

- Redesigning the main conducting interface
- Changing the actual tempo or dynamics axis mapping
- Teaching every gesture and keyboard shortcut
- Revisiting the resolved long-session audio jitter
- Building a full second repertoire piece for the loading screen
- Reworking musical playback behavior unrelated to initial readiness
- Adding a general account system or cross-device onboarding state

## Implementation handoff

Before coding, inspect the latest repository because recent fixes may have changed loading and audio behavior. Preserve the resolved audio-jitter fix.

Implement this in small stages:

1. Separate renderable shell state from dependency readiness.
2. Introduce typed loading milestones and robust failure handling.
3. Add the priority violin asset, isolated warm-up transport, and short original phrase.
4. Build the three demonstration states using the existing interface elements.
5. Connect animation and live input to the warm-up phrase, tempo gauge, and dynamics ribbon.
6. Connect the active camera-axis mapping to tutorial copy and animation.
7. Add first-time, returning-user, skip, mute, and keyboard-fallback behavior.
8. Load only current-piece instrument banks during startup.
9. Verify production build, fast automated tests, cold-load behavior, camera denial, audio cleanup, and responsive layout.

At handoff, report both actual and perceptual results:

- Time to first visible shell
- Time to usable keyboard mode
- Time to usable camera mode
- Number and total size of initial instrument requests
- Time until the warm-up phrase becomes audible after user interaction
- First visit and repeat visit behavior
- Slow-network and camera-denial behavior
- Test duration
