# TODO.md

[x] I'm having an issue where Beethoven's 5th is just too LOUD overall with all the parts playing. Could we have something in the metadata that just brings everything down a bit on that song? Like we reduce the velocity by 25% or something across the board before anything else? Or is there another way of doing it?
> **Resolved**: Added `velocityScale: 0.75` in metadata (`PieceDefinition` in `src/score/repertoire.ts` and `public/midi/5th-Symphony-Part-1.json`). `MidiScore.load` applies `velocityScale` directly during note parsing, reducing velocity by 25% across the board before dynamic tier modeling or synthesis.

[x] Can we specificy minimum and maximum tempi? For example in Beethoven's 5th, it's starting tempo is pretty fast, so I need more room above it to make it faster, but I don't need to make it go radically as slow. The tempo range for Eine Keine is pretty good but ideally I'd like it to reduce the range by about 10pm on each end (so neither go quite as slow or quite as fast) - again I think metadata might be the solution
> **Resolved**: Added `minBpm` and `maxBpm` to `PieceDefinition` and song JSON files:
> - **Beethoven's 5th**: `minBpm: 60, maxBpm: 240` (starting tempo 108, providing plenty of room for accelerando while preventing sluggish tempos).
> - **Eine Kleine**: `minBpm: 50, maxBpm: 210` (reduced by 10 BPM on each end from standard 40–220).
> - `bpmGauge.ts` dynamically positions ticks and adjusts label bounds (`setGaugeBpmRange`), and `ConductorClock` and `cameraGestureHandler` clamp to the active piece tempo bounds.

[x] The imperial march starts with 4 bars or rests. I just want it to start when I start. Again, I wonder if metadata could make it start just before it is supposed to come on
> **Resolved**: Added `startBeat: 12` in `The-Imperial-March.json`. The transport, scheduler, and `SpotlightScoreVisualizer` initialize at beat 12 (bar 4), starting playback directly on the opening timpani/string ostinato with zero leading bars of rests.

[ ] I really like pointing at an instrument and seeing a SINGLE line of music (maybe sometimes some double stopping). In Eine Keine the violins 1s seem to have two lines, quite far apart. Is is possible to turn them into two instruments? This one I need on a feature flag though. And in Beethoven's 5th SO MANY things seem to be grouped together. I'm not even sure how that works. Maybe rather than fixing it, and you write in this TODO how it currently works and some options for fixing it.

### How It Currently Works
1. **Section Grouping in Metadata**:
   In `src/score/repertoire.ts` and `public/midi/*.json`, pieces define orchestra sections with lists of channels and track names:
   - In Beethoven's 5th: `strings-upper` bundles channels `[7, 8]` with track name `"STRINGS"` (grouping 1st Violins, 2nd Violins, and Violas into a single section); `woodwinds` bundles Flute (ch 0) and Oboe (ch 1); `reeds` bundles Clarinet (ch 2) and Bassoon (ch 3); `strings-lower` bundles Cello (ch 10) and Contrabass (ch 11).
2. **Note Extraction**:
   In `SpotlightScoreVisualizer.ts`, `loadNotesForSection()` filters MIDI events matching any channel or track name assigned to that section. For grouped sections, notes from all combined instruments are pooled together.
3. **Chord Column Merging in VexFlow**:
   In `renderMeasure()`, `groupNotesByBeat()` aggregates all notes occurring within 0.05 beats of each other into a single vertical chord column (`StaveNote` with multiple `keys`). When multiple instruments play simultaneously, their pitches are rendered as a vertical stack of notes on one stave.
4. **Eine Kleine Divisi**:
   In `Eine-Kleine-Nachtmusik1.mid`, Track 0 ("Violin I") has 72 polyphonic moments baked into channel 0 (e.g. mm. 20, 68, 92–96) where both upper melody and lower harmony/octave lines exist in the same track. When rendered, VexFlow combines them into chords.

### Options for Fixing
- **Option A: Split Section Metadata into Individual Instrument Parts (Recommended for Beethoven 5)**
  Update `5th-Symphony-Part-1.json` to define distinct sections for each instrument:
  - Separate `flute` (ch 0), `oboe` (ch 1), `clarinet` (ch 2), `bassoon` (ch 3), `violin1` (ch 7), `violin2` (ch 8), `viola` (ch 8/channel demux), `cello` (ch 10), `contrabass` (ch 11).
  - Update or map the orchestra stage SVG hit targets so each desk/section can be spotlighted individually, showing only that instrument's single notation line.
- **Option B: Top-Line / Monophonic Melody Filter (behind a Feature Flag)**
  Introduce a feature flag (`singleLineMode` in `SpotlightScoreVisualizer.ts`):
  - When active, `loadNotesForSection` or `groupNotesByBeat` extracts only the highest pitch at each beat (the leading melody line).
  - To preserve authentic violin double-stops: if two simultaneous notes are within a close harmonic interval (e.g. minor 3rd to perfect 5th) and share the exact same duration, preserve them as a double-stop; otherwise, filter out the lower accompaniment/divisi voice.
- **Option C: Track / Channel Divisi Demuxing (for Eine Kleine Violin 1)**
  - Split Eine Kleine's Track 0 into two logical tracks: `Violin I (Desk 1 / Upper)` and `Violin I (Desk 2 / Divisi)`.
  - Can be done either via MIDI file pre-processing or dynamically on load using a voice separation algorithm (e.g., Skyline heuristic).
- **Option D: Two-Voice Stave Engraving (VexFlow Multi-Voice)**
  - Instead of forcing simultaneous notes into a single chord with shared stems, create two distinct VexFlow `Voice` instances on the stave (Voice 1 stems up, Voice 2 stems down).
  - This preserves both parts without stacking them into awkward wide chords.

---

[x] Please go back to expressive being the default mode. And find a place for mode select to work OK on mobile.
> **Resolved**:
> - Set default mode to Expressive (`gestural`) across `ExperienceController` and `index.html`.
> - Added responsive CSS in `src/styles/base.css`:
>   - Desktop keyboard shortcut hint text (`.mode-shortcut-hint`) is hidden on tablets (<=768px) and mobile (<=480px).
>   - Mode and Input selectors wrap into neat, centered, rounded pill bars with touch-friendly button targets (`min-height: 32px`).
>   - On mobile phones (<=480px), each pill selector fits within the viewport width without horizontal scrolling or wrapping issues.




NOT YET

- [ ] **Camera accents NOT YET**: Forward push gesture with both hands to trigger dynamic accent.
