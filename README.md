# КОРОВАНЫ

> Джва года в разработке.

[**Play on GitHub Pages**](https://rumukh.github.io/korovany/)

A compact procedural 3D action game inspired by the legendary Russian game-design meme. Play as forest elves, the palace guard, or the villain across four connected regions.

## Features

- Three playable factions with separate objectives and starting zones
- A seamless four-zone world with tree LOD, procedural pixel textures, weathered roads, buildings, clouds, and torches
- Melee combat, NPC squads, caravan raids, stylized injuries, prosthetics, healing, and trading
- Original procedural 8-bit soundtrack with faction and zone variations
- Local save/load support
- No external art or audio assets

## Controls

| Input | Action |
| --- | --- |
| `WASD` | Move |
| `Shift` | Sprint |
| `Space` | Jump |
| Mouse | Camera |
| Left click | Attack |
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

Create a standalone offline HTML file:

```bash
npm run bundle
```

The `main` branch is deployed automatically to GitHub Pages through GitHub Actions.
