import { Injectable } from '@angular/core';
import {
  Cartesian3,
  Cartographic,
  ClockRange,
  Color,
  Entity,
  HeightReference,
  JulianDate,
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

    // 2. Real terrain heights for each waypoint.
    const terrainProvider = await whenTerrainReady(terrain);
    const cartographics = lonLats.map(([lon, lat]) => Cartographic.fromDegrees(lon, lat));
    await sampleTerrainMostDetailed(terrainProvider, cartographics);
    if (viewer.isDestroyed()) {
      return undefined;
    }
    const waypoints = cartographics.map((c) =>
      Cartesian3.fromRadians(c.longitude, c.latitude, c.height ?? 0),
    );

    // 3. One sample per waypoint, timed by distance at constant speed.
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
        // Waypoints are far apart, so the straight line between two of them can cut
        // through or float above the terrain; clamping keeps the model on the ground.
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
