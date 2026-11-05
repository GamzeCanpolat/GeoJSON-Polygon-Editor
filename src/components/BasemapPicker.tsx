import { useState } from 'react';
import { ChevronDown, ExternalLink, Info, Layers3, RefreshCw, X } from 'lucide-react';
import { BASEMAPS, getBasemapDefinition, type Basemap } from '../map/basemaps';

interface Props { value: Basemap; onChange(value: Basemap): void; onRetry(): void }
export function BasemapPicker({ value, onChange, onRetry }: Props) {
  const [infoOpen, setInfoOpen] = useState(false);
  const definition = getBasemapDefinition(value);
  return <div className="basemap-controls">
    <div className="basemap-switch"><Layers3 size={15} /><label className="sr-only" htmlFor="basemap">Harita altlığı</label><select id="basemap" value={value} onChange={(event) => onChange(event.target.value as Basemap)}>{BASEMAPS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><ChevronDown size={12} /><button className={`icon-button basemap-info-toggle ${infoOpen ? 'active' : ''}`} aria-label="Harita kaynağı bilgisi" aria-expanded={infoOpen} aria-controls="basemap-source-info" title="Kaynak ve güncellik bilgisi" onClick={() => setInfoOpen(!infoOpen)}><Info size={15} /></button></div>
    {infoOpen && <section className="basemap-source-info" id="basemap-source-info" aria-label="Altlık kaynağı ve güncelliği">
      <div className="source-info-heading"><span>{definition.label.toLocaleUpperCase('tr-TR')}</span><button className="icon-button" aria-label="Kaynak bilgisini kapat" onClick={() => setInfoOpen(false)}><X size={15} /></button></div>
      <h3>{definition.provider}</h3><p>{definition.description}</p><div className="source-freshness"><strong>Güncellik</strong><p>{definition.freshness}</p></div>
      {definition.maxNativeZoom && <p className="source-zoom-note">Ayrıntı ve kapsama bölgeye göre değişir. Yüksek yakınlaştırmada görüntü büyütülebilir; büyütmek yeni ayrıntı üretmez.</p>}
      <div className="source-info-links">{definition.sourceUrl && <a href={definition.sourceUrl} target="_blank" rel="noopener noreferrer">Kaynak<ExternalLink size={11} /></a>}{definition.updateInfoUrl && <a href={definition.updateInfoUrl} target="_blank" rel="noopener noreferrer">Sağlayıcı bilgisi<ExternalLink size={11} /></a>}{value !== 'none' && <button onClick={onRetry}><RefreshCw size={12} />Yeniden dene</button>}</div>
    </section>}
  </div>;
}
