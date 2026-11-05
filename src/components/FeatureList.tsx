import { useEffect,useState } from 'react';
import { Crosshair,Eye,EyeOff,Search,Trash2,Upload,X } from 'lucide-react';
import type { FeaturePage,FeatureRecord,GeoJsonRepository } from '../domain/contracts';

interface Props {repository:GeoJsonRepository;page:FeaturePage;selected:FeatureRecord|null;busy:boolean;hidden:ReadonlySet<string>;search:string;onSearch(value:string):void;onSelect(id:string):void;onToggle(id:string):void;onFocus():void;onDelete():void;onImport():void}
export function FeatureList({repository,page,selected,busy,hidden,search,onSearch,onSelect,onToggle,onFocus,onDelete,onImport}:Props){
  const [field,setField]=useState(''),[labels,setLabels]=useState<Record<string,string>>({}),[extraFields,setExtraFields]=useState<string[]>([]),[searchOpen,setSearchOpen]=useState(false);
  useEffect(()=>{
    let active=true;
    if(!field){setLabels({});return;}
    void(async()=>{const next:Record<string,string>={},fields=new Set<string>();for(const item of page.items){try{const record=await repository.get(item.id);if(!active)return;Object.keys(record.feature.properties??{}).forEach(key=>fields.add(key));const value=record.feature.properties?.[field];next[item.id]=value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);}catch{ /* a new file may have replaced the previous page */ }}if(active){setLabels(next);setExtraFields([...fields]);}})();
    return()=>{active=false;};
  },[repository,page,field]);
  const fields=[...new Set(['name','ad','isim','title','ana_kategori','alt_kategori',...Object.keys(selected?.feature.properties??{}),...extraFields])];
  return <>
    <div className="reference-list-tools"><select aria-label="Şekil etiketi" value={field} onChange={event=>setField(event.target.value)}><option value="">Etiket: Geometri</option>{fields.map(name=><option key={name} value={name}>{name}</option>)}</select><button className="icon-button" aria-label="Şekil ara" aria-expanded={searchOpen} onClick={()=>setSearchOpen(value=>!value)}><Search size={13}/></button><button className="icon-button" aria-label="Seçili şekle yakınlaş" disabled={!selected?.summary.bounds} onClick={onFocus}><Crosshair size={13}/></button><button className="icon-button" aria-label="Listeden seçili şekli sil" disabled={!selected||busy} onClick={onDelete}><Trash2 size={13}/></button></div>
    {searchOpen&&<div className="reference-search"><input aria-label="Şekillerde ara" placeholder="Şekil ara…" value={search} onChange={event=>onSearch(event.target.value)}/><button className="icon-button" aria-label="Aramayı temizle" onClick={()=>{onSearch('');setSearchOpen(false);}}><X size={13}/></button></div>}
    <div className="reference-feature-list" aria-label="Şekil listesi">{page.items.map(item=>{
      const label=field?labels[item.id]||item.geometryType:item.geometryType;
      return <div className={`reference-feature-row ${selected?.summary.id===item.id?'selected':''} ${hidden.has(item.id)?'is-hidden':''}`} key={item.id}><button className="reference-feature-select" disabled={busy} onClick={()=>onSelect(item.id)} title={`${label} · ${item.geometryType}`} aria-label={`${label} seç`}>{label}</button><button className="icon-button feature-eye" aria-label={`${label} ${hidden.has(item.id)?'göster':'gizle'}`} aria-pressed={!hidden.has(item.id)} onClick={()=>onToggle(item.id)}>{hidden.has(item.id)?<EyeOff size={14}/>:<Eye size={14}/>}</button></div>;
    })}{!page.items.length&&<div className="reference-empty">{search?<p>Eşleşen şekil yok.</p>:<><p>Haritada bir şekil çizin veya dosyadan harita verisi içe aktarın.</p><strong>Dosya içe aktar</strong><button className="button secondary" disabled={busy} onClick={onImport}><Upload size={14}/>İçe aktar</button><details><summary>Desteklenen dosyalar</summary><p>GeoJSON (.json, .geojson)<br/>Excel (.xls, .xlsx)</p></details></>}</div>}</div>
  </>;
}
