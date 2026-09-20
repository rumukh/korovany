# КОРОВАНЫ

> Джва года в разработке.

[**Play on GitHub Pages**](https://rumukh.github.io/korovany/)

A seeded 3D action roguelite inspired by the legendary Russian game-design meme. Every run assembles a finite 5x5 campaign for the forest elves, palace guard, or villain.

## Features

- Three playable factions with generated starts, objective routes, encounters, and finales
- Reproducible 25-region worlds with streamed terrain, hills, rivers, roads, bridges, settlements, and fog of war
- Shareable text or numeric seeds with deterministic world validation and fingerprints
- Melee combat, NPC squads, caravan raids, stylized injuries, prosthetics, healing, and trading
- A one-per-run bridge ambush with guarded cargo, a physical delivery, and a lasting supply consequence
- Directional evasion, perfect guard, and drag-to-look when mouse capture is unavailable
- Follow, Hold, Focus, and Regroup squad orders with a live health and status roster
- An expedition atlas with road/bridge itineraries, cautious routes, and a compact compass
- Faction-specific two-phase finale opponents with readable attack tells and recovery windows
- Dynamic events, escalating threat, pooled loot, run upgrades, achievements, and starting boons
- Original vector faction emblems, caravan key art, and adaptive chip-folk soundtrack
- Run endings score themselves: a brass fanfare march for victory, a tolling funeral lament for death
- Suspend/continue, terminal victory or defeat, profile rewards, and run history
- Procedural 3D art and generated instruments with no external art, audio, or asset packs

Character materials keep their own world palette across light and dark UI themes:
faction-colored cloth, warm skin, neutral steel, and dark leather remain distinct.

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
| `J` / **Поход** | Open the paused journal: contracts, objectives, doctrines, rumours, and chronicle |
| `F` / pause-menu save | Save |
| `P` / `Esc` / pause button | Close the top overlay, or pause; terminal results stay open |

On touch screens, hold a movement button and drag the world with another finger.
The footprint button is a held sprint modifier, and the up-arrow action jumps.
Jump once per press; release before jumping again. Mouse and world-drag look can
aim above or below the horizon, including bow shots. Movement, evasion, shields,
and melee keep their ground-plane heading regardless of camera pitch.
Pause, lost focus, and cancelled gestures release held movement, camera, and shield
inputs. Paid recovery, cooldowns, stamina, and committed finishers are preserved.

The three melee beats have alternating wind-ups and follow-through, with a stronger
full-body finisher. Poses and weapon trails follow the actual combat clock rather
than a separate animation timer; cancelling a swing also cancels its visual strike.
The guard braces the shield with the offhand, including while moving or attacking.
The elf briefly equips a bow for the shot's follow-through, using the existing
ability cooldown; a new melee attack or evasion immediately takes visual priority.
Neither pose adds a wind-up, changes damage, or restores an injured limb.
The default camera looks farther ahead and pulls back on portrait screens without
changing aim direction. Reduced motion softens secondary torso movement.

Faction launch is available before optional run configuration. Expand **Настроить поход**
to change the seed or starting boon; graphics and audio controls live under **Настройки**.
The field HUD keeps immediate vitals and navigation visible. Open **Поход** for the
full campaign details, or **Отряд** for individual companion health and orders.

## The bridge ambush

New runs place an optional caravan encounter on a real generated bridge. It does not
replace campaign objectives or alter the world's seed. After reaching camp, follow
the bridge guidance or find **Засада у старого моста** in the journal and atlas.
The guard protects the cargo from raiders; the other factions overcome its escorts.
Once selected, the bridge HUD follows the atlas's live route, including cautious
detours and resumed runs. If no road can be planned, it labels the direction as a
straight-line bearing rather than directing you along the original camp itinerary.

Secure the cart before deciding its fate. **Забрать груз** pays 85 gold immediately;
**Довести обоз** requires staying beside the moving cart across the bridge, grants two
rations, and replenishes the bridge region's supply. If the cargo is destroyed, it
cannot be claimed. Press `E` by secured cargo to release a captured mouse for the
choice buttons. Combat wounds, delivery progress, and the single outcome survive
suspend/continue. Existing saves without this encounter keep their original campaign.

Ordinary caravans also require their escorts to be overcome before robbery. Guard
aid is a bounded reward for defending the caravan, not healing for repeated inspections.

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
