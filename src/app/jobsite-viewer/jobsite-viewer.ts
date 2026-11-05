import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  inject,
  viewChild,
} from '@angular/core';
import { Cartesian3, Ion, Math as CesiumMath, Terrain, Viewer } from 'cesium';
import { environment } from '../../environments/environment';

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
  private viewer?: Viewer;

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
    });
  }

  ngOnDestroy(): void {
    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.destroy();
    }
    this.viewer = undefined;
  }
}
