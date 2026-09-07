# Magic Finger: Hold to Lock

## Tuning Required

* Right now you need to hold very steady for it to start locking, increase the threshold for what "steady" means by 60% please

* Timing of the locking circle: it takes a little too long for the circle to start appearing, but then it fill up to fast. Reduce the time the locking indicator circle takes to appear by 30%, but then make it take 50% longer to fill up and lock the circle

* Loock in feedback:  visulisation - this should happen at the position on screen of the locking circle. Right now it always happens in the top right part of the tempo gauge.

* Rearming - the laser rearms far to easily when moving up towards the top. In reality I just want it to rearm IF YOU ARE ACTUALLY POINTING TO THE TOP - I.E. pointing at one of the instrument sections. The current behaviour makes the rearming take place if you gradually increase the tempo or dynamics, which gives us the same bad experience of going to max tempo.





## Problem

When the player retracts their pointing finger to stop controlling tempo or dynamics, the laser moves as the finger curls. This often changes the value just before release.

## New interaction

Augment the fist-shake lock gesture with a **hold steady to lock** interaction. It does a similar thing (locks the value) but tries a different input that doesn't require the user to learn anything new

1. The player grabs and adjusts tempo or dynamics as they do now.
2. When the selected value stays roughly steady for about **0.85 seconds**, the control begins charging. (Configurable, add the config into the debug menu)
3. Show the charge as a ring filling around the slider handle or laser impact point.
4. If the value moves meaningfully, reset the charge immediately.
5. When the ring completes, send a bright pulse along the laser, briefly flash the handle, freeze the current value, and fade out the laser to a darker colour, showing it is inactive.
6. The completed pulse and dimming  laser communicate success.

Measure steadiness using the **resulting slider value**, rather than requiring the fingertip or hand to stay perfectly still. Allow normal jitter. This could be a configurable value too but make a sensible first guess.

## Rearming the laser

After locking, continue tracking the pointer invisibly. Rearm the laser when either:

- the player retracts and re-extends their finger, or
- the invisible pointer moves clearly outside the expanded hit area of the current control, e.g. it moves to a whole different side of the screen (e.g. out of the tempo area, into the instruments area)

Once rearmed, the laser reappears and can target another control or instrument. Do not let small tracking wobble immediately rearm or re-grab the locked control.

## Visual guidance

For the first few uses, show:

> Hold steady to lock • Point away to continue

The interaction should feel like the laser charges up, releases its energy in a pulse, then temporarily powers down.

## Success criteria

- Retracting the finger after a lock cannot alter the chosen value.
- Small natural wobble does not prevent the charge from completing.
- Deliberate adjustment resets the charge clearly.
- The player can point away and naturally move to another target.
- Moving from a locked, mid tempo up to Instrument Spotlight (at the top) doesn't accidentially trigger a fast tempo as the finger points that way
- The same behaviour works for both tempo and dynamics.
