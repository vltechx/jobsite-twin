import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ApolloTestingController, ApolloTestingModule } from 'apollo-angular/testing';
import { firstValueFrom } from 'rxjs';

import { GraphQLError } from 'graphql';

import {
  CreateScenarioDocument,
  ScenarioDetailDocument,
  ScenariosDocument,
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
