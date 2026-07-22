# КОРОВАНЫ

> Джва года в разработке.

[**Play on GitHub Pages**](https://rumukh.github.io/korovany/)

A seeded 3D action roguelite inspired by the legendary Russian game-design meme. Every run assembles a finite 5x5 campaign for the forest elves, palace guard, or villain.

## Features

- Three playable factions with generated starts, objective routes, encounters, and finales
- Reproducible 25-region worlds with streamed terrain, hills, rivers, roads, bridges, settlements, and fog of war
- Shareable text or numeric seeds with deterministic world validation and fingerprints
- Melee combat, NPC squads, caravan raids, stylized injuries, prosthetics, healing, and trading
- Dynamic events, escalating threat, pooled loot, run upgrades, achievements, and starting boons
- Original vector faction emblems, caravan key art, and procedural 8-bit soundtrack
- Suspend/continue, terminal victory or defeat, profile rewards, and run history
- Backward-compatible loading for legacy version-1 four-zone saves
- Procedural 3D art with no external art, audio, or asset packs

## Controls

| Input | Action |
| --- | --- |
| `WASD` | Move |
| `Shift` | Sprint |
| `Space` | Jump |
| Mouse | Camera |
| Left click | Attack |
| Right click / `R` | Faction ability |
| `E` | Interact |
| `Q` | Command squad |
| `F` | Save |
| `P` / `Esc` | Pause |

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

The same seed and generator version produce the same region graph, terrain profiles, roads, river crossings, sites, encounters, and faction objective graphs. Generated runs are stored separately from legacy saves, so an old `korovany-save-v1` campaign can coexist with a new active run.
