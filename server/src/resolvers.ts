import { GraphQLError } from 'graphql';
import type pg from 'pg';
import { pool, withTransaction } from './db.js';
import type { Loaders } from './loaders.js';
import {
  MACHINE_COLUMNS,
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

interface UpdateMachineInput {
  name: string;
  type: MachineType;
  speedMps: number;
}

interface MachineInput extends UpdateMachineInput {
  route: { lat: number; lon: number }[];
}

interface CreateScenarioInput {
  name: string;
  siteId: string;
  machines?: MachineInput[] | null;
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
          await insertMachine(db, scenario.id, m);
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
    renameScenario: async (
      _: unknown,
      { id, name }: { id: string; name: string },
    ): Promise<ScenarioRow> => {
      if (!name.trim()) throw badInput('name must not be empty');
      if (!isUuid(id)) throw notFound(`Scenario ${id} not found`);
      const { rows } = await pool.query<ScenarioRow>(
        `UPDATE scenario SET name = $2 WHERE id = $1 RETURNING ${SCENARIO_COLUMNS}`,
        [id, name.trim()],
      );
      if (!rows[0]) throw notFound(`Scenario ${id} not found`);
      return rows[0];
    },

    // Machines, waypoints and runs go with it (ON DELETE CASCADE).
    deleteScenario: async (_: unknown, { id }: { id: string }): Promise<string> => {
      if (!isUuid(id)) throw notFound(`Scenario ${id} not found`);
      const { rowCount } = await pool.query('DELETE FROM scenario WHERE id = $1', [id]);
      if (!rowCount) throw notFound(`Scenario ${id} not found`);
      return id;
    },

    addMachine: async (
      _: unknown,
      { scenarioId, input }: { scenarioId: string; input: MachineInput },
    ): Promise<MachineRow> => {
      validateMachineInput(input, 'input');
      if (!isUuid(scenarioId)) throw notFound(`Scenario ${scenarioId} not found`);
      return withTransaction(async (db) => {
        // FOR SHARE keeps the scenario from being deleted before the insert commits.
        const scenario = await db.query('SELECT 1 FROM scenario WHERE id = $1 FOR SHARE', [
          scenarioId,
        ]);
        if (scenario.rowCount === 0) throw notFound(`Scenario ${scenarioId} not found`);
        return insertMachine(db, scenarioId, input);
      });
    },

    updateMachine: async (
      _: unknown,
      { id, input }: { id: string; input: UpdateMachineInput },
    ): Promise<MachineRow> => {
      validateMachineFields(input, 'input');
      if (!isUuid(id)) throw notFound(`Machine ${id} not found`);
      const { rows } = await pool.query<MachineRow>(
        `UPDATE machine SET name = $2, type = $3, speed_mps = $4
         WHERE id = $1 RETURNING ${MACHINE_COLUMNS}`,
        [id, input.name.trim(), input.type, input.speedMps],
      );
      if (!rows[0]) throw notFound(`Machine ${id} not found`);
      return rows[0];
    },

    // Its waypoints go with it (ON DELETE CASCADE).
    deleteMachine: async (_: unknown, { id }: { id: string }): Promise<string> => {
      if (!isUuid(id)) throw notFound(`Machine ${id} not found`);
      const { rowCount } = await pool.query('DELETE FROM machine WHERE id = $1', [id]);
      if (!rowCount) throw notFound(`Machine ${id} not found`);
      return id;
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
    validateMachineInput(m, `machines[${i}]`);
  }
}

function validateMachineFields(m: UpdateMachineInput, label: string): void {
  if (!m.name.trim()) throw badInput(`${label}.name must not be empty`);
  if (!(Number.isFinite(m.speedMps) && m.speedMps > 0)) {
    throw badInput(`${label}.speedMps must be > 0`);
  }
}

function validateMachineInput(m: MachineInput, label: string): void {
  validateMachineFields(m, label);
  if (m.route.length < 2) throw badInput(`${label}.route needs at least 2 waypoints`);
  for (const [j, p] of m.route.entries()) {
    if (!(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)) {
      throw badInput(`${label}.route[${j}] is not a valid lat/lon`);
    }
  }
}

/** Inserts a validated machine and its route (waypoint order = array order). */
async function insertMachine(
  db: pg.PoolClient,
  scenarioId: string,
  m: MachineInput,
): Promise<MachineRow> {
  const { rows } = await db.query<MachineRow>(
    `INSERT INTO machine (scenario_id, name, type, speed_mps)
     VALUES ($1, $2, $3, $4) RETURNING ${MACHINE_COLUMNS}`,
    [scenarioId, m.name.trim(), m.type, m.speedMps],
  );
  const machine = rows[0]!;
  await db.query(
    `INSERT INTO machine_waypoint (machine_id, seq, geom)
     SELECT $1, w.seq - 1, ST_SetSRID(ST_MakePoint(w.lon, w.lat), 4326)
     FROM unnest($2::float8[], $3::float8[]) WITH ORDINALITY AS w(lon, lat, seq)`,
    [machine.id, m.route.map((p) => p.lon), m.route.map((p) => p.lat)],
  );
  return machine;
}

const isNonNegative = (n: number) => Number.isFinite(n) && n >= 0;

function badInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
}

function notFound(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'NOT_FOUND' } });
}
