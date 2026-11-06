import { describe, it, expect, vi } from 'vitest';
import { ApiGeoJsonRepository } from '../../src/adapters/api/ApiGeoJsonRepository';
import type { GeoFeature } from '../../src/domain/contracts';

const dataset = { name: 'test.geojson', count: 0, vertices: 0, bounds: null, sourceBytes: 0, revision: 0 };
const workspace = { id: 'workspace', activeDatasetId: 'dataset', generationId: 'generation', dataset };
const feature: GeoFeature = { type: 'Feature', id: 'external', properties: { unknown: { keep: true } }, geometry: { type: 'Point', coordinates: [29, 41, 123] } };
const record = { summary: { id: 'generation:0', label: 'test', geometryType: 'Point', vertices: 1, bounds: [29, 41, 29, 41] }, feature };
const state = { expectedDatasetId: 'dataset', expectedGenerationId: 'generation', expectedRevision: 0 };
const job = { id: 'job', status: 'completed', processedBytes: 50, totalBytes: 50, processedFeatures: 1, error: null, initialDatasetId: 'dataset', initialGenerationId: 'generation', initialRevision: 0 };
function setup() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const repo = new ApiGeoJsonRepository({ fetch, pollIntervalMs: 0 });
  const reply = (body: unknown, status = 200, headers: Record<string,string> = {}) => fetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers }));
  reply(workspace);
  return { repo, fetch, reply };
}
function body(fetch: ReturnType<typeof setup>['fetch'], index: number) { return JSON.parse(String(fetch.mock.calls[index][1]?.body)); }

describe('ApiGeoJsonRepository', () => {
  it('creates one private workspace lazily and resets it with guarded revision zero', async () => {
    const { repo, fetch, reply } = setup(); expect(fetch).not.toHaveBeenCalled();
    expect(await repo.createEmpty()).toEqual(dataset);
    reply({ ...workspace, activeDatasetId: 'new', generationId: 'new' });
    await repo.createEmpty(); expect(fetch.mock.calls[1][0]).toContain('/workspace/empty'); expect(body(fetch,1)).toEqual(state);
  });
  it('keeps repository instances isolated', async () => {
    const a = setup(), b = setup(); await Promise.all([a.repo.createEmpty(), b.repo.createEmpty()]);
    expect(a.fetch).toHaveBeenCalledTimes(1); expect(b.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['insert','update','delete','restore'])('supports %s without changing feature identity or Z', async kind => {
    const { repo, fetch, reply } = setup();
    const result = { id: 'generation:0', record: kind === 'delete' ? null : record, dataset: { ...dataset, revision: 1 } };
    reply(result); const input = { ...(kind === 'insert' ? {} : { id: record.summary.id }), feature: kind === 'delete' ? null : feature };
    expect(await repo.mutate(input)).toEqual(result);
    expect(body(fetch,1)).toEqual({ ...input, ...state }); expect(feature.geometry).toEqual({ type:'Point',coordinates:[29,41,123] });
    reply({ ...result, dataset: { ...dataset, revision: 2 } }); await repo.mutate(input);
    expect(body(fetch,2).expectedRevision).toBe(1);
  });
  it('reads full features and pins their revision despite later viewport reads', async () => {
    const { repo, fetch, reply } = setup(); reply(record); expect(await repo.get('generation:0')).toEqual(record);
    reply({records:[],matched:0,limited:false},200,{'X-Dataset-Id':'dataset','X-Generation-Id':'generation','X-Dataset-Revision':'5'});
    await repo.query({ bounds:[28,40,30,42], tolerance:.01, limit:20 });
    const url = String(fetch.mock.calls[2][0]); expect(new URL(url).searchParams.getAll('bounds')).toEqual(['28','40','30','42']);
    reply({detail:'Revision değişti'},409); await expect(repo.mutate({id:'generation:0',feature})).rejects.toThrow('Revision değişti');
    expect(body(fetch,3).expectedRevision).toBe(0); expect(fetch).toHaveBeenCalledTimes(4);
  });
  it('lists with encoded search and accesses categories', async () => {
    const { repo, fetch, reply } = setup(); reply({items:[],total:0}); await repo.list('Işık & Park',20,20);
    expect(new URL(String(fetch.mock.calls[1][0])).searchParams.get('search')).toBe('Işık & Park');
    reply([{name:'Arazi',subcategories:[]}]); expect(await repo.categories()).toHaveLength(1);
    reply({catalog:[],dataset:{...dataset,revision:1}}); await repo.addCategory('Park','Arazi');
    expect(body(fetch,3)).toEqual({...state,name:'Park',parent:'Arazi'});
  });
  it('uploads multipart then polls and activates, preserving byte progress', async () => {
    const { repo, fetch, reply } = setup(); reply({...job,status:'uploading'}); reply({...job,status:'queued'}); reply(job);
    reply({...workspace,activeDatasetId:'imported',generationId:'new',dataset:{...dataset,count:1}});
    const progress = vi.fn(); await repo.open(new File(['{}'],'a.geojson'),progress);
    expect(body(fetch,1)).toEqual({}); expect(String(fetch.mock.calls[1][0])).toContain('expectedRevision=0');
    expect(fetch.mock.calls[2][1]?.body).toBeInstanceOf(FormData);
    expect(fetch.mock.calls[2][1]?.headers).toBeUndefined(); expect(fetch.mock.calls[4][0]).toContain('/jobs/job/activate');
    expect(progress).toHaveBeenLastCalledWith({bytesRead:50,totalBytes:50,featuresRead:1});
  });
  it('cancels an import even when abort races reservation, without activation', async () => {
    const { repo, fetch, reply } = setup(); const controller = new AbortController();
    fetch.mockImplementationOnce(async () => { controller.abort(); return new Response(JSON.stringify(job)); }); reply({...job,status:'cancelled'});
    await expect(repo.open(new File(['{}'],'a.geojson'),undefined,controller.signal)).rejects.toThrow('iptal');
    expect(fetch.mock.calls[2][0]).toContain('/jobs/job/cancel'); expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/activate'))).toBe(false);
    reply({items:[],total:0}); await repo.list('',0,20); expect(fetch.mock.calls[3][0]).toContain('/workspaces/workspace/features');
  });
  it('rejects already aborted imports without creating a workspace', async () => {
    const {repo,fetch} = setup(); const controller = new AbortController(); controller.abort();
    await expect(repo.open(new File(['{}'],'a.geojson'),undefined,controller.signal)).rejects.toThrow('iptal'); expect(fetch).not.toHaveBeenCalled();
  });
  it('sends independent cancellation when upload is aborted', async () => {
    const {repo,fetch,reply}=setup(); const controller=new AbortController(); reply({...job,status:'uploading'});
    fetch.mockImplementationOnce(async (_url,init)=>new Promise((_resolve,reject)=>{
      init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
      controller.abort();
    })); reply({...job,status:'cancelled'});
    await expect(repo.open(new File(['{}'],'a.geojson'),undefined,controller.signal)).rejects.toThrow('iptal');
    expect(fetch.mock.calls[3][0]).toContain('/cancel'); expect(fetch.mock.calls[3][1]?.signal?.aborted).toBe(false);
  });
  it('reconciles a lost activation response without retrying activation', async () => {
    const {repo,fetch,reply}=setup(); reply(job); reply(job);
    fetch.mockRejectedValueOnce(new TypeError('response lost'));
    reply({...job,activatedAt:'now',stagingDatasetId:'imported'});
    reply({...workspace,activeDatasetId:'imported',generationId:'new',dataset:{...dataset,count:1}});
    expect((await repo.open(new File(['{}'],'a.geojson'))).count).toBe(1);
    expect(fetch.mock.calls.filter(([url])=>String(url).endsWith('/activate'))).toHaveLength(1);
  });
  it('ignores a workspace creation response arriving after disposal', async () => {
    const fetch=vi.fn<typeof globalThis.fetch>(); let resolve!: (value:Response)=>void;
    fetch.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const repo=new ApiGeoJsonRepository({fetch}); const operation=repo.createEmpty(); await Promise.resolve(); repo.dispose();
    resolve(new Response(JSON.stringify(workspace))); await expect(operation).rejects.toThrow('kapatıldı');
    await expect(repo.createEmpty()).rejects.toThrow('kapatıldı'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('exports exact GeoJSON with catalog, properties, ID and Z, using record progress', async () => {
    const {repo,reply} = setup(); const data = {type:'FeatureCollection',category_catalog:[{name:'Unused',subcategories:[]}],features:[feature]}; reply(data);
    const progress = vi.fn(); const blob = await repo.export(progress); expect(JSON.parse(await blob.text())).toEqual(data);
    expect(progress).toHaveBeenLastCalledWith({bytesRead:1,totalBytes:1,featuresRead:1});
  });
  it.each([404,409,413,422,500])('reports HTTP %s without silently retrying',async status => {
    const {repo,fetch,reply} = setup(); reply({detail:[{msg:'Anlaşılır hata'}]},status);
    await expect(repo.list('',0,20)).rejects.toThrow('Anlaşılır hata'); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('surfaces network errors and keeps the queue usable', async () => {
    const {repo,fetch,reply} = setup(); fetch.mockRejectedValueOnce(new TypeError('network'));
    await expect(repo.list('',0,20)).rejects.toThrow('Sunucuya ulaşılamadı'); reply([]); expect(await repo.categories()).toEqual([]);
  });
  it('serializes operations and rejects queued and future work after dispose without deleting data',async () => {
    const {repo,fetch} = setup(); const first = repo.createEmpty(), second = repo.categories(); repo.dispose();
    await expect(first).rejects.toThrow('kapatıldı'); await expect(second).rejects.toThrow('kapatıldı');
    await expect(repo.get('x')).rejects.toThrow('kapatıldı'); expect(fetch).not.toHaveBeenCalled();
  });
});
