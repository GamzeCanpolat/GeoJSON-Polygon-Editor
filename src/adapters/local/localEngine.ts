import RBush from 'rbush';
import type { DatasetSummary, FeaturePage, FeatureRecord, FeatureSummary, GeoFeature, ImportProgress, MutationRequest, MutationResult, ViewportRequest, ViewportResult } from '../../domain/contracts';
import { describe, simplifyGeometry, validateFeature } from './geometry';
import { LocalDatabase, type StoredRecord } from './localDatabase';
import { streamGeoJson } from './streamGeoJson';
import { CategoryCatalog } from '../../domain/categories';

interface IndexItem { minX: number; minY: number; maxX: number; maxY: number; ordinal: number }
interface Dataset {
  id: string;
  meta: DatasetSummary;
  entries: Map<number, FeatureSummary>;
  tree: RBush<IndexItem>;
  next: number;
  catalog: CategoryCatalog;
}
const blank = (name: string, sourceBytes = 0): Dataset => ({
  id: crypto.randomUUID(), meta: { name, sourceBytes, count: 0, vertices: 0, bounds: null, revision: 0 },
  entries: new Map(), tree: new RBush(), next: 0, catalog: new CategoryCatalog(),
});
const indexItem = (ordinal: number, summary: FeatureSummary): IndexItem | null => summary.bounds ? ({ minX: summary.bounds[0], minY: summary.bounds[1], maxX: summary.bounds[2], maxY: summary.bounds[3], ordinal }) : null;

/** Browser-only adapter. Geometry lives in IndexedDB; only summaries/index stay in memory. */
export class LocalEngine {
  private db = new LocalDatabase();
  private ready = this.db.connect();
  private active = blank('Adsız çalışma.geojson');
  private cancelRequested = false;
  cancel() { this.cancelRequested = true; }
  private summarize(dataset: Dataset): DatasetSummary {
    const root = dataset.tree.toJSON();
    dataset.meta.count = dataset.entries.size;
    dataset.meta.bounds = Number.isFinite(root.minX) ? [root.minX, root.minY, root.maxX, root.maxY] : null;
    return { ...dataset.meta };
  }
  async createEmpty() {
    await this.ready;
    const old = this.active;
    this.active = blank('Adsız çalışma.geojson');
    await this.db.removeDataset(old.id).catch(() => {});
    return this.summarize(this.active);
  }
  async open(file: File, onProgress: (p: ImportProgress) => void = () => {}) {
    await this.ready;
    this.cancelRequested = false;
    const next = blank(file.name, file.size);
    try {
      await streamGeoJson(file, async (features) => {
        const records: StoredRecord[] = [], items: IndexItem[] = [];
        for (const feature of features) {
          const ordinal = next.next++;
          const record = describe(`${next.id}:${ordinal}`, feature);
          next.catalog.includeFeature(feature);
          next.entries.set(ordinal, record.summary);
          next.meta.vertices += record.summary.vertices;
          const item = indexItem(ordinal, record.summary); if (item) items.push(item);
          records.push({ ...record, dataset: next.id, ordinal });
        }
        await this.db.put(records);
        next.tree.load(items);
      }, onProgress, () => this.cancelRequested, (root) => next.catalog.import(root.category_catalog));
      if (this.cancelRequested) throw new Error('Dosya açma iptal edildi.');
      const old = this.active;
      this.active = next;
      // Cleanup of the previous temporary workspace must not roll back a committed import.
      await this.db.removeDataset(old.id).catch(() => {});
      return this.summarize(next);
    } catch (error) {
      await this.db.removeDataset(next.id);
      throw error;
    }
  }
  async query(request: ViewportRequest): Promise<ViewportResult> {
    await this.ready;
    const [minX, minY, maxX, maxY] = request.bounds;
    const items = this.active.tree.search({ minX, minY, maxX, maxY });
    const limit = Math.min(Math.max(1, request.limit), 3000);
    const records = await this.db.getMany(this.active.id, items.slice(0, limit).map((item) => item.ordinal));
    return {
      matched: items.length, limited: items.length > limit,
      records: records.map(({ summary, feature }) => ({ summary, feature: { ...feature, geometry: simplifyGeometry(feature.geometry, request.tolerance) } })),
    };
  }
  async list(search: string, offset: number, limit: number): Promise<FeaturePage> {
    const query = search.trim().toLocaleLowerCase('tr-TR');
    const items: FeatureSummary[] = [];
    let total = 0;
    for (const summary of this.active.entries.values()) {
      if (query && !`${summary.label} ${summary.geometryType}`.toLocaleLowerCase('tr-TR').includes(query)) continue;
      if (total >= offset && items.length < Math.min(limit, 100)) items.push(summary);
      total++;
    }
    return { items, total };
  }
  private ordinal(id: string) {
    if (!id.startsWith(`${this.active.id}:`)) throw new Error('Bu şekil etkin çalışmaya ait değil.');
    const value = Number(id.slice(this.active.id.length + 1));
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Geçersiz şekil kimliği.');
    return value;
  }
  async categories() { return this.active.catalog.list(); }
  async addCategory(name: string, parent?: string) {
    this.active.catalog.add(name, parent);
    this.active.meta.revision++;
    return { catalog: this.active.catalog.list(), dataset: this.summarize(this.active) };
  }
  async get(id: string): Promise<FeatureRecord> {
    await this.ready;
    const { summary, feature } = await this.db.get(this.active.id, this.ordinal(id));
    return { summary, feature };
  }
  async mutate(request: MutationRequest): Promise<MutationResult> {
    await this.ready;
    const data = this.active;
    const ordinal = request.id ? this.ordinal(request.id) : data.next;
    const id = `${data.id}:${ordinal}`;
    const previous = data.entries.get(ordinal);
    if (!request.id && request.feature === null) throw new Error('Silme işlemi için bir şekil kimliği gerekli.');
    const feature = request.feature === null ? null : validateFeature(request.feature);
    let record: FeatureRecord | null = null;
    if (feature) {
      // GeoJSON bbox is derived metadata; remove stale boxes after geometry edits.
      const clean = structuredClone(feature);
      delete clean.bbox;
      const cleanBoxes = (g: GeoFeature['geometry']) => {
        if (!g) return;
        delete g.bbox;
        if (g.type === 'GeometryCollection') g.geometries.forEach(cleanBoxes);
      };
      cleanBoxes(clean.geometry);
      record = describe(id, clean);
      await this.db.put([{ ...record, dataset: data.id, ordinal }]);
    } else await this.db.remove(data.id, ordinal);
    if (previous) {
      const oldItem = indexItem(ordinal, previous);
      if (oldItem) data.tree.remove(oldItem, (a, b) => a.ordinal === b.ordinal);
      data.meta.vertices -= previous.vertices;
    }
    if (record) {
      data.catalog.includeFeature(record.feature);
      data.entries.set(ordinal, record.summary);
      data.meta.vertices += record.summary.vertices;
      const item = indexItem(ordinal, record.summary); if (item) data.tree.insert(item);
      data.next = Math.max(data.next, ordinal + 1);
    } else data.entries.delete(ordinal);
    data.meta.revision++;
    return { id, record, dataset: this.summarize(data) };
  }
  async export(onProgress: (p: ImportProgress) => void = () => {}): Promise<Blob> {
    await this.ready;
    // Blob parts avoid one giant JSON string and never touch the UI thread.
    const catalog = this.active.catalog.list();
    const parts: BlobPart[] = [`{"type":"FeatureCollection",${catalog.length ? `"category_catalog":${JSON.stringify(catalog)},` : ''}"features":[`];
    const ordinals = [...this.active.entries.keys()].sort((a, b) => a - b);
    let first = true;
    for (let offset = 0; offset < ordinals.length; offset += 200) {
      const batch = await this.db.getMany(this.active.id, ordinals.slice(offset, offset + 200));
      const chunk = batch.map(({ feature }) => JSON.stringify(feature)).join(',');
      parts.push(new Blob([`${first ? '' : ','}${chunk}`])); first = false;
      onProgress({ bytesRead: Math.min(offset + 200, ordinals.length), totalBytes: ordinals.length, featuresRead: Math.min(offset + 200, ordinals.length) });
    }
    parts.push(']}');
    return new Blob(parts, { type: 'application/geo+json' });
  }
  dispose() { this.db.dispose(); }
}
