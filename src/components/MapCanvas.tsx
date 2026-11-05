import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { MapController, type Basemap, type EditorMode } from '../map/MapController';
import type { DatasetSummary, FeatureRecord, GeoFeature, GeoJsonRepository } from '../domain/contracts';

interface Props {
  repository: GeoJsonRepository;
  dataset: DatasetSummary | null;
  selected: FeatureRecord | null;
  mode: EditorMode;
  basemap: Basemap;
  snap: boolean;
  visible: boolean;
  hiddenIds: ReadonlySet<string>;
  busy: boolean;
  onSelect(id: string | null): void;
  onCreate(feature: GeoFeature): void;
  onUpdate(feature: GeoFeature): void;
  onViewport(stats: { shown: number; matched: number; limited: boolean }): void;
  onCoordinate(value: string): void;
  onError(message: string): void;
}
export const MapCanvas = forwardRef<MapController | null, Props>(function MapCanvas(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<MapController | null>(null);
  const callbacks = useRef(props); callbacks.current = props;
  useLayoutEffect(() => {
    if (!container.current) return;
    const map = new MapController(container.current, props.repository, {
      select: (id) => callbacks.current.onSelect(id), create: (f) => callbacks.current.onCreate(f), update: (f) => callbacks.current.onUpdate(f),
      viewport: (v) => callbacks.current.onViewport(v), coordinate: (v) => callbacks.current.onCoordinate(v), error: (v) => callbacks.current.onError(v),
    });
    controller.current = map;
    const resize = new ResizeObserver(() => map.resize()); resize.observe(container.current);
    return () => { resize.disconnect(); map.dispose(); controller.current = null; };
  }, [props.repository]);
  useImperativeHandle(ref, () => controller.current!, [props.repository]);
  useEffect(() => controller.current?.setMode(props.mode), [props.mode]);
  useEffect(() => controller.current?.setBasemap(props.basemap), [props.basemap]);
  useEffect(() => controller.current?.setSnap(props.snap), [props.snap]);
  useEffect(() => controller.current?.setVisible(props.visible), [props.visible]);
  useEffect(() => controller.current?.setHiddenIds(props.hiddenIds), [props.hiddenIds]);
  useEffect(() => controller.current?.setEnabled(!props.busy), [props.busy]);
  useEffect(() => controller.current?.showSelected(props.selected), [props.selected]);
  useEffect(() => controller.current?.refresh(), [props.dataset]);
  return <div className="map-canvas" ref={container} aria-label="GeoJSON düzenleme haritası" />;
});
