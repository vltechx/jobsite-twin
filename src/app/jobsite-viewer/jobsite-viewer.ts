import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  inject,
  isDevMode,
  signal,
  viewChild,
} from '@angular/core';
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  ClockRange,
  CustomDataSource,
  DataSource,
  defined,
  Entity,
  Ion,
  JulianDate,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Terrain,
  Viewer,
} from 'cesium';
import { Subscription } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  ScenarioService,
  describeApiError,
  type ScenarioDetail,
  type ScenarioSummary,
} from '../scenarios/scenario.service';
import { HaulTruckService } from './haul-truck.service';
import { SiteFeaturesService } from './site-features.service';

const JOBSITE = {
  latitude: 40.523,
  longitude: -112.15,
  height: 3000, // metres above the ellipsoid
};

type LoadStatus = 'loading' | 'ready' | 'error';

@Component({
  selector: 'app-jobsite-viewer',
  template: `
    <div #container class="viewer-container"></div>

    <div class="view-controls">
      <label class="scenario-picker">
        <span>Scenario</span>
        <select (change)="onScenarioChange($event)" [disabled]="scenarios().length === 0">
          @for (s of scenarios(); track s.id) {
            <option [value]="s.id" [selected]="s.id === selectedId()">{{ s.name }}</option>
          }
        </select>
      </label>
      <button type="button" (click)="followTruck()" [disabled]="!truck()">Follow truck</button>
      <button type="button" (click)="showSite()">Site view</button>
    </div>

    @if (status() === 'loading') {
      <div class="status-banner" role="status">{{ message() }}</div>
    } @else if (status() === 'error') {
      <div class="status-banner error" role="alert">
        <span>{{ message() }}</span>
        <button type="button" (click)="retry()">Retry</button>
      </div>
    }
  `,
  styleUrl: './jobsite-viewer.scss',
})
export class JobsiteViewerComponent implements AfterViewInit, OnDestroy {
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private readonly zone = inject(NgZone);
  private readonly scenarioService = inject(ScenarioService);
  private readonly siteFeatures = inject(SiteFeaturesService);
  private readonly haulTruck = inject(HaulTruckService);

  protected readonly scenarios = signal<ScenarioSummary[]>([]);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly status = signal<LoadStatus>('loading');
  protected readonly message = signal('Loading scenarios…');
  protected readonly truck = signal<Entity | undefined>(undefined);

  private viewer?: Viewer;
  private terrain?: Terrain;
  private clickHandler?: ScreenSpaceEventHandler;
  private request?: Subscription;
  /** What Retry should redo. */
  private failedStep: 'list' | 'scenario' = 'list';
  /** Incremented per scenario load; async work from an older load is discarded. */
  private loadGeneration = 0;
  private siteSource?: DataSource;
  private machineSource?: CustomDataSource;

  ngAfterViewInit(): void {
    Ion.defaultAccessToken = environment.cesiumIonToken;

    // Cesium runs its own render loop; keep it out of Angular change detection.
    this.zone.runOutsideAngular(() => {
      this.terrain = Terrain.fromWorldTerrain();
      this.viewer = new Viewer(this.container().nativeElement, { terrain: this.terrain });

      this.flyToSite(this.viewer);

      // Makes pickPosition hit the terrain surface, and hides features behind hills.
      this.viewer.scene.globe.depthTestAgainstTerrain = true;

      if (isDevMode()) {
        this.clickHandler = this.createCoordinateLogger(this.viewer);
      }
    });

    this.loadScenarioList();
  }

  protected onScenarioChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    if (id && id !== this.selectedId()) {
      this.loadScenario(id);
    }
  }

  protected retry(): void {
    const id = this.selectedId();
    if (this.failedStep === 'scenario' && id) {
      this.loadScenario(id);
    } else {
      this.loadScenarioList();
    }
  }

  protected followTruck(): void {
    const truck = this.truck();
    if (this.viewer && truck) {
      this.viewer.trackedEntity = truck;
    }
  }

  protected showSite(): void {
    if (this.viewer) {
      this.viewer.trackedEntity = undefined;
      this.flyToSite(this.viewer);
    }
  }

  private loadScenarioList(): void {
    this.setLoading('Loading scenarios…');
    this.request?.unsubscribe();
    this.request = this.scenarioService.listScenarios().subscribe({
      next: (scenarios) => {
        this.scenarios.set(scenarios);
        if (scenarios.length === 0) {
          this.setError(
            'list',
            'No scenarios in the database yet. Seed one with: cd server && npm run seed',
          );
          return;
        }
        // Keep the current selection if it still exists, otherwise take the first.
        const current = this.selectedId();
        const next = scenarios.some((s) => s.id === current) ? current! : scenarios[0].id;
        this.loadScenario(next);
      },
      error: (err) => this.setError('list', describeApiError(err)),
    });
  }

  private loadScenario(id: string): void {
    const generation = ++this.loadGeneration;
    this.selectedId.set(id);
    this.clearScene();
    this.setLoading('Loading scenario…');

    this.request?.unsubscribe();
    this.request = this.scenarioService.getScenario(id).subscribe({
      next: (scenario) =>
        this.drawScenario(scenario, generation).catch((err) => {
          if (generation === this.loadGeneration) {
            this.setError('scenario', `Couldn't draw scenario: ${describeApiError(err)}`);
          }
        }),
      error: (err) => this.setError('scenario', describeApiError(err)),
    });
  }

  /** Adds the scenario's site and machines, then resets the clock to the trip. */
  private async drawScenario(scenario: ScenarioDetail, generation: number): Promise<void> {
    const viewer = this.viewer;
    const terrain = this.terrain;
    const isStale = () =>
      generation !== this.loadGeneration || !viewer || viewer.isDestroyed();
    if (!viewer || !terrain || isStale()) return;

    const site = await this.siteFeatures.create(scenario.site.geojson);
    if (isStale()) return;
    await viewer.dataSources.add(site);
    this.siteSource = site;

    const machines = new CustomDataSource('machines');
    await viewer.dataSources.add(machines);
    this.machineSource = machines;

    const start = JulianDate.now();
    const added = (
      await Promise.all(
        scenario.machines.map((m) =>
          this.haulTruck.addMachine(machines, terrain, m, start, isStale),
        ),
      )
    ).filter((result) => result !== undefined);
    if (isStale()) return;

    this.resetClock(viewer, start, Math.max(0, ...added.map((a) => a.durationSec)));

    const haulTruck = scenario.machines.find((m) => m.type === 'HAUL_TRUCK');
    const followed =
      (haulTruck && machines.entities.getById(`machine-${haulTruck.id}`)) ?? added[0]?.entity;
    this.truck.set(followed);
    this.status.set('ready');
  }

  /** Clock starts at the trip start, loops, and covers the longest machine trip. */
  private resetClock(viewer: Viewer, start: JulianDate, durationSec: number): void {
    const stop = JulianDate.addSeconds(start, durationSec, new JulianDate());
    const clock = viewer.clock;
    clock.startTime = start.clone();
    clock.stopTime = stop.clone();
    clock.currentTime = start.clone();
    clock.clockRange = ClockRange.LOOP_STOP;
    clock.shouldAnimate = durationSec > 0;
    if (durationSec > 0) {
      viewer.timeline?.zoomTo(start, stop);
    }
  }

  /** Removes the current scenario's entities so the next one draws from scratch. */
  private clearScene(): void {
    this.truck.set(undefined);
    const viewer = this.viewer;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.trackedEntity = undefined;
    for (const source of [this.siteSource, this.machineSource]) {
      if (source) viewer.dataSources.remove(source, true);
    }
    this.siteSource = undefined;
    this.machineSource = undefined;
  }

  private setLoading(message: string): void {
    this.status.set('loading');
    this.message.set(message);
  }

  private setError(step: 'list' | 'scenario', message: string): void {
    this.failedStep = step;
    this.status.set('error');
    this.message.set(message);
  }

  private flyToSite(viewer: Viewer): void {
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(JOBSITE.longitude, JOBSITE.latitude, JOBSITE.height),
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch: CesiumMath.toRadians(-45),
        roll: 0,
      },
    });
  }

  /** Dev helper: logs lat/lon/height of the clicked point to the console. */
  private createCoordinateLogger(viewer: Viewer): ScreenSpaceEventHandler {
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: { position: Cartesian2 }) => {
      if (!viewer.scene.pickPositionSupported) {
        console.warn('pickPosition is not supported in this browser');
        return;
      }
      const position = viewer.scene.pickPosition(click.position);
      if (!defined(position)) {
        return; // clicked the sky
      }
      const carto = Cartographic.fromCartesian(position);
      console.log(
        `lat ${CesiumMath.toDegrees(carto.latitude).toFixed(6)}, ` +
          `lon ${CesiumMath.toDegrees(carto.longitude).toFixed(6)}, ` +
          `height ${carto.height.toFixed(1)} m`,
      );
    }, ScreenSpaceEventType.LEFT_CLICK);
    return handler;
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
    this.loadGeneration++; // discard any in-flight draw

    if (this.clickHandler && !this.clickHandler.isDestroyed()) {
      this.clickHandler.destroy();
    }
    this.clickHandler = undefined;

    this.truck.set(undefined);
    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.destroy();
    }
    this.viewer = undefined;
  }
}
