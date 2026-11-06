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
  defined,
  Entity,
  Ion,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Terrain,
  Viewer,
} from 'cesium';
import { environment } from '../../environments/environment';
import { HaulTruckService } from './haul-truck.service';
import { SiteFeaturesService } from './site-features.service';

const JOBSITE = {
  latitude: 40.523,
  longitude: -112.15,
  height: 3000, // metres above the ellipsoid
};

@Component({
  selector: 'app-jobsite-viewer',
  template: `
    <div #container class="viewer-container"></div>
    <div class="view-controls">
      <button type="button" (click)="followTruck()" [disabled]="!truck()">Follow truck</button>
      <button type="button" (click)="showSite()">Site view</button>
    </div>
  `,
  styleUrl: './jobsite-viewer.scss',
})
export class JobsiteViewerComponent implements AfterViewInit, OnDestroy {
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private readonly zone = inject(NgZone);
  private readonly siteFeatures = inject(SiteFeaturesService);
  private readonly haulTruck = inject(HaulTruckService);
  private viewer?: Viewer;
  protected readonly truck = signal<Entity | undefined>(undefined);
  private clickHandler?: ScreenSpaceEventHandler;

  ngAfterViewInit(): void {
    Ion.defaultAccessToken = environment.cesiumIonToken;

    // Cesium runs its own render loop; keep it out of Angular change detection.
    this.zone.runOutsideAngular(() => {
      const terrain = Terrain.fromWorldTerrain();
      this.viewer = new Viewer(this.container().nativeElement, { terrain });

      this.flyToSite(this.viewer);

      // Makes pickPosition hit the terrain surface, and hides features behind hills.
      this.viewer.scene.globe.depthTestAgainstTerrain = true;

      if (isDevMode()) {
        this.clickHandler = this.createCoordinateLogger(this.viewer);
      }

      this.siteFeatures
        .addTo(this.viewer)
        .catch((err) => console.error('Failed to load site features', err));

      this.haulTruck
        .addTo(this.viewer, terrain)
        .then((truck) => this.truck.set(truck))
        .catch((err) => console.error('Failed to add haul truck', err));
    });
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
