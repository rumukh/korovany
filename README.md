# КОРОВАНЫ

> Джва года в разработке.

[**Play on GitHub Pages**](https://rumukh.github.io/korovany/)

A seeded 3D action roguelite inspired by the legendary Russian game-design meme. Every run assembles a finite 5x5 campaign for the forest elves, palace guard, or villain.

## Features

- Three playable factions with generated starts, objective routes, encounters, and finales
- Reproducible 25-region worlds with streamed terrain, hills, rivers, roads, bridges, settlements, and fog of war
- Shareable text or numeric seeds with deterministic world validation and fingerprints
- Melee combat, NPC squads, caravan raids, stylized injuries, prosthetics, healing, and trading
- «Грабить корованы» as every run's spine: the camp is a choice between two caravans, the finale waits on two, and
  each side settles a won cart with its own verb from the letter while the market's prices remember it
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
forward: walk to its site and the node closes without the payout. A caravan beat never
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
beaten, and it drops and pays nothing. It comes home to its stations once nothing has asked for
room for 4 seconds and the whole pack fits, at the first moment none of its stations is in view
and all are at least 60 m from you, or with its square when that streams back in. Walk up to an
empty post, within 25 m of one of its stations, and the pack is called home: from then on it
only waits for you to look away. Seed 1's guard used to lose «Зверьё у домиков», beside the
palace's two strongholds, as crowded every time.

Known behaviour: until a pack is back, its post stands empty and the journal map shows none of
its dots. Looking away at the post, or going 60 m off, ends that as soon as the field has room.

## Rumours

The **Слухи** board offers a rumour only when you can meet it from where you stand, and never for more than about
25 seconds of walking. The walk along the itinerary the compass would chart, at walking pace on the legs you have, is
stretched by half again plus eight seconds for fights and detours, and it still has to fit the rumour's clock. A
defence or a sabotage then gets a clock fitted to that walk, between 48 and 80 seconds. An escort keeps its cart's
clock, and is offered only when you can be in the cart's square at every check it needs, wherever the cart will have
rolled by then. A new rumour comes at most every 32 seconds, two at a time, and none while you have taken one.

Each card reads **идти ~N с · осталось M с** and says whether you will make it: «успеешь», «впритык» (only with no
margin left) or «не успеть». Keeping a rumour pays a little, once, when its verdict lands: the palace guard's
commander and the villain's own purse pay 15 gold, and the elves' wooden houses share a ration. A broken or untaken
rumour pays nothing, and it still happens without you.

Take an escort and its cart is met rather than chased. The compass, the map pin and the card's walk lead to the
square where you can first be beside the cart in time, and the card says so: «встретить в D2 · идти ~6 с · …». The
meeting is worked out again once a chronicle tick, every 8 seconds; when none fits, the compass leads to the cart.

## Caravan beats

«Можно грабить корованы» is a decision, not scenery, and every new run is built round it. A
caravan beat is a gilded cart on a real road: you win the fight at the cart, then settle it
with your own side's verb from the letter.

- **«Суть такова: выбрать корован».** The camp is no longer reached, it is decided. Two
  caravans wait near the start, one on the road to the finale and one on another road, at
  least 70 m apart. They have different owners, and one is light (two guards, 70 gold) and
  the other rich (three with an elite, 120). The elves and the villain rob the other two
  sides' carts. The palace guard gets two orders: an escort of its own cart against one
  enemy, and a raid on the other's. The camp's card prices both: what the first verb pays,
  the walk there, the danger already known, and the side's other verbs. «Взяться» points the
  compass at one, but walking up to either cart is the choice. The cart you meet first is
  the one you took, and the other goes its own way. The camp's objective closes when that
  cart settles, however it ends. Until an offer is taken, the compass leads to the nearer
  one by road and says the other is in the card («ближний · второй — в карточке»);
  «Взяться» on the other retargets it. A run saved before the spine still launches straight
  at its camp. The few worlds with one
  offer, or whose other cart could not be staged, say «один корован», not two. On the
  field the card is short (the rule, each cart's guard, pay and walk, and «Взяться»), so
  both offers fit above the fold at 768 px; the journal's card adds the side's lead, its
  other verbs and how to choose.
- **The road.** The bridge ambush is always on the road to the finale, and one more cart
  stands on that road past it when the road allows: a forest road in the elves' squares, a
  mountain pass by the villain's fort, an open road elsewhere. Neither is a detour, and
  neither has a cart on it until the camp has chosen.
- **The gate.** The finale opens after two caravans have settled. Every ending counts: lost,
  escaped and never staged as much as robbed or walked in. The camp's declined cart neither
  counts nor is asked for, and a world with fewer carts than the gate never asks for more
  than it has. Until then the finale's row reads «Штурм после корованов: 1/2», and with
  nothing else left to do the compass leads to the nearest cart.

Caravans do not replace campaign objectives or alter the world's seed: placement reads the
world, takes its few draws from its own stream, and saves nothing but the carts' state. The
journal lists every cart, and the atlas charts every one the run can still meet, each with
its price. Once a cart is selected, its card follows the atlas's live route, including
cautious detours and resumed runs. If no road can be planned, it labels the direction as a
straight-line bearing.

The guard escorts its own carts and never pockets cargo. The other sides overcome the escort
of the cart they rob. Once the last escort or raider at the cart is down, the panel offers
your side's choices and what each one pays (here, a standard cart's):

| Side | Choice | Pays |
| --- | --- | --- |
| Elves | **Забрать груз** | 90 gold |
| Elves | **Отдать домикам деревяным** | walk the cart to its mark: two rations |
| Palace guard | **Довести обоз** | walk the cart to its mark: the commander's 55 gold and a ration |
| Palace guard | **Отпустить своим ходом** | nothing; the cart goes on alone |
| Palace guard (a raid) | **Конфисковать для дворца** | the commander's 70 gold bounty |
| Villain | **Забрать добро** | 90 gold |
| Villain | **Забрить в войско** | one more companion, up to a squad of four |
| Villain | **Сжечь груз** | no gold; one escort fewer at the palace finale, once, and only before it begins |

The burn choice says whether the palace can still lose a guard, and burning does exactly what it
says: not once the finale has begun, and not a guard standing in the world at that moment. A guard
you saw at the gate on an earlier visit can still be sent away, and a guard sent away stays away,
on every later visit and after a continue.

Every generated world has one shop, «Можно покупать и т. п.», and every ending moves its
prices through the chronicle. A cart that reaches the market adds 0.14 supply and makes them
cheaper; one that never does takes 0.19 and makes them dearer, and burned cargo takes 0.34.
The choice shows the price factor before and after, for example `×1,18 → ×1,27`. The notice,
the journal card and the сводка's caravan line say what became of the cart. The supply
drifts back by 4 % every 8-second chronicle tick, so a shock fades over a few minutes.

Seizing a cart counts once toward «Грабить корованы»: taking, giving, plundering, press-ganging
and burning, and the guard's confiscations. Walking a cart in or sending it on does not. On a
raid, the guard's rich caravan and the chronicle's ambushed enemy carts read **Конфисковать
груз для дворца** and pay as before. Press `E` by secured cargo to release a captured mouse
for the choice buttons. If the cargo is destroyed, it cannot be claimed.

A beat always ends. Stay more than 90 m from a cart you are fighting, holding or walking,
and after 30 seconds it settles itself. A robbery you never finished gets away with what is
left of its escort, a defence you left is lost, and a won cart left standing is looted. An
escorted cart goes on alone, unpaid, and a walk finishes without its guide or its reward. A
walked cart that cannot move for six seconds beside you arrives where it stands. A cart
that finds the road crowded asks your side's idle packs to step back, as a contract does; if
that is not room enough, it says so and waits while you stand by it;
after 30 seconds it goes through without the fight, unpaid, and still counts for the camp
and the gate. Until a choice is made, a won cart follows the claim rules below, and your
squad never loads it. No random event is rolled while the camp's choice is open, while a
cart is being fought, held or walked, or within 120 m of one not yet started; one already
running stands down when the fight starts unless you are in the middle of it.

Combat wounds, cargo health, the walk's progress, the walked-away clock, a crowded cart's
wait, the camp's choice and each single outcome survive suspend/continue. A run saved before
the spine keeps the campaign it started with: its camp closes on arrival, its finale has no
gate, and its one bridge cart is as it was. A save from before caravan beats migrates its
bridge ambush: a seizure already paid keeps its words and is never paid again. A villain who
was walking the old cart has no walking verb any more, so the cart returns to the bridge and
the choice opens again. A damaged caravan record is refused rather than repaired: every cart
closes unpaid, which settles the camp and opens the gate, and the run goes on.

Ordinary road carts are world texture, not caravan beats: they have no card and write no
consequence. They also require their escorts to be overcome before robbery, and an escort
you kill stays dead across walking away and a continue until its replacement is due 25
seconds later. Guard aid is a bounded reward for defending the cart, not healing for
repeated inspections.

Evasion protects only 0.06–0.18 seconds of its 0.30-second step, respects collision and
leg injuries, and cannot cancel a committed finisher. A guard's first frontal contact
within 0.12 seconds of raising the shield can spend 12 stamina instead of health;
the timing reward rearms no sooner than 0.65 seconds. Arrows never stun their shooter.

Without opening the atlas, the compass follows the road itinerary to a taken live rumour,
then to the camp's caravan (the one taken with «Взяться», or before that the nearer offer
by road), then to the active objective, and when nothing is left
before a shut finale, to the nearest caravan; it crosses rivers on actual bridges. A target within
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
taking their cargo counts toward caravan achievements. An ambush of your own side's cart is
defended, never robbed: there is no «Забрать груз», the event is won when its raiders are
down with the cargo still on the cart, and the owners pay 90 gold. An emptied road cart says
who emptied it. The claim and the channel are not saved, so a continue brings an ambush's
raiders back; the road cart's dead escorts are saved, as described above.

## Threat, doctrines and night

The threat tier in the corner rises with whichever comes first: the clock, one tier every
three minutes, or the run's progress. The required errand and the contract arm you settle,
kept or failed forward, are a step each, and so is every second caravan the run met, robbed,
walked, lost or escaped; each step raises the tier by one, up to 4;
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
