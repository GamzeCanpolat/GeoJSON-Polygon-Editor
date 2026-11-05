import type { Feature, Geometry, GeoJsonProperties } from 'geojson';

export type GeoFeature = Feature<Geometry | null, GeoJsonProperties>;
export type Bounds = [number, number, number, number];
export interface CategoryGroup { name: string; subcategories: string[] }
export interface CategoryMutationResult { catalog: CategoryGroup[]; dataset: DatasetSummary }
export interface FeatureSummary {
  id: string;
  label: string;
  geometryType: string;
  vertices: number;
  bounds: Bounds | null;
}
export interface FeatureRecord {
  summary: FeatureSummary;
  feature: GeoFeature;
}
export interface DatasetSummary {
  name: string;
  count: number;
  vertices: number;
  bounds: Bounds | null;
  sourceBytes: number;
  revision: number;
}
export interface ImportProgress {
  bytesRead: number;
  totalBytes: number;
  featuresRead: number;
}
export interface ViewportRequest {
  bounds: Bounds;
  tolerance: number;
  limit: number;
}
export interface ViewportResult {
  records: FeatureRecord[];
  matched: number;
  limited: boolean;
}
export interface FeaturePage {
  items: FeatureSummary[];
  total: number;
}
export interface MutationRequest {
  id?: string;
  feature: GeoFeature | null;
}
export interface MutationResult {
  id: string;
  record: FeatureRecord | null;
  dataset: DatasetSummary;
}

/** The UI only talks to this port. Replace the local adapter to integrate a backend. */
export interface GeoJsonRepository {
  open(file: File, onProgress?: (progress: ImportProgress) => void, signal?: AbortSignal): Promise<DatasetSummary>;
  createEmpty(): Promise<DatasetSummary>;
  query(request: ViewportRequest): Promise<ViewportResult>;
  list(search: string, offset: number, limit: number): Promise<FeaturePage>;
  get(id: string): Promise<FeatureRecord>;
  mutate(request: MutationRequest): Promise<MutationResult>;
  categories(): Promise<CategoryGroup[]>;
  addCategory(name: string, parent?: string): Promise<CategoryMutationResult>;
  export(onProgress?: (progress: ImportProgress) => void): Promise<Blob>;
  dispose(): void;
}

export type RepositoryMethods = 'open' | 'createEmpty' | 'query' | 'list' | 'get' | 'mutate' | 'categories' | 'addCategory' | 'export';
export interface WorkerRequest { id: number; method: RepositoryMethods | 'cancel' | 'dispose'; args: unknown[] }
export interface WorkerReply { id: number; result?: unknown; error?: string; progress?: ImportProgress }
