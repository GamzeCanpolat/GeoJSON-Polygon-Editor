import type { DatasetSummary, FeaturePage, FeatureRecord, GeoJsonRepository, ImportProgress, MutationRequest, MutationResult, RepositoryMethods, ViewportRequest, ViewportResult, WorkerReply } from '../../domain/contracts';
import type { CategoryGroup, CategoryMutationResult } from '../../domain/contracts';

export class WorkerGeoJsonRepository implements GeoJsonRepository {
  private worker = new Worker(new URL('./geojson.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; progress?: (p: ImportProgress) => void }>();
  constructor() {
    this.worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      const pending = this.pending.get(data.id); if (!pending) return;
      if (data.progress) { pending.progress?.(data.progress); return; }
      this.pending.delete(data.id);
      if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
    };
    this.worker.onerror = () => {
      for (const call of this.pending.values()) call.reject(new Error('Dosya işlemcisi durdu. Çalışmayı yeniden açın.'));
      this.pending.clear();
    };
  }
  private call<T>(method: RepositoryMethods, args: unknown[] = [], progress?: (p: ImportProgress) => void): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, progress });
      this.worker.postMessage({ id, method, args });
    });
  }
  async open(file: File, progress?: (p: ImportProgress) => void, signal?: AbortSignal) {
    if (signal?.aborted) throw new Error('Dosya açma iptal edildi.');
    const requestId = this.nextId;
    const cancel = () => this.worker.postMessage({ id: 0, method: 'cancel', args: [requestId] });
    signal?.addEventListener('abort', cancel, { once: true });
    try { return await this.call<DatasetSummary>('open', [file], progress); }
    finally { signal?.removeEventListener('abort', cancel); }
  }
  createEmpty() { return this.call<DatasetSummary>('createEmpty'); }
  query(request: ViewportRequest) { return this.call<ViewportResult>('query', [request]); }
  list(search: string, offset: number, limit: number) { return this.call<FeaturePage>('list', [search, offset, limit]); }
  get(id: string) { return this.call<FeatureRecord>('get', [id]); }
  mutate(request: MutationRequest) { return this.call<MutationResult>('mutate', [request]); }
  categories() { return this.call<CategoryGroup[]>('categories'); }
  addCategory(name: string, parent?: string) { return this.call<CategoryMutationResult>('addCategory', [name, parent]); }
  export(progress?: (p: ImportProgress) => void) { return this.call<Blob>('export', [], progress); }
  dispose() {
    this.worker.postMessage({ id: 0, method: 'dispose', args: [] });
    for (const call of this.pending.values()) call.reject(new Error('Çalışma kapatıldı.'));
    this.pending.clear();
  }
}
