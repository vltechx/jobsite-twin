import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { CombinedGraphQLErrors } from '@apollo/client';
import { Apollo } from 'apollo-angular';
import { Observable, map } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  AddMachineDocument,
  CreateScenarioDocument,
  DeleteMachineDocument,
  DeleteScenarioDocument,
  RenameScenarioDocument,
  ScenarioDetailDocument,
  ScenariosDocument,
  UpdateMachineDocument,
  type MachineInput,
  type ScenarioDetailQuery,
  type ScenariosQuery,
} from '../graphql/generated/graphql';
import type { MachineDraft, MachineFields, RouteDraft } from './route-draft';

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

  /**
   * One scenario with its site GeoJSON, machines and routes. Always fetched from the
   * server, so a reload after an edit never draws a stale cached copy.
   */
  getScenario(id: string): Observable<ScenarioDetail> {
    return this.apollo
      .query({ query: ScenarioDetailDocument, variables: { id }, fetchPolicy: 'network-only' })
      .pipe(
        map((result) => {
          const scenario = result.data?.scenario;
          if (!scenario) {
            throw new Error(
              `Scenario ${id} was not found. It may have been deleted or re-seeded.`,
            );
          }
          return scenario;
        }),
      );
  }

  /** Creates a scenario on `siteId` with the draft's machine; waypoints keep their order. */
  createScenario(siteId: string, draft: RouteDraft): Observable<ScenarioSummary> {
    return this.apollo
      .mutate({
        mutation: CreateScenarioDocument,
        variables: {
          input: { name: draft.scenarioName.trim(), siteId, machines: [machineInput(draft)] },
        },
      })
      .pipe(map((result) => required(result.data?.createScenario, 'the new scenario')));
  }

  renameScenario(id: string, name: string): Observable<ScenarioSummary> {
    return this.apollo
      .mutate({ mutation: RenameScenarioDocument, variables: { id, name: name.trim() } })
      .pipe(map((result) => required(result.data?.renameScenario, 'the renamed scenario')));
  }

  /** Deletes the scenario with its machines and runs; emits the deleted id. */
  deleteScenario(id: string): Observable<string> {
    return this.apollo
      .mutate({ mutation: DeleteScenarioDocument, variables: { id } })
      .pipe(map((result) => required(result.data?.deleteScenario, 'the deleted scenario id')));
  }

  /** Adds the draft's machine to a scenario; emits the new machine's id. */
  addMachine(scenarioId: string, draft: MachineDraft): Observable<string> {
    return this.apollo
      .mutate({
        mutation: AddMachineDocument,
        variables: { scenarioId, input: machineInput(draft) },
      })
      .pipe(map((result) => required(result.data?.addMachine, 'the new machine').id));
  }

  /** Changes a machine's name, type and speed (not its route). */
  updateMachine(id: string, fields: MachineFields): Observable<void> {
    return this.apollo
      .mutate({
        mutation: UpdateMachineDocument,
        variables: {
          id,
          input: {
            name: fields.machineName.trim(),
            type: fields.machineType,
            speedMps: fields.speedMps,
          },
        },
      })
      .pipe(
        map((result) => {
          required(result.data?.updateMachine, 'the updated machine');
        }),
      );
  }

  /** Deletes a machine and its route; emits the deleted id. */
  deleteMachine(id: string): Observable<string> {
    return this.apollo
      .mutate({ mutation: DeleteMachineDocument, variables: { id } })
      .pipe(map((result) => required(result.data?.deleteMachine, 'the deleted machine id')));
  }
}

function machineInput(draft: MachineDraft): MachineInput {
  return {
    name: draft.machineName.trim(),
    type: draft.machineType,
    speedMps: draft.speedMps,
    route: draft.waypoints.map(({ lat, lon }) => ({ lat, lon })),
  };
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`The GraphQL API did not return ${what}.`);
  }
  return value;
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
