# TODO.md

- [x] **THRESHOLD IN MODE E FOR HANDS**: Only pause when hands are completely off-screen (`samples.length === 0`), allowing low hand position (`y = 0.10`) for slow Largo conducting.
- [x] **MODE E FINGER BEATING**: Steady-hand filtering implemented using variance analysis. If one hand beats time while the other stays steady, the steady hand's smoothed mean Y exclusively sets tempo.
- [x] **FIRST FEW NOTES**: Beethoven 5 lead-in beat of anticipation added and timed precisely to conducting tempo.
- [x] **CUT TIME TEMPO**: Mode D ("Beat" mode) now operates in cut time (1 conducting stroke = 2 beats) with accurate musical BPM doubling on both the Speedometer readout and internal clock.
- [x] **BPM Green Zone**: Visual translucent target band on the tempo gauge highlighting ±20 BPM around the intended piece BPM.
- [x] **INTERPOLATE DYNAMICS**: Continuous 0–1 analogue dynamics interpolation implemented in AudioEngine with live vertical slider indicator alongside the dynamic ladder.
- [x] **TWO MODES IN MAIN UI**: Simplified to **🪄 Expressive** (Mode E, default) and **🥁 Beat** (Mode D, Cut Time), with live explanatory hint text. Autoplay and other modes moved to the Debug Overlay (`D` key).
- [x] **Cursor Key Control of accelerando for Mode E**: ← / → keys shift the base BPM ±5 BPM; `\` always triggers dynamic accent in all modes.
- [ ] **MAKE CAMERA VIEW MORE MAGICAL**: Add some VFX in time with the beat and overlay particle systems that react to the music and hands.
- [ ] **THUMBS UP and V SIGN MAGIC**: Gesture recognition for thumbs up and dual V-for-Victory signs triggering celebratory VFX bursts.
- [ ] **Camera accents**: Forward push gesture with both hands to trigger dynamic accent.