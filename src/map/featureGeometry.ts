import Feature from 'ol/Feature';
import Geometry from 'ol/geom/Geometry';
import GeoJSON from 'ol/format/GeoJSON';
import type { FeatureRecord, GeoFeature } from '../domain/contracts';

const format = new GeoJSON();
const projections = { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' };

export function readEditableFeature(record: FeatureRecord): Feature<Geometry> {
  const editable = format.readFeature(record.feature, projections) as Feature<Geometry>;
  // This ID is exclusively for selection; keep the original external ID in the record.
  editable.setId(record.summary.id);
  return editable;
}

export function writeEditedFeature(record: FeatureRecord, geometry: Geometry): GeoFeature {
  return { ...record.feature, geometry: format.writeGeometryObject(geometry, projections) };
}
