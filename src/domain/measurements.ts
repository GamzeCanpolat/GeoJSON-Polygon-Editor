import type { Geometry, Position } from 'geojson';
import MultiLineString from 'ol/geom/MultiLineString';
import Polygon from 'ol/geom/Polygon';
import { getArea, getLength } from 'ol/sphere';

const geographic = { projection: 'EPSG:4326' };

// Interpret each edge by its shorter path across the antimeridian.
function unwrapRing(ring: Position[]): Position[] {
  let previous = ring[0][0];
  return ring.map(([lon, lat]) => {
    const delta = ((lon - previous + 180) % 360 + 360) % 360 - 180;
    previous += delta;
    return [previous, lat];
  });
}

export function measureGeometry(geometry: Geometry | null | undefined) {
  if (geometry?.type === 'LineString' || geometry?.type === 'MultiLineString') {
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    return { kind: 'line' as const, length: getLength(new MultiLineString(lines), geographic) };
  }
  if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') return null;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let area = 0, perimeter = 0;
  for (const rings of polygons) {
    if (!rings.length) continue;
    const polygon = new Polygon(rings.map(unwrapRing));
    area += Math.max(0, getArea(polygon, geographic));
    perimeter += getLength(polygon, geographic);
  }
  return { kind: 'polygon' as const, area, perimeter };
}
