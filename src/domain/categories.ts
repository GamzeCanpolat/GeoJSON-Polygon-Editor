import type { CategoryGroup, GeoFeature } from './contracts';

export const categoryKey = (name: string) => name.trim().normalize('NFC').toLocaleLowerCase('tr-TR');
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function featureCategories(feature: GeoFeature) {
  return {
    main: text(feature.properties?.ana_kategori) || text(feature.properties?.kategori),
    sub: text(feature.properties?.alt_kategori),
  };
}

export function assignCategories(feature: GeoFeature, main: string, sub: string): GeoFeature {
  const properties = { ...feature.properties };
  if (main.trim()) properties.ana_kategori = main.trim(); else delete properties.ana_kategori;
  if (main.trim() && sub.trim()) properties.alt_kategori = sub.trim(); else delete properties.alt_kategori;
  // Keep files using the earlier single-category field consistent.
  if (Object.hasOwn(properties, 'kategori')) {
    if (main.trim()) properties.kategori = main.trim(); else delete properties.kategori;
  }
  return { ...feature, properties };
}

/** The small taxonomy is indexed separately from potentially very large geometries. */
export class CategoryCatalog {
  private groups = new Map<string, { name: string; children: Map<string, string> }>();
  include(main: string, sub = '') {
    main = main.trim(); sub = sub.trim();
    if (!main) return;
    const key = categoryKey(main);
    let group = this.groups.get(key);
    if (!group) { group = { name: main, children: new Map() }; this.groups.set(key, group); }
    if (sub && !group.children.has(categoryKey(sub))) group.children.set(categoryKey(sub), sub);
  }
  includeFeature(feature: GeoFeature) { const { main, sub } = featureCategories(feature); this.include(main, sub); }
  import(value: unknown) {
    if (value === undefined) return;
    if (!Array.isArray(value)) throw new Error('category_catalog bir kategori dizisi olmalı.');
    for (const item of value) {
      if (!item || typeof item.name !== 'string' || !item.name.trim() || !Array.isArray(item.subcategories) || !item.subcategories.every((v: unknown) => typeof v === 'string' && v.trim())) {
        throw new Error('Kategori listesinde geçersiz bir ana kategori veya alt kategori var.');
      }
      this.include(item.name);
      for (const sub of item.subcategories) this.include(item.name, sub);
    }
  }
  add(name: string, parent?: string) {
    name = name.trim();
    if (!name) throw new Error('Kategori adı boş bırakılamaz.');
    if (name.length > 80) throw new Error('Kategori adı en fazla 80 karakter olabilir.');
    const key = categoryKey(name);
    if (parent !== undefined) {
      const group = this.groups.get(categoryKey(parent));
      if (!group) throw new Error('Alt kategori eklemek için geçerli bir ana kategori seçin.');
      if (group.children.has(key)) throw new Error('Bu ana kategoride aynı adlı bir alt kategori zaten var.');
      group.children.set(key, name);
    } else {
      if (this.groups.has(key)) throw new Error('Bu ana kategori zaten var.');
      this.include(name);
    }
  }
  list(): CategoryGroup[] {
    return [...this.groups.values()].map((group) => ({ name: group.name, subcategories: [...group.children.values()].sort((a, b) => a.localeCompare(b, 'tr')) })).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }
}
