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

/** A machine's editable settings (everything except its route). */
export interface MachineFields {
  machineName: string;
  machineType: MachineType;
  speedMps: number;
}

/** A machine whose route was drawn on the map. */
export interface MachineDraft extends MachineFields {
  /** In the order they were clicked. */
  waypoints: LatLon[];
}

/** A new scenario with one machine whose route was drawn on the map. */
export interface RouteDraft extends MachineDraft {
  scenarioName: string;
}

/** Parses a typed speed; blank text is NaN (invalid), not 0. */
export function parseSpeed(text: string): number {
  return text.trim() === '' ? NaN : Number(text);
}

/** Returns a message per problem; empty means the fields can be saved. */
export function validateMachineFields(fields: MachineFields): string[] {
  const errors: string[] = [];
  if (!fields.machineName.trim()) {
    errors.push('Machine name is required.');
  }
  if (!(Number.isFinite(fields.speedMps) && fields.speedMps > 0)) {
    errors.push('Speed must be a number greater than 0.');
  }
  return errors;
}

/** Returns a message per problem; empty means the machine can be added. */
export function validateMachineDraft(draft: MachineDraft): string[] {
  return [...validateWaypoints(draft), ...validateMachineFields(draft)];
}

/** Returns a message per problem; empty means the draft can be saved. */
export function validateRouteDraft(draft: RouteDraft): string[] {
  return [
    ...validateWaypoints(draft),
    ...(draft.scenarioName.trim() ? [] : ['Scenario name is required.']),
    ...validateMachineFields(draft),
  ];
}

function validateWaypoints(draft: MachineDraft): string[] {
  return draft.waypoints.length < 2
    ? ['Click at least 2 points on the terrain to draw a route.']
    : [];
}
