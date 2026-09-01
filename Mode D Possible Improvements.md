Mode D Possible Improvements

BIG ONE BELOW, NEEDS TO BE OWN THING FOR MODE D

Please improve the camera timing model around three distinct signals:

**1. Bottom ictus = authoritative beat**

The actual camera beat remains the bottom turnaround of the downward stroke.

A confirmed bottom ictus can:

* emit a beat observation
* anchor phase
* contribute directly to tempo calculation

Do not make the apex itself a musical beat.

**2. Apex = supporting timing observation**

Detect the top turnaround as an `apex` timing observation, but do not emit it as a beat.

Use apex timing as supporting evidence about the conducting cycle.

In particular, apex should help with:

* detecting acceleration or deceleration earlier
* predicting when the next bottom ictus will occur
* validating whether two apparent bottom beats are physically plausible

For example, if two candidate bottom ictuses occur very close together with no credible apex/recovery between them, that is strong evidence that the second one is an accidental duplicate/false detection.

Conversely, a sequence like:

```text
BOTTOM -> APEX -> BOTTOM
```

is much stronger evidence of a real complete conducting cycle.

Please use apex evidence as part of confidence/scoring rather than making it an absolute requirement, because tracking may occasionally miss the apex.

Apex timing should also contribute to tempo estimation. If the established conducting cycle is shortening or lengthening, the timing of successive bottom/apex observations can provide earlier evidence of accelerando or rallentando before the next bottom arrives.

Do not assume bottom-to-apex and apex-to-bottom are exactly equal. Learn or smooth the conductor's recent gesture proportions if useful.

**3. Predict the upcoming bottom during the downstroke**

The beat currently feels slightly late because the system can only confirm the bottom once upward rebound has begun.

Separate:

* predicted ictus
* confirmed ictus

After an apex, while the hand is descending, continually estimate the likely time of the upcoming bottom using:

* recent hand trajectory
* velocity and deceleration
* recent apex timing
* recent bottom-to-bottom cycle duration
* the established conducting tempo

Use the predicted ictus for ahead-of-time audio scheduling when confidence is high enough.

The subsequently confirmed bottom remains the authoritative observation and should correct phase/prediction error.

Also reduce confirmation latency where possible. Do not wait for a large visible upward rebound if a velocity zero-crossing or short trajectory fit can identify that the trough has occurred earlier.

Preserve original camera-frame/sample timestamps through hand tracking so MediaPipe processing latency is not mistaken for gesture timing.

For debugging, expose these separately:

* apex detected
* predicted next ictus time/confidence
* confirmed bottom ictus
* candidate beat rejected as likely duplicate

The intended model is:

```text
BOTTOM
  -> authoritative beat

UPSTROKE

APEX
  -> supporting timing evidence
  -> helps estimate cycle speed
  -> helps reject impossible duplicate bottoms

DOWNSTROKE
  -> increasingly confident prediction of next ictus

BOTTOM
  -> authoritative beat
  -> correct prediction/phase
```

The main goal is for the orchestra to feel like it lands exactly when my downward gesture lands, while using the apex and full gesture cycle to make tempo changes more responsive and false double-beats less likely.

