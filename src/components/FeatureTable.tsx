import { stringifyJson } from '../domain/losslessJson';
import { useEffect, useRef, useState } from 'react';
import type { PendingEditorEdits } from '../data/PendingEditorEdits';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { DatasetSummary, FeatureRecord, FeatureSummary, GeoFeature, GeoJsonRepository } from '../domain/contracts';
import { parseTableValue } from '../domain/editorDocument';

type Row = { summary:FeatureSummary; properties:GeoFeature['properties'] };
interface Props {repository:GeoJsonRepository;dataset:DatasetSummary|null;busy:boolean;edits?:PendingEditorEdits;onSelect(id:string):void;onApply(record:FeatureRecord,feature:GeoFeature):Promise<boolean>}
const display = (value:unknown) => value === undefined ? '' : typeof value === 'string' ? value : stringifyJson(value);
export function FeatureTable({repository,dataset,busy,edits,onSelect,onApply}:Props) {
  const [rows,setRows]=useState<Row[]>([]),[offset,setOffset]=useState(0),[total,setTotal]=useState(0);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const [newField,setNewField]=useState(''),[extra,setExtra]=useState<string[]>([]);
  const drafts=useRef(new Map<string,{row:Row;name:string;text:string}>());
  const failed=useRef(false),pending=useRef<Promise<void>|null>(null),alive=useRef(true);
  const [,redraw]=useState(0),[saving,setSaving]=useState(false);
  const latest=useRef({repository,onApply,busy});latest.current={repository,onApply,busy};
  const key=(row:Row,name:string)=>JSON.stringify([row.summary.id,name]);
  function changed(){edits?.notify();if(alive.current)redraw(v=>v+1);}
  function draft(row:Row,name:string,text:string){
    const id=key(row,name);
    if(text===display(row.properties?.[name]))drafts.current.delete(id);else drafts.current.set(id,{row,name,text});
    failed.current=false;setError('');changed();
  }
  function flush():Promise<void>{
    if(pending.current)return pending.current;
    if(failed.current)return Promise.reject(new Error('Tablo hücresi kaydedilemedi. Değeri düzeltin veya “Tekrar dene”yi seçin.'));
    if(!drafts.current.size)return Promise.resolve();
    if(latest.current.busy)return Promise.reject(new Error('Başka bir işlem sürüyor; tablo değişiklikleri korunuyor.'));
    setSaving(true);
    const work=Promise.resolve().then(async()=>{
      try{
        while(drafts.current.size){
          const [id,entry]=drafts.current.entries().next().value!;
          const value=parseTableValue(entry.text,entry.row.properties?.[entry.name]);
          const record=await latest.current.repository.get(entry.row.summary.id);
          if(!alive.current)throw new Error('Tablo kapandı; hücre uygulanmadı.');
          const feature={...record.feature,properties:{...record.feature.properties,[entry.name]:value}};
          if(!await latest.current.onApply(record,feature))throw new Error('Alan kaydedilemedi. Düzenlenmiş değer tabloda korunuyor.');
          if(drafts.current.get(id)===entry)drafts.current.delete(id);
          setRows(rows=>rows.map(row=>row.summary.id===entry.row.summary.id?{...row,properties:feature.properties}:row));
          changed();
        }
        setError('');
      }catch(cause){failed.current=true;if(alive.current)setError(cause instanceof Error?cause.message:'Alan kaydedilemedi.');throw cause;}
      finally{pending.current=null;if(alive.current)setSaving(false);changed();}
    });
    pending.current=work;return work;
  }
  const flushRef=useRef(flush);flushRef.current=flush;
  useEffect(()=>{alive.current=true;const unregister=edits?.register({flush:()=>flushRef.current(),dirty:()=>drafts.current.size>0||!!pending.current});return()=>{alive.current=false;unregister?.();};},[edits]);
  useEffect(()=>{if(dataset&&offset>=dataset.count&&offset>0)setOffset(0);},[dataset,offset]);
  useEffect(()=>{
    let active=true;setLoading(true);
    void (async()=>{
      try {
        const page=await repository.list('',offset,20);
        const next:Row[]=[];
        for(const item of page.items){if(!active)return;const record=await repository.get(item.id);next.push({summary:record.summary,properties:record.feature.properties});}
        if(active){setRows(next);setTotal(page.total);if(!failed.current)setError('');}
      }catch(cause){if(active)setError((cause as Error).message);}
      finally{if(active)setLoading(false);}
    })();
    return()=>{active=false;};
  },[repository,dataset,offset]);
  const columns=[...new Set([...rows.flatMap(row=>Object.keys(row.properties??{})),...extra])];
  return <div className="feature-table-panel">
    <div className="table-toolbar"><span>{total.toLocaleString('tr-TR')} şekil</span><form onSubmit={(event)=>{event.preventDefault();const name=newField.trim();if(!name||name==='__proto__')return;setExtra(values=>[...new Set([...values,name])]);setNewField('');}}><input aria-label="Yeni öznitelik adı" placeholder="Alan adı" value={newField} maxLength={80} onChange={(event)=>setNewField(event.target.value)}/><button className="icon-button" aria-label="Öznitelik sütunu ekle" disabled={!newField.trim()||newField.trim()==='__proto__'}><Plus size={15}/></button></form></div>
    <div className="feature-table-scroll"><table><thead><tr><th>Şekil</th><th>Geometri</th>{columns.map(name=><th key={name}>{name}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.summary.id}><td><button className="table-select" disabled={busy||saving} onClick={()=>onSelect(row.summary.id)}>{row.summary.label}</button></td><td>{row.summary.geometryType}</td>{columns.map(name=><td key={name}><input aria-label={`${name} · ${row.summary.label}`} value={drafts.current.get(key(row,name))?.text??display(row.properties?.[name])} disabled={busy||loading||saving} onChange={event=>draft(row,name,event.target.value)} onBlur={()=>{void flush().catch(()=>{});}} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();if(event.key==='Escape'){draft(row,name,display(row.properties?.[name]));event.currentTarget.blur();}}}/></td>)}</tr>)}</tbody></table>{!rows.length&&!loading&&<p className="table-empty">Henüz şekil yok. Haritada çizin veya JSON paneline GeoJSON yapıştırın.</p>}</div>
    {error&&<p className="code-error" role="alert">{error} <button disabled={busy||saving} onClick={()=>{failed.current=false;void flush().catch(()=>{});}}>Tekrar dene</button></p>}
    {saving&&<p role="status">Tablo değişiklikleri kaydediliyor…</p>}
    <div className="table-footer"><span>{loading?'Yükleniyor…':total?`${offset+1}–${Math.min(offset+20,total)} / ${total}`:'0 kayıt'}</span><button className="icon-button" aria-label="Tablo önceki sayfa" disabled={offset===0||loading||busy} onClick={()=>setOffset(Math.max(0,offset-20))}><ChevronLeft size={16}/></button><button className="icon-button" aria-label="Tablo sonraki sayfa" disabled={offset+20>=total||loading||busy} onClick={()=>setOffset(offset+20)}><ChevronRight size={16}/></button></div>
  </div>;
}
