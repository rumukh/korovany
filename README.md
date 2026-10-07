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
- An expedition atlas with road/bridge itineraries and cautious routes; the compass follows the road by default
- Faction-specific two-phase finale opponents with readable attack tells and recovery windows
- Dynamic events, escalating threat, pooled loot, run upgrades, achievements, and starting boons
- Original vector faction emblems and caravan key art
- An adaptive folk-orchestral score: svirel and gusli elves, a brass guard march, a bassoon-and-choir villain
- Regions recolour it (gusli, balalaika and bayan, celesta, pizzicato); danger adds drums and brass on the bar line
- Run endings score themselves: a brass fanfare march for victory, a tolling funeral lament for death
- Suspend/continue, terminal victory or defeat, profile rewards, and run history
- Modelled effects: ringing shields, clinking coins, bowstrings, rolling thunder; chimes tuned to the music's key
- Procedural 3D art and code-synthesized instruments with no external art, audio, or asset packs
- Highest-quality enhanced graphics with articulated faction characters, tactile world surfaces,
  bounded atmosphere and combat effects, and a compact combat HUD

## Graphics and interface

Enhanced graphics at **High** quality are the default for new and continued runs.
The menu and pause dialog no longer offer graphics mode or preview-quality
selectors. Previously stored original/low/balanced choices are ignored.

**Боевой интерфейс** offers a live Full/Compact HUD preference. Bloom, ink,
foliage, weather and camera effects remain independently configurable, including
previously saved effect-off choices. Bloom-off uses the real no-post path.
Interface preferences do not replace or reset campaign saves.
On desktop, the right-hand HUD column scrolls rather than slipping under the
mouse-capture card, and notices start past the zone header instead of under its pause button.
Faction launch cards come first, above seed and starting-gift customization.
Theme, effect, audio and interface controls are grouped under **Настройки** at
the bottom of the main menu; the pause dialog keeps its live controls.

The stylized character direction is user-approved, but the quality tiers are
still provisional: desktop viewport emulation is not mobile-device certification,
and complete resource/performance acceptance is separate from art approval.
See [visual settings](docs/visual-settings.md) and the
[graphics upgrade results and screenshots](docs/graphics-upgrade-results.md).
The [graphics upgrade plan](docs/15-next-gen-graphics-plan.md) records the rollout contract.

Character materials keep their own world palette across light and dark UI themes:
faction-colored cloth, warm skin, neutral steel, and dark leather remain distinct.

## Controls

| Input | Action |
| --- | --- |
| `WASD` | Move |
| `Shift` | Sprint |
| `Space` | Jump |
| Mouse / world drag | Camera while captured; drag the world to look if capture is unavailable |
| Left click / world tap / touch attack | Three-beat melee, or fire while aiming the bow; a look drag does not attack |
| `C` / touch **Уворот** | Directional evasive step (25 stamina); without movement, step backward |
| Right click / `R` / touch ability | Hold to aim the elf's bow or raise the guard's shield; villain uses the rush |
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
The elf's held bow uses a separate shoulder view, starting level; release aim to return
to the overview camera and melee. Holding aim costs nothing. Each attack press fires
one arrow for 15 stamina with the existing 0.9-second cooldown and 18–10 distance-based
damage. Arrows leave the nock toward the reticle, then fall under gravity; there is no
automatic target selection. Terrain and solid sight-blocking world surfaces stop them.
On touch screens, hold the bow button, drag the world to aim, and tap the attack button
with another finger. The accessible bow button also toggles aim on keyboard activation.
Sprint and evasion leave bow mode without refunding a shot.
Pause, lost focus, and cancelled gestures release held movement, camera, bow, and shield
inputs. Paid recovery, cooldowns, stamina, and committed finishers are preserved.

The three melee beats have alternating wind-ups and follow-through, with a stronger
full-body finisher. Poses and weapon trails follow the actual combat clock rather
than a separate animation timer; cancelling a swing also cancels its visual strike.
The guard braces the shield with the offhand, including while moving or attacking.
The elf's held bow and shot recovery use the shared manual-aim presentation in both
the enhanced and legacy renderers. Releasing aim restores the melee equipment.
These poses do not change damage or restore an injured limb.
The default camera looks farther ahead and pulls back on portrait screens without
changing aim direction. Reduced motion softens secondary torso movement.

Faction launch is available before optional run configuration. Expand **Настроить поход**
to change the seed or starting boon; graphics and audio controls live under **Настройки**.
The field HUD keeps immediate vitals and navigation visible. Open **Поход** for the
full campaign details, or **Отряд** for individual companion health and orders.

## Contracts

Each campaign forks into two contract arms. Pin one with **Взяться** on the **Подряды** board,
in the HUD or the journal, and walk to its site: the contract starts when you arrive, and
the game's own random events cannot take it away. None is rolled while a contract is on the
ground, or while the un-started contract you are heading for is within 120 m. A random event
still running when you arrive is called off with no penalty, no reward and no failed-event
record, unless you are in the middle of it: a cart you have robbed, or a fight in which you
traded blows within the last 10 seconds and 60 m. That one you finish first, on its own
terms, while the contract waits with its grace paused. Located chronicle fights are handed
back, farthest first, when the contract needs their actors.

Every card on the board, in the journal and in the atlas says what the choice is worth before
you take it. **Плата** is everything a kept contract pays: its gold, plus a companion, damage,
healing or a trophy, named plainly. Duel damage is only what the run's champion cap still allows.
**Срок** is its clock once started. **Идти** times the walk along the itinerary the compass would
chart, at walking pace on the legs you have; with no road to plan it quotes the straight line and
says so. It ignores sprint, fights and props. **Опасно** names the hostile or contested squares
you already know on the way; squares still in fog are counted, never named. Payouts come from
one table, the one the game pays from.

Only a genuine inability to stage the contract spends its 12-second start grace: an actor
budget that cannot be reclaimed, or no walkable ground at the site. The notice then names
the reason. Lingering by the arm you did not take costs nothing, and the second arm waits
without losing patience while the first is still on the ground. A lost contract still fails
forward: walk to its site and the node closes without the payout. The bridge ambush never
takes a contract's fighters to make room for its own; on a crowded road it waits and retries.

Nor do idle garrisons crowd a contract out. A commander on your own side, such as the palace
guard's garrison commanders, calls for reinforcements only while his men are fighting, and no
commander's call ever takes the room a contract would stage in: it waits for his own side's
share of the field. The guard used to reach a contract beside the palace and find the square
already full of soldiers nobody had sent for.

When your own side still fills the field, it makes room. If a contract you have reached is
short of room once the game's own events have made way, your side's idle packs step back into
their squares, farthest first and only as many as it needs. A pack steps back only if it is not
hostile to you, at least 60 m away, outside the camera's view, unhurt and not fighting. Enemies
never step back, and neither do the squad, a stronghold's garrison, a unique, an objective, the
finale or anyone an event put down. Stepping back is not losing: the pack is not counted as
beaten, and it drops and pays nothing. It comes home to its stations when nothing has asked for
room for 4 seconds, the whole pack fits and none of its stations is near you or in view, or
with its square when that streams back in. Seed 1's guard used to lose «Зверьё у домиков»,
beside the palace's two strongholds, as crowded every time.

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

Without opening the atlas, the compass follows the road itinerary to a taken live rumour,
or else to the active objective, and crosses rivers on actual bridges. A target within
60 m on a dry straight line, or within 80 m when the road would double the walk, is
approached straight instead and labelled as an unchecked approach. The atlas selects
another destination without accepting a rumour or changing a campaign commitment;
«Убрать маршрут» returns to the default. Routes follow rendered road legs and actual
bridges; shortest and cautious routes differ only when known danger warrants a detour.
Dashed mission routes through fog reveal transport only. Dotted local approaches and
unavailable-road compass bearings are not certified walkable paths. The compass stays
independent of the `E` interaction prompt. Atlas and order selection share the same
pause/overlay policy: closing one cannot resume an underlying shop or pause, and Escape
closes only its owner.

## Who gets the caravan

Once a cart's escort is down, nobody takes it by touching it. A looter has to stand at the
cart for 3.5 seconds while the cargo sinks and glows, and a bar in the action prompt shows
how much is already gone. Any hit that lands on the looter, its rout, a returning escort or
the player pressing `E` first ends the attempt. Your own squad never loads a cart.

If you damaged an escort in the last 10 seconds, or stood within 10 m when the last one
fell, nobody else may start loading for 9 seconds: the robbery is yours. The palace guard
gets no such window because it defends the road cart, and knocking a looter off that cart
earns its bounded caravan aid. The chronicle's ambushed carts follow the same rules, and
taking their cargo counts toward caravan achievements. An emptied road cart says who
emptied it. None of this is saved: a continue brings the escorts and the raiders back.

## Threat, doctrines and night

The threat tier in the corner rises with whichever comes first: the clock, one tier every
three minutes, or the run's progress. The required errand and the contract arm you settle,
kept or failed forward, are a step each, and each step raises the tier by one, up to 4;
only the clock reaches 5. The camp, the arm you chose past and the finale are not steps. A
higher tier means more frequent events, bigger and faster threat waves once those start at
four minutes, and the doctrine drafts below. Enemy health and damage follow the clock's
tier alone, so a tier you earned brings attention, not tougher enemies, and its notice says
so: «Про пользователя прослышали…». Every three-minute mark still makes enemies tougher
and says that too, even when the tier in the corner is already higher: «Время берёт своё…».

Doctrine drafts open at tiers 2, 3 and 4, so a winning run meets two of them on the way to
its finale. A draft waits for a calm moment: nothing chasing you within 14 m, nothing
swinging or shooting at you within 38 m, and no finale under way. A fight that never ends
cannot hold it for ever: after 30 s of waiting it opens anyway, unless a finale is under way
or something is already swinging or shooting at you from within 14 m. It never opens an overlay:
take a card on the HUD or in the journal. «Устав дозора» still moves the waves off the clock
and onto closed objectives; without it, closing an objective never sends a wave.

A day lasts nine minutes. Dusk falls about four and a half minutes in, and the night lasts
about two and a half, 28% of the day rather than more than half. The game says so once,
when the villagers gather at their fires («Смеркается…»); a run continued at night does
not hear it again. Beasts grow faster at night (×2.2, was ×1.6), which keeps their pressure
per day unchanged, but the opening is daylight now and meets fewer beast raids. Turning the
day/night display off changes the lighting only, never the world's night.

None of this adds to a save. The tier comes from the saved tier and the saved objectives,
so suspend/continue never counts a step twice, and an older save catches up on its first
frame, with the notice. The draft's 30 s wait is not saved either: a continue starts it
again, which can hold a draft back by one more wait but never deals an extra one.

## Profile rewards

A finished run pays profile coins once, when it is archived: 45 for a victory or
12 for a defeat, one coin per four kills (up to 25), four per closed campaign step
(up to 20), and one per ten unspent gold (up to 15). An abandoned run pays nothing,
and suspend/continue cannot refill the purse. The end screen itemises the four
lines and the shop shows what the current purse would add. The purse cap stays
below the 33-coin gap between victory and defeat, so hoarding never beats buying
what wins.

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

The headless run harness doubles as a balance instrument: the squad, wounds and healing,
events as fights and the generator's own encounters sit behind opt-in arms. See
[the run harness](docs/run-harness.md) for its baseline and how to widen its sweep.

Create a standalone offline HTML file:

```bash
npm run bundle
```

The `main` branch is deployed automatically to GitHub Pages through GitHub Actions.

## Seeds and saves

The same seed and generator version produce the same region graph, terrain profiles, roads, river crossings, sites, encounters, and faction objective graphs. A run is suspended and resumed through a single active-run record; when its version or world fingerprint no longer matches, it is discarded rather than migrated.
