# TODO.md

- [x] **FIRST FEW NOTES**: Sort out the problem when you start the piece it misses the first few notes (Resolved in v0.2.3: Clamped near-past boundary notes in Scheduler so downbeat notes never drop under tap jitter).
- [x] **GOES ON WITHOUT YOU**: Sometime it gets into a state where the orchestra keeps playing but you have no more input, and you can't control it (Resolved in v0.2.3: Reset tap timestamp baseline on slow gaps in ConductorClock so conducting control is immediately recaptured).
- [x] **CUT TIME**: For Symphony #5, it feels like I need to conduct a lot. Make it that I conduct in "cut time" i.e. just half of the beats (Resolved in v0.2.3: Added `beatsPerTap: 2` for Beethoven 5, so 1 tap = 2 beats / 1 bar).
- [x] **SONG METADATA**: Metadata for songs colocated alongside `.mid` files in `public/midi/` (Resolved in v0.2.3: Created `Eine-Kleine-Nachtmusik1.json`, `5th-Symphony-Part-1.json`, and `repertoire.json`).