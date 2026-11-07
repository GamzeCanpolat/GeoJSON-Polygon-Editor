import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ProjectPage, ProjectSummary } from '../../domain/projects';

export function ProjectDialog({ title, busy, onClose, children }: {title:string;busy:boolean;onClose():void;children:ReactNode}) {
  const ref=useRef<HTMLDivElement>(null),id=useId();
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    ref.current?.querySelector<HTMLElement>('input,button')?.focus();
    return ()=>{if(previous?.isConnected)previous.focus();};
  },[]);
  return <div className="project-dialog-backdrop" onDragEnter={e=>{e.preventDefault();e.stopPropagation();}} onDragLeave={e=>e.stopPropagation()} onDragOver={e=>{e.preventDefault();e.stopPropagation();}} onDrop={e=>{e.preventDefault();e.stopPropagation();}} onClick={()=>{if(!busy)onClose();}} onKeyDown={event=>{
    event.stopPropagation();
    if(event.key==='Escape'&&!busy){event.preventDefault();onClose();}
    if(event.key==='Tab'){
      const nodes=ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');
      if(!nodes?.length){event.preventDefault();return;}
      const first=nodes[0],last=nodes[nodes.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  }}><div className="project-dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} onClick={e=>e.stopPropagation()} aria-busy={busy}>
    <header><h2 id={id}>{title}</h2><button type="button" className="button secondary" disabled={busy} onClick={onClose} aria-label="Proje penceresini kapat">Kapat</button></header>{children}
  </div></div>;
}

export function ProjectNameDialog({title,initialName='',busy,onClose,onSubmit}:{title:string;initialName?:string;busy:boolean;onClose():void;onSubmit(name:string):void}) {
  const [name,setName]=useState(initialName),id=useId();
  return <ProjectDialog title={title} busy={busy} onClose={onClose}><form onSubmit={e=>{e.preventDefault();if(name.trim()&&!busy)onSubmit(name.trim());}}>
    <label htmlFor={id}>Proje adı</label><input id={id} value={name} onChange={e=>setName(e.target.value)} maxLength={200} required disabled={busy}/>
    <button type="submit" className="button primary" disabled={busy||!name.trim()}>Onayla</button>
  </form></ProjectDialog>;
}

export function ProjectConfirmDialog({title,message,action,busy,onClose,onConfirm}:{title:string;message:string;action:string;busy:boolean;onClose():void;onConfirm():void}) {
  return <ProjectDialog title={title} busy={busy} onClose={onClose}><p>{message}</p><div className="project-actions">
    <button className="button secondary" disabled={busy} onClick={onClose}>Vazgeç</button><button className="button primary" disabled={busy} onClick={onConfirm}>{action}</button>
  </div></ProjectDialog>;
}

export function ProjectUnsavedDialog({busy,hasDraft,onCancel,onDiscard,onSave}:{busy:boolean;hasDraft:boolean;onCancel():void;onDiscard():void;onSave():void}) {
  return <ProjectDialog title="Kaydedilmemiş değişiklikler" busy={busy} onClose={onCancel}>
    <p>Çalışmanızı kaydetmek ister misiniz? Önceki workspace sunucuda korunur; uygulanmamış JSON taslağı devam ederseniz bırakılır.</p>
    {hasDraft&&<p>Kaydetmek için önce JSON taslağını uygulayın veya iptal edin.</p>}
    <div className="project-actions"><button className="button secondary" disabled={busy} onClick={onCancel}>İptal</button><button className="button secondary" disabled={busy} onClick={onDiscard}>Kaydetmeden Devam Et</button><button className="button primary" disabled={busy||hasDraft} onClick={onSave}>Kaydet</button></div>
  </ProjectDialog>;
}

export function ProjectListDialog({page,search,offset,busy,onSearch,onPage,onOpen,onRename,onDelete,onClose}:{
  page:ProjectPage;search:string;offset:number;busy:boolean;onSearch(value:string):void;onPage(offset:number):void;
  onOpen(project:ProjectSummary):void;onRename(project:ProjectSummary):void;onDelete(project:ProjectSummary):void;onClose():void;
}) {
  const [query,setQuery]=useState(search);
  return <ProjectDialog title="Projelerim" busy={busy} onClose={onClose}>
    <form onSubmit={e=>{e.preventDefault();onSearch(query);}}><label>Proje ara<input value={query} onChange={e=>setQuery(e.target.value)} disabled={busy}/></label><button className="button secondary" disabled={busy}>Ara</button></form>
    <p>{page.total} kayıtlı proje</p><ul className="project-list">{page.items.map(project=><li key={project.id}><div><strong>{project.name}</strong><small>Sürüm {project.version} · {new Date(project.updatedAt).toLocaleString('tr-TR')}</small></div><div className="project-actions">
      <button className="button primary" disabled={busy} onClick={()=>onOpen(project)} aria-label={`${project.name} projesini aç`}>Aç</button>
      <button className="button secondary" disabled={busy} onClick={()=>onRename(project)} aria-label={`${project.name} projesinin adını değiştir`}>Adını değiştir</button>
      <button className="button secondary" disabled={busy} onClick={()=>onDelete(project)} aria-label={`${project.name} projesini sil`}>Sil</button>
    </div></li>)}</ul>{!page.items.length&&!busy&&<p>Kayıtlı proje bulunamadı.</p>}
    <div className="project-actions"><button className="button secondary" disabled={busy||offset===0} onClick={()=>onPage(Math.max(0,offset-20))}>Önceki</button><button className="button secondary" disabled={busy||offset+20>=page.total} onClick={()=>onPage(offset+20)}>Sonraki</button><button className="button secondary" disabled={busy} onClick={()=>onSearch(search)}>Listeyi yenile</button></div>
  </ProjectDialog>;
}
