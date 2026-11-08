// Row shapes returned by SQL queries (snake_case, as stored).

export type MachineType = 'HAUL_TRUCK' | 'EXCAVATOR' | 'DOZER';
export type RunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface ScenarioRow {
  id: string;
  name: string;
  site_id: string;
}

export interface SiteRow {
  id: string;
  name: string;
  geojson: string;
}

export interface MachineRow {
  id: string;
  scenario_id: string;
  name: string;
  type: MachineType;
  speed_mps: number;
}

export interface WaypointRow {
  machine_id: string;
  seq: number;
  lat: number;
  lon: number;
}

export interface RunRow {
  id: string;
  scenario_id: string;
  status: RunStatus;
  started_at: Date;
  finished_at: Date | null;
  duration_sec: number | null;
  distance_m: number | null;
}

export const SCENARIO_COLUMNS = 'id, name, site_id';
export const MACHINE_COLUMNS = 'id, scenario_id, name, type, speed_mps';
export const RUN_COLUMNS =
  'id, scenario_id, status, started_at, finished_at, duration_sec, distance_m';
