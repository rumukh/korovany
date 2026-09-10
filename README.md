# КОРОВАНЫ

> Джва года в разработке.

[**Play on GitHub Pages**](https://rumukh.github.io/korovany/)

A seeded 3D action roguelite inspired by the legendary Russian game-design meme. Every run assembles a finite 5x5 campaign for the forest elves, palace guard, or villain.

## Features

- Three playable factions with generated starts, objective routes, encounters, and finales
- Reproducible 25-region worlds with streamed terrain, hills, rivers, roads, bridges, settlements, and fog of war
- Shareable text or numeric seeds with deterministic world validation and fingerprints
- Melee combat, NPC squads, caravan raids, stylized injuries, prosthetics, healing, and trading
- Directional evasion, perfect guard, and drag-to-look when mouse capture is unavailable
- Follow, Hold, Focus, and Regroup squad orders with a live health and status roster
- An expedition atlas with road/bridge itineraries, cautious routes, and a compact compass
- Faction-specific two-phase finale opponents with readable attack tells and recovery windows
- Dynamic events, escalating threat, pooled loot, run upgrades, achievements, and starting boons
- Original vector faction emblems, caravan key art, and adaptive chip-folk soundtrack
- Run endings score themselves: a brass fanfare march for victory, a tolling funeral lament for death
- Suspend/continue, terminal victory or defeat, profile rewards, and run history
- Procedural 3D art and generated instruments with no external art, audio, or asset packs

## Controls

| Input | Action |
| --- | --- |
| `WASD` | Move |
| `Shift` | Sprint |
| `Space` | Jump |
| Mouse / world drag | Camera while captured; drag the world to look if capture is unavailable |
| Left click / world tap / touch sword | Aimed three-beat melee; a look drag does not attack |
| `C` / touch **Уворот** | Directional evasive step (25 stamina); without movement, step backward |
| Right click / `R` / touch ability | Faction ability; guard holds the shield |
| `E` / touch `E` | Interact |
| `Q` / touch `Q` | Toggle squad Follow / Hold |
| `T` / squad HUD / touch `T` | Open squad orders: Follow, Hold, Focus, Regroup (pauses play) |
| `M` / minimap / compass / touch map | Open the paused expedition atlas |
| `F` / pause-menu save | Save |
| `P` / `Esc` / pause button | Close the top overlay, or pause; terminal results stay open |

On touch screens, hold a movement button and drag the world with another finger.
The footprint button is a held sprint modifier, and the up-arrow action jumps.
Jump once per press; release before jumping again. Mouse and world-drag look can
aim above or below the horizon, including bow shots. Movement, evasion, shields,
and melee keep their ground-plane heading regardless of camera pitch.
Pause, lost focus, and cancelled gestures release held movement, camera, and shield
inputs. Paid recovery, cooldowns, stamina, and committed finishers are preserved.

Evasion protects only 0.06–0.18 seconds of its 0.30-second step, respects collision and
leg injuries, and cannot cancel a committed finisher. A guard's first frontal contact
within 0.12 seconds of raising the shield can spend 12 stamina instead of health;
the timing reward rearms no sooner than 0.65 seconds. Arrows never stun their shooter.

The atlas selects a destination without accepting a rumour or changing a campaign
commitment. It follows rendered road legs and actual bridges; shortest and cautious
routes differ only when known danger warrants a detour. Dashed mission routes through
fog reveal transport only. Dotted local approaches and unavailable-road compass
bearings are not certified walkable paths. The compass stays independent of the `E`
interaction prompt. Atlas and order selection share the same pause/overlay policy:
closing one cannot resume an underlying shop or pause, and Escape closes only its owner.

## Development

```bash
npm ci
npm run dev
```

Build the site:

```bash
npm run build
```

Run deterministic generator, persistence, streaming, audio, and camera tests:

```bash
npm test
```

Create a standalone offline HTML file:

```bash
npm run bundle
```

The `main` branch is deployed automatically to GitHub Pages through GitHub Actions.

## Seeds and saves

The same seed and generator version produce the same region graph, terrain profiles, roads, river crossings, sites, encounters, and faction objective graphs. A run is suspended and resumed through a single active-run record; when its version or world fingerprint no longer matches, it is discarded rather than migrated.
