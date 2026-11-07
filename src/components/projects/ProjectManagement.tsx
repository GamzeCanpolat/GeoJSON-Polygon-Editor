import { useRef, useState } from 'react';
import type { DatasetSummary, GeoJsonRepository } from '../../domain/contracts';
import type { OpenedProject, Project, ProjectPage, ProjectRepository, ProjectSummary } from '../../domain/projects';
import { ApiGeoJsonRepository } from '../../adapters/api/ApiGeoJsonRepository';
import { ProjectConfirmDialog, ProjectListDialog, ProjectNameDialog, ProjectUnsavedDialog } from './ProjectDialogs';
import './projects.css';

export interface ProjectManagementProps {
  repository: GeoJsonRepository;
  dataset: DatasetSummary | null;
  activeProject: Project | null;
  dirty: boolean;
  hasDraft: boolean;
  editorBusy: boolean;
  hasPendingEdits?(): boolean;
  beforeOperation?(saving: boolean): Promise<void>;
  onActiveProjectChange(project: Project | null): void;
  onSaved(project: Project): void;
  /** Synchronous editor reset: selection/history/JSON/table/category/map state. */
  onOpened(result: OpenedProject): void;
  onDeleted(id: string): void;
  /** Parent must lock map edits/imports/keyboard operations throughout requests. */
  onOperationBusyChange(busy: boolean): void;
}

/** Main App uses this gate: explicit opt-in AND the API adapter are required. */
export function ProjectManagementFeature(props: ProjectManagementProps) {
  if(import.meta.env.VITE_PROJECT_MANAGEMENT!=='true'||!(props.repository instanceof ApiGeoJsonRepository))return null;
  return <ProjectManagement {...props} projects={props.repository.projects}/>;
}

type Dialog = {kind:'save';afterOpen?:ProjectSummary}|{kind:'list'}|{kind:'rename'|'delete'|'open';project:ProjectSummary}|null;
export function ProjectManagement({projects,dataset,activeProject,dirty,hasDraft,editorBusy,hasPendingEdits,beforeOperation,onActiveProjectChange,onSaved,onOpened,onDeleted,onOperationBusyChange}:Omit<ProjectManagementProps,'repository'>&{projects:ProjectRepository}) {
  const [dialog,setDialog]=useState<Dialog>(null),[busy,setBusy]=useState(false),lock=useRef(false);
  const [page,setPage]=useState<ProjectPage>({items:[],total:0}),[search,setSearch]=useState(''),[offset,setOffset]=useState(0);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const disabled=busy||editorBusy;
  function settled(){if(hasPendingEdits?.()){setError('Devam eden çizimi veya düzenlemeyi önce tamamlayın ya da Escape ile iptal edin.');return false;}return true;}
  async function execute(action:()=>Promise<void>,saving=false){
    if(lock.current||editorBusy||!settled())return;
    lock.current=true;setBusy(true);setError('');setNotice('');let acquired=false;
    try{await beforeOperation?.(saving);if(!settled())return;onOperationBusyChange(true);acquired=true;await action();}
    catch(cause){const status=(cause as {status?:number}).status;setError((status===409?'Sürüm çakışması. Proje listesini yenileyin; işlem tekrar gönderilmedi. ':'')+(cause instanceof Error?cause.message:'Proje işlemi tamamlanamadı.'));}
    finally{lock.current=false;setBusy(false);if(acquired)onOperationBusyChange(false);}
  }
  function load(term=search,start=offset){void execute(async()=>{const result=await projects.list(term,start,20);setPage(result);setSearch(term);setOffset(start);});}
  function list(){if(!settled())return;setDialog({kind:'list'});load(search,0);}
  function create(name:string,afterOpen?:ProjectSummary){void execute(async()=>{const saved=await projects.create(name);onActiveProjectChange(saved);onSaved(saved);setDialog(null);setNotice(`“${saved.name}” kaydedildi. Sürüm ${saved.version}.`);if(afterOpen)await openNow(afterOpen);},true);}
  function save(){
    if(!settled())return;
    if(!activeProject){setDialog({kind:'save'});return;}
    const target=activeProject;
    void execute(async()=>{const saved=await projects.save(target.id,target.version);onActiveProjectChange(saved);onSaved(saved);setNotice(`“${saved.name}” kaydedildi. Sürüm ${saved.version}.`);},true);
  }
  async function openNow(project:ProjectSummary){
      const result=await projects.open(project.id,project.version);
      onOpened(result);
      onActiveProjectChange({...project,generationId:result.workspace.generationId,dataset:result.workspace.dataset});
      setDialog(null);setNotice(`“${project.name}” açıldı.`);
  }
  function open(project:ProjectSummary){void execute(()=>openNow(project));}
  function saveAndOpen(target:ProjectSummary){
    if(!activeProject){setDialog({kind:'save',afterOpen:target});return;}
    const current=activeProject;
    void execute(async()=>{const saved=await projects.save(current.id,current.version);onActiveProjectChange(saved);onSaved(saved);await openNow(saved.id===target.id?saved:target);},true);
  }
  function rename(project:ProjectSummary,name:string){void execute(async()=>{
    const result=await projects.rename(project.id,name,project.version);
    if(activeProject?.id===project.id)onActiveProjectChange(result);
    setPage(p=>({...p,items:p.items.map(item=>item.id===result.id?result:item)}));setDialog({kind:'list'});setNotice('Proje adı değiştirildi.');
  });}
  function remove(project:ProjectSummary){void execute(async()=>{
    await projects.remove(project.id,project.version);
    if(activeProject?.id===project.id)onActiveProjectChange(null);
    onDeleted(project.id);setPage(p=>({total:Math.max(0,p.total-1),items:p.items.filter(item=>item.id!==project.id)}));
    setDialog({kind:'list'});setNotice('Kayıtlı proje silindi. Çalışma alanı korunuyor.');
  });}
  return <section className="project-management" aria-label="Proje yönetimi" onKeyDown={e=>{if(dialog)e.stopPropagation();}}>
    <div className="project-actions project-toolbar-actions"><button className="button primary" onClick={save} disabled={disabled||!dataset||hasDraft}>Projeyi Kaydet</button><button className="button secondary" onClick={()=>{if(settled())setDialog({kind:'save'});}} disabled={disabled||!dataset||hasDraft}>Farklı Kaydet</button><button className="button secondary" onClick={list} disabled={disabled}>Projelerim</button></div>
    <details className="project-mobile-menu"><summary>Projeler</summary><div className="project-actions" onClick={e=>{if((e.target as HTMLElement).closest('button'))e.currentTarget.parentElement?.removeAttribute('open');}}><button className="button primary" onClick={save} disabled={disabled||!dataset||hasDraft}>Projeyi Kaydet</button><button className="button secondary" onClick={()=>{if(settled())setDialog({kind:'save'});}} disabled={disabled||!dataset||hasDraft}>Farklı Kaydet</button><button className="button secondary" onClick={list} disabled={disabled}>Projelerim</button></div></details>
    <span title={activeProject?`${activeProject.name} · sürüm ${activeProject.version}`:undefined}>{activeProject?`${activeProject.name} · sürüm ${activeProject.version}`:'Henüz proje olarak kaydedilmedi'}</span>
    {busy&&<p role="status">Proje işlemi sürüyor…</p>}
    {hasDraft&&<p>Kaydetmeden önce JSON taslağını uygulayın veya iptal edin.</p>}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
    {dialog?.kind==='save'&&<ProjectNameDialog key="save" title={activeProject?'Farklı Kaydet':'Projeyi Kaydet'} initialName={activeProject?.name} busy={disabled} onClose={()=>setDialog(dialog.afterOpen?{kind:'open',project:dialog.afterOpen}:null)} onSubmit={name=>create(name,dialog.afterOpen)}/>}
    {dialog?.kind==='list'&&<ProjectListDialog page={page} search={search} offset={offset} busy={disabled} onClose={()=>setDialog(null)} onSearch={term=>load(term,0)} onPage={start=>load(search,start)} onOpen={project=>{if(dirty||hasDraft)setDialog({kind:'open',project});else open(project);}} onRename={project=>setDialog({kind:'rename',project})} onDelete={project=>setDialog({kind:'delete',project})}/>}
    {dialog?.kind==='rename'&&<ProjectNameDialog key={dialog.project.id} title="Proje Adını Değiştir" initialName={dialog.project.name} busy={disabled} onClose={()=>setDialog({kind:'list'})} onSubmit={name=>rename(dialog.project,name)}/>}
    {dialog?.kind==='delete'&&<ProjectConfirmDialog title="Projeyi Sil" message={`“${dialog.project.name}” kayıtlı projesi silinsin mi? Bu işlem proje kaydını siler; açık çalışma alanını silmez.`} action="Silmeyi onayla" busy={disabled} onClose={()=>setDialog({kind:'list'})} onConfirm={()=>remove(dialog.project)}/>}
    {dialog?.kind==='open'&&<ProjectUnsavedDialog busy={disabled} hasDraft={hasDraft} onCancel={()=>setDialog({kind:'list'})} onDiscard={()=>open(dialog.project)} onSave={()=>saveAndOpen(dialog.project)}/>}
  </section>;
}
