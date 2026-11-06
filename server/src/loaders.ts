// Per-request DataLoaders. Field resolvers call .load(parentId); DataLoader collects every
// id requested in the same tick and runs ONE query per loader (WHERE x = ANY($1)), so a
// nested query costs one SQL query per level instead of one per parent row (N+1).
import DataLoader from 'dataloader';
import { pool } from './db.js';
import {
  RUN_COLUMNS,
  type MachineRow,
  type RunRow,
  type SiteRow,
  type WaypointRow,
} from './rows.js';

export interface Loaders {
  siteById: DataLoader<string, SiteRow | undefined>;
  machinesByScenarioId: DataLoader<string, MachineRow[]>;
  routeByMachineId: DataLoader<string, WaypointRow[]>;
  runsByScenarioId: DataLoader<string, RunRow[]>;
}

export function createLoaders(): Loaders {
  return {
    siteById: new DataLoader(async (ids) => {
      const { rows } = await pool.query<SiteRow>(SITE_GEOJSON_SQL, [ids]);
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids.map((id) => byId.get(id));
    }),

    machinesByScenarioId: new DataLoader(async (ids) => {
      const { rows } = await pool.query<MachineRow>(
        `SELECT id, scenario_id, name, type, speed_mps
         FROM machine WHERE scenario_id = ANY($1::uuid[])
         ORDER BY name, id`,
        [ids],
      );
      return groupBy(ids, rows, (r) => r.scenario_id);
    }),

    routeByMachineId: new DataLoader(async (ids) => {
      const { rows } = await pool.query<WaypointRow>(
        `SELECT machine_id, seq, ST_Y(geom) AS lat, ST_X(geom) AS lon
         FROM machine_waypoint WHERE machine_id = ANY($1::uuid[])
         ORDER BY machine_id, seq`,
        [ids],
      );
      return groupBy(ids, rows, (r) => r.machine_id);
    }),

    runsByScenarioId: new DataLoader(async (ids) => {
      const { rows } = await pool.query<RunRow>(
        `SELECT ${RUN_COLUMNS}
         FROM simulation_run WHERE scenario_id = ANY($1::uuid[])
         ORDER BY started_at DESC`,
        [ids],
      );
      return groupBy(ids, rows, (r) => r.scenario_id);
    }),
  };
}

/** Splits rows into one array per key, in the order DataLoader asked for the keys. */
function groupBy<T>(keys: readonly string[], rows: T[], keyOf: (row: T) => string): T[][] {
  const groups = new Map<string, T[]>(keys.map((k) => [k, []]));
  for (const row of rows) {
    groups.get(keyOf(row))?.push(row);
  }
  return keys.map((k) => groups.get(k)!);
}

// Builds each site's GeoJSON FeatureCollection in SQL: the boundary polygon first,
// then its features (haul roads, markers) with their stored properties.
const SITE_GEOJSON_SQL = `
  SELECT s.id, s.name,
    jsonb_build_object(
      'type', 'FeatureCollection',
      'features',
        jsonb_build_array(jsonb_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(s.boundary)::jsonb,
          'properties', jsonb_build_object('name', s.name, 'type', 'boundary')
        ))
        || COALESCE(
          (SELECT jsonb_agg(
             jsonb_build_object(
               'type', 'Feature',
               'geometry', ST_AsGeoJSON(f.geom)::jsonb,
               'properties', f.properties || jsonb_build_object('name', f.name)
             ) ORDER BY f.kind, f.name)
           FROM site_feature f WHERE f.site_id = s.id),
          '[]'::jsonb)
    )::text AS geojson
  FROM site s
  WHERE s.id = ANY($1::uuid[])
`;
