import type { Geometry, Position } from 'geojson';
import type { Bounds, FeatureRecord, GeoFeature } from '../../domain/contracts';

export { validateFeature, validateGeometry } from '../../domain/geoJsonValidation';

export function describe(id: string, feature: GeoFeature): FeatureRecord {
  let vertices = 0;
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c: unknown) => {
    if (!Array.isArray(c) || !c.length) return;
    if (typeof c[0] === 'number') {
      vertices++;
      bounds[0] = Math.min(bounds[0], c[0]); bounds[1] = Math.min(bounds[1], c[1]);
      bounds[2] = Math.max(bounds[2], c[0]); bounds[3] = Math.max(bounds[3], c[1]);
    } else c.forEach(walk);
  };
  const visit = (g: Geometry | null) => {
    if (!g) return;
    if (g.type === 'GeometryCollection') g.geometries.forEach(visit);
    else walk(g.coordinates);
  };
  visit(feature.geometry);
  const props = feature.properties;
  const label = props?.name ?? props?.ad ?? props?.title ?? props?.NAME ?? feature.id ?? `Şekil ${Number(id.split(':').at(-1)) + 1}`;
  return { feature, summary: { id, label: String(label).slice(0, 160), geometryType: feature.geometry?.type ?? 'Geometri yok', vertices, bounds: vertices ? bounds : null } };
}

/** Display-only simplification. Never write the preview back to storage or export it. */
function simplifyLine(points: Position[], tolerance: number, ring = false): Position[] {
  if (points.length < 12 || tolerance <= 0) return points;
  const sq = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const a = points[first], b = points[last];
    let max = sq, index = 0;
    for (let i = first + 1; i < last; i++) {
      const p = points[i], dx = b[0] - a[0], dy = b[1] - a[1];
      const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
      const d = (p[0] - a[0] - dx * t) ** 2 + (p[1] - a[1] - dy * t) ** 2;
      if (d > max) { max = d; index = i; }
    }
    if (index) { keep[index] = 1; stack.push([first, index], [index, last]); }
  }
  const result = points.filter((_, i) => keep[i]);
  return result.length >= (ring ? 4 : 2) ? result : points;
}
export function simplifyGeometry(g: Geometry | null, tolerance: number): Geometry | null {
  if (!g) return null;
  switch (g.type) {
    case 'LineString': return { ...g, coordinates: simplifyLine(g.coordinates, tolerance) };
    case 'MultiLineString': return { ...g, coordinates: g.coordinates.map((l) => simplifyLine(l, tolerance)) };
    case 'Polygon': return { ...g, coordinates: g.coordinates.map((r) => simplifyLine(r, tolerance, true)) };
    case 'MultiPolygon': return { ...g, coordinates: g.coordinates.map((p) => p.map((r) => simplifyLine(r, tolerance, true))) };
    case 'GeometryCollection': return { ...g, geometries: g.geometries.map((x) => simplifyGeometry(x, tolerance)!) };
    default: return g;
  }
}
