import type { DatasetSummary, GeoFeature } from './contracts';
import { CategoryCatalog } from './categories';
import { validateFeature, validateGeometry } from './geoJsonValidation';
import { parseJson, stringifyJson } from './losslessJson';

export const EMPTY_DOCUMENT = '{\n  "type": "FeatureCollection",\n  "features": []\n}';
export const MAX_EDITOR_TEXT = 2 * 1024 * 1024;
export const isLargeDocument = (dataset: DatasetSummary | null) => !!dataset && (dataset.sourceBytes > MAX_EDITOR_TEXT || dataset.vertices > 30000 || dataset.count > 5000);

/** Validate before updating the workspace. Invalid drafts never replace map data. */
export function parseEditorDocument(text: string, selectedFeature = false): Record<string, unknown> {
  if (new TextEncoder().encode(text).byteLength > MAX_EDITOR_TEXT) throw new Error('Kod editörü en fazla 2 MB metin düzenler. Büyük dosyayı Dosya aç ile yükleyin.');
  const value = parseJson(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Bir GeoJSON nesnesi bekleniyor.');
  const root = value as Record<string, unknown>;
  if (selectedFeature) { validateFeature(root); return root; }
  if (root.type === 'FeatureCollection') {
    if (!Array.isArray(root.features)) throw new Error('FeatureCollection içinde features dizisi gerekli.');
    root.features.forEach(validateFeature);
    const catalog = new CategoryCatalog(); catalog.import(root.category_catalog);
  } else if (root.type === 'Feature') validateFeature(root);
  else validateGeometry(root);
  return root;
}

export function formatEditorDocument(value: unknown): string {
  let source = value;
  if (value && typeof value === 'object' && (value as Record<string,unknown>).type === 'FeatureCollection') {
    const {type,features,...metadata} = value as Record<string,unknown>;
    source = {type,features,...metadata};
  }
  const pretty = stringifyJson(source, 2);
  // Keep numeric coordinate tuples on one line without changing any values.
  const text = pretty?.replace(/\[\n[ \t]+(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?:,\n[ \t]+-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)*)\n[ \t]*\]/g, (_match, numbers: string) => `[${numbers.replace(/,\n[ \t]+/g, ', ')}]`);
  if (text === undefined || new TextEncoder().encode(text).byteLength > MAX_EDITOR_TEXT) throw new Error('Bu verinin tam metni kod editörü sınırını aşıyor. Seçili şekli düzenleyin veya dosyayı dışa aktarın.');
  return text;
}

export function parseTableValue(text: string, original: unknown): unknown {
  if (typeof original === 'string' || original === undefined) return text;
  const value = parseJson(text);
  if ((typeof original === 'number' || typeof original === 'bigint') && !(typeof value === 'bigint' || typeof value === 'number' && Number.isFinite(value))) throw new Error('Bu sütuna bir sayı girin.');
  if (typeof original === 'boolean' && typeof value !== 'boolean') throw new Error('Bu sütuna true veya false girin.');
  return value;
}

export function featureFromEditor(text: string): GeoFeature { return parseEditorDocument(text, true) as unknown as GeoFeature; }
