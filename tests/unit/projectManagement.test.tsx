// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectManagement, ProjectManagementFeature } from '../../src/components/projects/ProjectManagement';
import { ApiGeoJsonRepository } from '../../src/adapters/api/ApiGeoJsonRepository';
import type { GeoJsonRepository } from '../../src/domain/contracts';
import type { Project, ProjectRepository } from '../../src/domain/projects';

const dataset={name:'test.geojson',count:1,vertices:4,bounds:null,sourceBytes:120,revision:4};
const project:Project={id:'p',name:'Park',savedDatasetId:'snapshot',version:1,generationId:'g',dataset,createdAt:'2026-11-06T10:00:00Z',updatedAt:'2026-11-06T10:00:00Z'};
let host:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllEnvs();});
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,0));});
async function click(text:string){const button=[...host.querySelectorAll('button')].find(b=>b.textContent===text);expect(button,host.textContent??'').toBeDefined();await act(async()=>button!.click());}
async function name(value:string){const input=host.querySelector('input')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
function service(){return {list:vi.fn().mockResolvedValue({items:[project],total:1}),get:vi.fn().mockResolvedValue(project),create:vi.fn().mockResolvedValue(project),save:vi.fn().mockResolvedValue({...project,version:2}),rename:vi.fn().mockResolvedValue({...project,name:'Yeni',version:2}),remove:vi.fn().mockResolvedValue(undefined),open:vi.fn().mockResolvedValue({workspace:{id:'w2',projectId:'p',activeDatasetId:'d2',generationId:'g',dataset,createdAt:'today',updatedAt:'today'},previousWorkspace:{id:'w1'}})} satisfies ProjectRepository;}
async function render(options:{active?:Project|null;dirty?:boolean;draft?:boolean;busy?:boolean;pending?:boolean}={}){
  const projects=service(),saved=vi.fn(),opened=vi.fn(),deleted=vi.fn(),lock=vi.fn();
  function Harness(){const [active,setActive]=useState<Project|null>(options.active??null);return <ProjectManagement projects={projects} dataset={dataset} activeProject={active} dirty={options.dirty??false} hasDraft={options.draft??false} editorBusy={options.busy??false} hasPendingEdits={()=>options.pending??false} onActiveProjectChange={setActive} onSaved={saved} onOpened={opened} onDeleted={deleted} onOperationBusyChange={lock}/>;}
  await act(async()=>root.render(<Harness/>));return {projects,saved,opened,deleted,lock};
}
describe('project management UI',()=>{
  it('is off by default even with an API repository',async()=>{
    vi.stubEnv('VITE_PROJECT_MANAGEMENT',undefined);const fetch=vi.fn();const repo=new ApiGeoJsonRepository({fetch});
    await act(async()=>root.render(<ProjectManagementFeature repository={repo} dataset={dataset} activeProject={null} dirty={false} hasDraft={false} editorBusy={false} onActiveProjectChange={()=>{}} onSaved={()=>{}} onOpened={()=>{}} onDeleted={()=>{}} onOperationBusyChange={()=>{}}/>));expect(host.innerHTML).toBe('');expect(fetch).not.toHaveBeenCalled();repo.dispose();
  });
  it('never renders in local mode even with flag on',async()=>{
    vi.stubEnv('VITE_PROJECT_MANAGEMENT','true');await act(async()=>root.render(<ProjectManagementFeature repository={{} as GeoJsonRepository} dataset={dataset} activeProject={null} dirty={false} hasDraft={false} editorBusy={false} onActiveProjectChange={()=>{}} onSaved={()=>{}} onOpened={()=>{}} onDeleted={()=>{}} onOperationBusyChange={()=>{}}/>));expect(host.innerHTML).toBe('');
  });
  it('renders on explicit API opt-in without automatically saving or listing',async()=>{
    vi.stubEnv('VITE_PROJECT_MANAGEMENT','true');const fetch=vi.fn();const repo=new ApiGeoJsonRepository({fetch});
    await act(async()=>root.render(<ProjectManagementFeature repository={repo} dataset={dataset} activeProject={null} dirty={false} hasDraft={false} editorBusy={false} onActiveProjectChange={()=>{}} onSaved={()=>{}} onOpened={()=>{}} onDeleted={()=>{}} onOperationBusyChange={()=>{}}/>));expect(host.textContent).toContain('Projelerim');expect(fetch).not.toHaveBeenCalled();repo.dispose();
  });
  it('creates a named project, reports success and later saves explicit version',async()=>{
    const s=await render();await click('Projeyi Kaydet');await name('İlk proje');await click('Onayla');await settle();
    expect(s.projects.create).toHaveBeenCalledWith('İlk proje');expect(s.saved).toHaveBeenCalledWith(project);expect(host.querySelector('[role=status]')?.textContent).toContain('kaydedildi');
    await click('Projeyi Kaydet');await settle();expect(s.projects.save).toHaveBeenCalledWith('p',1);expect(host.textContent).toContain('sürüm 2');
  });
  it('save as creates a separate snapshot instead of overwriting existing project',async()=>{
    const s=await render({active:project});await click('Farklı Kaydet');await name('Kopya');await click('Onayla');expect(s.projects.create).toHaveBeenCalledWith('Kopya');expect(s.projects.save).not.toHaveBeenCalled();
  });
  it('prevents duplicate snapshot creation while a save is pending',async()=>{
    const s=await render();let finish!:(value:Project)=>void;s.projects.create.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    await click('Projeyi Kaydet');await name('Park');await click('Onayla');await click('Onayla');expect(s.projects.create).toHaveBeenCalledTimes(1);
    await act(async()=>finish(project));expect(s.saved).toHaveBeenCalledOnce();
  });
  it('blocks saving unapplied JSON drafts and all writes while editor is busy',async()=>{
    const s=await render({draft:true,busy:true});await click('Projeyi Kaydet');expect(s.projects.create).not.toHaveBeenCalled();expect(host.textContent).toContain('JSON taslağını');
  });
  it('requires confirmation for dirty open and invokes the editor reset only on success',async()=>{
    const s=await render({dirty:true});await click('Projelerim');await click('Aç');expect(s.projects.open).not.toHaveBeenCalled();expect(host.textContent).toContain('Kaydedilmemiş değişiklikler');
    await click('İptal');expect(s.opened).not.toHaveBeenCalled();await click('Aç');await click('Kaydetmeden Devam Et');expect(s.projects.open).toHaveBeenCalledWith('p',1);expect(s.opened).toHaveBeenCalledOnce();expect(s.lock.mock.calls).toContainEqual([true]);expect(s.lock.mock.calls.at(-1)).toEqual([false]);
  });
  it('shows 409 and preserves current editor state after failed open',async()=>{
    const s=await render();s.projects.open.mockRejectedValue({status:409,message:'Proje sürümü değişti'});await click('Projelerim');await click('Aç');expect(host.querySelector('[role=alert]')?.textContent).toContain('Sürüm çakışması');expect(s.opened).not.toHaveBeenCalled();expect(s.saved).not.toHaveBeenCalled();
  });
  it('saves before reopening the same project using the returned new version',async()=>{
    const s=await render({dirty:true,active:project});await click('Projelerim');await click('Aç');await click('Kaydet');
    expect(s.projects.save).toHaveBeenCalledWith('p',1);expect(s.projects.open).toHaveBeenCalledWith('p',2);expect(s.saved).toHaveBeenCalledOnce();expect(s.opened).toHaveBeenCalledOnce();
  });
  it('asks a name for the unsaved current workspace before save-and-open',async()=>{
    const s=await render({dirty:true});s.projects.create.mockResolvedValue({...project,id:'new'});await click('Projelerim');await click('Aç');await click('Kaydet');
    expect(s.projects.open).not.toHaveBeenCalled();await name('Current work');await click('Onayla');expect(s.projects.create).toHaveBeenCalledWith('Current work');expect(s.projects.open).toHaveBeenCalledWith('p',1);
  });
  it('does not pretend an unapplied JSON draft is included in a project save',async()=>{
    const s=await render({draft:true});await click('Projelerim');await click('Aç');await click('Kaydet');expect(s.projects.save).not.toHaveBeenCalled();expect(s.projects.create).not.toHaveBeenCalled();await click('İptal');expect(s.projects.open).not.toHaveBeenCalled();
  });
  it('does not deactivate a pending sketch by starting a background project request',async()=>{
    const s=await render({pending:true});await click('Projeyi Kaydet');await click('Projelerim');expect(s.projects.list).not.toHaveBeenCalled();expect(s.lock).not.toHaveBeenCalled();expect(host.querySelector('[role=alert]')?.textContent).toContain('Devam eden çizimi');
  });
  it('never deletes without explicit confirmation and cancel does nothing',async()=>{
    const s=await render({active:project});await click('Projelerim');await click('Sil');expect(s.projects.remove).not.toHaveBeenCalled();await click('Vazgeç');expect(s.projects.remove).not.toHaveBeenCalled();await click('Sil');await click('Silmeyi onayla');expect(s.projects.remove).toHaveBeenCalledWith('p',1);expect(s.deleted).toHaveBeenCalledWith('p');expect(s.opened).not.toHaveBeenCalled();
  });
  it('renames with version without marking unsaved geometry as saved',async()=>{
    const s=await render({active:project});await click('Projelerim');await click('Adını değiştir');await name('Yeni');await click('Onayla');expect(s.projects.rename).toHaveBeenCalledWith('p','Yeni',1);expect(s.saved).not.toHaveBeenCalled();expect(host.textContent).toContain('sürüm 2');
  });
  it('reports connection failures without switching or modifying the editor',async()=>{
    const s=await render({active:project});s.projects.save.mockRejectedValue(new Error('Sunucuya ulaşılamadı'));await click('Projeyi Kaydet');expect(host.querySelector('[role=alert]')?.textContent).toContain('Sunucuya ulaşılamadı');expect(s.saved).not.toHaveBeenCalled();
  });
});
