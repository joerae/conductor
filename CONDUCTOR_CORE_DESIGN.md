# CONDUCTOR

## Core Experience Design and Technical Specification

**Version 0.1 | 31 August 2026**

Conductor is an interactive orchestral experience in which the player controls tempo in real time. The first version uses the Space Bar as the conducting input. Camera conducting is a later input layer.

> **Core proposition:** The orchestra should feel as though it is following the player, not as though the player is tapping along to a pre-recorded track. The first prototype tests only that sensation.

## 1. Product vision

The first version is intentionally not a rhythm game. There is no score, target BPM, win state, judgement line, or requirement to reproduce a canonical performance. The core question is whether controlling the temporal shape of a live orchestral performance is satisfying on its own.

### Experience principles

- The orchestra follows the player. The player is not trying to follow the orchestra.
- Tempo is expressive, not a score to optimize.
- The system should feel responsive without sounding nervous or mechanically jittery.
- Prediction is fundamental. The orchestra schedules the next beat before it arrives, then corrects its clock from the player's next observation.
- The first playable stays narrow enough that failures are easy to diagnose.
- Camera conducting is an input upgrade, not a different musical system.

### Phase 1 scope

**In:** one MIDI piece, Space Bar input, tempo only, predictive beat clock, browser playback, simple stage presentation, good-enough orchestral samples.

**Out:** camera input, dynamics, articulation, section cueing, scoring, 3D orchestra simulation, repertoire system, final commercial audio.

## 2. First playable interaction

1. Load MIDI and samples before asking the player to conduct.
2. Show: **Tap SPACE twice to set the pulse.**
3. First press establishes preparatory beat A.
4. Second press establishes preparatory beat B and the initial beat period.
5. Predict the next beat and define it as score beat 0.
6. Schedule the opening notes before that beat arrives.
7. The orchestra enters on the predicted beat.
8. Third and later presses correct tempo and phase while playback continues.

```text
Player input:     TAP A          TAP B          TAP C          TAP D
                      |              |              |              |
Predicted pulse:      prep           prep           BEAT 0         BEAT 1
                                                    ^
                                                    orchestra enters

After TAP B, the system already knows when it expects BEAT 0.
The audio for BEAT 0 is scheduled before TAP C arrives.
```

During performance, one accepted Space Bar press equals one conducted beat. The orchestra continues from prediction between presses. Small timing imperfections are smoothed, deliberate tempo changes are followed, one missed beat can be inferred, and prolonged lack of input eventually produces a graceful pause.

## 3. Predictive conductor clock

The central technical system is a clock that predicts future beats from imperfect human observations.

### Three time domains

- **Score time:** position in the composition, measured in beats or ticks.
- **Conductor time:** inferred beat period, phase, predicted next beat, and confidence.
- **Audio time:** `AudioContext.currentTime`, used to schedule audible events precisely.

```text
MIDI score (beat space)
        |
        v
[ Score Transport ] <----- [ Conductor Clock ] <----- [ Beat Input ]
        |                         ^                         Space Bar now
        |                         |                         Camera later
        v                         |
[ Look-ahead Scheduler ] --------+
        |
        v
[ Audio Engine ] ---> Web Audio clock ---> speakers
```

A tap is an observation, not an audio trigger.

### Initial follower model

Use a small, explicit PLL-inspired follower.

```text
On accepted tap at time t:

  observedInterval = t - lastAcceptedTap
  beatSteps = nearest plausible number of missed beats (normally 1)
  observedPeriod = observedInterval / beatSteps

  phaseError = t - expectedTapTime
  period = blend(period, observedPeriod, tempoGain)
  phase  = phase + phaseError * phaseGain

  nextBeatTime = correctedPhase + period
```

Starting tuning values, not contracts:

- `tempoGain`: about 0.25 to 0.40
- `phaseGain`: about 0.30 to 0.50
- accepted tempo range: about 45 to 220 BPM

Tune for two competing goals: natural 10-20 ms tapping noise should not make the orchestra wobble, while a deliberate accelerando or ritardando should become obvious within about 2-4 beats.

### Input robustness

- Reject obvious quick double taps.
- If an interval is close to 2x the predicted beat period, infer one missed tap and divide the interval by two.
- Down-weight a single unusual interval.
- Follow several consistent faster or slower intervals as intentional tempo change.
- Coast briefly when input disappears, then fade/pause after several beats.

## 4. MIDI and score representation

Parse MIDI into beat space. Do not use source seconds as runtime timing.

```text
beatPosition = midiTick / PPQ
```

Parse notes into independent score events so note releases can continue to follow later tempo changes:

```ts
type ScoreEvent = {
  beat: number;
  type: "noteOn" | "noteOff";
  trackId: string;
  noteId: string;
  midiNote: number;
  velocity: number;
};
```

The audio layer should expose separate scheduling operations for note-on and note-off events.

Phase 1 requires note on/off, velocity, enough program/track data to map instruments, PPQ/ticks, and basic time-signature metadata. Parse embedded tempo for metadata but ignore it as the runtime transport.

## 5. Audio scheduling

Use one reusable `AudioContext`. Musical events are scheduled against Web Audio time, not fired directly from keyboard events, `setTimeout`, or animation frames.

A lightweight scheduler can wake every roughly 20-30 ms and schedule events inside a roughly 120-180 ms future window. These are tuning values.

Rules:

- Events outside the look-ahead window remain movable as tempo changes.
- Events already committed to Web Audio are normally fixed.
- The scheduler must never schedule an event twice.
- The custom conductor clock plus score beat position is the source of truth.
- Do not make Tone.Transport, MIDI seconds, or browser timers the musical authority.

Recommended first stack:

- TypeScript browser app
- `@tonejs/midi` or equivalent for MIDI parsing
- custom `ConductorClock`
- Web Audio time for scheduling
- replaceable sampler/SoundFont `AudioEngine`
- lightweight web UI

Tone.js can assist with samplers or audio utilities, but its standard transport should not own tempo.

## 6. Software architecture

```text
BeatInputProvider   Produces timestamped beat observations.
ConductorClock      Estimates period and phase, predicts beats.
MidiScore           Normalizes MIDI into beat-space events.
ScoreTransport      Maps score positions through conductor time.
Scheduler           Commits upcoming score events exactly once.
AudioEngine         Schedules note-on/off and master audio operations.
ExperienceController Owns loading/preparing/playing/coasting states.
DebugOverlay        Makes timing state visible while tuning.
```

Input contract:

```ts
type BeatObservation = {
  source: "keyboard" | "camera";
  timestampMs: number;
  confidence: number;
};

interface BeatInputProvider {
  start(): void;
  stop(): void;
  onBeat(callback: (beat: BeatObservation) => void): () => void;
}
```

The rest of the system must not care whether a beat came from a keypress or a camera.

## 7. Visual experience

Keep the main presentation simple and musical. Use a stage or orchestra visual, piece title, preparation prompt, restart control, and clear loading state.

Do not add score, combo, target BPM, accuracy feedback, or Perfect/Good/Miss judgements to the core experience.

A visible predicted pulse is worth testing, but it may accidentally make the player follow the screen. Keep it removable and always available in debug mode.

## 8. Phased build plan

### Phase 0: Timing spike

**Goal:** prove the predictive clock before orchestration.

Deliverable: Space taps drive a click or single note. Two preparatory taps predict the entry. Stable tempo, accelerando, ritardando, jitter, double taps, and a missed beat behave sensibly.

### Phase 1: First orchestra

**Goal:** prove the core experience.

Deliverable: one MIDI file plays from beat space through the predictive scheduler. Space controls tempo. The opening downbeat is predicted. Basic samples are sufficient. The result is enjoyable enough to repeat.

### Phase 2: Make it musical

Improve instrument mapping, independent note releases, velocity, useful controllers, reverb, levels, pause/resume, and graceful conducting stop.

### Phase 3: Experience polish

Add intentional presentation, loading flow, preparation cue, restart, completion, subtle feedback, and hidden debug mode.

### Phase 4: Camera input

Use MediaPipe or equivalent to produce the same `BeatObservation` events from hand motion. Keep keyboard input as the reference implementation. Isolate beat detection from expressive gesture work.

### Phase 5: Expressive conducting

Only after tempo following is excellent, explore dynamics, cutoff, cueing, gesture size, left-hand expression, and related controls.

### Phase 6: Optional game layer

Only if it improves the product, explore challenges, audience reaction, orchestra personality, progression, or scoring.

## 9. Acceptance tests

Phase 0:

- Stable 120 BPM plus realistic jitter remains audibly stable.
- 90 to 140 BPM over 8 beats is followed without abrupt jumps.
- A ritardando does not stall or reverse the clock.
- One missed tap does not halve the tempo.
- An accidental quick double tap is ignored.
- The opening sound lands on the beat predicted from the two preparatory taps.

Phase 1:

- MIDI advances in beat space under conductor control.
- No note is triggered directly from the Space Bar handler.
- Tempo changes affect future note starts and note releases where practical.
- No duplicate notes, scheduler drift, or runaway tempo.
- At least one tester intentionally plays with tempo rather than merely reproducing the original tempo.

## 10. Debug telemetry

Expose at least:

- inferred BPM
- beat period
- predicted next beat time
- phase error in milliseconds
- tap accepted/rejected and reason
- conductor confidence
- score beat position
- scheduler horizon and queued event count
- `AudioContext` base/output latency where available

Add deterministic test helpers that feed synthetic tap sequences into `ConductorClock` without audio.

## 11. Camera input later

The camera phase should output the same beat observations as the keyboard phase. A likely first approach is hand landmark tracking plus motion analysis, detecting a deceleration and direction change around an ictus rather than testing for a fixed screen coordinate.

Start with one hand and one beat signal. Do not add dynamics or left-hand gesture interpretation at the same time.

## 12. Content and licensing

- Use a public-domain composition for the prototype.
- Confirm the MIDI arrangement license separately from the composition.
- Confirm all SoundFont and sample licenses.
- Keep music and sample assets isolated from conductor logic.
- Prefer local/repository-managed assets for a dependable prototype.

## 13. Repository implementation rules

- Build the smallest end-to-end vertical slice first.
- Keep `ConductorClock` free of audio and UI dependencies.
- Keep MIDI parsing separate from runtime transport.
- Keep `BeatInputProvider` abstract from the beginning.
- Keep `AudioEngine` replaceable.
- Do not silently add game mechanics.
- Do not add camera work until Space Bar conducting is musically convincing.
- Prefer visible tuning constants over clever hidden heuristics.
- Document every timing constant and why it exists.

Suggested shape:

```text
/src
  /audio
    AudioEngine.ts
    instruments.ts
  /clock
    ConductorClock.ts
    clockTypes.ts
  /input
    BeatInputProvider.ts
    KeyboardBeatInput.ts
    CameraBeatInput.ts        // later
  /score
    MidiScore.ts
    ScoreTransport.ts
    scoreTypes.ts
  /scheduler
    Scheduler.ts
  /experience
    ExperienceController.ts
  /ui
    DebugOverlay.ts
/tests
  conductorClock.test.ts
  scheduler.test.ts
  scoreTransport.test.ts
  tapScenarios.ts
/public
  /midi
  /samples
/docs
  core-design.md
```

## 14. Definition of success

The first milestone is not "camera conducting works" and it is not "MIDI plays in the browser." The first milestone is that the orchestra feels like it is following a human pulse.

The key signals are responsiveness, stability, agency, illusion, and repeatability.

> **Go / no-go question after Phase 1:** If the camera never existed, is controlling an orchestra with Space Bar tempo alone already an interesting musical experience? If the answer is no, adding gesture recognition will not fix the core product.

## 15. Open design questions

- How long should the orchestra coast after conducting stops?
- Should the system show the predicted beat, or does that turn the player into a follower?
- How aggressively should it follow sudden changes versus smoothing them?
- Should missed beats be inferred automatically?
- How should fermatas, pauses, and final cadences work later?
- Which first MIDI arrangement gives the most convincing result with lightweight samples?

## Technical references

- Web Audio API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- AudioContext: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext
- @tonejs/midi: https://github.com/Tonejs/Midi
- Tone.js Transport: https://tonejs.github.io/docs/14.5.3/Transport
- MediaPipe Hand Landmarker: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
- SpessaSynth: https://github.com/spessasus/spessasynth_lib
- WebAudioFontPlayer: https://webaudiofonts.com/webaudiofontplayer/
