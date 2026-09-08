# TODO.md


[  ] disable warmup for now. I think there's a feature flag. Keep it in there. But just show a loading bar for the moment instead of warmup



[  ] Add "Made by Joe Raeburn in 2026" down in the footer



BIG REFACTOR, only do when called

[  ] Refactor MagicFingerController to make future interaction changes easier to
reason about. Preserve current behaviour during this task.

The present controller is approximately 1,500 lines and duplicates geometry,
vertical-gauge processing, hold-to-lock, and release logic.

Stage 1:
- Extract DOM geometry providers, rectangle conversion, ray intersection,
  and instrument targeting into src/camera/magicFingerGeometry.ts.
- Add pure unit tests for ray-versus-rectangle and instrument targeting.
- Make the geometry module return semantic targets: tempo, dynamics,
  instrument, or open.
- MagicFingerController must no longer directly inspect DOM elements.
- Do not change interaction thresholds or behaviour.

Stage 2:
- Consolidate the overlapping state, activeTarget, hoverTarget,
  currentHoverTarget, isLockedIn, lockedTarget, and lockedValue fields into
  one discriminated interaction-state type.
- Preserve the existing public API and telemetry format.
- Do not change behaviour.

Stage 3:
- Extract the duplicated tempo and vertical-dynamics processing into a
  shared vertical-control function.
- Keep horizontal dynamics processing separate.
- Keep target-specific value conversion explicit.

Run tests/magicFinger.test.ts after each stage. Run the full test suite and
typecheck at the end. Do not update version history. Do not alter visual
design. Do not create feature flags.

If a stage cannot be completed without changing behaviour, stop after the
previous successful stage and explain the blocker.


NOT YET is below



[  ] Put in rests into the score visualiser! Right now there are no rests unless the whole bar is rests!!

[  ] Magic finger mode - beats to set tempo. If I move my hand up and down to create "beats", and I do 4 of these in a row, it will use that speed to set the tempo. But only if the four are suffienctly stable to capture the intention of "oh I'm beating my hands up and down now".

- [ ] **Camera accents NOT YET**: Forward push gesture with both hands to trigger dynamic accent.

[ ] warmup. Click to go through the tutorial steps. So it'll keep showing the tempo bit until you hit "next". Then it'll keep showing the dynamic bit until you hit "next". Then it'll either bein the "ready" state or the loading will still be goig on. And during those two states I don't think it needs to show the webcam at all

[  ] warmup, the final "raise your hands to begin" is too wordy. I just needs that one line of text.
