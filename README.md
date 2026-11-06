# Jobsite Twin

A prototype construction-site digital twin built with Angular and CesiumJS.

![Jobsite Twin screenshot](docs/screenshot.png)

## Features

- **3D world terrain** of a real open-pit mine (Bingham Canyon, Utah) using Cesium World Terrain.
- **Site features from GeoJSON** ([`src/assets/site.geojson`](src/assets/site.geojson)), clamped to the terrain: site boundary, haul road and labeled markers (stockpile, site office, haul road entrance). Click a feature to see its name in the info box. Coordinates are approximate.
- **Animated haul truck** that drives the haul road at about 10 m/s. Waypoint heights come from the terrain (`sampleTerrainMostDetailed`), and the truck faces its direction of travel and leaves a trail.
- **Timeline playback** that loops over the truck's trip; change speed with Cesium's clock controls.
- **View controls**: *Follow truck* and *Site view* buttons.
- **Coordinate helper** (development builds only): click the terrain to log latitude, longitude and height to the browser console.

## Tech stack

- [Angular](https://angular.dev) 21 (standalone components, signals)
- [CesiumJS](https://cesium.com/platform/cesiumjs/) 1.146
- [Cesium ion](https://cesium.com/platform/cesium-ion/) for terrain and imagery
- TypeScript 5.9
- [Vitest](https://vitest.dev) for unit tests

## Setup

### Prerequisites

- Node.js 22 (Angular 21 requires `^20.19`, `^22.12` or `>=24`)
- npm 11
- A free [Cesium ion](https://ion.cesium.com/signup) account

### Install

```bash
npm install
```

### Cesium ion token

1. In Cesium ion, go to **Access Tokens → Create token**.
2. Keep only read scopes: `assets:read` (and `geocode` if you want the search box).
3. Under **Allowed URLs**, restrict it to `http://localhost:4200`.

The token is embedded in the browser bundle, so treat it as public and keep it restricted.

### Configure the environment

```bash
cp src/environments/environment.example.ts src/environments/environment.ts
```

Put your token in `environment.ts`. It is git-ignored and never committed.

### Run

```bash
npx ng serve    # or: npm start
```

Open <http://localhost:4200>.

Other commands: `npx ng build` (production build to `dist/`), `npx ng test` (unit tests).

## How I built it

- Developed with [Claude Code](https://claude.com/claude-code) in VS Code, guided by a `CLAUDE.md` I kept updated.
- Reviewed every diff before accepting it.
- Built in small PRs, one per step.

## Roadmap

- GraphQL backend for scenarios and simulation runs
- ESLint
- Playwright end-to-end tests
- GitHub Actions CI

## Credits

- [CesiumJS](https://github.com/CesiumGS/cesium) — Apache License 2.0.
- [Cesium ion](https://cesium.com/platform/cesium-ion/) — Cesium World Terrain and the default Bing Maps aerial imagery, used under the Cesium ion terms of service.
- **CesiumMilkTruck** model © Cesium, from the [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CesiumMilkTruck), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Cesium trademarks and logos are excluded from that license.

## License

[MIT](LICENSE). Third-party assets keep their own licenses (see Credits).
