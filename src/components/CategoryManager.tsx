import { useEffect, useRef, useState } from 'react';
import { Check, CornerDownRight, FolderTree, Plus, X } from 'lucide-react';
import type { CategoryGroup } from '../domain/contracts';
import { categoryKey } from '../domain/categories';

interface Props {
  catalog: CategoryGroup[];
  busy: boolean;
  onAdd(name: string, parent?: string): Promise<boolean>;
  onClose(): void;
}

export function CategoryManager({ catalog, busy, onAdd, onClose }: Props) {
  const [mainName, setMainName] = useState('');
  const [subName, setSubName] = useState('');
  const [parent, setParent] = useState('');
  const [message, setMessage] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const latest = useRef({ busy, onClose }); latest.current = { busy, onClose };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !latest.current.busy) { event.preventDefault(); latest.current.onClose(); }
      if (event.key !== 'Tab') return;
      const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([tabindex="-1"]),select:not(:disabled),a[href]');
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  const addMain = async () => {
    setMessage('');
    if (await onAdd(mainName)) { setParent(mainName.trim()); setMainName(''); setMessage('Ana kategori eklendi. Şimdi buna bağlı alt kategoriler ekleyebilirsiniz.'); requestAnimationFrame(() => dialog.current?.querySelector<HTMLInputElement>('#new-sub-category')?.focus()); }
  };
  const addSub = async () => {
    setMessage('');
    if (await onAdd(subName, parent)) { setSubName(''); setMessage('Alt kategori eklendi. Seçili şeklin kategori alanından atayabilirsiniz.'); requestAnimationFrame(() => dialog.current?.querySelector<HTMLInputElement>('#new-sub-category')?.focus()); }
  };
  const mainExists = catalog.some((group) => categoryKey(group.name) === categoryKey(mainName));
  const subExists = catalog.find((group) => group.name === parent)?.subcategories.some((name) => categoryKey(name) === categoryKey(subName));
  return <div className="modal-backdrop" onClick={() => { if (!busy) onClose(); }}><div ref={dialog} className="category-modal" role="dialog" aria-modal="true" aria-labelledby="category-title" onClick={(event) => event.stopPropagation()}>
    <div className="help-heading"><span className="modal-icon"><FolderTree size={24} /></span><button className="icon-button" aria-label="Kategorileri kapat" disabled={busy} onClick={onClose}><X size={20} /></button></div>
    <span className="eyebrow">ÇALIŞMANIZI DÜZENLEYİN</span><h2 id="category-title">Ana ve alt kategoriler</h2><p>Kategori ağacınızı oluşturun, ardından şekillerinize atayın.</p>
    <div className="category-forms">
      <form onSubmit={(event) => { event.preventDefault(); if (!mainExists) void addMain(); }}><label htmlFor="new-main-category">Yeni ana kategori</label><div className="category-input-row"><input id="new-main-category" placeholder="Örn. Arazi kullanımı" maxLength={80} required value={mainName} disabled={busy} onChange={(event) => { setMainName(event.target.value); setMessage(''); }} /><button className="button primary" disabled={busy || !mainName.trim() || mainExists} type="submit" aria-label="Ana kategori ekle"><Plus size={15} />Ekle</button></div>{mainExists && <p className="category-field-hint">Bu ana kategori zaten var. Yan taraftan alt kategori ekleyebilirsiniz.</p>}</form>
      <form onSubmit={(event) => { event.preventDefault(); if (!subExists) void addSub(); }}><label htmlFor="subcategory-parent">Alt kategorinin ana kategorisi</label><select id="subcategory-parent" value={parent} onChange={(event) => { setParent(event.target.value); setMessage(''); }} disabled={busy || !catalog.length} required><option value="">Ana kategori seçin</option>{catalog.map((group) => <option key={group.name} value={group.name}>{group.name}</option>)}</select><label htmlFor="new-sub-category">Yeni alt kategori</label><div className="category-input-row"><input id="new-sub-category" placeholder="Örn. Yeşil alan" maxLength={80} required value={subName} disabled={busy || !parent} onChange={(event) => { setSubName(event.target.value); setMessage(''); }} /><button className="button primary" disabled={busy || !parent || !subName.trim() || subExists} type="submit" aria-label="Alt kategori ekle"><Plus size={15} />Ekle</button></div>{!catalog.length && <p className="category-field-hint">Önce bir ana kategori ekleyin.</p>}{subExists && <p className="category-field-hint">Bu alt kategori seçili ana kategoride zaten var.</p>}</form>
    </div>
    {message && <p className="category-success" role="status"><Check size={14} />{message}</p>}
    <div className="category-tree-heading"><span>KATEGORİ AĞACI</span><span>{catalog.length} ana kategori</span></div>
    <div className="category-tree">{catalog.length ? catalog.map((group) => <div className="category-group" key={group.name}><div><FolderTree size={15} /><strong>{group.name}</strong><span>{group.subcategories.length} alt kategori</span></div>{group.subcategories.length ? <ul>{group.subcategories.map((sub) => <li key={sub}><CornerDownRight size={13} />{sub}</li>)}</ul> : <p>Henüz alt kategori yok.</p>}</div>) : <p className="category-empty">İlk ana kategorinizi ekleyerek başlayın.</p>}</div>
    <p className="category-footnote">Kategori ağacı ve şekillere atanan kategoriler dışa aktardığınız GeoJSON dosyasında saklanır.</p><button className="button secondary category-done" onClick={onClose} disabled={busy}>Tamam</button>
  </div></div>;
}
