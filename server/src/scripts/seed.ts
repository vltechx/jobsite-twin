// Imports src/assets/site.geojson as one site + one scenario with a haul truck that
// follows the haul road. Safe to re-run: the seeded site and its scenarios are replaced.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from '../db.js';

const GEOJSON_PATH = fileURLToPath(new URL('../../../src/assets/site.geojson', import.meta.url));

const SITE_NAME = 'Bingham Canyon Mine';
const SCENARIO_NAME = 'Baseline haul cycle';
const TRUCK = { name: 'Haul Truck 1', type: 'HAUL_TRUCK', speedMps: 10 } as const;

interface Feature {
  type: 'Feature';
  properties: { name: string; type: string; [key: string]: unknown };
  geometry: { type: string; coordinates: unknown };
}

async function main(): Promise<void> {
  const geojson = JSON.parse(await readFile(GEOJSON_PATH, 'utf8')) as { features: Feature[] };
  const boundary = findOne(geojson.features, 'boundary', 'Polygon');
  const haulRoad = findOne(geojson.features, 'haul-road', 'LineString');
  const markers = geojson.features.filter((f) => f.geometry.type === 'Point');
  const route = haulRoad.geometry.coordinates as [number, number][];

  const scenarioId = await withTransaction(async (db) => {
    // Remove the previous seed (machines, waypoints and runs cascade from scenario).
    await db.query(
      'DELETE FROM scenario WHERE site_id IN (SELECT id FROM site WHERE name = $1)',
      [SITE_NAME],
    );
    await db.query('DELETE FROM site WHERE name = $1', [SITE_NAME]);

    const site = await db.query<{ id: string }>(
      `INSERT INTO site (name, boundary)
       VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))
       RETURNING id`,
      [SITE_NAME, JSON.stringify(boundary.geometry)],
    );
    const siteId = site.rows[0]!.id;

    for (const feature of [haulRoad, ...markers]) {
      const { name, type, ...rest } = feature.properties;
      await db.query(
        `INSERT INTO site_feature (site_id, kind, name, geom, properties)
         VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326), $5)`,
        [
          siteId,
          feature === haulRoad ? 'haul_road' : 'marker',
          name,
          JSON.stringify(feature.geometry),
          // Keep the original GeoJSON "type" (e.g. "stockpile") with the other properties.
          JSON.stringify({ type, ...rest }),
        ],
      );
    }

    const scenario = await db.query<{ id: string }>(
      'INSERT INTO scenario (name, site_id) VALUES ($1, $2) RETURNING id',
      [SCENARIO_NAME, siteId],
    );
    const id = scenario.rows[0]!.id;

    const machine = await db.query<{ id: string }>(
      `INSERT INTO machine (scenario_id, name, type, speed_mps)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [id, TRUCK.name, TRUCK.type, TRUCK.speedMps],
    );
    await db.query(
      `INSERT INTO machine_waypoint (machine_id, seq, geom)
       SELECT $1, w.seq - 1, ST_SetSRID(ST_MakePoint(w.lon, w.lat), 4326)
       FROM unnest($2::float8[], $3::float8[]) WITH ORDINALITY AS w(lon, lat, seq)`,
      [machine.rows[0]!.id, route.map((c) => c[0]), route.map((c) => c[1])],
    );
    return id;
  });

  console.log(
    `Seeded site "${SITE_NAME}" with ${markers.length} markers and a haul road; ` +
      `scenario "${SCENARIO_NAME}" (${scenarioId}) with ${TRUCK.name} on ${route.length} waypoints.`,
  );
}

function findOne(features: Feature[], type: string, geometryType: string): Feature {
  const match = features.find(
    (f) => f.properties.type === type && f.geometry.type === geometryType,
  );
  if (!match) {
    throw new Error(`site.geojson has no ${geometryType} feature with type "${type}"`);
  }
  return match;
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
