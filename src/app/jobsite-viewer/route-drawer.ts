import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantProperty,
  CustomDataSource,
  defined,
  Entity,
  HeightReference,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
} from 'cesium';

import type { LatLon } from '../scenarios/route-draft';

const DRAFT_COLOR = Color.ORANGE;

/** Viewer click actions that would select or track entities while drawing. */
const SUSPENDED_ACTIONS = [
  ScreenSpaceEventType.LEFT_CLICK,
  ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
] as const;

/**
 * Draw mode: each left-click on the terrain adds a waypoint, shown as a point plus a
 * ground-clamped line. Call destroy() to remove the drawing and restore the viewer's
 * own click handling.
 */
export class RouteDrawer {
  private readonly source = new CustomDataSource('route-draft');
  private readonly handler: ScreenSpaceEventHandler;
  private readonly line: Entity;
  private readonly points: { position: Cartesian3; entity: Entity }[] = [];
  private readonly suspended = new Map<ScreenSpaceEventType, unknown>();

  constructor(
    private readonly viewer: Viewer,
    /** Called with the new point count after every add/undo. */
    private readonly onChange: (count: number) => void,
  ) {
    void viewer.dataSources.add(this.source);
    this.line = this.source.entities.add({
      show: false,
      polyline: { clampToGround: true, width: 4, material: DRAFT_COLOR },
    });

    for (const type of SUSPENDED_ACTIONS) {
      this.suspended.set(type, viewer.screenSpaceEventHandler.getInputAction(type));
      viewer.screenSpaceEventHandler.removeInputAction(type);
    }

    this.handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    this.handler.setInputAction(
      (click: { position: Cartesian2 }) => this.addAt(click.position),
      ScreenSpaceEventType.LEFT_CLICK,
    );
  }

  /** Waypoints in click order. */
  waypoints(): LatLon[] {
    return this.points.map(({ position }) => {
      const carto = Cartographic.fromCartesian(position);
      return {
        lat: CesiumMath.toDegrees(carto.latitude),
        lon: CesiumMath.toDegrees(carto.longitude),
      };
    });
  }

  undo(): void {
    const last = this.points.pop();
    if (last) {
      this.source.entities.remove(last.entity);
      this.update();
    }
  }

  destroy(): void {
    if (!this.handler.isDestroyed()) {
      this.handler.destroy();
    }
    if (this.viewer.isDestroyed()) return;
    for (const [type, action] of this.suspended) {
      if (action) {
        this.viewer.screenSpaceEventHandler.setInputAction(
          action as (event: unknown) => void,
          type,
        );
      }
    }
    this.viewer.dataSources.remove(this.source, true);
  }

  private addAt(windowPosition: Cartesian2): void {
    const scene = this.viewer.scene;
    const ray = this.viewer.camera.getPickRay(windowPosition);
    // globe.pick only hits terrain (not entities or the truck model).
    const position = ray && scene.globe.pick(ray, scene);
    if (!defined(position)) {
      return; // clicked the sky
    }
    const entity = this.source.entities.add({
      position,
      point: {
        pixelSize: 10,
        color: DRAFT_COLOR,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY, // never hidden by hills
      },
    });
    this.points.push({ position, entity });
    this.update();
  }

  private update(): void {
    const positions = this.points.map((p) => p.position);
    this.line.show = positions.length >= 2;
    this.line.polyline!.positions = new ConstantProperty(positions);
    this.onChange(positions.length);
  }
}
