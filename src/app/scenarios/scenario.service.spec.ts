import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ApolloTestingController, ApolloTestingModule } from 'apollo-angular/testing';
import { firstValueFrom } from 'rxjs';

import { GraphQLError } from 'graphql';

import {
  AddMachineDocument,
  CreateScenarioDocument,
  DeleteMachineDocument,
  DeleteScenarioDocument,
  RenameScenarioDocument,
  ScenarioDetailDocument,
  ScenariosDocument,
  UpdateMachineDocument,
} from '../graphql/generated/graphql';
import { ScenarioService, describeApiError } from './scenario.service';

describe('ScenarioService', () => {
  let service: ScenarioService;
  let controller: ApolloTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ApolloTestingModule] });
    service = TestBed.inject(ScenarioService);
    controller = TestBed.inject(ApolloTestingController);
  });

  afterEach(() => controller.verify());

  it('lists scenarios', async () => {
    const result = firstValueFrom(service.listScenarios());
    controller.expectOne(ScenariosDocument).flush({
      data: { scenarios: [{ __typename: 'Scenario', id: 's1', name: 'Baseline' }] },
    });
    expect(await result).toEqual([{ __typename: 'Scenario', id: 's1', name: 'Baseline' }]);
  });

  it('errors with a clear message when a scenario does not exist', async () => {
    const result = firstValueFrom(service.getScenario('missing'));
    const op = controller.expectOne(ScenarioDetailDocument);
    expect(op.operation.variables).toEqual({ id: 'missing' });
    op.flush({ data: { scenario: null } });
    await expect(result).rejects.toThrow('Scenario missing was not found');
  });

  it('creates a scenario with trimmed names and waypoints in drawn order', async () => {
    const result = firstValueFrom(
      service.createScenario('site-1', {
        scenarioName: '  North haul ',
        machineName: ' Truck 7',
        machineType: 'DOZER',
        speedMps: 6.5,
        waypoints: [
          { lat: 2, lon: 20 },
          { lat: 1, lon: 10 },
        ],
      }),
    );
    const op = controller.expectOne(CreateScenarioDocument);
    expect(op.operation.variables).toEqual({
      input: {
        name: 'North haul',
        siteId: 'site-1',
        machines: [
          {
            name: 'Truck 7',
            type: 'DOZER',
            speedMps: 6.5,
            route: [
              { lat: 2, lon: 20 },
              { lat: 1, lon: 10 },
            ],
          },
        ],
      },
    });
    op.flush({ data: { createScenario: { __typename: 'Scenario', id: 'new', name: 'North haul' } } });
    expect(await result).toEqual({ __typename: 'Scenario', id: 'new', name: 'North haul' });
  });

  it('surfaces server validation errors', async () => {
    const result = firstValueFrom(
      service.createScenario('site-1', {
        scenarioName: 'x',
        machineName: 'y',
        machineType: 'HAUL_TRUCK',
        speedMps: 1,
        waypoints: [],
      }),
    );
    controller
      .expectOne(CreateScenarioDocument)
      .graphqlErrors([new GraphQLError('machines[0].route needs at least 2 waypoints')]);
    const err = await result.catch((e: unknown) => e);
    expect(describeApiError(err)).toBe(
      'The GraphQL API reported an error: machines[0].route needs at least 2 waypoints',
    );
  });
});

describe('ScenarioService edits', () => {
  let service: ScenarioService;
  let controller: ApolloTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ApolloTestingModule] });
    service = TestBed.inject(ScenarioService);
    controller = TestBed.inject(ApolloTestingController);
  });

  afterEach(() => controller.verify());

  it('renames a scenario with a trimmed name', async () => {
    const result = firstValueFrom(service.renameScenario('s1', '  South pit '));
    const op = controller.expectOne(RenameScenarioDocument);
    expect(op.operation.variables).toEqual({ id: 's1', name: 'South pit' });
    op.flush({ data: { renameScenario: { __typename: 'Scenario', id: 's1', name: 'South pit' } } });
    expect(await result).toEqual({ __typename: 'Scenario', id: 's1', name: 'South pit' });
  });

  it('deletes a scenario and emits its id', async () => {
    const result = firstValueFrom(service.deleteScenario('s1'));
    const op = controller.expectOne(DeleteScenarioDocument);
    expect(op.operation.variables).toEqual({ id: 's1' });
    op.flush({ data: { deleteScenario: 's1' } });
    expect(await result).toBe('s1');
  });

  it('adds a drawn machine to a scenario', async () => {
    const result = firstValueFrom(
      service.addMachine('s1', {
        machineName: ' Dozer 2 ',
        machineType: 'DOZER',
        speedMps: 3,
        waypoints: [
          { lat: 1, lon: 10 },
          { lat: 2, lon: 20 },
        ],
      }),
    );
    const op = controller.expectOne(AddMachineDocument);
    expect(op.operation.variables).toEqual({
      scenarioId: 's1',
      input: {
        name: 'Dozer 2',
        type: 'DOZER',
        speedMps: 3,
        route: [
          { lat: 1, lon: 10 },
          { lat: 2, lon: 20 },
        ],
      },
    });
    op.flush({ data: { addMachine: { __typename: 'Machine', id: 'm9' } } });
    expect(await result).toBe('m9');
  });

  it('updates a machine without sending its route', async () => {
    const result = firstValueFrom(
      service.updateMachine('m1', { machineName: ' Exc ', machineType: 'EXCAVATOR', speedMps: 2 }),
    );
    const op = controller.expectOne(UpdateMachineDocument);
    expect(op.operation.variables).toEqual({
      id: 'm1',
      input: { name: 'Exc', type: 'EXCAVATOR', speedMps: 2 },
    });
    op.flush({
      data: {
        updateMachine: {
          __typename: 'Machine',
          id: 'm1',
          name: 'Exc',
          type: 'EXCAVATOR',
          speedMps: 2,
        },
      },
    });
    await expect(result).resolves.toBeUndefined();
  });

  it('surfaces NOT_FOUND when deleting a machine that is gone', async () => {
    const result = firstValueFrom(service.deleteMachine('m1'));
    controller
      .expectOne(DeleteMachineDocument)
      .graphqlErrors([new GraphQLError('Machine m1 not found')]);
    const err = await result.catch((e: unknown) => e);
    expect(describeApiError(err)).toBe('The GraphQL API reported an error: Machine m1 not found');
  });
});

describe('describeApiError', () => {
  it('says the API is not running when the request gets no response', () => {
    const message = describeApiError(new HttpErrorResponse({ status: 0 }));
    expect(message).toContain("Can't reach the GraphQL API");
    expect(message).toContain('npm run dev');
  });

  it('reports HTTP errors with their status', () => {
    const err = new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' });
    expect(describeApiError(err)).toBe('The GraphQL API returned HTTP 500 Internal Server Error.');
  });
});
