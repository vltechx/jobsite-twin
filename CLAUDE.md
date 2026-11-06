# CLAUDE.md

Prototype construction-site digital twin: Angular 21 + CesiumJS frontend (repo root), GraphQL backend in `server/` (Apollo Server + PostgreSQL/PostGIS).

## Working agreements

- Explain each change briefly before making it.
- Ask before adding any dependency (frontend or server).
- Keep changes small; one commit per step. Never commit secrets.
- Don't claim features in docs that aren't built.

## Commands

Frontend (repo root):

- `npm start` — dev server at http://localhost:4200
- `npx ng build` — production build (must pass; initial budget is raised to 6 MB/8 MB for Cesium)
- `npx ng test --watch=false` — Vitest unit tests

Backend (`cd server`):

- `npm run db:up` / `npm run db:down` — PostGIS in Docker Compose
- `npm run db:psql` — psql shell in the DB container; `npm run db:psql -- -c "SQL"` for one query
- `npm run migrate` — apply new `migrations/*.sql` (tracked in `schema_migrations`)
- `npm run seed` — re-import `src/assets/site.geojson` (replaces the seeded site and its scenarios, including their runs)
- `npm run dev` — GraphQL server with reload at http://localhost:4000
- `npm run typecheck`

## Layout

- `src/app/jobsite-viewer/jobsite-viewer.ts` — Cesium `Viewer` lifecycle, camera, dev click-to-coordinates logger, Follow truck / Site view buttons
- `src/app/jobsite-viewer/site-features.service.ts` — loads and styles `site.geojson` (boundary, haul road, markers), all clamped to terrain
- `src/app/jobsite-viewer/haul-truck.service.ts` — haul road → densified (~5 m) → `sampleTerrainMostDetailed` → `SampledPositionProperty` at 10 m/s; looping clock
- `src/assets/` — `site.geojson`, `models/CesiumMilkTruck.glb` (CC BY 4.0, Cesium)
- `src/environments/environment.ts` — Cesium ion token, **git-ignored**; `environment.example.ts` is the committed template
- `server/migrations/` — plain SQL, applied in filename order
- `server/src/schema.ts` (typeDefs), `resolvers.ts`, `loaders.ts` (DataLoaders), `db.ts` (pool, `withTransaction`), `scripts/` (migrate, seed)
- `server/.env` — DB settings, **git-ignored**; `server/.env.example` is the committed template

## Frontend conventions and gotchas

- Standalone components, signals, zoneless (no zone.js). Cesium is created in `ngAfterViewInit` and destroyed in `ngOnDestroy`; destroy any `ScreenSpaceEventHandler` too.
- Cesium assets are copied to `/cesium/` by `angular.json`; `index.html` sets `window.CESIUM_BASE_URL = '/cesium/'` before the app loads.
- `src/assets` is copied to `/assets/` by `angular.json` (only `public/` is copied by default).
- `scene.globe.depthTestAgainstTerrain = true` — needed for `pickPosition` on terrain; it also hides geometry below the surface.
- Polygons clamped to terrain can't have outlines; the boundary outline is a ground-clamped polyline.
- Wait for world terrain (`Terrain.readyEvent`) before sampling heights; before that the provider is a flat ellipsoid.
- Entity `path` can't be clamped to ground: keep route samples dense (~5 m) and slightly lifted.
- Unit tests run in jsdom (no WebGL): stub `app-jobsite-viewer` in component tests.

## Backend conventions and gotchas

- ESM + `moduleResolution: NodeNext`: relative imports need the `.js` extension.
- Env is loaded with Node's `--env-file=.env` (no dotenv).
- Schema changes: add a new numbered file in `server/migrations/`; never edit an applied migration.
- Geometry is SRID 4326. PostGIS points are `(lon, lat)` — `ST_MakePoint(lon, lat)`, `ST_X` = lon, `ST_Y` = lat.
- Nested fields must go through the per-request DataLoaders in `loaders.ts` (batched `WHERE x = ANY($1::uuid[])`); never query per parent row in a field resolver.
- DB enum labels match the GraphQL enums (`HAUL_TRUCK`, `RUNNING`, …), so no mapping is needed.
- Errors: `GraphQLError` with `extensions.code` `BAD_USER_INPUT` or `NOT_FOUND`; invalid UUIDs are treated as not found.
- `CreateScenarioInput`, `MachineInput`, `WaypointInput` were added because the original schema referenced `CreateScenarioInput` without defining it.
- The `postgis/postgis` image is amd64-only (emulated on Apple Silicon). The healthcheck uses TCP so `--wait` doesn't return during the image's first-run init.
