import { useEffect, useState } from 'react';
import { Braces, SlidersHorizontal, Table2, X } from 'lucide-react';
import type { CategoryGroup, DatasetSummary, FeatureRecord, GeoFeature, GeoJsonRepository } from '../domain/contracts';
import { DocumentEditor } from './DocumentEditor';
import { FeatureTable } from './FeatureTable';
import { Inspector } from './Inspector';
import type { PendingEditorEdits } from '../data/PendingEditorEdits';

interface Props {
  repository:GeoJsonRepository;dataset:DatasetSummary|null;record:FeatureRecord|null;busy:boolean;catalog:CategoryGroup[];workspaceKey:number;
  onReplace(text:string):Promise<boolean>;onApply(feature:GeoFeature):Promise<boolean>;onTableApply(record:FeatureRecord,feature:GeoFeature):Promise<boolean>;
  onSelect(id:string):void;onManageCategories():void;onFocus():void;onEdit():void;onClose():void;onDraftChange(changed:boolean):void;
  edits?:PendingEditorEdits;
}
export function DataPanel(props:Props) {
  const [tab,setTab]=useState<'json'|'table'|'properties'>('json');
  const [width,setWidth]=useState<number|null>(null);
  const [tableVisited,setTableVisited]=useState(false);
  useEffect(()=>{if(!props.record)setTab(current=>current==='properties'?'json':current);},[props.record]);
  const tabs=[{id:'json',label:'JSON',icon:Braces},{id:'table',label:'Tablo',icon:Table2},...(props.record?[{id:'properties',label:'Özellikler',icon:SlidersHorizontal}]:[])];
  return <aside className="data-panel" style={width?{width,flexBasis:width}:undefined} aria-label="GeoJSON ve tablo editörü"><div className="data-resizer" role="separator" aria-label="Veri panelini boyutlandır" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={900} aria-valuenow={width??320} tabIndex={0} onDoubleClick={()=>setWidth(null)} onKeyDown={(event)=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();const current=width??event.currentTarget.parentElement!.getBoundingClientRect().width;setWidth(Math.max(280,Math.min(900,window.innerWidth*.65,current+(event.key==='ArrowLeft'?20:-20))));}}} onPointerDown={(event)=>{event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={(event)=>{if(event.currentTarget.hasPointerCapture(event.pointerId)){const right=event.currentTarget.parentElement!.getBoundingClientRect().right;setWidth(Math.max(280,Math.min(900,window.innerWidth*.65,right-event.clientX)));}}} onPointerUp={(event)=>{event.currentTarget.releasePointerCapture(event.pointerId);}}/><div className="data-panel-tabs" role="tablist" aria-label="Veri görünümü">{tabs.map(({id,label,icon:Icon})=><button key={id} role="tab" aria-selected={tab===id} onClick={()=>{if(id==='table')setTableVisited(true);setTab(id as typeof tab);}}><Icon size={14}/>{label}</button>)}<button className="icon-button" aria-label="Veri panelini kapat" onClick={props.onClose}><X size={16}/></button></div>
    <section className="data-pane" hidden={tab!=='json'} role="tabpanel" aria-label="JSON"><DocumentEditor key={props.workspaceKey} repository={props.repository} dataset={props.dataset} record={props.record} busy={props.busy} onReplace={props.onReplace} onApply={props.onApply} onDraftChange={props.onDraftChange}/></section>
    {(tab==='table'||tableVisited)&&<section className="data-pane" hidden={tab!=='table'} role="tabpanel" aria-label="Tablo"><FeatureTable key={props.workspaceKey} edits={props.edits} repository={props.repository} dataset={props.dataset} busy={props.busy} onSelect={props.onSelect} onApply={props.onTableApply}/></section>}
    {tab==='properties'&&<section className="data-pane workspace-properties" role="tabpanel" aria-label="Özellikler"><Inspector record={props.record} busy={props.busy} catalog={props.catalog} onManageCategories={props.onManageCategories} onApply={props.onApply} onFocus={props.onFocus} onEdit={props.onEdit} onClose={props.onClose}/></section>}
  </aside>;
}
