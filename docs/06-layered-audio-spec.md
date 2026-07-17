# 06 - Layered Procedural Combat Audio

> Implementation-ready Web Audio spec for КОРОВАНЫ. It preserves the no-asset procedural
> approach while replacing one-oscillator SFX with bounded layered cues, explicit buses,
> variation, priority, and teardown.

## 1. Goal

Make combat, loot, UI, and world events sound as intentional as the new visuals. A hit
should combine transient, body, and texture; a kill should feel larger than a hit; a
shield should read as metal; and repeated impacts should vary without becoming noise.

The system must:

1. keep procedural audio and browser-autoplay compliance;
2. separate music, gameplay SFX, and UI levels;
3. cap concurrent sources and repeated cues;
4. support cheap camera-relative stereo placement;
5. disconnect every node on end/destroy;
6. stay useful when music or bloom is disabled.

## 2. Scope and non-goals

### In scope

- `AudioDirector` extraction with master/music/SFX/UI buses.
- Layer recipes using oscillators, one shared noise buffer, filters, and envelopes.
- Per-cue pitch/gain variation.
- Priority, concurrency caps, cooldown/coalescing, and voice tracking.
- Camera-relative stereo pan for world cues.
- Separate SFX volume preference.
- Existing procedural music migration without changing composition.

### Out of scope

- Downloaded samples, speech, voice acting, convolution reverb impulse files, or licensed
  audio.
- HRTF/3D `PannerNode` simulation.
- A full adaptive score rewrite.
- Footstep material detection in milestone one.
- User microphone or MIDI input.
- Suspending the `AudioContext` as ordinary pause behavior.

## 3. Verified baseline

| System | Current behavior |
| --- | --- |
| Context | `GameEngine` lazily creates one `AudioContext` on user interaction and owns it until `stopMusic()`/destroy. |
| Music | A scheduler creates procedural square/triangle tones, kick, snare, and hat through `musicGain`; faction, zone, and step select notes. |
| SFX | `playSound()` maps each cue to start frequency, end frequency, duration, oscillator type, and one gain envelope connected directly to `audioContext.destination`. |
| Mixing | SFX bypass music gain and have no master/SFX bus, compression, spatial pan, mute, or concurrency limit. |
| Pause/visibility | Music gain targets lower values on pause/end and zero when hidden/muted. |
| Lifecycle | Music scheduled sources are tracked; ordinary SFX sources/nodes are not tracked or explicitly disconnected. |
| Ownership | A window-level stop owner prevents overlapping music when engine instances change. |

## 4. Design corrections

- **Do not make impact louder by starting unlimited oscillators.** Layer count and voice
  count are both capped; priority determines what survives.
- **Do not connect SFX directly to destination.** Every source routes through a voice gain,
  category bus, master compressor, and master gain.
- **Do not create white-noise buffers per cue.** Generate one reusable buffer per
  `AudioContext`.
- **Do not use `AudioContext.suspend()` for pause or tab hide.** Resume can require a new
  user gesture. Ramp buses to zero/low level while the scheduler remains valid.
- **Do not play one wet splat per gore particle.** One combat event produces one bounded
  gore layer regardless of particle count.
- **Do not randomize beyond recognition.** Variation stays within recipe ranges and uses
  deterministic per-request parameter selection where practical.
- **Do not make SFX depend on React state timing.** GameEngine submits cues directly at
  authoritative events.

## 5. AudioDirector API

Add `src/game/AudioDirector.ts`:

```ts
export type SoundCue =
  | 'swing'
  | 'hitLight'
  | 'hitHeavy'
  | 'hurt'
  | 'block'
  | 'gore'
  | 'down'
  | 'bow'
  | 'arrow'
  | 'cleave'
  | 'attackTell'
  | 'whiff'
  | 'coin'
  | 'lootReveal'
  | 'lootCollect'
  | 'command'
  | 'objective'
  | 'save'
  | 'jump'
  | 'land'
  | 'event'
  | 'eventWin'
  | 'eventFail'
  | 'victory'

export interface SoundRequest {
  cue: SoundCue
  category?: 'gameplay' | 'ui'
  position?: THREE.Vector3
  intensity?: number
  variantSeed?: number
}

export interface AudioDirectorSettings {
  musicMuted: boolean
  sfxVolume: number
}
```

Public methods:

```ts
resume(): void
play(request: SoundRequest): void
setMusicMuted(muted: boolean): void
setSfxVolume(volume: number): void
setPaused(paused: boolean): void
setEnded(ended: boolean): void
setHidden(hidden: boolean): void
setListener(position: THREE.Vector3, right: THREE.Vector3): void
destroy(): void
```

`GameEngine` keeps a thin `playSound(cue, options)` wrapper only if it improves call-site
clarity. The director owns all Web Audio nodes and timers.

## 6. Bus graph

```text
music voices -> musicGain ----\
game voices  -> sfxGain -------+-> masterCompressor -> masterGain -> destination
UI voices    -> uiGain --------/
```

Recommended nominal targets:

```text
masterGain=0.85
musicGain active=0.18, paused=0.08, ended=0.035
sfxGain=0.62 * userSfxVolume
uiGain=0.48 * userSfxVolume
```

`DynamicsCompressorNode` starting values:

```text
threshold=-18 dB
knee=12 dB
ratio=5:1
attack=0.003 s
release=0.18 s
```

These are safety/tone defaults, not a substitute for reasonable layer gains. Do not drive
the compressor continuously.

## 7. Layer recipe model

Recipes are data plus small layer constructors:

```ts
type AudioLayer =
  | ToneLayer
  | NoiseLayer

interface CueRecipe {
  priority: number
  cooldown: number
  maxConcurrent: number
  layers: AudioLayer[]
}
```

Each tone layer defines waveform, start/end frequency range, attack, hold, release, and
gain range. Each noise layer defines buffer offset/duration, filter type/frequency/Q,
envelope, and gain.

All sources in one request share a parent voice gain and optional `StereoPannerNode`.
Track the request as one voice even when it has three source nodes.

### 7.1 Core cue recipes

| Cue | Layers |
| --- | --- |
| `swing` | band-pass noise whoosh + quiet descending triangle |
| `hitLight` | short noise crack + low triangle body |
| `hitHeavy` | sharper crack + lower sine thump + short saw texture |
| `block` | high metallic square ping + low impact + high-pass noise tick |
| `hurt` | descending saw body + filtered noise breath |
| `gore` | low-pass noise splat + short irregular triangle drop |
| `down` | heavy sine fall + noise body + short accent tone |
| `bow` | high-pass noise string + triangle twang |
| `arrow` | narrow-band noise pass-by; no low thump |
| `cleave` | broad whoosh + low sweep; impact layers arrive from hit events |
| `attackTell` | role-pitched short pulse, one layer |
| `whiff` | quiet high-pass whoosh |
| `lootReveal` | two/three-note rarity arpeggio |
| `lootCollect` | short upward triangle + sparkle tick |

Keep existing music notes and event/UI melodic identity unless a recipe explicitly
replaces the old single tone.

### 7.2 Intensity

Clamp request intensity to `0..1`. Use it to vary:

- body-layer gain by at most 6 dB;
- low-frequency endpoint;
- noise duration by at most 35%;
- optional third layer threshold.

Intensity never multiplies total output without a clamp. A lethal hit is a different
recipe/priority choice plus intensity, not four simultaneous `hit` calls.

### 7.3 Variation

Per request:

- pitch ratio: `0.94..1.06` ordinary, `0.90..1.04` gore/down;
- gain variation: +/- 1.5 dB;
- noise-buffer offset: randomized within valid range;
- waveform remains recipe-defined.

`variantSeed` can derive from actor/event sequence for repeatable tests. When omitted, use
the director's own seeded runtime RNG.

## 8. Priority, cooldown, and concurrency

Track:

```ts
interface ActiveVoice {
  id: number
  cue: SoundCue
  priority: number
  endsAt: number
  sources: AudioScheduledSourceNode[]
  nodes: AudioNode[]
}
```

Limits:

```text
MAX_ACTIVE_VOICES=24
MAX_ACTIVE_SOURCES=48
```

Suggested priority:

```text
victory/eventFail/UI confirmation=100
player hurt/block/lethal down=90
heavy hit/loot legendary=75
ordinary hit/attack tell=55
swing/gore/arrow=40
ambient-like details=20
```

Admission:

1. reject if the cue's cooldown is active, unless recipe allows coalescing;
2. reject if its per-cue concurrent cap is reached and it is not higher priority;
3. at global capacity, stop/fade the oldest lowest-priority voice only when the new voice
   has strictly higher priority;
4. otherwise suppress the new request.

Coalesce multiple same-frame cleave hits into one heavy impact body plus at most two
spatial crack voices. Spec 02's single `CombatFeedbackEvent` fan-out should make this
explicit rather than relying only on cooldown.

Every source `ended` handler removes itself. When the last source ends, disconnect all
voice nodes and remove the voice record.

## 9. Cheap spatial placement

For requests with a world position:

```text
offset = sourcePosition - listenerPosition
pan = clamp(dot(normalizeXZ(offset), cameraRight) * distanceFactor, -0.85, 0.85)
gain attenuation = lerp(1, 0.35, clamp(distance / 42, 0, 1))
```

Use `StereoPannerNode`; UI/music remain centered. Pan is copied at request time and does
not update for a 100 ms transient.

Do not pan player-owned swing, hurt, block, or UI cues away from center. Very near sounds
stay nearly centered to avoid headphone discomfort.

## 10. Music migration

Move existing scheduler, patterns, roots, kick/noise helpers, source tracking, and
visibility volume logic into `AudioDirector` without changing:

- faction roots/tempo/patterns;
- zone shift source (`zoneAt(player position)`);
- step sequencing;
- active/paused/ended nominal musical balance.

Pass the current zone into `setMusicContext(faction, zone)` or provide a callback; do not
let `AudioDirector` import `GameEngine`.

The global `window.__korovanyStopMusic` ownership guard may remain, but it calls director
destroy/stop rather than a partial `GameEngine.stopMusic()`.

## 11. Settings and autoplay

Persist `sfxVolume` under `korovany-sfx-volume` as a finite clamped `0..1` value. Default
to `0.8`.

- Add an accessible range input in menu and pause settings labeled `Громкость эффектов`.
- Display rounded percent.
- `0` is mute; no second SFX boolean is needed.
- Existing music mute remains unchanged.
- Update the director live without rebuilding the engine.

Create/resume the context only after existing pointer/keyboard interaction. A sound
request before context creation may be dropped; do not queue stale combat sounds to play
after the next gesture.

## 12. Pause, visibility, and lifecycle

- On pause: gameplay SFX requests are suppressed, UI cues remain allowed, active
  transients finish, music uses current paused target.
- On end: suppress new gameplay cues after the result cue, ramp SFX bus down over 100 ms,
  and preserve the existing quiet music behavior.
- On hidden: ramp master to zero quickly but keep scheduler time coherent.
- On visible: restore buses only if the context is running; do not call `resume()` without
  a user gesture after browser suspension.
- On destroy: stop every tracked source (ignoring only `InvalidStateError`), disconnect all
  nodes, clear interval/scheduler state, remove global ownership, and close the context
  once.
- Use short linear/exponential ramps to avoid gain discontinuity clicks.

## 13. File-level changes

| File | Changes |
| --- | --- |
| `src/game/AudioDirector.ts` | Context, buses, compressor, shared noise, recipes, voice admission/tracking, music scheduler, spatial pan, settings, and teardown. |
| `src/game/GameEngine.ts` | Replace direct context/music fields and `playSound()` implementation with director calls; update listener/zone context; submit authoritative combat/loot/action cues. |
| `src/App.tsx` | Read/persist/clamp SFX volume, state/ref, accessible menu/pause range, and live setter. |
| `src/App.css` | Reuse or minimally extend settings range styles. |
| `src/game/types.ts` | No gameplay or save change. Audio preferences remain application settings. |

## 14. Tuning and budgets

```text
MAX_ACTIVE_VOICES=24
MAX_ACTIVE_SOURCES=48
SFX_DISTANCE_MAX=42
PAN_MAX=0.85
SFX_VOLUME_DEFAULT=0.8
MASTER_COMPRESSOR_THRESHOLD=-18 dB
```

Per-cue starting caps:

```text
hitLight=6      hitHeavy=3     gore=3
swing=2         block=2        attackTell=4
arrow=4         lootCollect=2  UI/event=2
```

No recipe exceeds three source layers. The music scheduler retains its current lookahead
and interval unless profiling demonstrates a problem.

## 15. Accessibility

- Music and SFX controls are independent.
- UI confirmation remains audible at low but nonzero SFX volume and visually duplicated
  by existing notices/cards.
- Important gameplay information never exists only in audio; attack telegraphs, damage
  state, block sparks, and loot cards remain visual.
- Stereo pan is capped and near-player sounds stay centered.
- Avoid very high sustained tones and extreme sub-bass; procedural frequencies remain in
  ordinary device ranges.
- No cue uses repeated urgent notification patterns outside deliberate Teams/browser
  behavior; this is a game mix, not an alarm.

## 16. Edge cases

- A multi-target cleave cannot submit one full heavy/gore stack per target.
- A shield block suppresses blood/gore audio and uses block layers even when chip damage
  is positive.
- Pool pressure may suppress decorative gore/swing, never player hurt or result/UI
  confirmation.
- If a source throws on stop because it already ended, only `InvalidStateError` is
  ignored; other teardown errors are surfaced consistently.
- Volume parsing rejects `NaN`, infinity, and out-of-range storage values and falls back
  to default.
- Repeated start/menu/start cycles cannot leave an interval or context from the prior
  engine.
- Browser context state may become `interrupted`/`suspended`; requests fail quietly only
  according to a documented context-not-running guard, not a broad catch.

## 17. Acceptance criteria

- [ ] SFX and music route through explicit buses and one master compressor/gain; no SFX
      connects directly to destination.
- [ ] Swing, light/heavy hit, block, gore, down, bow/arrow, loot, and event cues have
      distinguishable bounded layer recipes.
- [ ] Pitch/noise variation avoids obvious repetition without changing cue identity.
- [ ] Per-cue/global caps hold at 24 voices and 48 sources; priority preserves player hurt
      and result/UI cues under a 25-actor stress fight.
- [ ] World cues pan/attenuate camera-relatively; player and UI cues remain centered.
- [ ] Pause, hidden tab, end, autoplay restrictions, and repeated engine teardown produce
      no delayed burst, click loop, orphan interval, node leak, or overlapping music.
- [ ] SFX volume persists, clamps invalid values, applies live, and remains separate from
      music mute.
- [ ] Existing music composition and zone/faction shifts remain recognizably unchanged.
- [ ] `SavedGame` remains version 1.
- [ ] Production build, oxlint, recipe unit tests, admission/cooldown tests, autoplay
      browser check, and repeated lifecycle audio check pass.

## 18. Dependencies and effort

- Spec 02 owns combat feedback weight/result events.
- Spec 04 owns anticipation/contact/whiff timing.
- Spec 03 optionally adds reveal/collect cues.

The director can land first with old cue call sites, then consume richer events.

**3-4 days.** Node graphs and recipes are modest; migration of existing music, reliable
voice cleanup, browser lifecycle behavior, and mix tuning across dense combat require the
time.
