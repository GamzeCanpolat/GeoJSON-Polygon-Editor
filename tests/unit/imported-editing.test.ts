import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import Polygon from 'ol/geom/Polygon';
import MultiPolygon from 'ol/geom/MultiPolygon';
import { fromLonLat } from 'ol/proj';
import { LocalEngine } from '../../src/adapters/local/localEngine';
import { readEditableFeature, writeEditedFeature } from '../../src/map/featureGeometry';
import type { GeoFeature } from '../../src/domain/contracts';

let engine: LocalEngine | null = null;
afterEach(() => { engine?.dispose(); engine = null; });

it.each(['Polygon', 'MultiPolygon'] as const)('edits an imported %s in map projection and exports original IDs, holes and attributes', async (type) => {
  const rings = [
    [[37,39,100],[37.02,39,101],[37.02,39.02,102],[37,39.02,103],[37,39,100]],
    [[37.005,39.005,110],[37.01,39.005,111],[37.01,39.01,112],[37.005,39.005,110]],
  ];
  const feature: GeoFeature = {
    type: 'Feature', id: 'external-original-id',
    properties: { name: 'Dışarıdan yüklenen alan', ana_kategori: 'Arazi', alt_kategori: 'Park', custom: { keep: true } },
    geometry: type === 'Polygon' ? { type, coordinates: rings } : { type, coordinates: [rings, [[[37.03,39.03,100],[37.04,39.03,100],[37.04,39.04,100],[37.03,39.03,100]]]] },
  };
  engine = new LocalEngine();
  await engine.open(new File([JSON.stringify({ type: 'FeatureCollection', features: [feature] })], 'imported.json'));
  const record = await engine.get((await engine.list('', 0, 1)).items[0].id);
  const editable = readEditableFeature(record);
  expect(editable.getId()).not.toBe(feature.id);
  const geometry = editable.getGeometry() as Polygon | MultiPolygon;
  // The same geometry bridge is used by OpenLayers Modify/Translate in the UI.
  if (geometry instanceof Polygon) {
    const coords = geometry.getCoordinates(); coords[0][1] = fromLonLat([37.025,39.001,101]); geometry.setCoordinates(coords);
  } else {
    const coords = geometry.getCoordinates(); coords[0][0][1] = fromLonLat([37.025,39.001,101]); geometry.setCoordinates(coords);
  }
  await engine.mutate({ id: record.summary.id, feature: writeEditedFeature(record, geometry) });
  const output = JSON.parse(await (await engine.export()).text()).features[0] as GeoFeature;
  expect(output.id).toBe(feature.id);
  expect(output.properties).toEqual(feature.properties);
  expect(output.geometry?.type).toBe(type);
  const editedRings = output.geometry!.type === 'Polygon' ? output.geometry!.coordinates : (output.geometry as import('geojson').MultiPolygon).coordinates[0];
  expect(editedRings[0][1][0]).toBeCloseTo(37.025, 7);
  expect(editedRings[0][1][1]).toBeCloseTo(39.001, 7);
  expect(editedRings[0][1][2]).toBe(101);
  expect(editedRings[1]).toHaveLength(rings[1].length);
  for (let i = 0; i < rings[1].length; i++) {
    expect(editedRings[1][i][0]).toBeCloseTo(rings[1][i][0], 7);
    expect(editedRings[1][i][1]).toBeCloseTo(rings[1][i][1], 7);
    expect(editedRings[1][i][2]).toBe(rings[1][i][2]);
  }
  if (output.geometry!.type === 'MultiPolygon') expect(output.geometry!.coordinates).toHaveLength(2);
});
