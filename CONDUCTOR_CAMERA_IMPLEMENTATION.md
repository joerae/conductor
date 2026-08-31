# Conductor Camera Input Implementation Specification

## Purpose

This document specifies how to add a camera-based conducting input mode to the existing Conductor web application.

The application already supports multiple beat input modes and multiple beat calculation modes. Camera conducting should be added as another input mode, not as a replacement for the existing keyboard or other modes.

The camera mode must preserve the existing downstream timing architecture. Its job is to convert observed hand motion into the same kind of beat events that the rest of the application already consumes, while optionally producing a continuous dynamics signal.

The design goal is permissive, expressive conducting rather than formal conducting-pattern recognition.

---

## Core product principle

The player should feel that the orchestra is watching them, not that they are performing gestures for a classifier.

Camera mode should therefore accept:

- one-hand conducting
- two-hand conducting
- either left or right hand as the beat hand
- both hands moving together for a stronger beat cue
- switching naturally between one and two hands
- gradual raising or lowering of the hands to control dynamics

The system should not require the player to nominate a dominant hand, hold a baton pose, or follow a formal 2/4, 3/4, or 4/4 conducting pattern.

---

# 1. Scope

## 1.1 In scope for the first camera implementation

1. Request camera permission in-browser.
2. Run hand tracking locally in the browser.
3. Track up to two hands.
4. Convert hand trajectories into candidate beat events.
5. Fuse near-simultaneous beats from two hands into a single beat event.
6. Pass camera-derived beat events into the existing beat-processing pipeline.
7. Estimate dynamics from the overall vertical position of one or two hands.
8. Smooth dynamics so normal conducting strokes do not create volume pumping.
9. Provide useful visual/debug telemetry for development.
10. Fail gracefully when hands or camera are unavailable.

## 1.2 Explicitly out of scope initially

Do not implement these as part of the first camera pass:

- formal conducting-pattern recognition
- identifying bar position from gesture direction
- instrument-section pointing
- cut-off gestures
- articulation recognition
- gesture vocabulary such as fist, pinch, palm, cue, etc.
- left-hand-only dynamics rules
- baton detection
- facial expression recognition
- cloud inference
- video upload, recording, storage, or streaming
- AI/LLM calls for gesture interpretation
- player scoring based on conducting technique

These can be considered later without changing the core architecture.

---

# 2. Deployment and privacy constraints

The camera implementation must work in the existing static web application deployment model, including Netlify.

## Requirements

- Use `navigator.mediaDevices.getUserMedia()` for camera access.
- Camera mode must run on HTTPS in production.
- Hand landmark inference must run locally in the browser.
- No camera frames should be sent to a backend or third-party inference API.
- No authentication, server process, or API key should be required for camera operation.
- Do not persist raw camera frames.

A suitable implementation is MediaPipe Hand Landmarker or an equivalent browser-local hand landmark model.

The resulting pipeline should be conceptually:

```text
Camera stream
    -> browser-local hand tracking
    -> per-hand landmark positions
    -> motion history
    -> beat detector + dynamics estimator
    -> existing conductor clock / beat calculation system
    -> audio scheduler
```

---

# 3. Integration with the existing input architecture

Camera should be implemented as a new beat input provider.

Do not bypass or duplicate the application's existing beat-processing and prediction systems.

The exact interface should match the repository's current abstraction, but conceptually the camera provider should emit something equivalent to:

```ts
type BeatObservation = {
  timestamp: number;       // high-resolution monotonic time
  source: "camera";
  confidence: number;      // 0..1
  handCount: 1 | 2;
};
```

If the current input abstraction only accepts timestamps, keep that interface and store confidence/debug metadata separately rather than redesigning unrelated architecture.

The camera provider must not own tempo calculation if the application already separates input collection from beat calculation.

Preferred separation:

```text
CameraBeatInputProvider
    emits candidate beat timestamps

Existing BeatCalculationMode
    interprets those timestamps
    estimates tempo / phase / prediction

Existing ConductorClock
    maps score beats to audio time
```

This separation matters because the user should be able to combine camera input with existing or future beat-calculation algorithms.

---

# 4. Hand tracking representation

Track up to two hands.

For each detected hand, retain a short rolling history containing at minimum:

```ts
type HandSample = {
  timestamp: number;
  handedness?: "left" | "right";
  confidence: number;
  x: number;
  y: number;
  z?: number;
};
```

The `x` and `y` values should represent a single conducting point for the hand.

## 4.1 Recommended conducting point

Start by testing these candidates, in this order:

1. wrist landmark
2. index fingertip
3. weighted combination of wrist and index fingertip

The wrist is likely to be more stable and less sensitive to finger pose. The index fingertip may better approximate a baton but can introduce more jitter.

Make the selected point configurable in a development/debug setting rather than hard-wiring assumptions throughout the detector.

## 4.2 Coordinate normalization

Use normalized coordinates independent of camera resolution.

Be explicit about Y direction. Most camera/image coordinate systems have Y increasing downward. Convert once into a conductor-space coordinate where increasing Y means physically higher if that makes downstream logic easier to reason about.

Mirror the visual camera preview if desired for player comfort, but do not accidentally mirror the underlying handedness or motion calculations twice.

---

# 5. Motion preprocessing

Raw hand landmarks will jitter. Beat detection must operate on a lightly filtered trajectory, not raw frame-to-frame positions.

However, over-smoothing creates perceptible latency.

Use two separate smoothing paths:

## 5.1 Fast path for beat detection

Purpose: preserve direction changes and timing.

Use a low-latency filter such as:

- exponential moving average with a small alpha window
- One Euro Filter
- short Savitzky-Golay style smoothing if already available

The filter should reduce tracking noise without shifting the apparent ictus significantly.

## 5.2 Slow path for dynamics

Purpose: identify broad vertical posture rather than individual strokes.

Use much heavier smoothing, approximately in the 500 ms to 1000 ms perceptual range.

This separation is essential. Do not derive dynamics from the same fast signal used for beat detection.

---

# 6. Permissive beat detection

## 6.1 Desired behaviour

A beat can come from:

- left hand only
- right hand only
- both hands together

The player must not choose a beat hand.

The beat detector should look for an ictus-like change in motion, not a particular conducting pattern.

For the initial implementation, define a candidate beat primarily as a sufficiently energetic downward stroke followed by a reversal or deceleration near its lowest point.

In conductor-space, this can be thought of as:

```text
hand moves downward
    -> downward velocity becomes significant
    -> approaches local vertical minimum
    -> vertical velocity crosses toward zero / upward
    -> candidate beat near the reversal point
```

The exact mathematical implementation may vary, but it should operate on velocity and local extrema rather than a hard screen-space threshold.

## 6.2 Per-hand candidate detection

Maintain independent motion state for each visible hand.

For each hand calculate at least:

- vertical position
- vertical velocity
- optional vertical acceleration
- recent stroke amplitude
- time since last candidate beat

A candidate beat should require all of the following:

1. meaningful downward movement occurred before the reversal
2. movement amplitude exceeded a minimum gesture threshold
3. the hand reverses direction or substantially decelerates
4. the candidate is not inside the per-hand refractory window

This prevents camera jitter from creating beats while the hand is nearly stationary.

## 6.3 Adaptive gesture threshold

Avoid using only a fixed number of normalized-screen pixels.

Players will conduct with different gesture sizes and camera framing.

Prefer an adaptive threshold based on recent movement amplitude, with sensible minimum and maximum clamps.

For example, estimate the recent normal conducting stroke range and require a candidate stroke to be a meaningful fraction of that range.

Do not make the initial adaptation so aggressive that the first few gestures are ignored. Bootstrap with conservative defaults.

---

# 7. Two-hand fusion

Two hands moving together must produce one beat, not two.

## 7.1 Fusion rule

When a beat candidate arrives from one hand, hold it briefly in a fusion window.

If the other hand produces a candidate within approximately 50 to 100 ms, merge them into one beat observation.

The exact fusion window should be tunable based on testing.

Conceptually:

```text
Left candidate at 12.420s
Right candidate at 12.454s
Difference = 34 ms

=> one fused beat, not two beats
```

## 7.2 Fused timestamp

For two-hand beats, calculate the emitted beat time from the two candidates using either:

- confidence-weighted average timestamp, or
- the timestamp of the stronger candidate if one is clearly more reliable

Do not simply emit the later beat, because that unnecessarily adds latency.

## 7.3 Confidence

Two-hand agreement should increase beat confidence.

Possible starting logic:

```text
single strong hand      -> medium/high confidence
single weak hand        -> low/medium confidence
two agreeing hands      -> high confidence
hands disagree strongly -> prefer stronger candidate or reject weaker one
```

Confidence should be advisory unless the current beat-processing interface already understands confidence.

## 7.4 Refractory period

After emitting a fused or single-hand beat, suppress additional camera beat emission for a short refractory period.

The refractory period should prevent the same ictus from being detected twice but still support musically useful fast tempi.

Start around 120 to 180 ms and tune empirically.

Do not choose a refractory period that makes 240 BPM impossible if the experience may need that range.

---

# 8. Interaction with predicted beat timing

Camera mode should provide observed beat timestamps to the same predictive system used by other beat input modes.

It should not delay beat emission in an attempt to make the camera detector itself predictive.

The division of responsibility should be:

```text
CAMERA LAYER
"I observed an ictus at time T with confidence C"

BEAT CALCULATION / CONDUCTOR CLOCK
"Given recent observations, I predict the next beat at T+n"

AUDIO SCHEDULER
schedules score events ahead of time against that prediction
```

This keeps camera latency isolated and makes keyboard and camera input comparable.

## Important latency principle

The camera detector should timestamp the inferred physical beat as accurately as possible.

If processing finishes 30 ms after the corresponding video frame was captured, prefer the frame/sample timestamp over `performance.now()` at the end of inference.

Do not intentionally push the timestamp later merely because detection happens later.

Where browser APIs expose frame timing, preserve it through the pipeline.

---

# 9. Dynamics control

Camera mode may emit a continuous dynamics control in addition to beat events.

Dynamics should initially be based primarily on broad hand height.

## 9.1 Product behaviour

The intended interaction is:

```text
hands gradually higher   -> louder
hands gradually lower    -> softer
```

Example conceptual mapping:

```text
low      -> p
          -> mp
middle   -> mf
          -> f
high     -> ff
```

Do not force discrete jumps between markings internally. The audio engine should receive a continuous normalized dynamics value, with musical labels used only for display if desired.

```ts
type DynamicsObservation = {
  timestamp: number;
  value: number;       // normalized 0..1
  confidence: number;
};
```

## 9.2 One-hand and two-hand dynamics

The desired behaviour is permissive:

- if one hand is visible, use that hand's slowly smoothed vertical position
- if two hands are visible, use the average or weighted centre of both hands

Two visible hands should generally provide a more stable dynamics estimate.

Do not require both hands for dynamics.

## 9.3 Avoiding beat-driven volume pumping

Normal conducting repeatedly moves the hand up and down.

Therefore dynamics must not directly map instantaneous Y position to gain.

Instead use a slow envelope or baseline estimate. For example:

```text
fast trajectory:   used for ictus / beat
slow trajectory:   used for dynamics posture
```

A beat stroke may move the hand through a large vertical range over 300 ms, but the estimated dynamics should barely change unless the centre of the conducting region is shifting over multiple strokes.

## 9.4 Calibration

Do not require an explicit calibration flow in the first version unless testing proves it necessary.

Prefer automatic normalization using a slowly adapting recent motion envelope.

Maintain sensible fixed bounds as a fallback so dynamics works immediately when camera mode begins.

Possible later enhancement: an optional 5-second neutral-position calibration.

---

# 10. Audio dynamics mapping

Do not map dynamics directly to linear amplitude without testing. Perceived loudness is nonlinear.

The camera module should ideally emit a normalized expressive value, and the audio layer should own how that maps to gain, velocity, or orchestral expression.

If the current audio implementation only exposes master gain, initially map the normalized value to a constrained gain range rather than silence-to-clipping.

For example, camera dynamics might control a useful musical range such as approximately `p` through `ff`, while preserving headroom.

Do not alter MIDI note velocities destructively after scheduling if the audio engine already has a section/master expression mechanism that is more suitable.

---

# 11. Handling hand loss and ambiguity

Camera tracking will intermittently lose hands due to occlusion, framing, lighting, or fast movement.

This must not produce spurious beats or abrupt dynamics jumps.

## 11.1 Temporary hand loss

If one hand disappears briefly:

- continue with the remaining visible hand
- do not emit a beat merely because a landmark vanished
- preserve the missing hand's state for a short grace period so reacquisition is not treated as a huge motion jump

## 11.2 Both hands lost

When no hands are visible:

- emit no camera beats
- hold dynamics briefly, then gently return toward a neutral/default value if desired
- show unobtrusive UI feedback such as `Hands not detected`
- do not stop the orchestra solely because tracking was lost unless that behaviour belongs to the active beat-calculation mode

The existing conductor clock should decide how music behaves when beat input stops.

## 11.3 Reacquisition

On reacquiring a hand, initialize its motion history from the current location.

Do not calculate velocity from the previous pre-loss location to the new location, because this can create a false high-speed stroke and beat.

---

# 12. Camera lifecycle and UX

Camera should be opt-in.

Suggested flow:

1. Player chooses `Camera` as beat input.
2. Show a short explanation that processing happens locally.
3. Player clicks `Enable camera`.
4. Request camera permission.
5. Load/initialize hand tracking.
6. Show live camera preview or a simplified silhouette/debug view.
7. Once a hand is detected, camera beat input becomes active.

## Requirements

- Do not request camera permission on initial page load.
- Stop camera tracks when camera mode is disabled or the component is disposed.
- Handle permission denial cleanly.
- Allow the user to switch back to keyboard/other beat input without reload.
- Avoid keeping multiple camera inference loops alive after switching modes.

---

# 13. Performance requirements

The camera mode shares the main browser environment with audio scheduling, so inference must not destabilize audio timing.

## Priorities

1. Audio scheduling must remain reliable.
2. Beat timing must remain responsive.
3. Camera preview smoothness is secondary.

Do not attempt hand inference on every camera frame if the device cannot sustain it.

A target inference rate in the 20 to 30 FPS region may be sufficient for initial beat detection, provided timestamps are accurate and motion interpolation is reasonable.

Use a worker or suitable MediaPipe execution mode if main-thread inference creates audio/UI stalls.

Measure rather than assume.

## Telemetry to capture during development

- camera FPS
- hand-inference FPS
- average inference duration
- p95 inference duration
- landmark sample age when processed
- candidate-beat timestamp
- emitted-beat timestamp
- processing delay from frame timestamp to beat emission
- number of duplicate candidates suppressed
- number of two-hand candidates fused

---

# 14. Debug visualisation

Build a developer/debug overlay early. Camera beat detection is difficult to tune from audio alone.

The debug view should optionally show:

- camera preview
- tracked point for each hand
- filtered trajectory trail
- current vertical velocity
- candidate beat marker
- emitted/fused beat flash
- hand confidence
- dynamics slow baseline
- normalized dynamics value
- current camera FPS/inference FPS

Optional but useful:

- color or label indicating each per-hand detector state, for example `rising`, `falling`, `ictus candidate`, `refractory`

This overlay should be removable or disabled in the production experience.

---

# 15. Suggested detector state machine

Per hand, a simple initial state machine could be:

```text
IDLE
  |
  | sufficient downward velocity
  v
FALLING
  |
  | stroke amplitude sufficient
  | velocity approaches zero / reverses
  v
ICTUS_CANDIDATE
  |
  | candidate accepted
  v
REFRACTORY
  |
  | minimum interval elapsed
  v
IDLE
```

This is a starting architecture, not a requirement to use exactly these state names.

The detector should reject tiny reversals caused by landmark noise.

---

# 16. Suggested module boundaries

Adapt names to the existing repository rather than imposing a parallel architecture.

Conceptually:

```text
camera/
  CameraBeatInputProvider.ts
  CameraController.ts
  HandTracker.ts
  HandMotionFilter.ts
  HandBeatDetector.ts
  BeatFusion.ts
  DynamicsEstimator.ts
  cameraTypes.ts
  CameraDebugOverlay.tsx   // only if current UI stack uses React
```

Responsibilities:

### `CameraController`
Owns browser camera permission, media stream lifecycle, start/stop.

### `HandTracker`
Wraps MediaPipe or equivalent. Converts frames into normalized hand landmarks.

### `HandMotionFilter`
Maintains fast and slow filtered trajectories.

### `HandBeatDetector`
Owns independent per-hand beat candidate detection.

### `BeatFusion`
Combines near-simultaneous left/right candidates into one observation and applies global camera refractory logic.

### `DynamicsEstimator`
Produces slow normalized dynamics signal from one or two hands.

### `CameraBeatInputProvider`
Adapts camera results to the application's existing beat input interface.

Do not allow MediaPipe-specific types to leak deeply into the conductor/audio architecture.

---

# 17. Configuration

Centralize tunable values.

Example categories:

```ts
const CAMERA_CONDUCTING_CONFIG = {
  beat: {
    minDownwardVelocity: /* tune */,
    minStrokeAmplitude: /* tune */,
    fusionWindowMs: 75,
    refractoryMs: 150,
  },
  filtering: {
    beatFilter: /* tune */,
    dynamicsTimeConstantMs: 700,
  },
  tracking: {
    maxHands: 2,
    minDetectionConfidence: /* tune */,
    minTrackingConfidence: /* tune */,
  },
};
```

Do not scatter magic numbers across event handlers.

Numbers in this document are starting points, not validated final values.

---

# 18. Testing strategy

## 18.1 Unit tests

Beat detection should be testable without a real camera.

Feed deterministic synthetic hand trajectories into the detector.

Required cases:

### A. Clean one-hand beat

A downward stroke followed by reversal emits exactly one candidate.

### B. Stationary jitter

Small random movement around a fixed position emits no beat.

### C. Two hands together

Left and right candidate beats 30 to 50 ms apart result in exactly one fused beat.

### D. Alternating hands

Left beat, then right beat one musical beat later, produces two separate beat observations.

### E. Hand switch

Player conducts with right hand for several beats, then left only. Beat stream continues without configuration change.

### F. Hand disappearance

Tracking loss emits no false beat.

### G. Reacquisition jump

A hand reappearing far from its last location emits no false beat.

### H. Fast conducting

Detector supports the chosen maximum target BPM without refractory suppression of legitimate beats.

### I. Dynamics stroke rejection

Repeated large up/down beat gestures around the same centre produce nearly stable dynamics.

### J. Dynamics lift

The same beat gesture gradually translated upward over several beats causes dynamics to rise smoothly.

## 18.2 Integration tests

Mock camera beat observations and verify they travel through the same downstream beat-calculation architecture as keyboard input.

Switching between keyboard and camera should not create duplicate listeners or simultaneous beat providers unless explicitly supported by the app.

## 18.3 Manual testing matrix

Test at minimum:

- one right hand
- one left hand
- both hands in unison
- uneven two-hand motion
- switching hands mid-piece
- small gestures
- large gestures
- slow tempo
- fast tempo
- deliberate accelerando
- deliberate ritardando
- hands raised gradually while conducting
- hands lowered gradually while conducting
- brief occlusion
- hands leaving frame
- different distances from camera
- moderate and poor lighting

---

# 19. Implementation phases

## Phase C0: Camera plumbing

Goal: prove local hand tracking works inside the existing static app.

Deliverables:

- camera input option appears alongside existing input modes
- permission flow
- local camera preview
- up to two tracked hands
- debug dots/landmarks
- clean start/stop lifecycle
- no beat emission yet

Acceptance criteria:

- works on localhost and deployed Netlify HTTPS build
- no backend/API calls for inference
- switching away from camera stops the media tracks
- both hands can be tracked simultaneously

## Phase C1: Single-hand permissive beat input

Goal: use either hand to conduct tempo.

Deliverables:

- fast motion filter
- independent per-hand beat detector
- whichever visible hand produces a valid ictus can emit a beat
- camera beats pass into existing beat calculation modes
- debug beat flash

Acceptance criteria:

- right-only and left-only conducting both work without settings
- stationary hands do not create beats
- detected beats feel temporally close to visible ictus
- existing predictive beat system remains unchanged downstream

## Phase C2: Two-hand fusion and resilience

Goal: make natural two-hand conducting reliable.

Deliverables:

- fusion window
- confidence combination
- global refractory protection
- hand-loss/reacquisition handling
- telemetry for duplicate suppression and fusion

Acceptance criteria:

- two hands moving together create one beat
- one hand can drop out without interrupting the other
- reacquisition does not create false beats
- player can naturally alternate between one and two hands

## Phase C3: Dynamics

Goal: allow broad vertical hand position to control loudness while continuing to conduct tempo.

Deliverables:

- slow dynamics estimator
- one/two-hand centre calculation
- normalized continuous dynamics output
- audio-layer mapping
- debug dynamics meter

Acceptance criteria:

- ordinary beat strokes do not cause obvious volume pumping
- gradually raising conducting position produces a clear crescendo
- gradually lowering produces a diminuendo
- dynamics remains usable with either one or two visible hands

## Phase C4: Tuning and performance

Goal: make camera conducting feel robust across real users and devices.

Deliverables:

- tuning based on recorded synthetic trajectories and manual play sessions
- adaptive gesture thresholds
- performance telemetry
- inference-rate tuning
- fallback messaging for unsupported/slow devices

Acceptance criteria:

- audio scheduling remains stable while camera inference is active
- no persistent double-beat behaviour
- useful conducting works across a reasonable range of gesture sizes
- latency is low enough that the predictive clock can convincingly follow the performer

## Phase C5: Optional expressive extensions

Only after tempo + dynamics feel convincing.

Candidates:

- gesture-size contribution to dynamics
- cue gestures
- cut-offs
- section cues
- articulation
- formal conducting pattern interpretation

None of these should be anticipated in C0-C4 unless doing so is essentially free and does not complicate the core design.

---

# 20. Coding-agent instructions

When implementing this specification:

1. Inspect the repository's existing beat input and beat calculation abstractions before writing code.
2. Add camera as another input provider rather than creating a parallel timing system.
3. Preserve the existing predicted-next-beat / conductor-clock architecture.
4. Do not replace working beat calculation logic with camera-specific tempo estimation.
5. Keep camera inference entirely client-side.
6. Implement phases in order and keep each phase independently testable.
7. Prefer small modules with deterministic tests around motion processing.
8. Expose detector tuning constants centrally.
9. Add debug instrumentation before attempting extensive threshold tuning.
10. Do not add later gesture features while implementing the initial phases.

Before modifying downstream conductor or audio code, explain why the existing interface is insufficient. Prefer adapting camera output to the current interface wherever possible.

---

# 21. Definition of success

The first mature camera version succeeds when a player can stand in front of a laptop and, without learning a special gesture vocabulary:

- conduct with their right hand
- conduct with their left hand
- conduct with both hands together
- switch between those naturally
- speed up and slow down the orchestra
- raise their overall gesture to make the orchestra louder
- lower it to make the orchestra softer

The player should experience the system as permissive and musical rather than as gesture recognition software.

The key illusion is:

> The orchestra is watching me and following what I mean.

