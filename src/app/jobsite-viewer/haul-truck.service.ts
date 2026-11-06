import { Injectable } from '@angular/core';
import {
  Cartesian3,
  Cartographic,
  ClockRange,
  Color,
  Entity,
  HeightReference,
  JulianDate,
  Math as CesiumMath,
  PolylineGlowMaterialProperty,
  SampledPositionProperty,
  sampleTerrainMostDetailed,
  Terrain,
  TerrainProvider,
  TimeInterval,
  TimeIntervalCollection,
  VelocityOrientationProperty,
  Viewer,
} from 'cesium';

const SITE_GEOJSON_URL = 'assets/site.geojson';
const TRUCK_MODEL_URL = 'assets/models/CesiumMilkTruck.glb';
const TRUCK_SPEED_MPS = 10;
/** Spacing of densified road points; close to the finest terrain mesh spacing. */
const DENSIFY_SPACING_M = 5;
/** Raises samples slightly so the trail doesn't flicker in and out of the terrain. */
const TRAIL_LIFT_M = 1;

interface SiteFeatureCollection {
  features: {
    properties?: { type?: string };
    geometry: { type: string; coordinates: unknown };
  }[];
}

@Injectable({ providedIn: 'root' })
export class HaulTruckService {
  /**
   * Adds a truck that drives the haul road on a loop and points the viewer clock at
   * the trip. Resolves to the truck entity, or undefined if the viewer was destroyed
   * while loading.
   */
  async addTo(viewer: Viewer, terrain: Terrain): Promise<Entity | undefined> {
    // 1. Haul road coordinates from the GeoJSON.
    const lonLats = await this.loadHaulRoad();

    // 2. Densify to a point every ~5 m, then get terrain heights for all of them in
    //    one call, so straight lines between samples follow the ground.
    const terrainProvider = await whenTerrainReady(terrain);
    const cartographics = densify(lonLats, DENSIFY_SPACING_M);
    await sampleTerrainMostDetailed(terrainProvider, cartographics);
    if (viewer.isDestroyed()) {
      return undefined;
    }
    const waypoints = cartographics.map((c) =>
      Cartesian3.fromRadians(c.longitude, c.latitude, (c.height ?? 0) + TRAIL_LIFT_M),
    );

    // 3. One sample per densified point, timed by distance at constant speed.
    const start = JulianDate.now();
    const position = new SampledPositionProperty();
    let elapsedSeconds = 0;
    waypoints.forEach((point, i) => {
      if (i > 0) {
        elapsedSeconds += Cartesian3.distance(waypoints[i - 1], point) / TRUCK_SPEED_MPS;
      }
      position.addSample(JulianDate.addSeconds(start, elapsedSeconds, new JulianDate()), point);
    });
    const stop = JulianDate.addSeconds(start, elapsedSeconds, new JulianDate());

    // 4. Truck entity facing its direction of travel, with a trail.
    const truck = viewer.entities.add({
      name: 'Haul Truck',
      description: `<p>Drives the main haul road at about ${TRUCK_SPEED_MPS} m/s.</p>`,
      availability: new TimeIntervalCollection([new TimeInterval({ start, stop })]),
      position,
      orientation: new VelocityOrientationProperty(position),
      model: {
        uri: TRUCK_MODEL_URL,
        minimumPixelSize: 48,
        // Samples are lifted TRAIL_LIFT_M for the trail; clamping keeps the wheels
        // on the ground anyway.
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
      path: {
        leadTime: 0,
        trailTime: elapsedSeconds,
        resolution: 1,
        width: 8,
        material: new PolylineGlowMaterialProperty({ glowPower: 0.2, color: Color.CYAN }),
      },
    });

    // 5. Clock covers the trip and loops; speed is adjustable in the animation widget.
    const clock = viewer.clock;
    clock.startTime = start.clone();
    clock.stopTime = stop.clone();
    clock.currentTime = start.clone();
    clock.clockRange = ClockRange.LOOP_STOP;
    clock.multiplier = 1;
    clock.shouldAnimate = true;
    viewer.timeline?.zoomTo(start, stop);

    return truck;
  }

  private async loadHaulRoad(): Promise<[number, number][]> {
    const response = await fetch(SITE_GEOJSON_URL);
    if (!response.ok) {
      throw new Error(`Failed to load ${SITE_GEOJSON_URL}: ${response.status}`);
    }
    const geojson = (await response.json()) as SiteFeatureCollection;
    const road = geojson.features.find(
      (f) => f.properties?.type === 'haul-road' && f.geometry.type === 'LineString',
    );
    if (!road) {
      throw new Error('No haul-road LineString found in site.geojson');
    }
    return road.geometry.coordinates as [number, number][];
  }
}

/**
 * Inserts points every ~spacingM metres along each segment (interpolated in lon/lat,
 * accurate enough for segments of a few hundred metres). Heights are left at 0.
 */
function densify(lonLats: [number, number][], spacingM: number): Cartographic[] {
  const points: Cartographic[] = [];
  for (let i = 1; i < lonLats.length; i++) {
    const a = Cartographic.fromDegrees(...lonLats[i - 1]);
    const b = Cartographic.fromDegrees(...lonLats[i]);
    const length = Cartesian3.distance(Cartographic.toCartesian(a), Cartographic.toCartesian(b));
    const steps = Math.max(1, Math.ceil(length / spacingM));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      points.push(
        new Cartographic(
          CesiumMath.lerp(a.longitude, b.longitude, t),
          CesiumMath.lerp(a.latitude, b.latitude, t),
        ),
      );
    }
  }
  points.push(Cartographic.fromDegrees(...lonLats[lonLats.length - 1]));
  return points;
}

/** Resolves once world terrain has loaded (before that the viewer uses a flat ellipsoid). */
function whenTerrainReady(terrain: Terrain): Promise<TerrainProvider> {
  if (terrain.ready) {
    return Promise.resolve(terrain.provider);
  }
  return new Promise((resolve, reject) => {
    terrain.readyEvent.addEventListener((provider) => resolve(provider));
    terrain.errorEvent.addEventListener((error) => reject(error));
  });
}