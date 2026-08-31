# CONDUCTOR: Sound Rendering Architecture & Hybrid Dynamic Modeling

**Version 1.0 | September 2026**

## 1. Overview & Philosophy

In an acoustic orchestral performance, changing dynamic levels (e.g., from *pianissimo* to *fortissimo*) is not merely a change in volume—it is a profound physical transformation:
- **Timbre & Harmonics:** Loud brass notes develop rich upper harmonics and bite; loud strings produce a sharp attack and rich harmonic overtone series. Soft instruments produce warm, rounded, fundamental-heavy tones (*sotto voce*, *flautando*).
- **Ensemble Dynamic Contrast:** In authentic orchestration, melody voices carry significantly higher velocity than accompanying harmonic beds. Shifting dynamics must preserve this relative balance rather than flattening it.
- **Room & Acoustic Bloom:** Quiet playing remains intimate and dry; loud playing energizes the concert hall, swelling the reverberant tail.

### The Hybrid Dynamic Modeling Approach for Web Apps

Traditional sample-based orchestra engines often require gigabytes of multi-velocity sample layers to achieve these timbral shifts, creating prohibitive multi-hundred-megabyte downloads in browser environments.

**Conductor** solves this by pairing lightweight, instant-loading General MIDI SoundFonts (`FluidR3_GM`) with real-time **Web Audio native DSP modeling**:
1. **Proportional MIDI Velocity Scaling:** Preserves score phrasing and relative melody/accompaniment distance across all dynamic tiers without clipping or squashing.
2. **Spectral Timbre Filtering:** Smoothly automated `BiquadFilterNode` (Low-Pass Filter + High-Shelf Harmonics) running natively on the Web Audio C++ thread with sub-millisecond latency.
3. **Dynamic Attack Envelope Shaping:** Velocity-dependent attack curves (crisp 3ms bite on forte, gentle 16ms swell on piano).
4. **Dynamic Concert Hall Acoustics:** Stereo impulse response convolution reverb whose wet/dry ratio scales with orchestral energy.
5. **Transparent Safety Peak Protection:** A high-threshold (-1.0 dBFS) soft-knee peak limiter replacing heavy compressors, maintaining 100% natural score dynamic range.

```text
Score Events (MidiScore)
        │
        ▼
[ Proportional Velocity Scaler ] ─── Active Dynamic Level (pp, p, mp, mf, f, ff)
        │
        ▼
[ WebAudioFont Synthesizer ] ────── Dynamic Attack Envelope (3ms - 16ms)
        │
        ▼
[ Instrument Voice Nodes ]
        │
        ▼
[ Master Dynamic Filter Bus ] ───── LPF Cutoff (5.5kHz - 20kHz) & High-Shelf (-3dB - +2.2dB)
        │
   ┌────┴────────────────────────┐
   │ (Dry Master)                │ (Wet Send)
   │                             ▼
   │                   [ Convolver Reverb ]
   │                             │
   │                   [ Dynamic Reverb Gain ] (7% - 30% Wet)
   │                             │
   └─────────────┬───────────────┘
                 ▼
     [ Master Safety Limiter ] ─── Threshold -1.0 dBFS (Transparent Peak Protection)
                 │
                 ▼
       [ Audio Destination ] ───── Speakers / Headphones
```

---

## 2. Dynamic Levels & Parameters

Conductor defines six discrete dynamic markings, centered around the default score baseline `mf`:

| Dynamic | Italian Name | Velocity Multiplier | LPF Cutoff ($f_c$) | High-Shelf Gain | Reverb Wet | Attack Time | Character |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **`ff`** | *Fortissimo* | $\times 1.36$ | $20,000\text{ Hz}$ | $+2.2\text{ dB}$ | $30\%$ | $3\text{ ms}$ | Explosive, piercing brass bite, massive hall bloom *(Overburn)* |
| **`f`** | *Forte* | $\times 1.18$ | $17,500\text{ Hz}$ | $+1.2\text{ dB}$ | $24\%$ | $5\text{ ms}$ | Robust, powerful, resonant orchestral tutti |
| **`mf`** | *Mezzo-forte* | $\times 1.00$ | $14,000\text{ Hz}$ | $0.0\text{ dB}$ | $16\%$ | $8\text{ ms}$ | Balanced baseline; authentic score balance |
| **`mp`** | *Mezzo-piano* | $\times 0.84$ | $10,500\text{ Hz}$ | $-1.0\text{ dB}$ | $12\%$ | $11\text{ ms}$ | Subdued, gentle, warm accompaniment |
| **`p`** | *Piano* | $\times 0.68$ | $7,500\text{ Hz}$ | $-2.0\text{ dB}$ | $9\%$ | $14\text{ ms}$ | Soft, delicate, intimate phrasing |
| **`pp`** | *Pianissimo* | $\times 0.50$ | $5,500\text{ Hz}$ | $-3.0\text{ dB}$ | $7\%$ | $16\text{ ms}$ | Whisper-quiet, rounded fundamental (*sotto voce*) |

---

## 3. Mathematical Foundations

### 3.1 Proportional Velocity Scaling vs Additive Offsets

If a score contains a lead melody note at velocity $v_m = 95$ and an accompaniment note at velocity $v_a = 60$:

- **Additive Offset Problem ($+45$ on `ff`):**
  - $v_m' = \min(95 + 45, 127) = 127$
  - $v_a' = \min(60 + 45, 127) = 105$
  - **Dynamic contrast:** shrank from $35\text{ pts}$ to $22\text{ pts}$ (accompaniment becomes unnaturally prominent).
- **Proportional Scaling ($v' = \text{clamp}(v \times 1.36, 18, 127)$):**
  - $v_m' = \min(95 \times 1.36, 127) = 127$
  - $v_a' = 60 \times 1.36 = 82$
  - **Dynamic contrast:** remains at $45\text{ pts}$ (melody leads cleanly while accompaniment swells naturally).

### 3.2 Smooth Parameter Interpolation

To prevent clicks or zipper noise when the conductor adjusts dynamics during active playback:
- Filter frequencies and gains use `AudioParam.setTargetAtTime(target, currentTime, timeConstant)` with $\tau = 0.040\text{ s}$ ($63\%$ reached in $40\text{ ms}$, fully settled in $\sim 120\text{ ms}$).
- Velocity scaling applies immediately to all newly scheduled note-on events.

---

## 4. `ff` Overburn Mechanic

In live conducting, sustaining a full orchestral *fortissimo* requires continuous physical energy and intensity.

- **Trigger:** Shifting up into `ff` (via <kbd>↑</kbd>, mouse wheel, or clicking the `[⚡ ff]` badge) immediately activates maximum power, visual gold glow on the stage, and full acoustic excitation.
- **Decay:** After $1.5\text{ seconds}$ of no further upward input, the dynamic level automatically and smoothly decays back to `f` ($\tau \approx 0.8\text{ s}$).
- **Sustaining:** The conductor can maintain `ff` by continuously pumping/re-triggering the upward control.

---

## 5. Diagnostic & A/B Testing Capabilities

The system exposes full real-time telemetry and individual bypass toggles inside the Debug Overlay (<kbd>D</kbd> key):
- **Velocity Scaling Bypass:** Test raw score velocities versus scaled output.
- **Timbre Filter Bypass:** Listen to the unprocessed SoundFont versus dynamic low-pass/shelf modeling.
- **Reverb Scaling Bypass:** Compare static 16% room acoustics versus dynamic acoustic bloom.
- **Attack Envelope Bypass:** Compare fixed attack versus velocity-responsive envelope.
- **Safety Limiter Bypass:** Compare transparent peak protection versus unconstrained mix bus.
