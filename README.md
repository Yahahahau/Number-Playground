# Number Playground

First-person physics sandbox for phones (portrait). Grab, push, pull, rotate and throw number blocks with a
Physics Gun; slam two blocks together hard enough and they merge (values add: 2 + 4 = 6). Every new number is
saved to your Collection and can be spawned again. Daily challenges, a pond with an interactive water shader,
optional real-time shadows (off by default, toggle in Settings), three graphics presets (default Low).

Stack: Three.js, Rapier3D (`@dimforge/rapier3d-compat`), Vite. Numbers are `BigInt` end to end and are stored
as decimal strings in `localStorage`.

## Run

```
npm install
npm run dev        # http://localhost:5173  (open on a phone via the LAN address)
npm run build      # production build in dist/
npm run preview
```

## Controls (touch)
- Lower-left: virtual joystick. Drag anywhere else to look.
- Grab/Release, Push, Pull (hold), Rotate (grab first, tap, then drag), Throw.
- Left rail: Numbers (Collection), Spawn, Reset (clears blocks only). Top right: Help, Settings.
- Desktop test keys: WASD, drag mouse, E grab, F push, hold Q pull, R rotate, T throw, C/N/X/H, wheel = distance.

## Layout
`src/core` loop + bigint helpers · `src/physics` Rapier wrapper (fixed 60 Hz step) · `src/player` controller + input ·
`src/weapons` Physics Gun · `src/blocks` blocks, merge, buoyancy · `src/collection` collection + daily ·
`src/world` terrain, trees, sky · `src/water` water shader + ripples · `src/effects` pooled particles ·
`src/audio` procedural Web Audio · `src/save` persistence · `src/settings` quality presets · `src/ui` mobile UI.

## Notes
- Merge rule: two blocks that collide with relative speed >= 2.1 m/s become one block at the mass-weighted
  point, keeping total linear and angular momentum.
- High quality adds a larger shadow map, sharper water, a live cube-map reflection and more particles;
  there is no full-screen post-processing pass.

## Play online / updates
Pushing to `main` builds the game and publishes it to the `gh-pages` branch automatically
(`.github/workflows/deploy.yml`). Enable it once: Settings -> Pages -> Source: *Deploy from a branch*,
branch `gh-pages`, folder `/ (root)`. The build uses relative paths, so the same output also works inside an
iframe / in-app web view. Every deploy produces new hashed file names, so reloading always loads the latest version.
