import type { Geometry, Position } from 'geojson';
import type { GeoFeature } from './contracts';

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Structural checks only; topology/self-intersection checks belong to the validation service. */
export function validateFeature(input: unknown): GeoFeature {
  if (!object(input) || input.type !== 'Feature') throw new Error('Her kayıt GeoJSON Feature türünde olmalı.');
  if (input.properties !== null && !object(input.properties)) throw new Error('properties bir nesne veya null olmalı.');
  if (input.id !== undefined && typeof input.id !== 'string' && typeof input.id !== 'number') throw new Error('Feature id bir metin veya sayı olmalı.');
  validateGeometry(input.geometry);
  return input as unknown as GeoFeature;
}

function position(p: unknown): asserts p is Position {
  if (!Array.isArray(p) || p.length < 2 || !p.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error('Koordinatlar en az iki sonlu sayı içermeli.');
  }
  if (p[0] < -180 || p[0] > 180 || p[1] < -90 || p[1] > 90) {
    throw new Error('WGS84 koordinatları bekleniyor: boylam −180…180, enlem −90…90.');
  }
}

function line(v: unknown, ring = false) {
  if (!Array.isArray(v) || v.length < (ring ? 4 : 2)) throw new Error(ring ? 'Poligon halkası en az dört koordinat içermeli.' : 'Çizgi en az iki koordinat içermeli.');
  v.forEach(position);
  if (ring && (v[0].length !== v[v.length - 1].length || v[0].some((n: number, i: number) => n !== v[v.length - 1][i]))) {
    throw new Error('Poligon halkasının ilk ve son koordinatı aynı olmalı.');
  }
}
function array(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new Error('Geometri koordinatları bir dizi olmalı.');
  return v;
}
export function validateGeometry(g: unknown): asserts g is Geometry | null {
  if (g === null) return;
  if (!object(g)) throw new Error('Geçerli bir GeoJSON geometrisi bekleniyor.');
  switch (g.type) {
    case 'Point': position(g.coordinates); break;
    case 'MultiPoint': array(g.coordinates).forEach(position); break;
    case 'LineString': line(g.coordinates); break;
    case 'MultiLineString': array(g.coordinates).forEach((l) => line(l)); break;
    case 'Polygon': array(g.coordinates).forEach((r) => line(r, true)); break;
    case 'MultiPolygon': array(g.coordinates).forEach((p) => array(p).forEach((r) => line(r, true))); break;
    case 'GeometryCollection': array(g.geometries).forEach(validateGeometry); break;
    default: throw new Error(`Desteklenmeyen geometri türü: ${String(g.type)}`);
  }
}
