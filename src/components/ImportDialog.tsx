import { useEffect,useRef,useState } from 'react';
import { FileUp,LoaderCircle,PlusCircle,X } from 'lucide-react';
import { ImportReader } from '../data/ImportReader';
import { MAX_EXCEL_BYTES,type ImportFormat,type ImportIssue,type ImportKind,type SpreadsheetInfo } from '../data/importTypes';

interface Props {initialFile:File|null;busy:boolean;count:number;dirty:boolean;hasDraft:boolean;onImport(file:File,append:boolean,skippedRows?:number):Promise<boolean>;onClose():void}
const kinds:{value:ImportKind;label:string}[]=[{value:'coordinates',label:'Koordinatlar'},{value:'wkt',label:'WKT sütunu'},{value:'geojson',label:'GeoJSON sütunu'},{value:'polyline',label:'Kodlanmış polyline'}];
export function ImportDialog({initialFile,busy,count,dirty,hasDraft,onImport,onClose}:Props){
  const [file,setFile]=useState<File|null>(initialFile),[format,setFormat]=useState<ImportFormat>(initialFile&&/\.xlsx?$/i.test(initialFile.name)?'excel':'geojson');
  const [info,setInfo]=useState<SpreadsheetInfo|null>(null),[kind,setKind]=useState<ImportKind>('coordinates');
  const [reading,setReading]=useState(false),[submitting,setSubmitting]=useState(false),[error,setError]=useState('');
  const [issues,setIssues]=useState<ImportIssue[]>([]),[append,setAppend]=useState(count>0);
  const reader=useRef<ImportReader|null>(null),version=useRef(0),input=useRef<HTMLInputElement>(null),dialog=useRef<HTMLDivElement>(null);
  const submission=useRef(false);
  const latest=useRef({busy,onClose});latest.current={busy,onClose};
  const locked=busy||reading||submitting;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!latest.current.busy){event.preventDefault();latest.current.onClose();}
      if(event.key!=='Tab')return;
      const controls=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([tabindex="-1"]),select:not(:disabled)');
      if(!controls?.length)return;const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',keydown);
    return()=>{version.current++;reader.current?.dispose();document.removeEventListener('keydown',keydown);if(previous?.isConnected)previous.focus();};
  },[]);
  const load=async(selected:File,nextFormat:ImportFormat,fromPicker=true)=>{
    const request=++version.current;reader.current?.dispose();reader.current=null;
    setFile(selected);setFormat(nextFormat);setInfo(null);setError('');setIssues([]);
    if(nextFormat!=='excel'){
      setReading(false);
      // GeoJSON has no column mapping step. Selecting another file should add it
      // immediately; replacing a populated workspace still needs explicit submit.
      if(fromPicker&&(append||count===0)&&!(append&&hasDraft))await submit(selected,'geojson',true);
      return;
    }
    if(selected.size>MAX_EXCEL_BYTES){setError('Excel dosyası en fazla 25 MB olabilir. Büyük veriyi GeoJSON olarak açın.');return;}
    setReading(true);
    try{
      const bytes=await selected.arrayBuffer();if(request!==version.current)return;
      const next=new ImportReader();reader.current=next;
      const result=await next.load(bytes);if(request!==version.current)return;
      setInfo(result);setKind(result.kind);
    }catch(cause){if(request===version.current)setError((cause as Error).message);}
    finally{if(request===version.current)setReading(false);}
  };
  const first=useRef(initialFile);
  useEffect(()=>{if(first.current){const chosen=first.current;first.current=null;void load(chosen,/\.xlsx?$/i.test(chosen.name)?'excel':'geojson');}},[]);
  const changeSheet=async(sheet:string)=>{
    if(!reader.current)return;setReading(true);setError('');setIssues([]);
    const request=++version.current;
    try{const result=await reader.current.sheet(sheet);if(request===version.current){setInfo(result);setKind(result.kind);}}
    catch(cause){if(request===version.current)setError((cause as Error).message);}
    finally{if(request===version.current)setReading(false);}
  };
  const setColumn=(field:'latitude'|'longitude'|'geometry',value:number)=>{setInfo(current=>current?{...current,[field]:value}:current);setError('');setIssues([]);};
  const columnSelect=(label:string,field:'latitude'|'longitude'|'geometry')=><label className="import-field">{label}<select aria-label={label} value={info?.[field]??-1} disabled={locked||!info} onChange={event=>setColumn(field,Number(event.target.value))}><option value={-1}>Sütun seçin</option>{info?.columns.map(column=><option key={column.index} value={column.index}>{column.name}</option>)}</select></label>;
  const ready=!!file&&(format==='geojson'||!!info&&(kind==='coordinates'?info.latitude>=0&&info.longitude>=0&&info.latitude!==info.longitude:info.geometry>=0));
  const submit=async(selected=file,selectedFormat=format,fromPicker=false)=>{
    if(!selected||(!fromPicker&&!ready)||busy||reading||submission.current||append&&hasDraft)return;
    const request=version.current;submission.current=true;setSubmitting(true);setError('');setIssues([]);
    try{
      let incoming=selected,skippedRows=0;
      if(selectedFormat==='excel'){
        const result=await reader.current!.convert({...info!,kind});
        if(request!==version.current)return;
        if(result.issues?.length){setIssues(result.issues);return;}
        if(!result.blob)throw new Error('Excel verisi dönüştürülemedi.');
        skippedRows=result.skippedRows??0;
        incoming=new File([result.blob],selected.name.replace(/\.[^.]+$/,'.geojson'),{type:'application/geo+json'});
      }
      if(await onImport(incoming,append,skippedRows))onClose();
    }catch(cause){if(request===version.current)setError((cause as Error).message);}
    finally{submission.current=false;if(request===version.current)setSubmitting(false);}
  };
  return <div className="modal-backdrop import-backdrop" onClick={()=>{if(!busy)onClose();}} onDragOver={event=>{event.preventDefault();event.stopPropagation();}} onDrop={event=>{event.preventDefault();event.stopPropagation();const chosen=event.dataTransfer.files[0];if(chosen&&!locked)void load(chosen,/\.xlsx?$/i.test(chosen.name)?'excel':'geojson');}}><div ref={dialog} className="standard-import-dialog" role="dialog" aria-modal="true" aria-labelledby="standard-import-title" onClick={event=>event.stopPropagation()}>
    <header><PlusCircle size={17}/><h2 id="standard-import-title">İçe aktar{file?` · ${file.name}`:''}</h2><button className="icon-button" aria-label="İçe aktarmayı kapat" disabled={busy} onClick={onClose}><X size={18}/></button></header>
    <form onSubmit={event=>{event.preventDefault();void submit();}}>
      <div className="import-file-picker">{!file&&<span>Harita verisi içeren dosyayı seçin veya buraya bırakın.</span>}<button type="button" className="button secondary" disabled={locked} onClick={()=>input.current?.click()}><FileUp size={14}/>{file?'Dosyayı değiştir':'Dosya seç'}</button><input ref={input} className="sr-only" tabIndex={-1} type="file" accept=".json,.geojson,.xls,.xlsx" aria-label="İçe aktarılacak dosya" disabled={locked} onChange={event=>{const chosen=event.target.files?.[0];event.target.value='';if(chosen)void load(chosen,/\.xlsx?$/i.test(chosen.name)?'excel':'geojson');}}/></div>
      <label className="import-field">Dosya biçimi<select aria-label="Dosya biçimi" value={format} disabled={locked} onChange={event=>{const next=event.target.value as ImportFormat;if(file)void load(file,next,false);else setFormat(next);}}><option value="geojson">GeoJSON (.json, .geojson)</option><option value="excel">Excel (.xls, .xlsx)</option></select></label>
      {format==='geojson'&&<p className="import-note">{append||count===0?'JSON / GeoJSON dosyasını seçtiğinizde şekiller çalışmaya otomatik eklenir.':'Dosyayı seçtikten sonra İçe aktar ile mevcut çalışmayı değiştirin.'}</p>}
      {format==='excel'&&<><fieldset className="import-kind"><legend>Veri türü</legend>{kinds.map(item=><label key={item.value}><input type="radio" name="import-kind" value={item.value} checked={kind===item.value} disabled={locked} onChange={()=>{setKind(item.value);setError('');setIssues([]);if(info&&item.value!=='coordinates'){const match=info.columns.find(column=>column.name.toLowerCase().includes(item.value));if(match)setColumn('geometry',match.index);}}}/>{item.label}</label>)}</fieldset><div className="import-mapping"><label className="import-field">Sayfa<select aria-label="Çalışma sayfası" value={info?.sheet??''} disabled={locked||!info} onChange={event=>void changeSheet(event.target.value)}>{!info&&<option value="">Dosya seçin</option>}{info?.sheets.map(sheet=><option key={sheet}>{sheet}</option>)}</select></label>{kind==='coordinates'?<>{columnSelect('Enlem sütunu','latitude')}{columnSelect('Boylam sütunu','longitude')}</>:<div className="import-geometry-field">{columnSelect(`${kind==='geojson'?'GeoJSON':kind==='wkt'?'WKT':'Polyline'} sütunu`,'geometry')}</div>}</div><p className="import-note">{kind==='coordinates'?'Her satır bir nokta olur. Poligon için GeoJSON veya WKT sütununu seçin.':kind==='geojson'?info&&info.geometry>=0?`“${info.columns.find(column=>column.index===info.geometry)?.name}” sütunundaki JSON okunacak. Poligonları açmak için İçe aktar’a basın.`:'JSON kodlarının bulunduğu sütunu seçin, ardından İçe aktar’a basın.':'Seçilen sütun geometridir; diğer sütunlar şeklin özniteliklerine eklenir.'} {info?`${info.rowCount.toLocaleString('tr-TR')} veri satırı.`:''}</p></>}
      {(reading||submitting)&&<p className="import-reading" role="status"><LoaderCircle className="spin" size={14}/>{reading?'Dosya okunuyor…':'Veri içe aktarılıyor…'}</p>}
      {format==='excel'&&<p className="import-note">Excel sayı hücrelerinde daha önce kaybolmuş basamaklar geri getirilemez. Büyük kimlikleri kaynak Excel dosyasında metin olarak saklayın; metin kimlikler korunur.</p>}
      {count>0&&<label className="import-append"><input type="checkbox" checked={append} disabled={locked} onChange={event=>setAppend(event.target.checked)}/>Çalışmaya ekle ({count.toLocaleString('tr-TR')} mevcut şekli koru)</label>}
      {!append&&dirty&&<p className="import-warning">Mevcut çalışma ve dışa aktarılmamış değişiklikleri bu dosyayla değiştirilecek.</p>}
      {append&&hasDraft&&<p className="import-warning">Eklemeden önce JSON taslağını uygulayın veya taslağı bırakıp güncel veriyi yükleyin.</p>}
      {error&&<p className="import-error" role="alert">{error}</p>}
      {issues.length>0&&<div className="import-error" role="alert"><strong>Veri içe aktarılmadı.</strong><ul>{issues.slice(0,10).map((issue,index)=><li key={index}>{issue.row>0?`Satır ${issue.row}: `:''}{issue.message}</li>)}</ul>{issues.length>10&&<span>İlk 10 hata gösteriliyor.</span>}</div>}
      <footer><button type="button" className="button secondary" disabled={busy} onClick={onClose}>İptal</button><button className="button primary" type="submit" disabled={locked||!ready||append&&hasDraft}>İçe aktar</button></footer>
    </form>
  </div></div>;
}
