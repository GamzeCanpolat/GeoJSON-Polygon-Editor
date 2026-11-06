import { describe, expect, it, vi } from 'vitest';
import { ApiGeoJsonRepository } from '../../src/adapters/api/ApiGeoJsonRepository';

const dataset = { name: 'test.geojson', count: 0, vertices: 0, bounds: null, sourceBytes: 0, revision: 7 };
const workspace = { id: 'w', projectId: null, activeDatasetId: 'd', generationId: 'g', dataset, createdAt: 'today', updatedAt: 'today' };
const project = { id: 'p', name: 'Park', savedDatasetId: 'snapshot', version: 1, createdAt: 'today', updatedAt: 'today', generationId: 'g', dataset };
function setup() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const repo = new ApiGeoJsonRepository({ fetch });
  const reply = (body: unknown, status = 200) => fetch.mockResolvedValueOnce(new Response(status === 204 ? null : JSON.stringify(body), { status }));
  const body = (index: number) => JSON.parse(String(fetch.mock.calls[index][1]?.body));
  return { repo, projects: repo.projects, fetch, reply, body };
}
describe('shared ProjectRepository', () => {
  it('rejects an empty ID instead of treating a project get as a project list',async()=>{
    const {projects,fetch}=setup();await expect(projects.get('')).rejects.toThrow('proje kimliği');expect(fetch).not.toHaveBeenCalled();
  });
  it('lists and gets projects without creating or changing a workspace', async () => {
    const {projects,fetch,reply}=setup(); reply({items:[project],total:1});reply(project);
    expect((await projects.list('Park & Şehir',20,10)).total).toBe(1);expect(await projects.get('p')).toEqual(project);
    expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get('search')).toBe('Park & Şehir');
    expect(fetch.mock.calls.every(([,init])=>init?.method==='GET')).toBe(true);
  });
  it('creates a snapshot with workspace state and saves with explicit project version', async () => {
    const {repo,projects,fetch,reply,body}=setup();reply(workspace);reply(project);reply({...project,version:2});
    expect(await projects.create('Park')).toEqual(project);
    expect(body(1)).toEqual({name:'Park',workspaceId:'w',expectedDatasetId:'d',expectedGenerationId:'g',expectedRevision:7});
    expect((await projects.save('p',1)).version).toBe(2);
    expect(fetch.mock.calls[2][1]?.method).toBe('PUT');expect(body(2)).toEqual({workspaceId:'w',expectedDatasetId:'d',expectedGenerationId:'g',expectedRevision:7,expectedVersion:1});
    reply({catalog:[],dataset:{...dataset,revision:8}});await repo.addCategory('Unused');expect(body(3).expectedRevision).toBe(7);
  });
  it('shares FIFO with geometry mutations and snapshots their completed revision', async () => {
    const {repo,projects,reply,body}=setup();reply(workspace);reply({id:'g:0',record:null,dataset:{...dataset,revision:8}});reply(project);
    const mutation=repo.mutate({feature:{type:'Feature',properties:{},geometry:null}});const save=projects.create('Park');
    await mutation;await save;expect(body(2).expectedRevision).toBe(8);
  });
  it('opens a separate workspace; later mutations use its physical identity and revision', async () => {
    const {repo,projects,fetch,reply,body}=setup();reply(workspace);await repo.createEmpty();
    const next={...workspace,id:'w2',projectId:'p',activeDatasetId:'copy',dataset:{...dataset,revision:3}};reply(next);
    const result=await projects.open('p',5);
    expect(result.previousWorkspace).toEqual(workspace);expect(result.workspace).toEqual(next);
    expect(body(1)).toEqual({projectId:'p',expectedProjectVersion:5});expect(fetch.mock.calls[1][0]).toMatch(/\/workspaces$/);
    result.workspace.activeDatasetId='caller-edited';
    reply({id:'g:0',record:null,dataset:{...dataset,revision:4}});await repo.mutate({feature:{type:'Feature',properties:{},geometry:null}});
    expect(fetch.mock.calls[2][0]).toContain('/w2/mutations');expect(body(2).expectedDatasetId).toBe('copy');expect(body(2).expectedRevision).toBe(3);
  });
  it('can open on a fresh adapter without creating an empty placeholder', async () => {
    const {projects,fetch,reply}=setup();reply({...workspace,projectId:'p'});
    expect((await projects.open('p',1)).previousWorkspace).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects old queued writes after project switch rather than applying them to new data', async () => {
    const {repo,projects,fetch,reply}=setup();reply(workspace);await repo.createEmpty();reply({...workspace,id:'w2',activeDatasetId:'copy'});
    const opened=projects.open('p',1);const oldWrite=repo.mutate({feature:{type:'Feature',properties:{},geometry:null}});
    await opened;await expect(oldWrite).rejects.toThrow('Çalışma alanı değişti');expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('renames with expectedVersion and deletes via 204 without parsing JSON', async () => {
    const {projects,fetch,reply,body}=setup();reply({...project,name:'Yeni',version:2});reply(null,204);
    expect((await projects.rename('p','Yeni',1)).version).toBe(2);expect(body(0)).toEqual({name:'Yeni',expectedVersion:1});
    await projects.remove('p',2);expect(fetch.mock.calls[1][1]?.method).toBe('DELETE');expect(fetch.mock.calls[1][0]).toContain('expectedVersion=2');
  });
  it.each([404,409,422,500,503])('reports HTTP %s without retrying or resetting active data',async status=>{
    const {repo,projects,fetch,reply}=setup();reply(workspace);await repo.createEmpty();reply({detail:'Proje işlemi reddedildi'},status);
    await expect(projects.open('p',1)).rejects.toThrow('Proje işlemi reddedildi');reply({items:[],total:0});await repo.list('',0,20);
    expect(fetch.mock.calls[2][0]).toContain('/w/features');expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each(['create','save','rename','remove'] as const)('does not retry %s after a version/state conflict',async method=>{
    const {projects,fetch,reply}=setup();if(method==='create'||method==='save')reply(workspace);reply({detail:'Sürüm değişti'},409);
    const operation=method==='create'?projects.create('Park'):method==='save'?projects.save('p',1):method==='rename'?projects.rename('p','Park',1):projects.remove('p',1);
    await expect(operation).rejects.toMatchObject({status:409});expect(fetch).toHaveBeenCalledTimes(method==='create'||method==='save'?2:1);
  });
  it('keeps previous data on network failure and leaves queue usable',async()=>{
    const {repo,projects,fetch,reply}=setup();reply(workspace);await repo.createEmpty();fetch.mockRejectedValueOnce(new TypeError('network'));
    await expect(projects.open('p',1)).rejects.toThrow('Sunucuya ulaşılamadı');reply({items:[],total:0});await repo.list('',0,20);expect(fetch.mock.calls[2][0]).toContain('/w/features');
  });
  it('disposal rejects project work and never automatically deletes projects',async()=>{
    const {repo,projects,fetch}=setup();repo.dispose();await expect(projects.remove('p',1)).rejects.toThrow('kapatıldı');await expect(projects.list()).rejects.toThrow('kapatıldı');expect(fetch).not.toHaveBeenCalled();
  });
});
