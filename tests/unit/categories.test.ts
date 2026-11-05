import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { assignCategories, CategoryCatalog, featureCategories } from '../../src/domain/categories';
import { LocalEngine } from '../../src/adapters/local/localEngine';
import type { GeoFeature } from '../../src/domain/contracts';

const feature: GeoFeature = { type: 'Feature', id: 'park-1', properties: { name: 'Test alanı', kategori: 'Arazi', alt_kategori: 'Park', not: 'Korunacak öznitelik' }, geometry: { type: 'Point', coordinates: [37,39] } };
let engine: LocalEngine | null = null;
afterEach(() => { engine?.dispose(); engine = null; });

describe('category hierarchy', () => {
  it('rejects blank/duplicate names and missing parents; scopes children by parent', () => {
    const catalog = new CategoryCatalog();
    catalog.add('  İmar  '); catalog.add('Park', 'İmar'); catalog.add('Çevre'); catalog.add('Park', 'Çevre');
    expect(() => catalog.add('imar')).toThrow('zaten');
    expect(() => catalog.add('park', 'İmar')).toThrow('zaten');
    expect(() => catalog.add(' ')).toThrow('boş');
    expect(() => catalog.add('Alt', 'Bulunmayan')).toThrow('geçerli');
    expect(catalog.list().find((g) => g.name === 'İmar')?.subcategories).toEqual(['Park']);
  });
  it('preserves unrelated properties, synchronizes legacy categories and clears the old child', () => {
    const updated = assignCategories(feature, 'Eğitim', '');
    expect(featureCategories(updated)).toEqual({ main: 'Eğitim', sub: '' });
    expect(updated.properties).toEqual({ name: 'Test alanı', kategori: 'Eğitim', ana_kategori: 'Eğitim', not: 'Korunacak öznitelik' });
    expect(feature.properties?.alt_kategori).toBe('Park');
    expect(featureCategories(assignCategories(updated, '', 'Eski alt'))).toEqual({ main: '', sub: '' });
  });
  it('discovers imported categories and preserves assignments and unused definitions on export/reopen', async () => {
    engine = new LocalEngine();
    await engine.open(new File([JSON.stringify({ type: 'FeatureCollection', features: [feature] })], 'categories.geojson'));
    expect(await engine.categories()).toEqual([{ name: 'Arazi', subcategories: ['Park'] }]);
    await engine.addCategory('Ulaşım'); await engine.addCategory('Yol', 'Ulaşım');
    await engine.addCategory('Henüz kullanılmayan');
    const record = (await engine.list('', 0, 1)).items[0];
    await engine.mutate({ id: record.id, feature: assignCategories(feature, 'Ulaşım', 'Yol') });
    const exported = await engine.export();
    const json = JSON.parse(await exported.text());
    expect(json.features[0].properties.ana_kategori).toBe('Ulaşım');
    expect(json.features[0].properties.alt_kategori).toBe('Yol');
    expect(json.features[0].id).toBe('park-1');
    await engine.open(new File([exported], 'reopened.geojson'));
    expect(await engine.categories()).toEqual(json.category_catalog);
    expect((await engine.get((await engine.list('', 0, 1)).items[0].id)).feature).toEqual(json.features[0]);
  });
  it('keeps the old data/catalog when imported category metadata is invalid', async () => {
    engine = new LocalEngine(); await engine.createEmpty(); await engine.addCategory('Mevcut');
    const invalid = new File([JSON.stringify({ type: 'FeatureCollection', features: [feature], category_catalog: [{ name: 'Bozuk', subcategories: false }] })], 'invalid.geojson');
    await expect(engine.open(invalid)).rejects.toThrow('Kategori');
    expect(await engine.categories()).toEqual([{ name: 'Mevcut', subcategories: [] }]);
    expect((await engine.list('', 0, 10)).total).toBe(0);
  });
});
