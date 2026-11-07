import { validateRouteDraft, type RouteDraft } from './route-draft';

const valid: RouteDraft = {
  scenarioName: 'North haul',
  machineName: 'Truck 7',
  machineType: 'HAUL_TRUCK',
  speedMps: 8,
  waypoints: [
    { lat: 40.52, lon: -112.15 },
    { lat: 40.53, lon: -112.14 },
  ],
};

describe('validateRouteDraft', () => {
  it('accepts a complete draft', () => {
    expect(validateRouteDraft(valid)).toEqual([]);
  });

  it('needs at least 2 points', () => {
    expect(validateRouteDraft({ ...valid, waypoints: [valid.waypoints[0]] })).toEqual([
      'Click at least 2 points on the terrain to draw a route.',
    ]);
  });

  it('requires both names (whitespace does not count)', () => {
    expect(validateRouteDraft({ ...valid, scenarioName: '  ', machineName: '' })).toEqual([
      'Scenario name is required.',
      'Machine name is required.',
    ]);
  });

  it.each([0, -1, NaN, Infinity])('rejects speed %s', (speedMps) => {
    expect(validateRouteDraft({ ...valid, speedMps })).toEqual([
      'Speed must be a number greater than 0.',
    ]);
  });
});
