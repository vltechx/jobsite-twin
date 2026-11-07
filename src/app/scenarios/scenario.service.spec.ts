import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ApolloTestingController, ApolloTestingModule } from 'apollo-angular/testing';
import { firstValueFrom } from 'rxjs';

import { ScenarioDetailDocument, ScenariosDocument } from '../graphql/generated/graphql';
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
