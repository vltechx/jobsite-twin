import type { MachineType } from '../graphql/generated/graphql';

/** Display names for the API's MachineType enum (must list every value). */
export const MACHINE_TYPE_LABELS = {
  HAUL_TRUCK: 'Haul truck',
  EXCAVATOR: 'Excavator',
  DOZER: 'Dozer',
} satisfies Record<MachineType, string>;

export const MACHINE_TYPES = Object.keys(MACHINE_TYPE_LABELS) as MachineType[];

export interface LatLon {
  lat: number;
  lon: number;
}

/** A scenario with one machine whose route was drawn on the map. */
export interface RouteDraft {
  scenarioName: string;
  machineName: string;
  machineType: MachineType;
  speedMps: number;
  /** In the order they were clicked. */
  waypoints: LatLon[];
}

/** Returns a message per problem; empty means the draft can be saved. */
export function validateRouteDraft(draft: RouteDraft): string[] {
  const errors: string[] = [];
  if (draft.waypoints.length < 2) {
    errors.push('Click at least 2 points on the terrain to draw a route.');
  }
  if (!draft.scenarioName.trim()) {
    errors.push('Scenario name is required.');
  }
  if (!draft.machineName.trim()) {
    errors.push('Machine name is required.');
  }
  if (!(Number.isFinite(draft.speedMps) && draft.speedMps > 0)) {
    errors.push('Speed must be a number greater than 0.');
  }
  return errors;
}
