# TODO.md

[x] In Magic Finger mode, Vertically align the Dynamics and Tempo boxes with the camera, so they all sit vertically in the same space. This will make it easier to point at it

[x] Right now the tempo selector doesn't work in Magic Finger mode at all! If you point at it, it never goes into "Gold" selected state

[x] When the finger lasers appear in Magic Finger mode, the camera should darken to black, just like it does in Expressive Mode.

[x] Expressive mode has a neat "finger switching" emergent behavior and I want that in magic finger mode too! 

[x] Magic Finger mode - we need to make pointing up WAY more more pointing up in expressive mode. Namely, don't make the laser "snap" to the target, let me freely more my finger. However do make it turn gold when a target is selected. See how it is done in expressive mode, and pull that across

[x] [ Magic finger mode sensitivity] when I have my finger "3/4 pointed" it will often decise it isn't pointed enough. E.g. it looks like it is still pointed to the left, but the game will decide that it isn't enough to count as a point. I want this to count as a point.

[x] Left (dynamic) selector  and right (tempo) selector. These should be the same full vertical height as the camera. Right now they are nearly the same height.

[x] Magic finger mode - way to stop the music. In magic finger mode, if no hands are present on the screen, music should not play

[x] Magic finger mode - avoid extreme values when moving quickly. If I am editing the tempo on the right, then a move my finger up to the top with the intention of highlighting and instrument, it should NOT set the tempo to max - this happens accidentally a lot. Is there a way to distinguish this intentionality? Often I will want to change the volume rapidly, but it seems to easy to do it accidentally at the moment.

[ ] Magic finger mode - it's really hard for me to exit dynamic or tempo adjustment without me actually changing the dynamics or tempo. As I'm closing my fist, it moved the finger and often moves it down. Would like to do something about it. For example, maybe I could shake either hand to "lock in" the change (I see a sparkle) and then the laser will stop stop pointing. It can then make the laser point again by pointing to a different side of the screen, or by pulling my finger in and out again.

[ ] Magic finger mode - if my hand isn't on the screen for 1 second, the orchestra stops. That's good, but let's make it 500ms, and let's make a fade down start after 250ms. (This is just for Magic Finger Mode, Expressive mode should still be instantaneous.)

[ ] Magic finger instrument highlight mode - I don't think this has the volume changes that we have in the Expressive highlight mode - can we get those in please?

[  ] Let's get rid of cut time (al breve) for Symphony # 5. It is messing up the tempo indicators


[  ] Put in rests into the score visualiser! Right now there are no rests!!

**Note** a previous agent tried to do this and dot stuck halfwy through. HEre was the implemetnation plan

Implementation Plan: Fulfilling Magic Finger & Repertoire TODOs
This plan details the technical approach to implement the four pending items in 
TODO.md
:

Magic Finger Lock-In & Clean Exit: Shake either hand to lock in tempo/dynamic changes (with a sparkle effect), disable laser until repointing or pulling finger in/out, and suppress downward drags when closing fist.
Magic Finger Absence Grace Period & Fade: Change no-hands pause timeout to 500ms with a smooth volume fade-down beginning at 250ms.
Magic Finger Instrument Highlight Volume: Ensure pointing at an orchestra section applies the full acoustic spotlight (forte boost for selected section, piano backgrounding for others) identical to Expressive mode.
Beethoven Symphony No. 5 Cut Time Removal: Eliminate cut time (beatsPerTap: 2) so tempo indicators reflect standard 1-tap-per-beat conducting in 2/4.
Proposed Changes
Component 1: Score & Repertoire (
TODO: Symphony #5 Cut Time
)
Eliminate cut time (beatsPerTap: 2) from Beethoven Symphony No. 5 across metadata and tests.

[MODIFY] 
src/score/repertoire.ts
Change beatsPerTap: 2 to beatsPerTap: 1.
Update conductMode to "Standard (1 tap = 1 beat)".
Update description to "The most famous four-note motif in music history. Allegro con brio in 2/4 at ~108 BPM."
[MODIFY] 
public/midi/5th-Symphony-Part-1.json
Update beatsPerTap: 1, conductMode: "Standard (1 tap = 1 beat)", and description to match.
[MODIFY] 
tests/scoreLeadInAndRepertoire.test.ts
Update test assertion to check beatsPerTap equals 1.
Component 2: Audio Engine (
TODO: Fade Down & Instrument Highlight
)
Provide dedicated fade volume scaling on master output and ensure spotlighting volume changes are applied seamlessly.

[MODIFY] 
src/audio/AudioEngine.ts
Add fadeMultiplier: number = 1.0 (range 0.0 to 1.0).
Add setFadeMultiplier(ratio: number): void to smoothly scale master volume (masterVolume * fadeMultiplier) over a fast time constant (0.03s).
Add restoreMasterVolume(): void to reset fadeMultiplier = 1.0 and restore this.masterVolume.
Call restoreMasterVolume() inside stopAllNotes() and resume() so playback is never inadvertently left muted.
Component 3: Magic Finger Controller (
TODO: Shake-To-Lock-In, Sparkle, Instrument Targeting
)
Implement shake detection, lock-in state, repointing rules, and robust section mapping.

[MODIFY] 
src/camera/MagicFingerController.ts
Shake Detection:
Maintain hand position and velocity history for both hands over a 300ms sliding window.
Detect shake via rapid lateral/multi-directional oscillation (speed above threshold with >= 2 velocity reversals).
Lock-In State & Sparkle Event:
If shake is detected on either hand while activeTarget is acquired ("tempo" or "dynamics"):
Lock current value.
Set isLockedIn = true, lockedSide = this.activeTarget.
Fire onLockIn?.({ target: lockedSide, value, screenX, screenY }).
Disable pointing ray (activeTarget = null; state = "idle"; ray = null;).
Repoint / Reactivation:
Reset lock-in when: a) Finger is pulled in / retracted (no pointing hands detected). b) Finger points towards a different region (e.g. was locked on right tempo, now points left towards dynamics or up towards orchestra).
Fist Curl Drag Prevention:
When active on tempo/dynamics, detect when index finger flexion begins collapsing towards a closed fist. Freeze the value at lastValidInBounds instead of letting the downward curl drop tempo/volume.
Section Mapping:
Enhance DefaultDOMGeometryProvider.getInstrumentSections() to check data-section-id in addition to id.
Provide setSections(sections: PieceSection[]) on MagicFingerController so section IDs and hit targets match REPERTOIRE even before/without SVG mutation.
Wire onSpotlightChange and emit lockInEvent in MagicFingerTelemetry.
Component 4: Camera Provider & Experience Controller (
TODO: 500ms Stop / 250ms Fade, Audio Wiring
)
[MODIFY] 
src/camera/CameraBeatInputProvider.ts
Pass this.currentSections into MagicFingerController.setSections(...).
Forward onLockIn callbacks / telemetry to UI overlay for sparkle bursts.
[MODIFY] 
src/experience/ExperienceController.ts
500ms Pause & 250ms Fade Down:
When samples.length === 0 in magic mode:
If magicNoHandsStartTime === 0, record timestamp.
If now - magicNoHandsStartTime >= 500: restore master volume and call pausePlayback().
Else if now - magicNoHandsStartTime >= 250: compute fadeRatio = 1.0 - (elapsed - 250) / 250 and call this.audioEngine.setFadeMultiplier(fadeRatio).
When hands return (samples.length > 0): if magicNoHandsStartTime > 0, call this.audioEngine.restoreMasterVolume(); magicNoHandsStartTime = 0;.
Instrument Spotlight Volume Wiring:
Wire onSpotlightChange in mfController.setCallbacks directly to this.audioEngine.setSectionFocus(sec.channels, 1.0).
In cameraInput.onFocus, match section ID flexibly (s.id === id || String(idx) === id || "section-" + s.id === id).
Component 5: Visual Feedback & UI (
TODO: Sparkle VFX
)
[MODIFY] 
index.html
Ensure default SVG section tags have both id="section-violin1" and data-section-id="violin1" for clean initial DOM alignment.
[MODIFY] 
src/camera/CameraPreviewOverlay.ts
Add triggerSparkleVFX(screenX: number, screenY: number): void to render a golden sparkle particle burst ✨ at the lock-in location on the stage overlay or camera canvas.
[MODIFY] 
src/main.ts
Handle onMagicFinger lock-in telemetry: show lock-in hint in prompt (✨ Locked in! Shake detected • Point elsewhere or retract finger to repoint), flash gauge gold, and trigger sparkle animation.
Component 6: Tests (
Fix Regression & Add TODO Coverage
)
[MODIFY] 
tests/experienceControllerBugs.test.ts
Fix Issue 21 test by awaiting the start playback promise or microtask tick.
Add test verifying the 500ms pause and 250ms fade down behavior in Magic Finger mode.
[MODIFY] 
tests/magicFinger.test.ts
Add tests for shake-to-lock-in gesture detection.
Add tests for lock-in clearing on finger retract vs pointing elsewhere.
Add tests verifying instrument spotlighting triggers audio section focus.
Verification Plan
Automated Tests
Run npm test to verify all test suites pass, including existing and new tests:
tests/magicFinger.test.ts
tests/experienceControllerBugs.test.ts
tests/scoreLeadInAndRepertoire.test.ts
tests/audioLifecycleAndPerformance.test.ts
Manual / Browser Verification
Verify Beethoven Symphony No. 5 loads with 1-tap-per-beat tempo display (BPM ~108, no doubling or cut time mismatch).
Verify in Magic Finger mode:
When removing hands from camera, volume starts fading at 250ms and orchestra stops at 500ms.
When pointing at an orchestra section, sound levels clearly shift (spotlighted section gets louder, other sections soften).
When pointing at tempo or dynamics, shaking a hand locks in the value, displays sparkles ✨, and turns off the laser until finger is retracted or pointed to another side.

NOT YET is below

[  ] Magic finger mode - beats to set tempo. If I move my hand up and down to create "beats", and I do 4 of these in a row, it will use that speed to set the tempo. But only if the four are suffienctly stable to capture the intention of "oh I'm beating my hands up and down now".

- [ ] **Camera accents NOT YET**: Forward push gesture with both hands to trigger dynamic accent.

[ ] warmup. Click to go through the tutorial steps. So it'll keep showing the tempo bit until you hit "next". Then it'll keep showing the dynamic bit until you hit "next". Then it'll either bein the "ready" state or the loading will still be goig on. And during those two states I don't think it needs to show the webcam at all

[  ] warmup, the final "raise your hands to begin" is too wordy. I just needs that one line of text.
