import { Injectable } from '@angular/core';
import {
  Cartesian2,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  Entity,
  GeoJsonDataSource,
  HeightReference,
  JulianDate,
  LabelGraphics,
  LabelStyle,
  PointGraphics,
  PolygonHierarchy,
  PolylineGraphics,
  VerticalOrigin,
  Viewer,
} from 'cesium';

const SITE_GEOJSON_URL = 'assets/site.geojson';

const BOUNDARY_COLOR = Color.ORANGE;
const HAUL_ROAD_COLOR = Color.YELLOW;
const MARKER_COLORS: Record<string, Color> = {
  stockpile: Color.SADDLEBROWN,
  office: Color.DODGERBLUE,
  entrance: Color.LIMEGREEN,
};

@Injectable({ providedIn: 'root' })
export class SiteFeaturesService {
  /** Loads the site GeoJSON, styles it, and adds it to the viewer. */
  async addTo(viewer: Viewer): Promise<GeoJsonDataSource | undefined> {
    const dataSource = await GeoJsonDataSource.load(SITE_GEOJSON_URL, {
      clampToGround: true,
    });

    // The component may have been destroyed while the file was loading.
    if (viewer.isDestroyed()) {
      return undefined;
    }

    const now = JulianDate.now();
    for (const entity of dataSource.entities.values) {
      this.setInfoBoxContent(entity, now);

      if (entity.polygon) {
        this.styleBoundary(entity, now);
      } else if (entity.polyline) {
        this.styleHaulRoad(entity);
      } else if (entity.billboard) {
        this.styleMarker(entity, now);
      }
    }

    await viewer.dataSources.add(dataSource);
    return dataSource;
  }

  /** Boundary: faint fill plus a semi-transparent outline drawn on the terrain. */
  private styleBoundary(entity: Entity, time: JulianDate): void {
    const polygon = entity.polygon!;
    polygon.material = new ColorMaterialProperty(BOUNDARY_COLOR.withAlpha(0.12));
    // Polygon outlines aren't supported when clamped to terrain, so draw the
    // outline as a ground-clamped polyline along the ring instead.
    polygon.outline = new ConstantProperty(false);

    const hierarchy = polygon.hierarchy?.getValue(time) as PolygonHierarchy | undefined;
    if (hierarchy?.positions.length) {
      entity.polyline = new PolylineGraphics({
        positions: [...hierarchy.positions, hierarchy.positions[0]],
        clampToGround: true,
        width: 3,
        material: BOUNDARY_COLOR.withAlpha(0.7),
      });
    }
  }

  /** Haul road: thick yellow line clamped to the ground. */
  private styleHaulRoad(entity: Entity): void {
    const polyline = entity.polyline!;
    polyline.width = new ConstantProperty(6);
    polyline.material = new ColorMaterialProperty(HAUL_ROAD_COLOR);
    polyline.clampToGround = new ConstantProperty(true);
  }

  /** Markers: replace the default pin with a coloured point and a label. */
  private styleMarker(entity: Entity, time: JulianDate): void {
    const type = entity.properties?.['type']?.getValue(time) as string | undefined;
    const color = (type && MARKER_COLORS[type]) || Color.WHITE;

    entity.billboard = undefined;
    entity.point = new PointGraphics({
      pixelSize: 12,
      color,
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      // Keep markers visible even when terrain would hide them.
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    entity.label = new LabelGraphics({
      text: entity.name ?? '',
      font: '14px sans-serif',
      fillColor: Color.WHITE,
      outlineColor: Color.BLACK,
      outlineWidth: 3,
      style: LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -12),
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
  }

  /** Info box: the title is entity.name; the body shows the name and description. */
  private setInfoBoxContent(entity: Entity, time: JulianDate): void {
    const description = entity.properties?.['description']?.getValue(time) as string | undefined;
    const name = entity.name ?? 'Unnamed feature';
    entity.description =
      `<h3>${escapeHtml(name)}</h3>` +
      (description ? `<p>${escapeHtml(description)}</p>` : '');
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
