import { JSONParser } from '@streamparser/json';
import { ApiProjectRepository } from './ApiProjectRepository';
import type { ProjectRepository, ProjectWorkspace as Workspace } from '../../domain/projects';
import type { GeoJsonRepository, DatasetSummary, FeatureRecord, FeaturePage, MutationRequest, MutationResult, CategoryGroup, CategoryMutationResult, ViewportRequest, ViewportResult, ImportProgress } from '../../domain/contracts';

interface State { expectedDatasetId: string; expectedGenerationId: string; expectedRevision: number }
interface Job { id: string; status: string; processedBytes: number; totalBytes: number; processedFeatures: number; error: string | null; initialDatasetId: string; initialGenerationId: string; initialRevision: number; activatedAt?: string | null; stagingDatasetId?: string | null }
export interface ApiRepositoryOptions { baseUrl?: string; fetch?: typeof fetch; pollIntervalMs?: number }

export class RepositoryHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'RepositoryHttpError'; }
}
const aborted = () => new Error('İşlem iptal edildi veya çalışma kapatıldı.');

/** Independent adapter. Construction performs no network request; all work is FIFO. */
export class ApiGeoJsonRepository implements GeoJsonRepository {
  private readonly base: string;
  private readonly transport: typeof fetch;
  private readonly interval: number;
  private tail: Promise<unknown> = Promise.resolve();
  private workspace?: Workspace;
  private closed = false;
  private readonly lifetime = new AbortController();
  private readonly pins = new Map<string, State>();
  private workspaceEpoch = 0;
  readonly projects: ProjectRepository;
  constructor(options: ApiRepositoryOptions = {}) {
    this.base = (options.baseUrl ?? 'http://127.0.0.1:8000/api/v1').replace(/\/$/, '');
    this.transport = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.interval = options.pollIntervalMs ?? 250;
    if (!Number.isFinite(this.interval) || this.interval < 0) throw new Error('Geçersiz job takip aralığı.');
    this.projects = new ApiProjectRepository(task => this.queue(() => task({
      current: () => this.workspace ? structuredClone(this.workspace) : null,
      ready: async () => structuredClone(await this.ready()),
      json: <T>(path: string, method?: string, body?: unknown) => this.json<T>(path, method, body).then(result => { this.check(); return result; }),
      remove: async path => { await this.request(path, { method: 'DELETE' }); this.check(); },
      switchWorkspace: workspace => {
        this.check(); this.workspace = structuredClone(workspace); this.pins.clear(); this.workspaceEpoch++;
      },
      linkProject: id => { this.check(); if (this.workspace) this.workspace.projectId = id; },
    })));
  }
  private check(signal?: AbortSignal) { if (this.closed || signal?.aborted) throw aborted(); }
  private queue<T>(task: () => Promise<T>): Promise<T> {
    const epoch = this.workspaceEpoch;
    const operation = this.tail.then(() => {
      this.check();
      if (epoch !== this.workspaceEpoch) throw new Error('Çalışma alanı değişti. Güncel çalışmayı yeniden okuyun.');
      return task();
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  private async request(path: string, init: RequestInit = {}, signal = this.lifetime.signal): Promise<Response> {
    let response: Response;
    try { response = await this.transport(this.base + path, { ...init, signal }); }
    catch { if (signal.aborted) throw aborted(); throw new Error('Sunucuya ulaşılamadı. Bağlantıyı kontrol edin; yazma işleminin sonucu belirsiz olabilir.'); }
    if (!response.ok) {
      let message = `Sunucu isteği başarısız (HTTP ${response.status}).`;
      try {
        const body: unknown = await response.json();
        const detail = (body as { detail?: unknown })?.detail;
        if (typeof detail === 'string') message = detail;
        else if (Array.isArray(detail)) message = detail.map(item => typeof item?.msg === 'string' ? item.msg : 'Geçersiz istek').join('; ');
      } catch { /* A non-JSON proxy error still has a useful HTTP status. */ }
      throw new RepositoryHttpError(response.status, message);
    }
    return response;
  }
  private async json<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await this.request(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }, signal);
    try { return await response.json() as T; } catch { throw new Error('Sunucu yanıtı okunamadı; yazma işleminin sonucu belirsiz olabilir.'); }
  }
  private async ready() {
    if (!this.workspace) { const w = await this.json<Workspace>('/workspaces', 'POST'); this.check(); this.workspace = w; }
    return this.workspace;
  }
  private path(w: Workspace, suffix = '') { return `/workspaces/${encodeURIComponent(w.id)}${suffix}`; }
  private state(w: Workspace): State { return { expectedDatasetId: w.activeDatasetId, expectedGenerationId: w.generationId, expectedRevision: w.dataset.revision }; }
  private emit(callback: ((p: ImportProgress) => void) | undefined, progress: ImportProgress) { try { callback?.(progress); } catch { /* UI observer exceptions cannot change committed server outcomes. */ } }
  private async read<T>(suffix: string): Promise<T> {
    const w = await this.ready();
    const response = await this.request(this.path(w, suffix));
    const result = await response.json() as T;
    this.check();
    const dataset = response.headers.get('X-Dataset-Id'), generation = response.headers.get('X-Generation-Id'), revision = response.headers.get('X-Dataset-Revision');
    if (dataset && generation && revision !== null && Number.isSafeInteger(Number(revision))) {
      w.activeDatasetId = dataset; w.generationId = generation; w.dataset = { ...w.dataset, revision: Number(revision) };
    }
    return result;
  }
  createEmpty() { return this.queue(async () => {
    if (!this.workspace) return (await this.ready()).dataset;
    const w = this.workspace;
    const next = await this.json<Workspace>(this.path(w, '/empty'), 'POST', this.state(w));
    this.check(); this.workspace = next; this.pins.clear(); return next.dataset;
  }); }
  query(request: ViewportRequest) { return this.queue(() => {
    const params = new URLSearchParams(); request.bounds.forEach(value => params.append('bounds', String(value)));
    params.set('tolerance', String(request.tolerance)); params.set('limit', String(request.limit));
    return this.read<ViewportResult>('/viewport?' + params);
  }); }
  list(search: string, offset: number, limit: number) { return this.queue(() => this.read<FeaturePage>('/features?' + new URLSearchParams({ search, offset: String(offset), limit: String(limit) }))); }
  get(id: string) { return this.queue(async () => {
    const record = await this.read<FeatureRecord>('/features/' + encodeURIComponent(id));
    this.pins.set(id, this.state(this.workspace!)); return record;
  }); }
  mutate(request: MutationRequest) { return this.queue(async () => {
    const w = await this.ready();
    const result = await this.json<MutationResult>(this.path(w, '/mutations'), 'POST', { ...request, ...(request.id ? this.pins.get(request.id) ?? this.state(w) : this.state(w)) });
    this.check(); w.dataset = result.dataset; this.pins.delete(result.id); return result;
  }); }
  categories() { return this.queue(() => this.read<CategoryGroup[]>('/categories')); }
  addCategory(name: string, parent?: string) { return this.queue(async () => {
    const w = await this.ready();
    const result = await this.json<CategoryMutationResult>(this.path(w, '/categories'), 'POST', { name, parent, ...this.state(w) });
    this.check(); w.dataset = result.dataset; return result;
  }); }
  open(file: File, progress?: (p: ImportProgress) => void, signal?: AbortSignal) { return this.queue(async () => {
    this.check(signal);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    this.lifetime.signal.addEventListener('abort', abort, { once: true });
    let job: Job | undefined, activated = false;
    try {
      const w = await this.ready(); this.check(signal);
      const state = this.state(w);
      // Reservation is not aborted: retain its ID even if cancellation races its response.
      job = await this.json<Job>(this.path(w, '/imports?') + new URLSearchParams(Object.entries(state).map(([k,v]) => [k,String(v)])), 'POST', {}, AbortSignal.timeout(30000));
      this.check(signal);
      if (job.initialDatasetId !== state.expectedDatasetId || job.initialGenerationId !== state.expectedGenerationId || job.initialRevision !== state.expectedRevision) throw new Error('Import çalışma alanı değişti.');
      const form = new FormData(); form.append('file', file);
      const response = await this.request(this.path(w, '/imports?jobId=') + encodeURIComponent(job.id), { method: 'POST', body: form }, controller.signal);
      job = await response.json() as Job;
      while (true) {
        this.check(signal);
        this.emit(progress, { bytesRead: job.processedBytes, totalBytes: job.totalBytes, featuresRead: job.processedFeatures });
        if (job.status === 'completed') break;
        if (job.status === 'failed' || job.status === 'cancelled') throw new Error(job.error || 'Dosya içe aktarılamadı.');
        await new Promise<void>((resolve, reject) => {
          const stop = () => { clearTimeout(timer); reject(aborted()); };
          const timer = setTimeout(() => { controller.signal.removeEventListener('abort', stop); resolve(); }, this.interval);
          controller.signal.addEventListener('abort', stop, { once: true });
          if (controller.signal.aborted) stop();
        });
        job = await this.json<Job>('/jobs/' + encodeURIComponent(job.id), 'GET', undefined, controller.signal);
      }
      this.check(signal);
      // Once activation starts, wait for its outcome rather than misreport a committed import as cancelled.
      let next: Workspace;
      try { next = await this.json<Workspace>('/jobs/' + encodeURIComponent(job.id) + '/activate', 'POST', undefined, AbortSignal.timeout(30000)); }
      catch (error) {
        if (error instanceof RepositoryHttpError) throw error;
        const status = await this.json<Job>('/jobs/' + encodeURIComponent(job.id), 'GET', undefined, AbortSignal.timeout(5000));
        if (!status.activatedAt) throw new Error('Aktivasyon sonucu doğrulanamadı. Çalışmayı yeniden okuyun.');
        next = await this.json<Workspace>(this.path(w), 'GET', undefined, AbortSignal.timeout(5000));
        if (next.activeDatasetId !== status.stagingDatasetId) throw new Error('Aktivasyon sonrası çalışma alanı değişti.');
      }
      activated = true;
      this.check(); this.workspace = next; this.pins.clear(); return next.dataset;
    } finally {
      signal?.removeEventListener('abort', abort); this.lifetime.signal.removeEventListener('abort', abort);
      if (job && !activated) {
        try { await this.json('/jobs/' + encodeURIComponent(job.id) + '/cancel', 'POST', undefined, AbortSignal.timeout(5000)); } catch { /* Preserve original error; no automatic activation retry. */ }
      }
    }
  }); }
  export(progress?: (p: ImportProgress) => void) { return this.queue(async () => {
    const w = await this.ready(); const response = await this.request(this.path(w, '/export'));
    const parts: BlobPart[] = []; let count = 0;
    const parser = new JSONParser({ paths: ['$.features.*'], keepStack: false });
    parser.onValue = ({ parent, key }) => { if (Array.isArray(parent) && typeof key === 'number') { count++; delete parent[key]; } };
    this.emit(progress, { bytesRead: 0, totalBytes: 0, featuresRead: 0 });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Sunucu dışa aktarma akışı boş.');
    try {
      while (true) { this.check(); const { done, value } = await reader.read(); if (done) break; parser.write(value); parts.push(new Uint8Array(value)); }
      if (!parser.isEnded) parser.end(); this.check();
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    this.emit(progress, { bytesRead: count, totalBytes: count, featuresRead: count });
    return new Blob(parts, { type: 'application/geo+json' });
  }); }
  dispose() { this.closed = true; this.lifetime.abort(); this.pins.clear(); }
}
