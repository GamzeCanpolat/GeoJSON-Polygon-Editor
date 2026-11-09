import { useEffect, useRef, useState } from 'react';
import mapinDataLogo from './assets/mapin-data-logo.svg';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, CircleHelp, Circle, CircleDot, Crosshair, Download, Eye, EyeOff, FileJson2, FolderOpen, FolderTree, Layers3, LoaderCircle, Magnet, Maximize, Moon, MousePointer2, Move, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Pentagon, Plus, Redo2, Search, Square, Spline, ShieldCheck, Sun, Trash2, Undo2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import { MapCanvas } from './components/MapCanvas';
import { CoordinateNavigation } from './components/CoordinateNavigation';
import { DataPanel } from './components/DataPanel';
import { isLargeDocument, MAX_EDITOR_TEXT, parseEditorDocument } from './domain/editorDocument';
import { CategoryManager } from './components/CategoryManager';
import { ImportDialog } from './components/ImportDialog';
import { FeatureList } from './components/FeatureList';
import { ImportReader } from './data/ImportReader';
import { exportTabularFile } from './data/exportTabularFile';
import type { ExportFormat } from './data/tabularExport';
import { BasemapPicker } from './components/BasemapPicker';
import { createRepository } from './data/createRepository';
import { PendingEditorEdits } from './data/PendingEditorEdits';
import { ApiGeoJsonRepository } from './adapters/api/ApiGeoJsonRepository';
import { ProjectManagementFeature } from './components/projects/ProjectManagement';
import { ProjectNameDialog } from './components/projects/ProjectDialogs';
import type { Project } from './domain/projects';
import { useTheme } from './useTheme';
import type { CategoryGroup, DatasetSummary, FeaturePage, FeatureRecord, GeoFeature, ImportProgress } from './domain/contracts';
import type { Basemap, EditorMode, MapController } from './map/MapController';

type HistoryEntry = { kind: 'feature'; id: string; before: GeoFeature | null; after: GeoFeature | null; size: number } | { kind: 'document'; before: string; after: string; name: string; size: number };
type Notice = { kind: 'success' | 'error' | 'info'; message: string };
const nf = new Intl.NumberFormat('tr-TR');
const sizeText = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const modes: { id: EditorMode; icon: typeof MousePointer2; label: string; key: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Seç', key: 'V' },
  { id: 'point', icon: CircleDot, label: 'Nokta çiz', key: 'N' },
  { id: 'line', icon: Spline, label: 'Çizgi çiz', key: 'L' },
  { id: 'draw', icon: Pentagon, label: 'Poligon çiz', key: 'P' },
  { id: 'rectangle', icon: Square, label: 'Dikdörtgen çiz', key: 'R' },
  { id: 'circle', icon: Circle, label: 'Daire çiz', key: 'C' },
  { id: 'edit', icon: Pencil, label: 'Köşeleri düzenle', key: 'E' },
  { id: 'move', icon: Move, label: 'Şekli taşı', key: 'M' },
];
const modeHints: Record<EditorMode, [string, string]> = {
  select: ['Keşfedin ve seçin', 'Bir şekle tıklayın, ayrıntılarını görün.'],
  point: ['Nokta ekleyin', 'Haritada konumuna tıklayın.'],
  line: ['Bir çizgi çizin', 'Köşeler için tıklayın. Çift tıklama ile tamamlayın.'],
  rectangle: ['Dikdörtgen çizin', 'Karşılıklı iki köşeye tıklayın.'],
  circle: ['Daire çizin', 'Merkeze ve çemberin kenarına tıklayın.'],
  draw: ['Yeni bir alan çizin', 'Köşeler için tıklayın. Çift tıklama ile tamamlayın.'],
  edit: ['Köşeleri düzenleyin', 'Köşeyi sürükleyin · Kenara tıklayıp köşe ekleyin · Alt + tıklama ile silin'],
  move: ['Alanı taşıyın', 'Seçili şekli sürükleyerek yeni konumuna taşıyın.'],
};

export function App() {
  const { theme, toggleTheme } = useTheme();
  const [repository] = useState(createRepository);
  const projectsEnabled = import.meta.env.VITE_PROJECT_MANAGEMENT === 'true' && repository instanceof ApiGeoJsonRepository;
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const workspaceVersion = useRef(0);
  const startup = useRef<Promise<DatasetSummary> | null>(null);
  const initialized = useRef(false);
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const map = useRef<MapController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dataset, setDataset] = useState<DatasetSummary | null>(null);
  const [selected, setSelected] = useState<FeatureRecord | null>(null);
  const [mode, setMode] = useState<EditorMode>('select');
  const [basemap, setBasemap] = useState<Basemap>('osm');
  const [snap, setSnap] = useState(false);
  const [visible, setVisible] = useState(true);
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth >= 760);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth >= 900);
  const [busy, setBusy] = useState<'init' | 'import' | 'export' | 'edit' | null>('init');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [dirty, setDirty] = useState(false);
  const [codeDirty, setCodeDirty] = useState(false);
  const codeDirtyRef=useRef(false);
  const [tableDirty,setTableDirty]=useState(false);
  const [tableEdits]=useState(()=>new PendingEditorEdits(setTableDirty));
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<FeaturePage>({ items: [], total: 0 });
  const [viewport, setViewport] = useState({ shown: 0, matched: 0, limited: false });
  const [coordinate, setCoordinate] = useState('—');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [help, setHelp] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [catalog, setCatalog] = useState<CategoryGroup[]>([]);
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const [confirmSaveName, setConfirmSaveName] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const operationLock = useRef(true);
  const selectionVersion = useRef(0);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);

  const notify = (kind: Notice['kind'], message: string) => setNotice({ kind, message });
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 6500); return () => clearTimeout(timer); }, [notice]);
  const resetState = (clearProject = true) => {
    workspaceVersion.current++; if (clearProject) setActiveProject(null);
    setPage({items:[],total:0}); setCatalog([]); setViewport({shown:0,matched:0,limited:false});
    map.current?.abortDrawing(); map.current?.showSelected(null); map.current?.refresh();
    selectionVersion.current++; setSelected(null); setUndoStack([]); setRedoStack([]); setDirty(false);
    codeDirtyRef.current=false;
    setSearch(''); setOffset(0); setMode('select'); setVisible(true); setCodeDirty(false); setWorkspaceKey(value => value + 1); setHiddenIds(new Set());
  };
  useEffect(() => {
    clearTimeout(disposeTimer.current);
    let active = true;
    if (!initialized.current) {
      startup.current ??= repository.createEmpty();
      startup.current.then((summary) => {
        if (!active) return;
        initialized.current = true; setDataset(summary);
      }).catch((error: Error) => { if (active) notify('error', error.message); })
        .finally(() => { if (active) { setBusy(null); operationLock.current = false; } });
    }
    // React may replay effects while refreshing source code. Keep the live
    // workspace if the same workspace component immediately subscribes again.
    return () => { active = false; disposeTimer.current = setTimeout(() => repository.dispose(), 0); };
  }, [repository]);
  useEffect(() => {
    let active = true;
    const version = workspaceVersion.current;
    const timer = setTimeout(() => {
      if (!dataset) return;
      repository.list(search, offset, 50).then((result) => { if (active && version === workspaceVersion.current) setPage(result); }).catch((error: Error) => { if (active && version === workspaceVersion.current) notify('error', error.message); });
    }, search ? 180 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [repository, dataset, search, offset]);
  useEffect(() => {
    let active = true;
    const version = workspaceVersion.current;
    if (dataset) repository.categories().then((result) => { if (active && version === workspaceVersion.current) setCatalog(result); }).catch((error: Error) => { if (active && version === workspaceVersion.current) notify('error', error.message); });
    return () => { active = false; };
  }, [repository, dataset]);
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => { if (dirty || codeDirty || tableEdits.hasChanges() || projectsEnabled && map.current?.hasPendingEdits()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty, codeDirty]);

  const select = async (id: string | null, focus = false) => {
    if (operationLock.current) return;
    const version = ++selectionVersion.current;
    if (!id) { setSelected(null); return; }
    try {
      const record = await repository.get(id);
      if (version !== selectionVersion.current) return;
      setHiddenIds(previous=>{if(!previous.has(id))return previous;const next=new Set(previous);next.delete(id);return next;}); setVisible(true);
      setSelected(record); if(window.innerWidth >= 900) setRightOpen(true);
      if (record.feature.geometry?.type === 'Polygon' || record.feature.geometry?.type === 'MultiPolygon') setMode('edit');
      if (focus) map.current?.fit(record.summary.bounds);
    } catch (error) { if (version === selectionVersion.current) notify('error', (error as Error).message); }
  };
  const open = async (file: File, append = false, skippedRows = 0): Promise<boolean> => {
    if (operationLock.current) return false;
    operationLock.current = true; setBusy('import'); setProgress({ bytesRead: 0, totalBytes: file.size, featuresRead: 0 });
    selectionVersion.current++; map.current?.abortDrawing();
    abort.current = new AbortController();
    try {
      let incoming=file;
      if(append && dataset?.count) {
        const existing=await repository.export();
        if(abort.current.signal.aborted)throw new Error('Dosya açma iptal edildi.');
        const merger=new ImportReader(), signal=abort.current.signal;
        const cancelMerge=()=>merger.dispose('Dosya açma iptal edildi.');signal.addEventListener('abort',cancelMerge,{once:true});
        try { const combined=await merger.merge(existing,file,setProgress); incoming=new File([combined],dataset.name,{type:'application/geo+json'}); }
        finally { signal.removeEventListener('abort',cancelMerge);merger.dispose(); }
      }
      const summary = await repository.open(incoming, setProgress, abort.current.signal);
      resetState(false); setDataset(summary); if(projectsEnabled || append && dataset?.count) setDirty(true);
      requestAnimationFrame(() => map.current?.fit(summary.bounds));
      notify('success', `${nf.format(summary.count)} şekil açıldı. ${skippedRows?`${nf.format(skippedRows)} boş geometri satırı atlandı.`:summary.count ? 'Çalışmaya hazırsınız.' : 'Dosya boş bir koleksiyon içeriyor.'}`);
      return true;
    } catch (error) { if(abort.current.signal.aborted)notify('info',(error as Error).message); throw error; }
    finally { setBusy(null); setProgress(null); operationLock.current = false; abort.current = null; }
  };
  const guardReplace = (action: () => void) => { if (busy) return; if (dirty || codeDirty || tableEdits.hasChanges() || projectsEnabled && map.current?.hasPendingEdits()) setConfirmAction(() => action); else action(); };
  const beginImport = () => { if(!busy){setImportFile(null);setImportOpen(true);} };
  const receiveFile = (file: File) => {
    if (busy) return;
    if (!/\.(geojson|json|xls|xlsx)$/i.test(file.name)) { notify('error', 'GeoJSON (.json/.geojson) veya Excel (.xls/.xlsx) dosyası seçin.'); return; }
    setImportFile(file); setImportOpen(true);
  };
  const toggleFeature = (id:string) => {
    setHiddenIds(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});
    if(selected?.summary.id===id){setSelected(null);setMode('select');}
  };
  const newProject = async () => {
    if (operationLock.current) return;
    operationLock.current = true; setBusy('edit');
    try { const summary = await repository.createEmpty(); resetState(); setDataset(summary); notify('success', 'Yeni çalışma hazır. Poligon aracıyla çizmeye başlayın.'); }
    catch (error) { notify('error', (error as Error).message); }
    finally { setBusy(null); operationLock.current = false; }
  };
  const saveBeforeReplace = async (name?: string) => {
    if (operationLock.current || !(repository instanceof ApiGeoJsonRepository) || !confirmAction) return;
    if (codeDirty || map.current?.hasPendingEdits()) { notify('info', 'Önce JSON taslağını veya devam eden çizimi tamamlayın.'); return; }
    if (!activeProject && name === undefined) { setConfirmSaveName(true); return; }
    const action = confirmAction;
    let savedSuccessfully = false;
    try { await tableEdits.flush(); } catch(error) { notify('error',(error as Error).message);return; }
    if(operationLock.current)return;
    if(codeDirtyRef.current||map.current?.hasPendingEdits()){notify('info','Önce JSON taslağını veya devam eden çizimi tamamlayın.');return;}
    operationLock.current = true; setBusy('edit');
    try {
      const saved = activeProject ? await repository.projects.save(activeProject.id, activeProject.version) : await repository.projects.create(name!);
      setActiveProject(saved); setDirty(false); setConfirmAction(null); setConfirmSaveName(false);
      notify('success', `“${saved.name}” kaydedildi.`);
      savedSuccessfully = true;
    } catch (error) { notify('error', (error as Error).message); }
    finally { operationLock.current = false; setBusy(null); }
    if (savedSuccessfully) action();
  };
  const changeMode = (value: EditorMode) => {
    if (busy) return;
    if ((value === 'edit' || value === 'move') && !selected) { notify('info', 'Önce haritadan veya listeden bir şekil seçin.'); return; }
    if (!visible) setVisible(true);
    setMode(value);
  };
  const addCategory = async (name: string, parent?: string): Promise<boolean> => {
    if (operationLock.current) return false;
    operationLock.current = true; setBusy('edit');
    try {
      const result = await repository.addCategory(name, parent);
      setCatalog(result.catalog); setDataset(result.dataset); setDirty(true);
      return true;
    } catch (error) { notify('error', (error as Error).message); return false; }
    finally { setBusy(null); operationLock.current = false; }
  };
  const commit = async (feature: GeoFeature | null, create = false, target: FeatureRecord | null = selected): Promise<boolean> => {
    if (operationLock.current || (!create && !target)) return false;
    operationLock.current = true; setBusy('edit'); selectionVersion.current++;
    const before = create ? null : target!.feature;
    try {
      const result = await repository.mutate({ id: create ? undefined : target!.summary.id, feature });
      const entry = { kind: 'feature' as const, id: result.id, before, after: result.record?.feature ?? null, size: ((create ? 0 : target!.summary.vertices) + (result.record?.summary.vertices ?? 0)) * 40 + 2048 };
      if (entry.size <= 32 * 1024 * 1024) {
        setUndoStack((history) => {
          const items = [...history, entry].slice(-30);
          while (items.reduce((sum, item) => sum + item.size, 0) > 32 * 1024 * 1024) items.shift();
          return items;
        });
      } else { setUndoStack([]); notify('info', 'Bu şekil çok ayrıntılı olduğu için işlem geri alma geçmişine eklenmedi.'); }
      setRedoStack([]); setDataset(result.dataset); setSelected(result.record); setDirty(true);
      if (create) { setMode('edit'); if(window.innerWidth >= 900) setRightOpen(true); }
      if (!feature) { setMode('select'); notify('success', 'Şekil silindi. Geri al ile kurtarabilirsiniz.'); }
      return true;
    } catch (error) {
      // Restore the exact persisted geometry after a rejected interactive edit.
      map.current?.showSelected(target); notify('error', (error as Error).message); return false;
    } finally { setBusy(null); operationLock.current = false; }
  };
  const replaceFromCode = async (text: string): Promise<boolean> => {
    if(tableEdits.hasChanges()){notify('info','Önce tablo hücrelerini uygulayın veya iptal edin.');return false;}
    if (operationLock.current || isLargeDocument(dataset)) return false;
    operationLock.current = true; setBusy('edit'); selectionVersion.current++;
    try {
      parseEditorDocument(text);
      const previous = await repository.export();
      if (previous.size > MAX_EDITOR_TEXT) throw new Error('Tüm dosya kod editörü sınırını aşıyor. Seçili şekli düzenleyin.');
      const before = await previous.text(), name = dataset?.name ?? 'Adsız çalışma.geojson';
      const summary = await repository.open(new File([text], name, { type: 'application/geo+json' }));
      const entry: HistoryEntry = { kind: 'document', before, after: text, name, size: (before.length + text.length) * 2 };
      setUndoStack(history => {
        const base = history.some(item => item.kind === 'feature') ? [] : history;
        const items = [...base, entry].slice(-30);
        while (items.reduce((sum,item)=>sum+item.size,0) > 32*1024*1024) items.shift();
        return items;
      });
      setRedoStack([]); setDataset(summary); setSelected(null); setMode('select'); setDirty(true);
      if (!dataset?.count && summary.count) requestAnimationFrame(() => map.current?.fit(summary.bounds));
      return true;
    } catch(error) { notify('error',(error as Error).message); return false; }
    finally { setBusy(null); operationLock.current = false; }
  };
  const historyStep = async (direction: 'undo' | 'redo') => {
    if(tableEdits.hasChanges()){notify('info','Önce tablo hücrelerini uygulayın veya iptal edin.');return;}
    const stack = direction === 'undo' ? undoStack : redoStack;
    const entry = stack.at(-1); if (!entry || operationLock.current || codeDirty) return;
    operationLock.current = true; setBusy('edit'); selectionVersion.current++;
    try {
      if (entry.kind === 'document') {
        const text = direction === 'undo' ? entry.before : entry.after;
        const summary = await repository.open(new File([text], entry.name, {type:'application/geo+json'}));
        setDataset(summary); setSelected(null);
      } else {
        const result = await repository.mutate({ id: entry.id, feature: direction === 'undo' ? entry.before : entry.after });
        setDataset(result.dataset); setSelected(result.record);
      }
      setDirty(true); setMode('select');
      if (direction === 'undo') {
        setUndoStack((v) => v.slice(0, -1));
        setRedoStack((v) => [...(entry.kind === 'document' ? v.filter(item => item.kind === 'document') : v), entry]);
      } else {
        setRedoStack((v) => v.slice(0, -1));
        setUndoStack((v) => [...(entry.kind === 'document' ? v.filter(item => item.kind === 'document') : v), entry]);
      }
    } catch (error) { notify('error', (error as Error).message); }
    finally { setBusy(null); operationLock.current = false; }
  };
  const exportFile = async (format: ExportFormat = 'geojson') => {
    if (operationLock.current || !dataset || codeDirty) return;
    operationLock.current = true; setBusy('export'); setProgress(null); map.current?.abortDrawing();
    try {
      const source = await repository.export(setProgress);
      if (format !== 'geojson') setProgress(null);
      const blob = format === 'geojson' ? source : await exportTabularFile(source, format, setProgress);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${dataset.name.replace(/\.(geojson|json)$/i, '')}-duzenlendi.${format}`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      if (!projectsEnabled && format === 'geojson') setDirty(false);
      const label = { geojson: 'GeoJSON', xlsx: 'Excel', csv: 'CSV' }[format];
      notify('success', `${label} indirme işlemi başlatıldı.`);
    } catch (error) { notify('error', (error as Error).message); }
    finally { setBusy(null); setProgress(null); operationLock.current = false; }
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const key = event.key.toLowerCase();
      if (exportOpen) {
        if (key === 'escape') setExportOpen(false);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'o') { event.preventDefault(); if (!busy && !help && !confirmAction && !categoriesOpen && !importOpen) fileInput.current?.click(); return; }
      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault();
        if (codeDirty) notify('info', 'Önce geçerli JSON taslağını uygulayın.'); else if (!help && !confirmAction && !categoriesOpen && !importOpen) void exportFile();
        return;
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable || help || confirmAction || categoriesOpen || importOpen) return;
      if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); void historyStep(event.shiftKey ? 'redo' : 'undo'); return; }
      if ((event.ctrlKey || event.metaKey) && key === 'y') { event.preventDefault(); void historyStep('redo'); return; }
      if (event.ctrlKey || event.metaKey || event.altKey || busy) return;
      if (event.key === 'Escape') { map.current?.abortDrawing(); setMode('select'); return; }
      if (event.key === 'Enter' && (mode === 'draw' || mode === 'line')) { event.preventDefault(); map.current?.finishDrawing(); return; }
      if (event.key === 'Backspace' && (mode === 'draw' || mode === 'line')) { event.preventDefault(); map.current?.removeLastPoint(); return; }
      if (event.key === 'Delete' && selected) { event.preventDefault(); void commit(null); return; }
      const tool = modes.find((item) => item.key.toLowerCase() === key); if (tool) changeMode(tool.id);
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  });

  const status = tableDirty ? 'Uygulanmamış tablo değişiklikleri var' : codeDirty ? 'JSON taslağı henüz uygulanmadı' : busy === 'edit' ? 'Değişiklik işleniyor…' : dirty ? 'Dışa aktarılmamış değişiklikler' : 'Çalışma alanı hazır';
  const percent = progress?.totalBytes ? Math.round(progress.bytesRead / progress.totalBytes * 100) : 0;
  return <div className={`app geojson-workspace ${!leftOpen ? 'left-collapsed' : ''} ${!rightOpen ? 'right-collapsed' : ''}`}
    onDragEnter={(event) => { if (categoriesOpen || importOpen || !event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current++; setDragging(true); }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDragLeave={(event) => { event.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
    onDrop={(event) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (categoriesOpen || importOpen) return; const file = event.dataTransfer.files[0]; if (file) receiveFile(file); }}>
    <header className="topbar">
      <a className="brand" href="#" onClick={(event) => event.preventDefault()}>
        <img className="brand-logo" src={mapinDataLogo} alt="Mapin Data" width={1004} height={287} />
        <span className="brand-copy"><strong>GeoJSON Editor</strong><span title={dataset?.name}>{dataset?.name ?? 'Çalışma hazırlanıyor…'}</span></span>
      </a>
      <div className="topbar-divider" /><div className="breadcrumb"><strong>{dataset?.name ?? 'Yeni çalışma'}</strong></div>
      <ProjectManagementFeature repository={repository} dataset={dataset} activeProject={activeProject} dirty={dirty||tableDirty} hasDraft={codeDirty}
        editorBusy={!!busy || importOpen || categoriesOpen || help || !!confirmAction}
        hasPendingEdits={()=>map.current?.hasPendingEdits() ?? false}
        beforeOperation={async saving=>{await tableEdits.flush();if(saving&&codeDirtyRef.current)throw new Error('Önce JSON taslağını uygulayın veya iptal edin.');}}
        onActiveProjectChange={setActiveProject} onSaved={()=>setDirty(false)}
        onOpened={result=>{resetState();setDataset(result.workspace.dataset);requestAnimationFrame(()=>{map.current?.fit(result.workspace.dataset.bounds);map.current?.refresh();});}}
        onDeleted={id=>{if(activeProject?.id===id)setDirty(true);}}
        onOperationBusyChange={value=>{operationLock.current=value;setBusy(value?'edit':null);}}/>
      <div className="topbar-actions"><button className="icon-button reference-sidebar-toggle" aria-label={leftOpen?'Şekil listesini kapat':'Şekil listesini aç'} onClick={()=>setLeftOpen(value=>!value)}>{leftOpen?<PanelLeftClose size={16}/>:<PanelLeftOpen size={16}/>}</button>
        <button className="help-button" onClick={() => setHelp(true)} title="Kullanım kılavuzu" aria-label="Kullanım kılavuzu"><CircleHelp size={18} /></button>
        <button className="button secondary" aria-label="Yeni dosya" disabled={!!busy} onClick={() => guardReplace(() => void newProject())}><Plus size={15}/><span>Yeni</span></button>
        <button className="icon-button theme-toggle" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Aydınlık moda geç' : 'Koyu moda geç'} title={theme === 'dark' ? 'Aydınlık moda geç' : 'Koyu moda geç'}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
      </div>
      <input ref={fileInput} className="sr-only" type="file" accept=".geojson,.json,.xls,.xlsx,application/geo+json,application/json,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Harita dosyası seç" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) receiveFile(file); }} />
    </header>
    <div className="workspace-toolbar"><div className="workspace-title"><button className="icon-button" title={leftOpen ? 'Sol paneli kapat' : 'Sol paneli aç'} aria-label={leftOpen ? 'Sol paneli kapat' : 'Sol paneli aç'} onClick={() => setLeftOpen(!leftOpen)}>{leftOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button><span>Şekiller</span></div><div className="drawing-toolbar" role="toolbar" aria-label="Harita araçları">{modes.map(({ id, icon: Icon, label, key }) => <button key={id} className={`draw-tool ${mode === id ? 'active' : ''}`} title={`${label} (${key})`} aria-label={label} data-tool={id} aria-pressed={mode === id} disabled={!!busy} onClick={() => changeMode(id)}><Icon size={20} strokeWidth={1.65} /><span className="tool-tooltip">{label}<kbd>{key}</kbd></span></button>)}<span className="toolbar-rule" /><button className={`draw-tool ${snap ? 'toggled' : ''}`} title="Köşelere yakala (görünür şekiller)" aria-label="Köşelere yakala" aria-pressed={snap} disabled={!!busy} onClick={() => setSnap(!snap)}><Magnet size={19} strokeWidth={1.65} /></button><button className="draw-tool delete-tool" title="Seçili şekli sil (Delete)" aria-label="Seçili şekli sil" disabled={!selected || !!busy} onClick={() => void commit(null)}><Trash2 size={18} strokeWidth={1.65} /></button></div><div className="reference-file-actions"><button className="button secondary" aria-label="İçe aktar" disabled={!!busy} onClick={beginImport}><Upload size={14}/><span>İçe aktar</span></button><button className="button secondary" aria-label="Dışa aktar" disabled={!!busy || !dataset || codeDirty || !dataset.count && !catalog.length} onClick={()=>setExportOpen(true)}><Download size={14}/><span>Dışa aktar</span></button></div><div className="history-tools"><button className="icon-button" disabled={!undoStack.length || !!busy || codeDirty} title="Geri al (Ctrl+Z)" aria-label="Geri al" onClick={() => void historyStep('undo')}><Undo2 size={16} /></button><button className="icon-button" disabled={!redoStack.length || !!busy || codeDirty} title="Yinele (Ctrl+Shift+Z)" aria-label="Yinele" onClick={() => void historyStep('redo')}><Redo2 size={16} /></button><span className="tool-divider" /><button className="icon-button" title={rightOpen ? 'Veri panelini kapat' : 'Veri panelini aç'} aria-label={rightOpen ? 'Veri panelini kapat' : 'Veri panelini aç'} onClick={() => { if (rightOpen && (codeDirty || tableEdits.hasChanges())) notify('info','JSON taslağını uygulayın veya güncel veriyi yeniden yükleyin.'); else setRightOpen(!rightOpen); }}>{rightOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button></div></div>
    <main className="workspace">
      {leftOpen && <aside className="sidebar reference-sidebar" aria-label="Şekiller">
        <FeatureList key={workspaceKey} repository={repository} page={page} selected={selected} busy={!!busy} hidden={hiddenIds} search={search}
          onSearch={(value)=>{setSearch(value);setOffset(0);}} onSelect={(id)=>void select(id,true)} onToggle={toggleFeature}
          onFocus={()=>map.current?.fit(selected?.summary.bounds??null)} onDelete={()=>void commit(null)} onImport={beginImport}/>
        {page.total > 50 && <div className="pagination"><span>{nf.format(offset + 1)}–{nf.format(Math.min(offset + 50, page.total))} / {nf.format(page.total)}</span><button className="icon-button" aria-label="Önceki sayfa" disabled={offset === 0 || !!busy} onClick={() => setOffset(Math.max(0, offset - 50))}><ArrowLeft size={14} /></button><button className="icon-button" aria-label="Sonraki sayfa" disabled={offset + 50 >= page.total || !!busy} onClick={() => setOffset(offset + 50)}><ArrowRight size={14} /></button></div>}
        <details className="reference-settings"><summary>Kategoriler ve görünüm</summary><button className="button secondary" disabled={!!busy} onClick={()=>setCategoriesOpen(true)}><FolderTree size={13}/>Kategorileri yönet</button><button className="button secondary" onClick={()=>setVisible(value=>!value)}>{visible?<Eye size={13}/>:<EyeOff size={13}/>}Tüm şekilleri {visible?'gizle':'göster'}</button></details>
      </aside>}
      <section className="map-workspace" aria-label="Harita çalışma alanı">
        <MapCanvas ref={map} repository={repository} dataset={dataset} selected={selected} mode={mode} basemap={basemap} snap={snap} visible={visible} hiddenIds={hiddenIds} busy={!!busy} onSelect={(id) => void select(id)} onCreate={(feature) => void commit(feature, true)} onUpdate={(feature) => void commit(feature)} onViewport={setViewport} onCoordinate={setCoordinate} onError={(message) => notify('error', message)} />
        <CoordinateNavigation onNavigate={coordinate => map.current?.goToCoordinate(coordinate)}
          onClear={() => map.current?.clearCoordinateMarker()} />
        <div className="map-topline"><span className="map-location"><span className="status-dot" />ÇALIŞMA HARİTASI</span><button className="map-counter" onClick={() => map.current?.fit(dataset?.bounds ?? null)} title="Çalışmanın tamamına yakınlaş"><Pentagon size={13} />{nf.format(dataset?.count ?? 0)} şekil<Maximize size={12} /></button></div>

        <div className="map-navigation"><button title="Yakınlaş" aria-label="Yakınlaş" onClick={() => map.current?.zoom(1)}><ZoomIn size={18} /></button><button title="Uzaklaş" aria-label="Uzaklaş" onClick={() => map.current?.zoom(-1)}><ZoomOut size={18} /></button><span /><button title="Tümünü göster" aria-label="Tümünü göster" onClick={() => map.current?.fit(dataset?.bounds ?? null)}><Crosshair size={18} /></button></div>
        <button className="compass" title="Kuzeye dön" aria-label="Kuzeye dön" onClick={() => map.current?.north()}><span>N</span><svg viewBox="0 0 24 28" aria-hidden="true"><path d="M12 2 20 24 12 19 4 24Z" fill="#1e5141" /><path d="M12 2V19L4 24Z" fill="#a5b9ae" /></svg></button>
        <BasemapPicker value={basemap} onChange={setBasemap} onRetry={() => map.current?.refreshBasemap()} />
        <div className="map-hint"><span className="hint-icon">{mode === 'draw' ? <Pentagon size={17} /> : mode === 'edit' ? <Pencil size={17} /> : mode === 'move' ? <Move size={17} /> : <MousePointer2 size={17} />}</span><div><strong>{modeHints[mode][0]}</strong><span>{modeHints[mode][1]}</span></div>{mode === 'draw' && <kbd>ESC</kbd>}</div>
        {viewport.limited && <div className="performance-banner" role="status"><Layers3 size={15} /><span>Bu alandaki {nf.format(viewport.matched)} şeklin {nf.format(viewport.shown)} tanesi gösteriliyor. Ayrıntı için yakınlaşın.</span></div>}
        {busy === 'init' && <div className="map-loading"><LoaderCircle className="spin" size={23} /><span>Çalışma alanı hazırlanıyor…</span></div>}
      </section>
      {rightOpen && <DataPanel edits={tableEdits} repository={repository} dataset={dataset} record={selected} busy={!!busy} catalog={catalog} workspaceKey={workspaceKey}
        onReplace={replaceFromCode} onApply={(feature) => commit(feature)} onTableApply={(record,feature) => commit(feature,false,record)} onSelect={(id) => void select(id,true)} onDraftChange={value=>{codeDirtyRef.current=value;setCodeDirty(value);}}
        onManageCategories={() => setCategoriesOpen(true)} onFocus={() => map.current?.fit(selected?.summary.bounds ?? null)} onEdit={() => changeMode('edit')}
        onClose={() => { if(codeDirty||tableEdits.hasChanges()) notify('info','JSON/tablo taslağını uygulayın veya iptal edin.'); else setRightOpen(false); }} />}

    </main>
    <footer className="statusbar"><div><span className={`status-dot ${dirty ? 'unsaved' : ''}`} /><span>{status}</span></div><div className="footer-coordinates"><Crosshair size={12} />{coordinate}</div><div><span>{nf.format(viewport.shown)} görünür</span><span className="footer-divider" /><span>WGS 84</span><span className="footer-divider" /><span>GeoJSON</span></div></footer>
    {importOpen && <ImportDialog key={importFile?`${importFile.name}-${importFile.size}-${importFile.lastModified}`:'empty'} initialFile={importFile} busy={!!busy} count={dataset?.count??0} dirty={dirty||codeDirty} hasDraft={codeDirty} onImport={open} onClose={()=>{setImportOpen(false);setImportFile(null);}}/>}
    {exportOpen && <div className="modal-backdrop">
      <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="modal-icon"><Download size={24} /></div>
        <h2 id="export-title">Dışa aktarma biçimini seçin</h2>
        <p>Çalışmadaki tüm nesneler seçtiğiniz biçimde indirilir.</p>
        <div className="confirm-actions export-options">
          {([['geojson', 'GeoJSON (.geojson)'], ['xlsx', 'Excel (.xlsx)'], ['csv', 'CSV (.csv)']] as const).map(([format, label]) =>
            <button key={format} className={`button ${format === 'geojson' ? 'primary' : 'secondary'}`}
              autoFocus={format === 'geojson'} onClick={() => { setExportOpen(false); void exportFile(format); }}>{label}</button>)}
          <button className="button secondary" onClick={() => setExportOpen(false)}>Vazgeç</button>
        </div>
      </div>
    </div>}
    {notice && <div className={`toast ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.kind === 'success' ? <Check size={18} /> : notice.kind === 'error' ? <CircleHelp size={18} /> : <ShieldCheck size={18} />}<span>{notice.message}</span><button className="icon-button" onClick={() => setNotice(null)} aria-label="Bildirimi kapat"><X size={15} /></button></div>}
    {(busy === 'import' || busy === 'export') && <div className="modal-backdrop"><div className="progress-modal" role="dialog" aria-modal="true" aria-labelledby="progress-title"><div className="progress-symbol"><FileJson2 size={31} /><LoaderCircle className="spin" size={20} /></div><span className="eyebrow">{busy === 'import' ? 'DOSYANIZ HAZIRLANIYOR' : 'DOSYA OLUŞTURULUYOR'}</span><h2 id="progress-title">{busy === 'import' ? 'Yeni alanlar keşfediliyor.' : 'Çalışmanız yola çıkıyor.'}</h2><p>{busy === 'import' ? 'Dosya, haritayı yavaşlatmadan parça parça açılıyor.' : 'Tüm şekiller seçilen biçimde hazırlanıyor.'}</p><div className="progress-track"><span style={{ width: `${percent}%` }} /></div><div className="progress-details"><strong>%{percent}</strong><span>{nf.format(progress?.featuresRead ?? 0)} şekil {busy === 'import' && progress ? `· ${sizeText(progress.bytesRead)} / ${sizeText(progress.totalBytes)}` : ''}</span></div>{busy === 'import' && <button className="button secondary" onClick={() => abort.current?.abort()}>İptal et</button>}</div></div>}
    {dragging && !busy && <div className="drop-overlay"><Upload size={45} strokeWidth={1.3} /><h2>Dosyanızı buraya bırakın</h2><p>.geojson, .json, .xls veya .xlsx</p></div>}
    {categoriesOpen && <CategoryManager catalog={catalog} busy={!!busy} onAdd={addCategory} onClose={() => setCategoriesOpen(false)} />}
    {confirmAction && !confirmSaveName && <div className="modal-backdrop"><div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="replace-title"><div className="modal-icon"><FolderOpen size={24} /></div><h2 id="replace-title">Mevcut çalışma değiştirilsin mi?</h2><p>{projectsEnabled ? 'Kaydedilmemiş değişiklikleriniz var. JSON taslağı veya yarım çizim kaydetmeden devam ederseniz bırakılacak.' : 'Dışa aktarılmamış değişiklikleriniz var. Çalışmayı değiştirmeden önce dosyanızı indirebilirsiniz.'}</p><div className="confirm-actions">{projectsEnabled ? <><button className="button secondary" disabled={!!busy} onClick={()=>setConfirmAction(null)}>İptal</button><button className="button secondary" disabled={!!busy} onClick={()=>{const action=confirmAction;setConfirmAction(null);action();}}>Kaydetmeden Devam Et</button><button className="button primary" disabled={!!busy||codeDirty||!!map.current?.hasPendingEdits()} onClick={()=>void saveBeforeReplace()}>Kaydet</button></> : <><button className="button secondary" onClick={() => setConfirmAction(null)}>Vazgeç</button><button className="button secondary" onClick={() => { setConfirmAction(null); void exportFile(); }}><ArrowDownToLine size={15} />Önce dışa aktar</button><button className="button primary" onClick={() => { const action = confirmAction; setConfirmAction(null); action(); }}>Değiştir</button></>}</div></div></div>}
    {confirmAction && confirmSaveName && <ProjectNameDialog title="Yeni çalışmaya geçmeden kaydet" busy={!!busy} onClose={()=>setConfirmSaveName(false)} onSubmit={name=>void saveBeforeReplace(name)}/>}
    {help && <div className="modal-backdrop" onClick={() => setHelp(false)}><div className="help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(event) => event.stopPropagation()}><div className="help-heading"><span className="modal-icon"><Pentagon size={25} /></span><button className="icon-button" aria-label="Kılavuzu kapat" onClick={() => setHelp(false)}><X size={20} /></button></div><span className="eyebrow">KÜÇÜK BİR BAŞLANGIÇ KILAVUZU</span><h2 id="help-title">Alanlarınıza şekil verin.</h2><p>Dosyanızı açın veya JSON paneline GeoJSON yapıştırın. Harita, JSON ve Tablo aynı çalışma verisini düzenler.</p><div className="shortcut-grid">{modes.map((tool) => <div key={tool.id}><span>{tool.label}</span><kbd>{tool.key}</kbd></div>)}<div><span>Geri al / yinele</span><kbd>Ctrl Z / Ctrl ⇧ Z</kbd></div><div><span>Dosya aç / dışa aktar</span><kbd>Ctrl O / Ctrl S</kbd></div><div><span>Çizimi tamamla / iptal et</span><kbd>Enter / Esc</kbd></div><div><span>Çizimde son köşeyi kaldır</span><kbd>Backspace</kbd></div></div><div className="help-note"><strong>Büyük dosyalar için</strong><p>100–500 MB dosyalar hedeflenir. Haritada bir seferde en çok 2.500 şekil gösterilir; tüm şekiller dosyada korunur. Ayrıntı için yakınlaşın veya listeden seçim yapın. Tek bir çok ayrıntılı poligonun düzenlenmesi cihaz belleğiyle sınırlıdır.</p><strong>Çalışmanızı saklayın</strong><p>Bu sürüm yerel bir çalışma oturumudur. Kapatmadan önce dışa aktarın. Altlık haritaları için internet gerekir. Geometri yapısı kontrol edilir; kendini kesme gibi topolojik hatalar bu sürümde kontrol edilmez.</p></div></div></div>}
  </div>;
}
