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
- `npm run codegen` — regenerate `src/app/graphql/generated/` from `server/src/schema.graphql` + `src/app/**/*.graphql` (commit the output)

Backend (`cd server`):

- `npm run db:up` / `npm run db:down` — PostGIS in Docker Compose
- `npm run db:psql` — psql shell in the DB container; `npm run db:psql -- -c "SQL"` for one query
- `npm run migrate` — apply new `migrations/*.sql` (tracked in `schema_migrations`)
- `npm run seed` — re-import `server/seed/site.geojson` (replaces the seeded site and its scenarios, including their runs)
- `npm run dev` — GraphQL server with reload at http://localhost:4000
- `npm run typecheck`

## Layout

- `src/app/jobsite-viewer/jobsite-viewer.ts` — Cesium `Viewer` lifecycle, scenario picker, loading/error banner, scenario load → clear → redraw → clock reset, Follow truck / Site view, Rename / Delete scenario (inline field, confirm banner), Draw route panel in two modes — new scenario (save → refetch list → select it) or add machine to the loaded scenario (save → reload it) — `runMutation` (one API change at a time, `saving` signal), dev click-to-coordinates logger (off while drawing)
- `src/app/jobsite-viewer/route-drawer.ts` — draw mode on the map: `globe.pick` clicks → waypoints, ground-clamped points + line, undo; suspends the viewer's own click/double-click actions until `destroy()`
- `src/app/jobsite-viewer/machine-panel.ts` — presentational list of the loaded scenario's machines: Follow / Edit (name, type, speed) / Delete with confirm, Add machine; emits intents only, closes its editor when a new `machines` list arrives
- `src/app/jobsite-viewer/_controls.scss` — shared `%control`, `%danger`, `%panel` placeholders (`@use 'controls'`)
- `src/app/jobsite-viewer/site-features.service.ts` — builds a styled `GeoJsonDataSource` from `Site.geojson` (boundary, haul road, markers), all clamped to terrain
- `src/app/jobsite-viewer/haul-truck.service.ts` — `addMachine`: full route as a ground-clamped line (`route-<id>`), then route (by `seq`) → densified (~5 m) → `sampleTerrainMostDetailed` → `SampledPositionProperty` at the machine's `speedMps` (`machine-<id>`); every machine type uses the milk-truck model
- `src/app/scenarios/` — `scenarios.graphql` (operations), `scenario.service.ts` (typed queries; create / rename / delete scenario and add / update / delete machine mutations; `getScenario` is `network-only` so reloads after edits aren't stale; `describeApiError`), `route-draft.ts` (`MachineFields` ⊂ `MachineDraft` ⊂ `RouteDraft`, machine-type labels, validators mirroring the server's checks, `parseSpeed`)
- `src/app/graphql/generated/` — codegen output; don't edit by hand
- `src/app/app.config.ts` — `provideHttpClient` + `provideApollo` (HttpLink to `environment.graphqlUrl`)
- `src/assets/` — `models/CesiumMilkTruck.glb` (CC BY 4.0, Cesium)
- `src/environments/environment.ts` — Cesium ion token and `graphqlUrl`, **git-ignored**; `environment.example.ts` is the committed template
- `codegen.ts` — GraphQL Code Generator config (client preset)
- `server/migrations/` — plain SQL, applied in filename order
- `server/seed/site.geojson` — seed source only; the app never reads it
- `server/src/schema.graphql` (schema; read by `schema.ts` and by codegen), `resolvers.ts`, `loaders.ts` (DataLoaders), `db.ts` (pool, `withTransaction`), `scripts/` (migrate, seed)
- `server/.env` — DB settings, **git-ignored**; `server/.env.example` is the committed template

## Frontend conventions and gotchas

- Standalone components, signals, zoneless (no zone.js). Cesium is created in `ngAfterViewInit` and destroyed in `ngOnDestroy`; destroy any `ScreenSpaceEventHandler` too.
- Cesium assets are copied to `/cesium/` by `angular.json`; `index.html` sets `window.CESIUM_BASE_URL = '/cesium/'` before the app loads.
- `src/assets` is copied to `/assets/` by `angular.json` (only `public/` is copied by default).
- `scene.globe.depthTestAgainstTerrain = true` — needed for `pickPosition` on terrain; it also hides geometry below the surface.
- Polygons clamped to terrain can't have outlines; the boundary outline is a ground-clamped polyline.
- Wait for world terrain (`Terrain.readyEvent`) before sampling heights; before that the provider is a flat ellipsoid.
- Entity `path` can't be clamped to ground: keep route samples dense (~5 m) and slightly lifted.
- Unit tests run in jsdom (no WebGL): stub `app-jobsite-viewer` in component tests. Test GraphQL code with `ApolloTestingModule` / `ApolloTestingController`.
- All app data comes from the GraphQL API; don't add static data files under `src/assets/` (they ship in the build).
- Scenario switches bump `loadGeneration`; async draw work checks `isStale()` after every await so an old load never draws over a new one.
- After changing a query or the server schema, run `npm run codegen` and fix any type errors it reveals.
- Apollo Client 4: import from `@apollo/client` (not `@apollo/client/core`); errors are not wrapped in `ApolloError` — network failures surface as `HttpErrorResponse` (status 0 = API unreachable), GraphQL errors as `CombinedGraphQLErrors`.

## Backend conventions and gotchas

- ESM + `moduleResolution: NodeNext`: relative imports need the `.js` extension.
- Env is loaded with Node's `--env-file=.env` (no dotenv).
- The GraphQL schema lives in `src/schema.graphql`; after changing it, run `npm run codegen` at the repo root.
- CORS: Apollo's standalone server sends `Access-Control-Allow-Origin: *`, which lets the app at :4200 call it in dev. Restrict origins before deploying.
- Schema changes: add a new numbered file in `server/migrations/`; never edit an applied migration.
- Geometry is SRID 4326. PostGIS points are `(lon, lat)` — `ST_MakePoint(lon, lat)`, `ST_X` = lon, `ST_Y` = lat.
- Nested fields must go through the per-request DataLoaders in `loaders.ts` (batched `WHERE x = ANY($1::uuid[])`); never query per parent row in a field resolver.
- DB enum labels match the GraphQL enums (`HAUL_TRUCK`, `RUNNING`, …), so no mapping is needed.
- Errors: `GraphQLError` with `extensions.code` `BAD_USER_INPUT` or `NOT_FOUND`; invalid UUIDs are treated as not found.
- `CreateScenarioInput`, `MachineInput`, `WaypointInput` were added because the original schema referenced `CreateScenarioInput` without defining it.
- The `postgis/postgis` image is amd64-only (emulated on Apple Silicon). The healthcheck uses TCP so `--wait` doesn't return during the image's first-run init.
