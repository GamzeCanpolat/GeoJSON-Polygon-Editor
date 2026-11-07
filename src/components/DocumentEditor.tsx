import { parseJson } from '../domain/losslessJson';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Code2, RefreshCw } from 'lucide-react';
import type { DatasetSummary, FeatureRecord, GeoFeature, GeoJsonRepository } from '../domain/contracts';
import { EMPTY_DOCUMENT, featureFromEditor, formatEditorDocument, isLargeDocument, MAX_EDITOR_TEXT, parseEditorDocument } from '../domain/editorDocument';

interface Props {
  repository: GeoJsonRepository; dataset: DatasetSummary | null; record: FeatureRecord | null; busy: boolean;
  onReplace(text: string): Promise<boolean>; onApply(feature: GeoFeature): Promise<boolean>;
  onDraftChange(changed: boolean): void;
}
export function DocumentEditor(props: Props) {
  const [code, setCode] = useState(EMPTY_DOCUMENT);
  const [scope, setScope] = useState<'document'|'feature'>('document');
  const [changed, setChanged] = useState(false), [conflict, setConflict] = useState(false);
  const [auto, setAuto] = useState(true), [loading, setLoading] = useState(false);
  const [error, setError] = useState(''), [limit, setLimit] = useState('');
  const current = useRef(props); current.current = props;
  const dirty = useRef(false), applying = useRef(false), version = useRef(0), textRef = useRef(code);
  const ownUpdate = useRef(false);
  const gutter = useRef<HTMLPreElement>(null);
  const setDirty = (value: boolean) => { dirty.current = value; setChanged(value); current.current.onDraftChange(value); };
  const large = isLargeDocument(props.dataset);
  useEffect(() => { if (large && !dirty.current) setScope('feature'); }, [large]);
  const load = async (requested: typeof scope = scope) => {
    const request = ++version.current;
    setLoading(true); setError(''); setLimit('');
    try {
      let text = EMPTY_DOCUMENT;
      if (requested === 'document') {
        if (isLargeDocument(current.current.dataset)) {
          setScope('feature'); setLimit('Büyük dosyada kod editörü seçili şekli gösterir. Tablo ve dışa aktarma tüm kayıtları içerir.');
          requested = 'feature';
        } else {
          const blob = await current.current.repository.export();
          if (request !== version.current) return;
          if (blob.size > MAX_EDITOR_TEXT) { setScope('feature'); requested = 'feature'; setLimit('Tüm dosya kod editörü sınırını aşıyor; seçili şekli düzenleyin.'); }
          else {
            try { text = formatEditorDocument(parseJson(await blob.text())); }
            catch(cause) { if((cause as Error).message.includes('sınırını')){setScope('feature');requested='feature';setLimit((cause as Error).message);}else throw cause; }
          }
        }
      }
      if (requested === 'feature') {
        const record = current.current.record;
        if (!record) text = '';
        else if (record.summary.vertices > 50000) { text = ''; setLimit('Seçili şekil kod editörü için çok ayrıntılı. Haritada düzenleyip dışa aktarabilirsiniz.'); }
        else text = formatEditorDocument((await current.current.repository.get(record.summary.id)).feature);
      }
      if (request !== version.current) return;
      textRef.current = text; setCode(text); setDirty(false); setConflict(false);
    } catch (cause) { if (request === version.current) setError((cause as Error).message); }
    finally { if (request === version.current) setLoading(false); }
  };
  useEffect(() => {
    if (!props.dataset) return;
    if (ownUpdate.current) { ownUpdate.current = false; return; }
    if (applying.current) return;
    if (dirty.current) { version.current++; setLoading(false); setConflict(true); return; }
    void load(scope);
  }, [props.dataset, scope, scope === 'feature' ? props.record?.summary.id : null]);
  useEffect(() => () => { version.current++; }, []);
  const apply = async () => {
    if (!dirty.current || applying.current || current.current.busy || conflict) return;
    const submitted = textRef.current;
    try {
      parseEditorDocument(submitted, scope === 'feature');
      applying.current = true; ownUpdate.current = true; setError('');
      const ok = scope === 'feature' ? await current.current.onApply(featureFromEditor(submitted)) : await current.current.onReplace(submitted);
      if (ok) { setDirty(false); setConflict(false); }
      else { ownUpdate.current = false; setError('Değişiklik uygulanamadı. Haritadaki veri korundu.'); }
    } catch (cause) { ownUpdate.current = false; setError((cause as Error).message); }
    finally { applying.current = false; }
  };
  useEffect(() => {
    if (!changed || conflict || props.busy) return;
    try { parseEditorDocument(code, scope === 'feature'); setError(''); }
    catch (cause) { setError((cause as Error).message); return; }
    if (!auto) return;
    const timer = setTimeout(() => { void apply(); }, 700);
    return () => clearTimeout(timer);
  }, [code, changed, auto, conflict, props.busy, scope]);
  const format = () => {
    try { const text = formatEditorDocument(parseEditorDocument(code,scope==='feature')); setCode(text); textRef.current=text; setError(''); }
    catch(cause){setError((cause as Error).message);}
  };
  const readOnly = props.busy || loading || scope === 'feature' && (!props.record || !code && !!limit);
  return <div className="document-editor">
    <div className="code-toolbar"><select aria-label="JSON kapsamı" value={scope} disabled={props.busy || changed} onChange={(event)=>setScope(event.target.value as typeof scope)}><option value="document" disabled={large}>Tüm dosya · FeatureCollection</option><option value="feature">Seçili şekil · Feature</option></select><button className="icon-button" aria-label="Haritadaki JSON’u yükle" title="Taslağı bırak, haritadaki veriyi yükle" disabled={props.busy||loading} onClick={()=>{setDirty(false);void load(scope);}}><RefreshCw size={14}/></button><button className="icon-button" aria-label="JSON biçimlendir" title="JSON biçimlendir" disabled={readOnly} onClick={format}><Code2 size={16}/></button></div>
    {(limit||large)&&<p className="code-info">{limit||'Büyük dosyada kod editörü seçili şekli gösterir. Tablo ve dışa aktarma tüm kayıtları içerir.'}</p>}
    <div className="code-editor"><pre ref={gutter} className="code-lines" aria-hidden="true">{Array.from({length:Math.max(1,code.split('\n').length)},(_,i)=>i+1).join('\n')}</pre><textarea aria-label="GeoJSON kod editörü" spellCheck={false} wrap="off" value={code} readOnly={readOnly} placeholder={scope==='feature'?'Haritadan veya listeden bir şekil seçin.':'GeoJSON yazın veya yapıştırın…'} onScroll={(event)=>{if(gutter.current)gutter.current.scrollTop=event.currentTarget.scrollTop;}} onChange={(event)=>{version.current++;setLoading(false);textRef.current=event.target.value;setCode(event.target.value);setDirty(true);}} onKeyDown={(event)=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void apply();}}}/></div>
    {conflict&&<div className="code-conflict" role="alert">Taslağı yazarken haritadaki veri değişti. Taslağı uygulamadan önce güncel veriyi yükleyin.<button className="button secondary" onClick={()=>{setDirty(false);void load(scope);}}><RefreshCw size={13}/>Güncel veriyi yükle</button></div>}
    {error&&<p className="code-error" role="alert"><AlertCircle size={13}/>{error}</p>}
    <div className="code-status"><label><input type="checkbox" checked={auto} onChange={(event)=>setAuto(event.target.checked)}/>Otomatik uygula</label><span role="status">{loading?'Veri okunuyor…':error?'Kontrol gerekli':conflict?'Harita değişti':changed?'Taslak':<><Check size={12}/>Senkronize</>}</span><button className="button primary" disabled={!changed||props.busy||loading||!!error||conflict} onClick={()=>void apply()}>Uygula</button></div>
  </div>;
}
