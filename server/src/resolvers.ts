import { GraphQLError } from 'graphql';
import { pool, withTransaction } from './db.js';
import type { Loaders } from './loaders.js';
import {
  RUN_COLUMNS,
  SCENARIO_COLUMNS,
  type MachineRow,
  type MachineType,
  type RunRow,
  type ScenarioRow,
  type WaypointRow,
} from './rows.js';

export interface Context {
  loaders: Loaders;
}

interface CreateScenarioInput {
  name: string;
  siteId: string;
  machines?: {
    name: string;
    type: MachineType;
    speedMps: number;
    route: { lat: number; lon: number }[];
  }[] | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id: string) => UUID_RE.test(id);

export const resolvers = {
  Query: {
    scenarios: async (): Promise<ScenarioRow[]> => {
      const { rows } = await pool.query<ScenarioRow>(
        `SELECT ${SCENARIO_COLUMNS} FROM scenario ORDER BY created_at, id`,
      );
      return rows;
    },

    scenario: async (_: unknown, { id }: { id: string }): Promise<ScenarioRow | null> => {
      if (!isUuid(id)) return null;
      const { rows } = await pool.query<ScenarioRow>(
        `SELECT ${SCENARIO_COLUMNS} FROM scenario WHERE id = $1`,
        [id],
      );
      return rows[0] ?? null;
    },
  },

  Mutation: {
    createScenario: async (
      _: unknown,
      { input }: { input: CreateScenarioInput },
    ): Promise<ScenarioRow> => {
      validateScenarioInput(input);
      return withTransaction(async (db) => {
        const site = await db.query('SELECT 1 FROM site WHERE id = $1', [input.siteId]);
        if (site.rowCount === 0) {
          throw notFound(`Site ${input.siteId} not found`);
        }
        const { rows } = await db.query<ScenarioRow>(
          `INSERT INTO scenario (name, site_id) VALUES ($1, $2) RETURNING ${SCENARIO_COLUMNS}`,
          [input.name.trim(), input.siteId],
        );
        const scenario = rows[0]!;

        for (const m of input.machines ?? []) {
          const machine = await db.query<{ id: string }>(
            `INSERT INTO machine (scenario_id, name, type, speed_mps)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [scenario.id, m.name.trim(), m.type, m.speedMps],
          );
          await db.query(
            `INSERT INTO machine_waypoint (machine_id, seq, geom)
             SELECT $1, w.seq - 1, ST_SetSRID(ST_MakePoint(w.lon, w.lat), 4326)
             FROM unnest($2::float8[], $3::float8[]) WITH ORDINALITY AS w(lon, lat, seq)`,
            [machine.rows[0]!.id, m.route.map((p) => p.lon), m.route.map((p) => p.lat)],
          );
        }
        return scenario;
      });
    },

    startSimulationRun: async (
      _: unknown,
      { scenarioId }: { scenarioId: string },
    ): Promise<RunRow> => {
      if (!isUuid(scenarioId)) throw notFound(`Scenario ${scenarioId} not found`);
      const { rows } = await pool.query<RunRow>(
        `INSERT INTO simulation_run (scenario_id, status, started_at)
         SELECT id, 'RUNNING', now() FROM scenario WHERE id = $1
         RETURNING ${RUN_COLUMNS}`,
        [scenarioId],
      );
      if (!rows[0]) throw notFound(`Scenario ${scenarioId} not found`);
      return rows[0];
    },

    completeSimulationRun: async (
      _: unknown,
      { id, durationSec, distanceM }: { id: string; durationSec: number; distanceM: number },
    ): Promise<RunRow> => {
      if (!isUuid(id)) throw notFound(`Simulation run ${id} not found`);
      if (!isNonNegative(durationSec) || !isNonNegative(distanceM)) {
        throw badInput('durationSec and distanceM must be finite and >= 0');
      }
      // Only a RUNNING run can be completed; the WHERE clause makes this atomic.
      const { rows } = await pool.query<RunRow>(
        `UPDATE simulation_run
         SET status = 'COMPLETED', finished_at = now(), duration_sec = $2, distance_m = $3
         WHERE id = $1 AND status = 'RUNNING'
         RETURNING ${RUN_COLUMNS}`,
        [id, durationSec, distanceM],
      );
      if (rows[0]) return rows[0];

      const existing = await pool.query<{ status: string }>(
        'SELECT status FROM simulation_run WHERE id = $1',
        [id],
      );
      if (!existing.rows[0]) throw notFound(`Simulation run ${id} not found`);
      throw badInput(
        `Simulation run ${id} is ${existing.rows[0].status}; only RUNNING runs can be completed`,
      );
    },
  },

  // Nested fields go through the per-request DataLoaders (see loaders.ts).
  Scenario: {
    site: async (s: ScenarioRow, _: unknown, { loaders }: Context) => {
      const site = await loaders.siteById.load(s.site_id);
      if (!site) throw new Error(`Site ${s.site_id} missing for scenario ${s.id}`);
      return site;
    },
    machines: (s: ScenarioRow, _: unknown, { loaders }: Context) =>
      loaders.machinesByScenarioId.load(s.id),
    runs: (s: ScenarioRow, _: unknown, { loaders }: Context) =>
      loaders.runsByScenarioId.load(s.id),
  },

  Machine: {
    speedMps: (m: MachineRow) => m.speed_mps,
    route: (m: MachineRow, _: unknown, { loaders }: Context): Promise<WaypointRow[]> =>
      loaders.routeByMachineId.load(m.id),
  },

  SimulationRun: {
    startedAt: (r: RunRow) => r.started_at.toISOString(),
    finishedAt: (r: RunRow) => r.finished_at?.toISOString() ?? null,
    durationSec: (r: RunRow) => r.duration_sec,
    distanceM: (r: RunRow) => r.distance_m,
  },
};

function validateScenarioInput(input: CreateScenarioInput): void {
  if (!input.name.trim()) throw badInput('name must not be empty');
  if (!isUuid(input.siteId)) throw notFound(`Site ${input.siteId} not found`);
  for (const [i, m] of (input.machines ?? []).entries()) {
    if (!m.name.trim()) throw badInput(`machines[${i}].name must not be empty`);
    if (!(Number.isFinite(m.speedMps) && m.speedMps > 0)) {
      throw badInput(`machines[${i}].speedMps must be > 0`);
    }
    if (m.route.length < 2) throw badInput(`machines[${i}].route needs at least 2 waypoints`);
    for (const [j, p] of m.route.entries()) {
      if (!(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)) {
        throw badInput(`machines[${i}].route[${j}] is not a valid lat/lon`);
      }
    }
  }
}

const isNonNegative = (n: number) => Number.isFinite(n) && n >= 0;

function badInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
}

function notFound(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'NOT_FOUND' } });
}
