import Map from 'ol/Map';
import Overlay from 'ol/Overlay';
import View from 'ol/View';
import Feature from 'ol/Feature';
import GeoJSON from 'ol/format/GeoJSON';
import Geometry from 'ol/geom/Geometry';
import MultiPoint from 'ol/geom/MultiPoint';
import Polygon from 'ol/geom/Polygon';
import MultiPolygon from 'ol/geom/MultiPolygon';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type TileImage from 'ol/source/TileImage';
import Draw, { createBox, createRegularPolygon } from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import Translate from 'ol/interaction/Translate';
import Snap from 'ol/interaction/Snap';
import Collection from 'ol/Collection';
import { defaults as controls, ScaleLine } from 'ol/control';
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style';
import type { Bounds, FeatureRecord, GeoFeature, GeoJsonRepository } from '../domain/contracts';
import { MAX_MERCATOR_LATITUDE, type GeographicCoordinate } from '../domain/coordinateNavigation';
import { readEditableFeature, writeEditedFeature } from './featureGeometry';
import { createBasemapSource, getBasemapDefinition, type Basemap } from './basemaps';
export type { Basemap } from './basemaps';

export type EditorMode = 'select' | 'point' | 'line' | 'draw' | 'rectangle' | 'circle' | 'edit' | 'move';
const drawModes = { point: 'Point', line: 'LineString', draw: 'Polygon', rectangle: 'Circle', circle: 'Circle' } as const;
const isDrawing = (mode: EditorMode): mode is keyof typeof drawModes => mode in drawModes;
interface Callbacks {
  select(id: string | null): void;
  create(feature: GeoFeature): void;
  update(feature: GeoFeature): void;
  viewport(stats: { shown: number; matched: number; limited: boolean }): void;
  coordinate(value: string): void;
  error(message: string): void;
}
const palette: Record<string, [string, string]> = {
  green: ['#247b60', 'rgba(57,147,108,.19)'],
  amber: ['#bb893a', 'rgba(225,178,77,.25)'],
  blue: ['#628eb3', 'rgba(104,158,201,.21)'],
};
const styles = Object.fromEntries(Object.entries(palette).map(([key, [stroke, fill]]) => [key, new Style({
  stroke: new Stroke({ color: stroke, width: 2 }), fill: new Fill({ color: fill }),
  image: new CircleStyle({ radius: 5, fill: new Fill({ color: stroke }), stroke: new Stroke({ color: '#fff', width: 2 }) }),
})]));
const selectedStyle = new Style({ stroke: new Stroke({ color: '#2563eb', width: 3 }), fill: new Fill({ color: 'rgba(59,130,246,.24)' }), image: new CircleStyle({ radius: 7, fill: new Fill({ color: '#3b82f6' }), stroke: new Stroke({ color: 'white', width: 2 }) }) });
const vertexStyle = new Style({
  image: new CircleStyle({ radius: 4.5, fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: '#2563eb', width: 2 }) }),
  geometry: (feature) => {
    const g = feature.getGeometry();
    if (g instanceof Polygon) return new MultiPoint(g.getCoordinates().flat());
    if (g instanceof MultiPolygon) return new MultiPoint(g.getCoordinates().flat(2));
    return undefined;
  },
});

export class MapController {
  readonly map: Map;
  private readonly coordinateMarker: Overlay;
  private format = new GeoJSON();
  private previewSource = new VectorSource<Feature<Geometry>>({ wrapX: false });
  private selectedSource = new VectorSource<Feature<Geometry>>({ wrapX: false });
  private previewLayer: VectorLayer<VectorSource<Feature<Geometry>>>;
  private selectedLayer: VectorLayer<VectorSource<Feature<Geometry>>>;
  private basemapLayer: TileLayer;
  private basemapSources: Partial<Record<Basemap, TileImage>> = {};
  private currentBasemap?: Basemap;
  private basemapErrored = false;
  private selectedFeatures = new Collection<Feature<Geometry>>();
  private draw: Draw;
  private drawingKind: keyof typeof drawModes = 'draw';
  private hiddenIds = new Set<string>();
  private modify: Modify;
  private translate: Translate;
  private snap: Snap;
  private selected: FeatureRecord | null = null;
  private pendingEdit = false;
  private mode: EditorMode = 'select';
  private enabled = true;
  private snapping = false;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private requestVersion = 0;
  private querying = false;
  private queryAgain = false;
  private visible = true;
  private lastCoordinateUpdate = 0;

  constructor(target: HTMLElement, private repository: GeoJsonRepository, private callbacks: Callbacks) {
    this.previewLayer = new VectorLayer({
      source: this.previewSource, renderBuffer: 30,
      style: (feature) => feature.getId() === this.selected?.summary.id ? undefined : styles[String(feature.get('renk'))] ?? styles.blue,
    });
    this.selectedLayer = new VectorLayer({ source: this.selectedSource, style: () => this.mode === 'edit' ? [selectedStyle, vertexStyle] : selectedStyle, zIndex: 5 });
    this.basemapLayer = new TileLayer({ className: 'basemap-layer', preload: 0 });
    this.map = new Map({ target, layers: [this.basemapLayer, this.previewLayer, this.selectedLayer],
      controls: controls({ zoom: false, rotate: false }).extend([new ScaleLine({ units: 'metric' })]),
      view: new View({ center: fromLonLat([35, 39]), zoom: 5.5, minZoom: 2, maxZoom: 21, constrainResolution: false }),
    });
    const marker = document.createElement('div');
    marker.className = 'coordinate-location-marker';
    marker.setAttribute('aria-hidden', 'true');
    this.coordinateMarker = new Overlay({
      id: 'coordinate-navigation-marker', element: marker, positioning: 'center-center',
      className: 'coordinate-marker-overlay', stopEvent: false,
    });
    this.map.addOverlay(this.coordinateMarker);
    this.draw = this.createDraw('draw');
    this.modify = new Modify({ features: this.selectedFeatures, pixelTolerance: 12 });
    this.translate = new Translate({ features: this.selectedFeatures });
    this.snap = new Snap({ source: this.previewSource, pixelTolerance: 10 });
    [this.draw, this.modify, this.translate, this.snap].forEach((interaction) => this.map.addInteraction(interaction));
    this.setMode('select');
    this.map.on('singleclick', (event) => {
      if (!this.enabled || isDrawing(this.mode)) return;
      const hit = this.map.forEachFeatureAtPixel(event.pixel, (feature) => feature, { hitTolerance: 6, layerFilter: (layer) => layer === this.previewLayer || layer === this.selectedLayer });
      const id = hit?.getId();
      if (id === this.selected?.summary.id) return;
      this.callbacks.select(id === undefined ? null : String(id));
    });
    this.map.on('pointermove', (event) => {
      if (performance.now() - this.lastCoordinateUpdate > 90) {
        const [lon, lat] = toLonLat(event.coordinate);
        this.callbacks.coordinate(`${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`);
        this.lastCoordinateUpdate = performance.now();
      }
      if (event.dragging || isDrawing(this.mode)) return;
      target.style.cursor = this.map.hasFeatureAtPixel(event.pixel, { layerFilter: (layer) => layer === this.previewLayer || layer === this.selectedLayer }) ? 'pointer' : '';
    });
    this.map.on('moveend', () => this.refresh());
    const edited = () => {
      this.pendingEdit = false;
      const geometry = this.selectedFeatures.item(0)?.getGeometry();
      if (!geometry || !this.selected) return;
      this.callbacks.update(writeEditedFeature(this.selected, geometry));
    };
    this.modify.on('modifyend', edited);
    this.translate.on('translateend', edited);
    this.modify.on('modifystart', () => { this.pendingEdit = true; });
    this.translate.on('translatestart', () => { this.pendingEdit = true; });
    this.setBasemap('osm');
  }
  private createDraw(kind: keyof typeof drawModes) {
    const interaction = new Draw({ type: drawModes[kind], stopClick: true, wrapX: false,
      geometryFunction: kind === 'rectangle' ? createBox() : kind === 'circle' ? createRegularPolygon(64) : undefined });
    interaction.on('drawstart', () => { this.pendingEdit = true; });
    interaction.on('drawabort', () => { this.pendingEdit = false; });
    interaction.on('drawend', (event) => {
      this.pendingEdit = false;
      const feature = this.format.writeFeatureObject(event.feature, { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' }) as GeoFeature;
      feature.properties = {};
      this.callbacks.create(feature);
    });
    return interaction;
  }
  setHiddenIds(ids: ReadonlySet<string>) { this.hiddenIds = new Set(ids); this.refresh(); }
  setBasemap(value: Basemap) {
    if (this.currentBasemap === value) return;
    this.currentBasemap = value;
    this.basemapErrored = false;
    this.basemapLayer.setVisible(value !== 'none');
    this.map.getTargetElement()?.classList.toggle('light-basemap', value === 'light');
    if (value === 'none') return;
    const key = value === 'light' ? 'osm' : value;
    let source = this.basemapSources[key];
    if (!source) {
      source = createBasemapSource(key)!;
      this.basemapSources[key] = source;
      source.on('tileloaderror', () => {
        if (this.disposed || !this.basemapLayer.getVisible() || this.basemapLayer.getSource() !== source || this.basemapErrored) return;
        this.basemapErrored = true;
        this.callbacks.error(`${getBasemapDefinition(this.currentBasemap!).label} altlığının bazı görüntüleri yüklenemedi. Başka bir altlık seçebilir veya kaynak bilgisinden yeniden deneyebilirsiniz. Şekilleriniz korunuyor.`);
      });
    }
    this.basemapLayer.setSource(source);
  }
  refreshBasemap() {
    this.basemapErrored = false;
    if (this.currentBasemap !== 'none') this.basemapLayer.getSource()?.refresh();
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    this.previewLayer.setVisible(visible); this.selectedLayer.setVisible(visible);
    this.setEnabled(this.enabled);
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    const active = enabled && this.visible;
    this.draw.setActive(active && isDrawing(this.mode));
    this.modify.setActive(active && this.mode === 'edit');
    this.translate.setActive(active && this.mode === 'move');
    this.snap.setActive(active && this.snapping && (isDrawing(this.mode) || this.mode === 'edit'));
  }
  setMode(mode: EditorMode) {
    this.draw.abortDrawing();
    if (isDrawing(mode) && this.drawingKind !== mode) {
      const interactions = this.map.getInteractions(), index = interactions.getArray().indexOf(this.draw);
      interactions.remove(this.draw); this.draw = this.createDraw(mode); this.drawingKind = mode; interactions.insertAt(Math.max(0,index), this.draw);
    }
    this.mode = mode; this.setEnabled(this.enabled); this.selectedLayer.changed();
    this.map.getTargetElement()?.classList.toggle('drawing', isDrawing(mode));
  }
  setSnap(value: boolean) { this.snapping = value; this.setEnabled(this.enabled); }
  abortDrawing() { this.draw.abortDrawing(); }
  hasPendingEdits() { return this.pendingEdit; }
  removeLastPoint() { this.draw.removeLastPoint(); }
  finishDrawing() { this.draw.finishDrawing(); }
  showSelected(record: FeatureRecord | null) {
    this.selected = record;
    this.selectedSource.clear(); this.selectedFeatures.clear();
    if (record?.feature.geometry) {
      const feature = readEditableFeature(record);
      this.selectedSource.addFeature(feature); this.selectedFeatures.push(feature);
    }
    this.previewLayer.changed();
  }
  fit(bounds: Bounds | null) {
    if (!bounds) return;
    this.map.getView().fit(transformExtent(bounds, 'EPSG:4326', 'EPSG:3857'), { padding: [85, 75, 85, 75], duration: 450, maxZoom: 19 });
  }
  goToCoordinate(coordinate: GeographicCoordinate) {
    const { longitude } = coordinate;
    const latitude = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, coordinate.latitude));
    const center = fromLonLat([longitude, latitude]);
    this.coordinateMarker.setPosition(center);
    const view = this.map.getView();
    view.cancelAnimations();
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650;
    view.animate({ center, zoom: 16, duration });
  }
  clearCoordinateMarker() { this.coordinateMarker.setPosition(undefined); }
  zoom(delta: number) { const view = this.map.getView(); view.animate({ zoom: (view.getZoom() ?? 12) + delta, duration: 200 }); }
  north() { this.map.getView().animate({ rotation: 0, duration: 250 }); }
  resize() { this.map.updateSize(); }
  refresh() {
    clearTimeout(this.timer);
    this.requestVersion++;
    this.timer = setTimeout(() => void this.loadViewport(), 100);
  }
  private async loadViewport() {
    if (this.disposed) return;
    if (this.querying) { this.queryAgain = true; return; }
    this.querying = true;
    const version = this.requestVersion;
    try {
      const view = this.map.getView();
      const bounds = transformExtent(view.calculateExtent(this.map.getSize()), 'EPSG:3857', 'EPSG:4326') as Bounds;
      bounds[0] = Math.max(-180, bounds[0]); bounds[1] = Math.max(-90, bounds[1]);
      bounds[2] = Math.min(180, bounds[2]); bounds[3] = Math.min(90, bounds[3]);
      const result = await this.repository.query({ bounds, tolerance: Math.max(0, (bounds[2] - bounds[0]) / (this.map.getSize()?.[0] ?? 1000) * .65), limit: 2500 });
      if (this.disposed || version !== this.requestVersion) return;
      const features = result.records.filter(record => !this.hiddenIds.has(record.summary.id)).map(({ summary, feature }) => {
        const f = this.format.readFeature(feature, { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' }) as Feature<Geometry>;
        f.setId(summary.id); return f;
      });
      this.previewSource.clear(true); this.previewSource.addFeatures(features);
      this.callbacks.viewport({ shown: features.length, matched: result.matched, limited: result.limited });
    } catch (error) { if (!this.disposed && version === this.requestVersion) this.callbacks.error(error instanceof Error ? error.message : 'Harita verisi alınamadı.'); }
    finally { this.querying = false; if (this.queryAgain) { this.queryAgain = false; void this.loadViewport(); } }
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.map.setTarget(undefined); this.map.dispose(); Object.values(this.basemapSources).forEach((source) => source.dispose()); }
}
