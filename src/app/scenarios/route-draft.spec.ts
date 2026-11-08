import {
  parseSpeed,
  validateMachineDraft,
  validateMachineFields,
  validateRouteDraft,
  type RouteDraft,
} from './route-draft';

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

describe('validateMachineDraft', () => {
  it('does not need a scenario name', () => {
    const { scenarioName: _, ...machine } = valid;
    expect(validateMachineDraft(machine)).toEqual([]);
  });

  it('needs a route and a name', () => {
    expect(validateMachineDraft({ ...valid, machineName: ' ', waypoints: [] })).toEqual([
      'Click at least 2 points on the terrain to draw a route.',
      'Machine name is required.',
    ]);
  });
});

describe('validateMachineFields', () => {
  it('checks name and speed only', () => {
    expect(
      validateMachineFields({ machineName: '', machineType: 'DOZER', speedMps: 0 }),
    ).toEqual(['Machine name is required.', 'Speed must be a number greater than 0.']);
  });
});

describe('parseSpeed', () => {
  it('treats blank text as invalid, not 0', () => {
    expect(parseSpeed('  ')).toBeNaN();
    expect(parseSpeed('2.5')).toBe(2.5);
  });
});
