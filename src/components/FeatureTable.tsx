import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { DatasetSummary, FeatureRecord, FeatureSummary, GeoFeature, GeoJsonRepository } from '../domain/contracts';
import { parseTableValue } from '../domain/editorDocument';

type Row = { summary:FeatureSummary; properties:GeoFeature['properties'] };
interface Props {repository:GeoJsonRepository;dataset:DatasetSummary|null;busy:boolean;onSelect(id:string):void;onApply(record:FeatureRecord,feature:GeoFeature):Promise<boolean>}
const display = (value:unknown) => value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
export function FeatureTable({repository,dataset,busy,onSelect,onApply}:Props) {
  const [rows,setRows]=useState<Row[]>([]),[offset,setOffset]=useState(0),[total,setTotal]=useState(0);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const [newField,setNewField]=useState(''),[extra,setExtra]=useState<string[]>([]);
  useEffect(()=>{if(dataset&&offset>=dataset.count&&offset>0)setOffset(0);},[dataset,offset]);
  useEffect(()=>{
    let active=true;setLoading(true);
    void (async()=>{
      try {
        const page=await repository.list('',offset,20);
        const next:Row[]=[];
        for(const item of page.items){if(!active)return;const record=await repository.get(item.id);next.push({summary:record.summary,properties:record.feature.properties});}
        if(active){setRows(next);setTotal(page.total);setError('');}
      }catch(cause){if(active)setError((cause as Error).message);}
      finally{if(active)setLoading(false);}
    })();
    return()=>{active=false;};
  },[repository,dataset,offset]);
  const columns=[...new Set([...rows.flatMap(row=>Object.keys(row.properties??{})),...extra])];
  const update = async (row:Row,name:string,text:string) => {
    if(busy||text===display(row.properties?.[name]))return;
    try {
      const value=parseTableValue(text,row.properties?.[name]);
      const record=await repository.get(row.summary.id);
      if(!await onApply(record,{...record.feature,properties:{...record.feature.properties,[name]:value}}))throw new Error('Alan kaydedilemedi.');
      setError('');
    }catch(cause){setError((cause as Error).message);}
  };
  return <div className="feature-table-panel">
    <div className="table-toolbar"><span>{total.toLocaleString('tr-TR')} şekil</span><form onSubmit={(event)=>{event.preventDefault();const name=newField.trim();if(!name||name==='__proto__')return;setExtra(values=>[...new Set([...values,name])]);setNewField('');}}><input aria-label="Yeni öznitelik adı" placeholder="Alan adı" value={newField} maxLength={80} onChange={(event)=>setNewField(event.target.value)}/><button className="icon-button" aria-label="Öznitelik sütunu ekle" disabled={!newField.trim()||newField.trim()==='__proto__'}><Plus size={15}/></button></form></div>
    <div className="feature-table-scroll"><table><thead><tr><th>Şekil</th><th>Geometri</th>{columns.map(name=><th key={name}>{name}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.summary.id}><td><button className="table-select" disabled={busy} onClick={()=>onSelect(row.summary.id)}>{row.summary.label}</button></td><td>{row.summary.geometryType}</td>{columns.map(name=><td key={name}><input key={`${row.summary.id}-${name}-${dataset?.revision}-${display(row.properties?.[name])}`} aria-label={`${name} · ${row.summary.label}`} defaultValue={display(row.properties?.[name])} disabled={busy||loading} onBlur={(event)=>void update(row,name,event.target.value)} onKeyDown={(event)=>{if(event.key==='Enter')event.currentTarget.blur();if(event.key==='Escape'){event.currentTarget.value=display(row.properties?.[name]);event.currentTarget.blur();}}}/></td>)}</tr>)}</tbody></table>{!rows.length&&!loading&&<p className="table-empty">Henüz şekil yok. Haritada çizin veya JSON paneline GeoJSON yapıştırın.</p>}</div>
    {error&&<p className="code-error" role="alert">{error}</p>}
    <div className="table-footer"><span>{loading?'Yükleniyor…':total?`${offset+1}–${Math.min(offset+20,total)} / ${total}`:'0 kayıt'}</span><button className="icon-button" aria-label="Tablo önceki sayfa" disabled={offset===0||loading||busy} onClick={()=>setOffset(Math.max(0,offset-20))}><ChevronLeft size={16}/></button><button className="icon-button" aria-label="Tablo sonraki sayfa" disabled={offset+20>=total||loading||busy} onClick={()=>setOffset(offset+20)}><ChevronRight size={16}/></button></div>
  </div>;
}
