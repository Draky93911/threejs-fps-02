# Ashline Yard

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Draky93911/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Draky93911/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS in the browser, on three.js. Ember attacks, Slate defends: plant the bomb at site A or B, or clear the yard. First to five rounds takes the match.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. Click to play: WASD to move, mouse to look, click to fire, R to reload, Ctrl/C to crouch, Space to jump, B for the buy menu (1–5 to buy), E to plant or defuse the bomb, G to throw a grenade.

## The game

- **Two teams, 4v4.** You plus three Ember bots against four Slate bots that walk the yard's lanes, hold sites, rotate on noise, and converge once the bomb is down.
- **Rounds and an objective.** 100-second rounds, a 20-second buy phase, a bomb to plant (3.5s) and defuse (5s), a 35-second fuse. Elimination, detonation, defuse or the clock decides each round.
- **Money and a buy menu.** Kills, plants and round wins pay; spend it on the Kestrel AR, Sparrow SMG, Longbow DMR, frag grenades and Kevlar.
- **Gunplay where accuracy counts.** Hitscan fire with headshot multipliers, recoil, and spread that punishes firing on the move; acceleration, crouching and collision with the map.
- **One original map.** Ashline Yard: a freight yard at dusk, two bomb sites (warehouse A, silo yard B), a container canyon down mid, and long sightlines on both flanks. Its own art, sounds (synthesized live, no audio files) and names — no copy of any commercial game.

## Layout

- `game/` — the playable game as static files: `index.html` plus ES modules under `src/` (world, bots, combat, match, weapons, player, HUD, audio, input), with three.js 0.187.0 vendored under `game/vendor/three/`.
- `main.ts` — the entry program: copies `game/` and `screenshots/` to `/output` and writes `dossier.json`.
- `screenshots/` — four real renders of the game's own code.

---

<sub>Entered on [make.fun](https://make.fun/?ref=640z6wc1&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
