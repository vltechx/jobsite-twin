import { Injectable } from '@angular/core';
import {
  Cartesian3,
  Cartographic,
  Color,
  CustomDataSource,
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
} from 'cesium';
import type { MachineData } from '../scenarios/scenario.service';

const TRUCK_MODEL_URL = 'assets/models/CesiumMilkTruck.glb';
/** Spacing of densified road points; close to the finest terrain mesh spacing. */
const DENSIFY_SPACING_M = 5;
/** Raises samples slightly so the trail doesn't flicker in and out of the terrain. */
const TRAIL_LIFT_M = 1;
/** Full planned route; same hue as the trail, fainter. */
const ROUTE_COLOR = Color.CYAN.withAlpha(0.5);

@Injectable({ providedIn: 'root' })
export class HaulTruckService {
  /**
   * Adds a machine that drives its route (ordered by seq) at its speed, starting at
   * `start`. Resolves to the entity and trip duration, or undefined if the route has
   * fewer than 2 points or the target was removed while terrain heights were loading.
   */
  async addMachine(
    target: CustomDataSource,
    terrain: Terrain,
    machine: MachineData,
    start: JulianDate,
    isStale: () => boolean,
  ): Promise<{ entity: Entity; durationSec: number } | undefined> {
    // 1. Route from the API, ordered by seq.
    const lonLats = [...machine.route]
      .sort((a, b) => a.seq - b.seq)
      .map((w): [number, number] => [w.lon, w.lat]);
    if (lonLats.length < 2) {
      return undefined;
    }

    // 2. Densify to a point every ~5 m, then get terrain heights for all of them in
    //    one call, so straight lines between samples follow the ground.
    const terrainProvider = await whenTerrainReady(terrain);
    const cartographics = densify(lonLats, DENSIFY_SPACING_M);
    await sampleTerrainMostDetailed(terrainProvider, cartographics);
    if (isStale()) {
      return undefined;
    }
    const waypoints = cartographics.map((c) =>
      Cartesian3.fromRadians(c.longitude, c.latitude, (c.height ?? 0) + TRAIL_LIFT_M),
    );

    // 3. One sample per densified point, timed by distance at the machine's speed.
    const position = new SampledPositionProperty();
    let elapsedSeconds = 0;
    waypoints.forEach((point, i) => {
      if (i > 0) {
        elapsedSeconds += Cartesian3.distance(waypoints[i - 1], point) / machine.speedMps;
      }
      position.addSample(JulianDate.addSeconds(start, elapsedSeconds, new JulianDate()), point);
    });
    const stop = JulianDate.addSeconds(start, elapsedSeconds, new JulianDate());

    // 4. The whole route as a line on the ground, so it's visible before the machine
    //    has driven it (the trail below only covers the part already driven).
    target.entities.add({
      id: `route-${machine.id}`,
      name: `${machine.name} route`,
      polyline: {
        positions: Cartesian3.fromDegreesArray(lonLats.flat()),
        clampToGround: true,
        width: 4,
        material: ROUTE_COLOR,
      },
    });

    // 5. Entity facing its direction of travel, with a trail.
    const entity = target.entities.add({
      id: `machine-${machine.id}`,
      name: machine.name,
      description:
        `<p>${escapeHtml(machine.type.replace('_', ' ').toLowerCase())}, ` +
        `about ${machine.speedMps} m/s.</p>`,
      availability: new TimeIntervalCollection([new TimeInterval({ start, stop })]),
      position,
      orientation: new VelocityOrientationProperty(position),
      model: {
        // Only one model is available, so every machine type uses the truck for now.
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

    return { entity, durationSec: elapsedSeconds };
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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