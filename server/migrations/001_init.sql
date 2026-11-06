-- Initial schema: sites with PostGIS geometry, scenarios, machines with routes, simulation runs.
-- All geometry is WGS 84 longitude/latitude (SRID 4326), the same as GeoJSON.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE machine_type AS ENUM ('HAUL_TRUCK', 'EXCAVATOR', 'DOZER');
CREATE TYPE run_status AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE site_feature_kind AS ENUM ('haul_road', 'marker');

-- A physical site. The boundary is exactly one polygon.
CREATE TABLE site (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  boundary   geometry(Polygon, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Other mapped features of a site: haul roads (LineString) and markers (Point).
-- properties keeps the remaining GeoJSON properties (e.g. description).
CREATE TABLE site_feature (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    uuid NOT NULL REFERENCES site (id) ON DELETE CASCADE,
  kind       site_feature_kind NOT NULL,
  name       text NOT NULL,
  geom       geometry(Geometry, 4326) NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT site_feature_geom_matches_kind CHECK (
    (kind = 'haul_road' AND GeometryType(geom) = 'LINESTRING') OR
    (kind = 'marker' AND GeometryType(geom) = 'POINT')
  )
);
CREATE INDEX site_feature_site_id_idx ON site_feature (site_id);
CREATE INDEX site_feature_geom_idx ON site_feature USING gist (geom);

-- A what-if setup on a site. A site can't be deleted while scenarios use it.
CREATE TABLE scenario (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  site_id    uuid NOT NULL REFERENCES site (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scenario_site_id_idx ON scenario (site_id);

CREATE TABLE machine (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL REFERENCES scenario (id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        machine_type NOT NULL,
  speed_mps   double precision NOT NULL CHECK (speed_mps > 0)
);
CREATE INDEX machine_scenario_id_idx ON machine (scenario_id);

-- A machine's route as ordered points; (machine_id, seq) makes the order unambiguous.
CREATE TABLE machine_waypoint (
  machine_id uuid NOT NULL REFERENCES machine (id) ON DELETE CASCADE,
  seq        integer NOT NULL CHECK (seq >= 0),
  geom       geometry(Point, 4326) NOT NULL,
  PRIMARY KEY (machine_id, seq)
);

CREATE TABLE simulation_run (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id  uuid NOT NULL REFERENCES scenario (id) ON DELETE CASCADE,
  status       run_status NOT NULL DEFAULT 'PENDING',
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  duration_sec double precision CHECK (duration_sec >= 0),
  distance_m   double precision CHECK (distance_m >= 0),
  CONSTRAINT simulation_run_completed_has_results CHECK (
    status <> 'COMPLETED'
    OR (finished_at IS NOT NULL AND duration_sec IS NOT NULL AND distance_m IS NOT NULL)
  )
);
CREATE INDEX simulation_run_scenario_id_idx ON simulation_run (scenario_id);
