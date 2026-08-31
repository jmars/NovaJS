# NovaJS

A browser port of **Escape Velocity Nova** by [Ambrosia Software](http://www.ambrosiasw.com/) / [ATMOS](https://en.wikipedia.org/wiki/ATMOS_Software), focused on faithfully reimplementing the original engine.

This fork is **single-player** and deployed live at:

**https://jmars.github.io/NovaJS/**

It reads the real EV Nova game data and ships in the browser; no Nova data is committed to the repo (see below).

## Controls (standard EV Nova)

* Arrow keys to move
* Spacebar to fire
* L while moving slowly over a planet to land
* Tab to select a target / R for nearest target
* W to choose a secondary weapon / Left Shift to fire it
* Hold A to point toward your target
* M to open the map and jump / J to jump
* Arrow keys scroll the outfitter / shipyard to see more items

## Status

This is a **faithful single-player reimplementation of the original engine**, not a from-scratch approximation. Engine behavior is recovered from the original `EV_Nova.dat` binary via Ghidra and ported exactly — see [docs/FIDELITY.md](docs/FIDELITY.md) for the per-subsystem audit (which behaviors are byte-verified against the binary vs. still approximated).

Implemented so far, ported from the binary:

* **Spawning** — event-driven system population (jump-in / landing / liftoff / boarding) with the binary's per-system dûde table, përs peripherals, and flët draw (docs/FIDELITY.md).
* **NPC AI** — acquisition (strength×odds filter, police-assist, player square), govt-difference retaliation with the suppression cascade, aggress-driven fleeing, trader travel + landing, interceptor comm-scan, pursuit memory, per-system legal records.
* **Combat** — projectile/beam/blast damage with the binary's order, friendly-fire and owner rules, splash semantics.
* **Economy** — trade prices/bands, cargo decay, capture odds, booty, outfit purchase/sell/trade-in recovered from the binary.
* **RNG** — the engine's Park-Miller LCG, seeded from the pilot, replacing any approximation.
* **UI** — spaceport (outfitter / shipyard / trade / missions / bar / comm), landing, and the system map.

## Copyright

Escape Velocity Nova is copyrighted by Ambrosia Software. NovaJS claims no rights to any EV Nova data. The goal is a Nova engine that interprets Nova files **without shipping Nova data itself**:

* The game data (`Nova_Data/`) is downloaded at deploy time from the `game-data` [GitHub release](https://github.com/jmars/NovaJS/releases/tag/game-data), never committed to git.
* The original binary `EV_Nova.dat` is shipped as the `game-binary` [GitHub release](https://github.com/jmars/NovaJS/releases/tag/game-binary) purely as the reverse-engineering reference; it is not distributed as part of the game and is not required to play the deployed site.

## Getting Started

### Prerequisites

* [node.js](https://nodejs.org/) and npm
* A copy of EV Nova's game data (`Nova Files` + `Plug-ins` in `.ndat` or Mac resource-fork format) — Windows `.res` is not yet supported.

### Installing

```bash
git clone https://github.com/jmars/NovaJS.git
cd NovaJS/
npm install
```

Place your game data under `nova/Nova_Data/`:

```bash
mkdir -p nova/Nova_Data
cp -r /path/to/EV\ Nova.app/Contents/Resources/Nova\ Files/ ./nova/Nova_Data/
mkdir -p nova/Nova_Data/Plug-ins/
# drop any plug-ins (.ndat) into nova/Nova_Data/Plug-ins/
```

### Running locally (dev server)

```bash
npm run build:browser          # bundle the client (nova/src/browser_bundle.js)
npm run generate:static -- --layout files --out dist-dev
node nova/server.ts            # express dev server on port 8000
# open http://localhost:8000
```

### Building the static site (what the live deploy uses)

```bash
npm run build:site             # builds dist-site/ (index.html + bundle + range-indexed game data)
# serve dist-site/ with any static host that supports HTTP Range requests
```

### Tests

Headless jasmine specs (no browser needed):

```bash
npm run test:headless          # 700+ specs
```

Type-check:

```bash
npx tsc --noEmit -p tsconfig.json
```

## Deployment

Pushing to `main` deploys to GitHub Pages via the included GitHub Actions workflow: it downloads the game-data release, runs `npm run build:site`, and publishes `dist-site/`. The deployed game loads game data lazily via HTTP Range requests, so the entry page revalidates every load (a redeploy takes effect on the next reload).

## Reverse engineering

`EV_Nova.dat` is analyzed with Ghidra (`tools/ghidra_12.1.3_PUBLIC`); the headless analysis scripts live in [`ghidra_scripts/`](ghidra_scripts/), and `scripts/regenerate_ghidra.sh` rebuilds the analyzed project from the binary + scripts. See [docs/FIDELITY.md](docs/FIDELITY.md) for the live audit of which engine behaviors match the binary.

## Project Structure

* `nova` — the client + engine (browser.ts is the entry point; `nova/src/nova_plugin/` holds the gameplay systems).
* `novaparse` — parses Nova files and Plug-ins.
* `novadatainterface` — the data interface implemented by `novaparse` and consumed by `nova`.
* `nova_ecs` — the Entity Component System used by NovaJS.
* `docs/FIDELITY.md` — the fidelity audit: which subsystems are byte-verified against the binary, which are still approximated.

## Known Bugs

* Beam weapons do not clip after colliding with a target (they pass through).
* Some engine subsystems are still approximated — see [docs/FIDELITY.md](docs/FIDELITY.md) for the exact list and their status.
