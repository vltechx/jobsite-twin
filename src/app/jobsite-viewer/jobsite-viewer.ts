import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  inject,
  isDevMode,
  viewChild,
} from '@angular/core';
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  defined,
  Ion,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Terrain,
  Viewer,
} from 'cesium';
import { environment } from '../../environments/environment';
import { SiteFeaturesService } from './site-features.service';

const JOBSITE = {
  latitude: 40.523,
  longitude: -112.15,
  height: 3000, // metres above the ellipsoid
};

@Component({
  selector: 'app-jobsite-viewer',
  template: `<div #container class="viewer-container"></div>`,
  styleUrl: './jobsite-viewer.scss',
})
export class JobsiteViewerComponent implements AfterViewInit, OnDestroy {
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private readonly zone = inject(NgZone);
  private readonly siteFeatures = inject(SiteFeaturesService);
  private viewer?: Viewer;
  private clickHandler?: ScreenSpaceEventHandler;

  ngAfterViewInit(): void {
    Ion.defaultAccessToken = environment.cesiumIonToken;

    // Cesium runs its own render loop; keep it out of Angular change detection.
    this.zone.runOutsideAngular(() => {
      this.viewer = new Viewer(this.container().nativeElement, {
        terrain: Terrain.fromWorldTerrain(),
      });

      this.viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(JOBSITE.longitude, JOBSITE.latitude, JOBSITE.height),
        orientation: {
          heading: CesiumMath.toRadians(0),
          pitch: CesiumMath.toRadians(-45),
          roll: 0,
        },
      });

      // Makes pickPosition hit the terrain surface, and hides features behind hills.
      this.viewer.scene.globe.depthTestAgainstTerrain = true;

      if (isDevMode()) {
        this.clickHandler = this.createCoordinateLogger(this.viewer);
      }

      this.siteFeatures
        .addTo(this.viewer)
        .catch((err) => console.error('Failed to load site features', err));
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

    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.destroy();
    }
    this.viewer = undefined;
  }
}
