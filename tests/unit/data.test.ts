import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { streamGeoJson } from '../../src/adapters/local/streamGeoJson';
import { LocalEngine } from '../../src/adapters/local/localEngine';
import { simplifyGeometry, validateFeature } from '../../src/adapters/local/geometry';
import type { GeoFeature } from '../../src/domain/contracts';

const polygon = (i = 0): GeoFeature => ({ type: 'Feature', id: i, properties: { name: `Alan ${i}`, nested: { text: 'Şırnak 🌍 "köşe"' } }, geometry: { type: 'Polygon', coordinates: [[[37+i*.001,39],[37.0005+i*.001,39],[37.0005+i*.001,39.0005],[37+i*.001,39.0005],[37+i*.001,39]]] } });
const file = (features: GeoFeature[], name = 'test.geojson') => new File([JSON.stringify({ type: 'FeatureCollection', features })], name);
let engine: LocalEngine | null = null;
afterEach(() => { engine?.dispose(); engine = null; });

describe('streaming GeoJSON reader', () => {
  it('reads collections across chunks, including nested properties and UTF-8', async () => {
    const features = Array.from({ length: 2500 }, (_, i) => polygon(i));
    const received: GeoFeature[] = [];
    await streamGeoJson(file(features), async (batch) => { received.push(...batch); });
    expect(received).toEqual(features);
  });
  it('accepts an empty collection, a single Feature and a bare geometry', async () => {
    const received: GeoFeature[] = [];
    expect(await streamGeoJson(file([]), async () => {})).toBe(0);
    await streamGeoJson(new Blob([JSON.stringify(polygon())]), async (batch) => { received.push(...batch); });
    await streamGeoJson(new Blob([JSON.stringify(polygon().geometry)]), async (batch) => { received.push(...batch); });
    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(polygon());
  });
  it('rejects malformed/truncated JSON, non-GeoJSON and an unclosed ring', async () => {
    await expect(streamGeoJson(new Blob(['{"type":"FeatureCollection","features":[']), async () => {})).rejects.toThrow();
    await expect(streamGeoJson(new Blob(['{"type":"FeatureCollection"}']), async () => {})).rejects.toThrow();
    const invalid = polygon(); if (invalid.geometry?.type === 'Polygon') invalid.geometry.coordinates[0].pop();
    await expect(streamGeoJson(file([invalid]), async () => {})).rejects.toThrow('ilk ve son');
  });
  it('can cancel without reading the whole input', async () => {
    let stopped = false;
    await expect(streamGeoJson(file(Array.from({ length: 3000 }, (_, i) => polygon(i))), async () => { stopped = true; }, undefined, () => stopped)).rejects.toThrow('iptal');
  });
  it('rejects a special prototype key instead of silently losing an attribute', async () => {
    const input = '{"type":"Feature","properties":{"__proto__":{"name":"wrong"}},"geometry":null}';
    await expect(streamGeoJson(new Blob([input]), async () => {})).rejects.toThrow('__proto__');
    const ordinaryValue = '{"type":"Feature","properties":{"name":"__proto__"},"geometry":null}';
    expect(await streamGeoJson(new Blob([ordinaryValue]), async () => {})).toBe(1);
  });
});

describe('repository integration', () => {
  it('preserves original IDs/properties/coordinates through import, edit and export', async () => {
    engine = new LocalEngine();
    await engine.open(file([polygon(1), polygon(2)]));
    const page = await engine.list('', 0, 50);
    const record = await engine.get(page.items[0].id);
    expect(record.feature).toEqual(polygon(1));
    const edited = structuredClone(record.feature); edited.properties!.name = 'Düzenlendi'; edited.bbox = [0,0,1,1];
    if (edited.geometry?.type === 'Polygon') edited.geometry.coordinates[0][1][0] += .0001;
    await engine.mutate({ id: record.summary.id, feature: edited });
    const output = JSON.parse(await (await engine.export()).text());
    expect(output.features[0].id).toBe(1);
    expect(output.features[0].properties.name).toBe('Düzenlendi');
    expect(output.features[0].bbox).toBeUndefined();
    expect(output.features[0].geometry).toEqual(edited.geometry);
    expect(output.features[1]).toEqual(polygon(2));
  });
  it('keeps the active dataset after a failed or cancelled import', async () => {
    engine = new LocalEngine(); await engine.open(file([polygon(5)]));
    await expect(engine.open(new File(['invalid'], 'bad.json'))).rejects.toThrow();
    expect((await engine.list('', 0, 10)).items[0].label).toBe('Alan 5');
    await expect(engine.open(file(Array.from({ length: 3000 }, (_, i) => polygon(i))), () => engine!.cancel())).rejects.toThrow('iptal');
    expect((await engine.list('', 0, 10)).items[0].label).toBe('Alan 5');
  });
  it('rejects an invalid update without deleting the existing feature', async () => {
    engine = new LocalEngine(); await engine.open(file([polygon()]));
    const id = (await engine.list('', 0, 1)).items[0].id;
    await expect(engine.mutate({ id, feature: false as unknown as GeoFeature })).rejects.toThrow();
    expect((await engine.get(id)).feature).toEqual(polygon());
  });
  it('caps viewport results while exporting all features, and supports delete/restore', async () => {
    engine = new LocalEngine(); await engine.open(file(Array.from({ length: 5000 }, (_, i) => polygon(i))));
    const viewport = await engine.query({ bounds: [-180,-90,180,90], tolerance: .001, limit: 100 });
    expect(viewport.records).toHaveLength(100); expect(viewport.matched).toBe(5000); expect(viewport.limited).toBe(true);
    const record = await engine.get(viewport.records[0].summary.id);
    await engine.mutate({ id: record.summary.id, feature: null });
    expect((await engine.list('', 0, 10)).total).toBe(4999);
    await engine.mutate({ id: record.summary.id, feature: record.feature });
    const output = JSON.parse(await (await engine.export()).text());
    expect(output.features).toHaveLength(5000);
    expect(output.features.map((f: GeoFeature) => f.id)).toEqual(Array.from({ length: 5000 }, (_, i) => i));
  });
  it('handles duplicate external IDs, null geometry, geometry collections and Z coordinates', async () => {
    engine = new LocalEngine();
    const features: GeoFeature[] = [polygon(), polygon(), { type: 'Feature', properties: null, geometry: null }, { type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [37,39,123] }, { type: 'LineString', coordinates: [[37,39,10], [37.1,39.1,20]] }] } }];
    await engine.open(file(features));
    const page = await engine.list('', 0, 50);
    expect(new Set(page.items.map((x) => x.id)).size).toBe(4);
    expect(JSON.parse(await (await engine.export()).text()).features).toEqual(features);
    expect((await engine.query({ bounds: [-180,-90,180,90], tolerance: 0, limit: 100 })).matched).toBe(3);
  });
});

describe('geometry safeguards', () => {
  it('rejects projected/non-finite positions and does not change source geometry for previews', () => {
    expect(() => validateFeature({ ...polygon(), geometry: { type: 'Point', coordinates: [37000,39000] } })).toThrow('WGS84');
    const g = { type: 'Polygon' as const, coordinates: [Array.from({ length: 1001 }, (_, i) => [37+Math.cos(i/1000*Math.PI*2)*.001, 39+Math.sin(i/1000*Math.PI*2)*.001])] };
    g.coordinates[0][1000] = [...g.coordinates[0][0]];
    const original = structuredClone(g);
    const preview = simplifyGeometry(g, .0001);
    expect(g).toEqual(original); expect(preview).not.toEqual(g);
  });
});
