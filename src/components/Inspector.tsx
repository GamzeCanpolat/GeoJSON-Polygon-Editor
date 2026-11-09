import { parseJson, stringifyJson } from '../domain/losslessJson';
import { useEffect, useMemo, useState } from 'react';
import { Braces, Check, ChevronRight, Crosshair, FolderTree, Pencil, Pentagon, Plus, X } from 'lucide-react';
import type { CategoryGroup, FeatureRecord, GeoFeature } from '../domain/contracts';
import { assignCategories, categoryKey, featureCategories } from '../domain/categories';
import { validateFeature } from '../domain/geoJsonValidation';
import { measureGeometry } from '../domain/measurements';

interface Props { record: FeatureRecord | null; busy: boolean; catalog: CategoryGroup[]; onManageCategories(): void; onApply(feature: GeoFeature): Promise<boolean>; onFocus(): void; onClose(): void; onEdit(): void }
const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const km = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 6 });

function Metric({ label, value, area = false }: { label: string; value: number; area?: boolean }) {
  return <div><span>{label}</span><strong>{nf.format(value)} {area ? 'm²' : 'm'}</strong>
    <span>{km.format(value / (area ? 1e6 : 1000))} {area ? 'km²' : 'km'}</span></div>;
}

export function Inspector({ record, busy, catalog, onManageCategories, onApply, onFocus, onClose, onEdit }: Props) {
  const geometry = record?.feature.geometry;
  const measurement = useMemo(() => measureGeometry(geometry), [geometry]);
  const [tab, setTab] = useState<'properties' | 'json'>('properties');
  const [draft, setDraft] = useState('');
  const [json, setJson] = useState('');
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    setDraft(stringifyJson(record?.feature.properties ?? {}, 2));
    setJson(stringifyJson(record?.feature ?? {}, 2)); setError(''); setChanged(false);
  }, [record]);
  const parsedEditing = useMemo(() => {
    try {
      if (!record) return { feature: null, error: null };
      const feature = validateFeature(tab === 'json' ? parseJson(json) : { ...record.feature, properties: parseJson(draft) });
      return { feature, error: null };
    } catch (error) { return { feature: null, error: error as Error }; }
  }, [record, tab, json, draft]);
  const editingFeature = (): GeoFeature => {
    if (parsedEditing.error) throw parsedEditing.error;
    return parsedEditing.feature!;
  };
  const setEditingFeature = (feature: GeoFeature) => {
    setDraft(stringifyJson(feature.properties, 2)); setJson(stringifyJson(feature, 2));
  };
  const changeTab = (next: typeof tab) => {
    try { if (record) setEditingFeature(editingFeature()); setTab(next); setError(''); }
    catch { setError('Sekme değiştirmeden önce JSON sözdizimini düzeltin.'); }
  };
  let chosen = { main: '', sub: '' }, categoryInputValid = true;
  try { if (record) chosen = featureCategories(editingFeature()); } catch { categoryInputValid = false; }
  const group = catalog.find((item) => categoryKey(item.name) === categoryKey(chosen.main));
  const mainValue = group?.name ?? chosen.main;
  const subValue = group?.subcategories.find((name) => categoryKey(name) === categoryKey(chosen.sub)) ?? chosen.sub;
  const mainOptions = catalog.map((item) => item.name); if (mainValue && !mainOptions.includes(mainValue)) mainOptions.push(mainValue);
  const subOptions = [...(group?.subcategories ?? [])]; if (subValue && !subOptions.includes(subValue)) subOptions.push(subValue);
  const changeCategories = (main: string, sub: string) => {
    try { setEditingFeature(assignCategories(editingFeature(), main, sub)); setChanged(true); setError(''); }
    catch { setError('Kategori seçmeden önce JSON sözdizimini düzeltin.'); }
  };
  const apply = async () => {
    if (!record) return;
    try {
      const feature = editingFeature();
      if (await onApply(feature)) { setChanged(false); setError(''); }
    } catch (err) { setError(`JSON okunamadı: ${err instanceof Error ? err.message : 'Sözdizimini kontrol edin.'}`); }
  };
  return <aside className="inspector" aria-label="Şekil detayları">
    <div className="panel-heading"><span>ÖZELLİKLER</span><button className="icon-button" onClick={onClose} title="Detay panelini kapat" aria-label="Detay panelini kapat"><X size={17} /></button></div>
    <div className="inspector-tabs" role="tablist" aria-label="Şekil bilgisi">
      <button role="tab" aria-selected={tab === 'properties'} className={tab === 'properties' ? 'active' : ''} onClick={() => changeTab('properties')}><Pentagon size={15} />Detaylar</button>
      <button role="tab" aria-selected={tab === 'json'} className={tab === 'json' ? 'active' : ''} onClick={() => changeTab('json')}><Braces size={15} />GeoJSON</button>
    </div>
    {!record ? <div className="inspector-empty"><div className="empty-geometry"><Pencil size={32} strokeWidth={1.5} /></div><h3>Bir şekil seçin</h3><p>Listeden veya haritadan bir şekil seçerek ayrıntılarını görün ve düzenlemeye başlayın.</p><div className="tiny-instruction"><span>01</span> Seçin <ChevronRight size={13} /><span>02</span> Düzenleyin</div></div> : <>
      <div className="selected-heading"><span className="eyebrow">SEÇİLİ ŞEKİL</span><h2>{record.summary.label}</h2><div className="type-chip"><Pentagon size={12} />{record.summary.geometryType}</div></div>
      <div className="metrics" aria-label="Seçili şeklin ölçüleri">
        <div><span>Köşe sayısı</span><strong>{nf.format(record.summary.vertices)}</strong></div>
        {measurement?.kind === 'polygon' && <>
          <Metric label="Alan" value={measurement.area} area />
          <Metric label="Çevre" value={measurement.perimeter} />
        </>}
        {measurement?.kind === 'line' && <Metric label="Uzunluk" value={measurement.length} />}
      </div>
      <div className="inspector-actions"><button className="button secondary" disabled={busy || !record.feature.geometry} onClick={onEdit}><Pencil size={14} />Köşeleri düzenle</button><button className="icon-button bordered" disabled={!record.summary.bounds} onClick={onFocus} title="Seçime yakınlaş" aria-label="Seçime yakınlaş"><Crosshair size={16} /></button></div>
      <section className="category-assignment" aria-label="Şekil kategorileri">
        <div className="category-assignment-heading"><span><FolderTree size={14} />KATEGORİLER</span><button className="icon-button" onClick={onManageCategories} disabled={busy} title="Kategori ekle veya yönet" aria-label="Kategori ekle veya yönet"><Plus size={16} /></button></div>
        <label htmlFor="feature-main-category">Ana kategori</label>
        <select id="feature-main-category" value={mainValue} disabled={busy || !categoryInputValid} onChange={(event) => changeCategories(event.target.value, '')}><option value="">Kategori seçilmedi</option>{mainOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <label htmlFor="feature-sub-category">Alt kategori</label>
        <select id="feature-sub-category" value={subValue} disabled={busy || !mainValue || !categoryInputValid} onChange={(event) => changeCategories(mainValue, event.target.value)}><option value="">{!mainValue ? 'Önce ana kategori seçin' : 'Alt kategori seçilmedi'}</option>{subOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <button className="category-manage-link" disabled={busy} onClick={onManageCategories}><Plus size={12} />Yeni ana / alt kategori ekle</button>
        <button className="button secondary category-apply" disabled={busy || !changed} onClick={() => void apply()}><Check size={14} />Kategori seçimini uygula</button>
      </section>
      <div className="editor-caption"><span>{tab === 'json' ? 'FEATURE · WGS84' : 'ÖZNİTELİKLER · JSON'}</span><span>{changed ? 'Düzenlendi' : 'Düzenlenebilir'}</span></div>
      <div className="json-editor"><div className="editor-dots"><i /><i /><i /><span>{tab === 'json' ? 'feature.geojson' : 'properties.json'}</span></div><textarea spellCheck={false} aria-label={tab === 'json' ? 'Seçili şeklin GeoJSON verisi' : 'Şekil öznitelikleri'} value={tab === 'json' ? json : draft} disabled={busy} onChange={(event) => { (tab === 'json' ? setJson : setDraft)(event.target.value); setChanged(true); }} /></div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="button primary apply-button" disabled={busy || !changed} onClick={() => void apply()}><Check size={15} />Değişiklikleri uygula</button>
      <p className="inspector-note">Düzenlemeler bu oturumda tutulur. Dosyanızı kaydetmek için dışa aktarın.</p>
    </>}
    <div className="inspector-footer"><span className="status-dot" /> EPSG:4326 <span>WGS 84</span></div>
  </aside>;
}
