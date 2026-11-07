import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { CombinedGraphQLErrors } from '@apollo/client';
import { Apollo } from 'apollo-angular';
import { Observable, map } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  ScenarioDetailDocument,
  ScenariosDocument,
  type ScenarioDetailQuery,
  type ScenariosQuery,
} from '../graphql/generated/graphql';

// Types derived from the generated query results (see scenarios.graphql, npm run codegen).
export type ScenarioSummary = ScenariosQuery['scenarios'][number];
export type ScenarioDetail = NonNullable<ScenarioDetailQuery['scenario']>;
export type MachineData = ScenarioDetail['machines'][number];

@Injectable({ providedIn: 'root' })
export class ScenarioService {
  private readonly apollo = inject(Apollo);

  /** All scenarios (id + name), always fetched from the server. */
  listScenarios(): Observable<ScenarioSummary[]> {
    return this.apollo
      .query({ query: ScenariosDocument, fetchPolicy: 'network-only' })
      .pipe(map((result) => result.data?.scenarios ?? []));
  }

  /** One scenario with its site GeoJSON, machines and routes. */
  getScenario(id: string): Observable<ScenarioDetail> {
    return this.apollo.query({ query: ScenarioDetailDocument, variables: { id } }).pipe(
      map((result) => {
        const scenario = result.data?.scenario;
        if (!scenario) {
          throw new Error(`Scenario ${id} was not found. It may have been deleted or re-seeded.`);
        }
        return scenario;
      }),
    );
  }
}

/** Turns API/network failures into a message that says what to do. */
export function describeApiError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      return (
        `Can't reach the GraphQL API at ${environment.graphqlUrl}. ` +
        'Is the server running? Start it with: cd server && npm run dev'
      );
    }
    return `The GraphQL API returned HTTP ${err.status} ${err.statusText}`.trim() + '.';
  }
  if (CombinedGraphQLErrors.is(err)) {
    return `The GraphQL API reported an error: ${err.errors.map((e) => e.message).join('; ')}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Something went wrong while talking to the GraphQL API.';
}
