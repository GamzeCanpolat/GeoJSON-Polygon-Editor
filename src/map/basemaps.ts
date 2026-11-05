import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import type TileImage from 'ol/source/TileImage';

export type Basemap = 'osm' | 'satellite' | 'topo' | 'light' | 'none';
export interface BasemapDefinition {
  id: Basemap;
  label: string;
  provider: string;
  description: string;
  freshness: string;
  sourceUrl?: string;
  updateInfoUrl?: string;
  maxNativeZoom?: number;
  url?: string;
  attribution?: string;
}

export const BASEMAPS: BasemapDefinition[] = [
  {
    id: 'osm', label: 'Sokak', provider: 'OpenStreetMap',
    description: 'Yollar, yer adları, binalar ve diğer harita ayrıntıları.',
    freshness: 'Topluluk verisi güncellenir; değişikliklerin altlığa yansıması sunucu ve önbelleğe bağlıdır.',
    sourceUrl: 'https://www.openstreetmap.org/',
    updateInfoUrl: 'https://operations.osmfoundation.org/policies/tiles/', maxNativeZoom: 19,
  },
  {
    id: 'satellite', label: 'Uydu', provider: 'Esri World Imagery',
    description: 'Uydu ve hava fotoğraflarını karşılaştırma altlığı olarak gösterir.',
    freshness: 'Görüntü çekim tarihi konuma göre değişir. Servisin güncellenmesi, her bölgenin yeni çekildiği anlamına gelmez.',
    sourceUrl: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
    updateInfoUrl: 'https://support.esri.com/en-us/knowledge-base/how-frequently-is-the-world-imagery-basemap-updated-146-000012222',
    maxNativeZoom: 23,
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© <a href="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" target="_blank" rel="noopener noreferrer">Esri, Vantor, Earthstar Geographics, and the GIS User Community</a>',
  },
  {
    id: 'topo', label: 'Topografya', provider: 'OpenTopoMap-R · OpenMaps.fr',
    description: 'Eşyükselti eğrileri, arazi gölgelendirmesi ve topoğrafik işaretler. Görsel altlıktır; sayısal yükseklik ölçümü yapmaz.',
    freshness: 'Sağlayıcı otomatik OSM güncellemesi ve bir güne kadar gecikme bildiriyor. Yükseklik verisinin tarihi ayrıca değişebilir.',
    sourceUrl: 'https://openmaps.fr/about-openmaps.fr.html',
    updateInfoUrl: 'https://openmaps.fr/tile-usage-policy.html', maxNativeZoom: 18,
    url: 'https://tile.openmaps.fr/opentopomap/{z}/{x}/{y}.png',
    attribution: '<a href="https://github.com/sletuffe/OpenTopoMap" target="_blank" rel="noopener noreferrer">© OpenTopoMap-R</a> · <a href="https://openmaps.fr/donate" target="_blank" rel="noopener noreferrer">❤️ Donation</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>',
  },
  {
    id: 'light', label: 'Sade harita', provider: 'OpenStreetMap',
    description: 'Aynı sokak altlığının düşük doygunluklu görünümü.',
    freshness: 'OpenStreetMap sokak altlığıyla aynı veriyi kullanır.',
    sourceUrl: 'https://www.openstreetmap.org/',
    updateInfoUrl: 'https://operations.osmfoundation.org/policies/tiles/', maxNativeZoom: 19,
  },
  {
    id: 'none', label: 'Altlık yok', provider: 'Yalnızca GeoJSON',
    description: 'Harita döşemelerini kapatır. GeoJSON şekillerini düzenlemeye devam edebilirsiniz.',
    freshness: 'Dış harita sağlayıcısından görüntü yüklenmez.',
  },
];

export const getBasemapDefinition = (id: Basemap) => BASEMAPS.find((definition) => definition.id === id)!;

export function createBasemapSource(id: Basemap): TileImage | null {
  if (id === 'none') return null;
  if (id === 'osm' || id === 'light') return new OSM();
  const definition = getBasemapDefinition(id);
  return new XYZ({
    url: definition.url, maxZoom: definition.maxNativeZoom,
    crossOrigin: 'anonymous', attributions: definition.attribution,
    attributionsCollapsible: false,
  });
}
