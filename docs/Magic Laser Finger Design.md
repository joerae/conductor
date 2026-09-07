Magic Laser Finger Design

# Magic Finger Mode

## Goal

Add a third camera conducting mode alongside **Expressive** and **Beat**, called **Magic Finger**.

Magic Finger is a playful, direct-control mode built around the existing laser pointer. The laser point works great for Instrument Spotlights, and now we want to use it for dynamics and tampo too. 

Suggested mode label: **☝️ Magic Finger**.

## Core behaviour

- Magic Finger uses the laser pointer as its control method, so it only supports camera control.
- The laser exists only while a valid pointing-finger gesture is detected.
- Retracting the finger immediately hides the laser and releases anything being controlled.
- Retracting the finger does **not** reset tempo or dynamics. Their last values remain in place.
- In this mode, disable or suppress the normal beat detection, hand-height tempo control, hand-spread dynamics control, and other expressive gestures. They must not compete with laser control.

The laser only interacts with these three musical areas in the first version:

1. Instrument sections above the camera (just like in Expressive mode)
2. Dynamics ribbon below the camera
3. Tempo gauge to the right

It does not need to operate ordinary buttons, selectors, modals, or other UI.

## Instruments

Keep the current laser spotlight interaction, I can't think of any changes required.

-
## Tempo control

The tempo gauge becomes a direct vertical laser slider.

- Pointing higher on the gauge means faster; pointing lower means slower.
- Use the gauge's existing 40 to 220 BPM mapping.
- Tempo should update continuously while the slider is controlled, not jump between the named tempo bands.

### Safe acquisition

The player cannot change tempo merely by pointing anywhere on the gauge. They must first point reasonably close to the **current indicated BPM marker**.

Once the pointer enters a generous capture area around that marker, acquire it immediately. No dwell is required. While acquired, the player can move the marker freely up and down the full gauge.

This prevents a stray point at 220 BPM from instantly changing a piece currently playing at 90 BPM.

I believe one way to do this is to visually show a block either side of the current BPM marketing that represents the "hit zone" that the finger will target. It could be similar to the "brackets" that are used to show the tempo range in the tempo control UI for beat mode. 

### Release

Release tempo control when either:

- the pointing gesture ends, or
- the laser leaves a forgiving padded interaction zone around the tempo gauge.

The padded zone should tolerate normal hand wobble, but allow the player to clearly move away and target dynamics or an instrument. On release, keep the last selected BPM.

## Dynamics control

The dynamics ribbon becomes a direct horizontal laser slider.

- Pointing left means softer; pointing right means louder.
- Control the existing continuous analogue dynamics value across the full range, with the musical labels updating as they do now.
- Do not reduce this to discrete `pp`, `p`, `mp`, `mf`, `f`, `ff`, and `fff` jumps.

Use the same safe-acquisition rule as tempo:

- The player must first point reasonably close to the **current analogue dynamics marker**.
- Acquire immediately when the laser enters that capture area.
- Again, visualise the capture area to make it way easier to debug
- Once acquired, allow continuous movement across the full dynamics ribbon.
- Release when the finger retracts or the laser leaves a forgiving padded zone around the dynamics control.
- Keep the final dynamics value after release.

For example, if the orchestra is around `mf`, pointing straight at `ff` should do nothing. The player must pick up the marker near `mf`, then sweep it towards `ff`.

## Targeting and state

Only one thing can be controlled at a time.

A simple conceptual interaction state is enough:

- **Pointing:** laser is active, but no slider is acquired
- **Tempo acquired:** pointer movement controls tempo
- **Dynamics acquired:** pointer movement controls dynamics
- **Instrument targeted:** that instrument is spotlighted while targeted (like current behavior)

Slider acquisition should take priority only after the pointer enters the capture area around its current marker. Otherwise the pointer remains free to target instruments or open space.

When a slider is acquired, small excursions around its track should not drop it. Once the pointer clearly leaves the padded control zone, release it immediately so the user can move naturally to another target.

## Visual feedback

The interaction needs to explain itself visually:

- Show the existing laser ray whenever a valid pointing gesture is active in Magic Finger mode.
- Keep the fingertip glow and projected target point.
- When the laser is close enough to acquire a tempo or dynamics marker, give that marker or track a clear hover glow.
- Once acquired, give it a stronger grabbed/active treatment so the player knows movement is now controlling it.
- Remove the acquired treatment immediately on release.
- Instrument spotlight feedback should remain as it is now, active only while pointed at.

Suggested mode hint:

> Point near a marker to grab it • Point at instruments  to spotlight • Retract finger to release

## Implementation guidance

These are just suggestions. Overall try to reuse the great stuff from instrument selection, but now allow us to change tempo and dynamics. Keep this integrated with the current camera architecture rather than building a parallel pointer system.

- Reuse or generalise the ray projection and screen-coordinate work in `InstrumentFocusController` and `CameraPreviewOverlay`.
- It may make sense to introduce a small Magic Finger interaction controller that hit-tests the three target areas and owns acquisition/release state.
- Reuse the current continuous dynamics pipeline and display marker.
- Reuse `bpmToPercent`; add the inverse mapping if needed for direct gauge control.
- The exact capture distance, release padding, and any light smoothing should be easy to tune after trying it with a child. Choose sensible initial values, but do not bury them throughout the code.
- Update the mode selector, current mode types/state, help text, and any mode-specific camera suppression rules.
- Preserve existing behaviour in Expressive and Beat modes.
- Add focused tests for the important interaction rules.
- Follow the repository's normal version bump and version-history process.

## Acceptance checks

The first version is successful when:

1. Selecting **Magic Finger** control method leaves the music controllable without beat or expressive gestures interfering.
2. Extending an index finger shows the laser; retracting it hides the laser and releases the current target.
3. Pointing at each instrument spotlights it only for as long as it is targeted.
4. Pointing far away from the current tempo marker does not change tempo.
5. Pointing near the tempo marker acquires it immediately, after which moving vertically controls the full BPM range.
6. Pointing far away from the current dynamics marker does not change dynamics.
7. Pointing near the dynamics marker acquires it immediately, after which moving horizontally controls the full continuous dynamics range.
8. Leaving a slider's padded zone releases it, but normal pointer wobble does not.
9. Tempo and dynamics retain their last values after release.
10. Moving from a released slider to an instrument works naturally, without needing a pinch, click, dwell, or mode reset.

