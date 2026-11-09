import type { WorkSheet } from 'xlsx';
import { streamGeoJson } from '../adapters/local/streamGeoJson';
import { featureCategories } from '../domain/categories';
import type { GeoFeature, ImportProgress } from '../domain/contracts';
import { stringifyJson } from '../domain/losslessJson';

export type TabularFormat = 'xlsx' | 'csv';
export type ExportFormat = 'geojson' | TabularFormat;
export type TabularReply = { progress: ImportProgress } | { blob: Blob } | { error: string };

const headers = ['Nesne ID', 'Geometri türü', 'Ad / etiket', 'Ana kategori', 'Alt kategori', 'Geometri (GeoJSON)', 'Öznitelikler (JSON)'];
const maxProperties = 256;
const maxExcelCellLength = 32_767;
const mib = 1024 * 1024;

function text(value: unknown): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : stringifyJson(value);
}

function row(feature: GeoFeature, keys: string[], ordinal: number): string[] {
  const props = feature.properties;
  const { main, sub } = featureCategories(feature);
  const name = props?.name ?? props?.ad ?? props?.title ?? props?.NAME ?? feature.id ?? `Şekil ${ordinal}`;
  return [text(feature.id), feature.geometry?.type ?? '', text(name), main, sub,
    stringifyJson(feature.geometry), stringifyJson(props),
    ...keys.map(key => props && Object.hasOwn(props, key) ? text(props[key]) : '')];
}

function csvCell(value: string): string {
  // Canonical negative numbers are literals. Protect other formula-like text,
  // including leading whitespace/control and fullwidth operator variants.
  const literal = /^-\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value);
  const startsFormula = /^[\t\r\n\0]|^[\s\p{Cc}]*[=+\-@＝＋－＠]/u.test(value);
  const safe = startsFormula && !literal ? '\t' + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export async function convertTabularExport(source: Blob, format: TabularFormat, onProgress: (p: ImportProgress) => void = () => {}): Promise<Blob> {
  const excel = format === 'xlsx';
  const limitMiB = excel ? 32 : 128;
  const maxCells = excel ? 1_000_000 : 5_000_000;
  const suggest = excel ? ' CSV veya GeoJSON seçin.' : ' GeoJSON seçin.';
  const sizeError = () => new Error(`Bu biçimde kaynak veya tablo verisi ${limitMiB} MiB sınırını aşıyor.${suggest}`);
  if (source.size > limitMiB * mib) throw sizeError();

  const propertyNames = new Set<string>();
  let count = 0;
  const progress = (pass: number) => (p: ImportProgress) => {
    onProgress({ ...p, bytesRead: pass * source.size + p.bytesRead, totalBytes: source.size * 2 });
  };
  await streamGeoJson(source, async features => {
    for (const feature of features) {
      for (const key of Object.keys(feature.properties ?? {})) {
        propertyNames.add(key);
        if (propertyNames.size > maxProperties) throw new Error('Tablolu dışa aktarma en fazla 256 ayrı özniteliği destekler. GeoJSON seçin.');
      }
      count++;
      if ((count + 1) * (headers.length + propertyNames.size) > maxCells) {
        throw new Error(`Tablo ${maxCells.toLocaleString('tr-TR')} hücre sınırını aşıyor.${suggest}`);
      }
    }
  }, progress(0));

  const keys = [...propertyNames];
  const titles = [...headers, ...keys.map(key => `Öznitelik: ${key}`)];
  const xlsx = excel ? await import('xlsx') : null;
  let sheet: WorkSheet | undefined;
  const parts: BlobPart[] = ['\uFEFF'];
  const encoder = new TextEncoder();
  let bytes = 0, ordinal = 0;
  const writeRows = (rows: string[][]) => {
    if (xlsx) {
      for (const values of rows) {
        for (const value of values) {
          if (value.length > maxExcelCellLength) {
            throw new Error('Bir Excel hücresi 32.767 karakteri aşıyor. Tam veriyi almak için CSV veya GeoJSON seçin.');
          }
          bytes += encoder.encode(value).byteLength;
          if (bytes > limitMiB * mib) throw sizeError();
        }
      }
      // SheetJS creates text cells for strings, including ID and formula-like text.
      if (sheet) xlsx.utils.sheet_add_aoa(sheet, rows, { origin: -1 });
      else sheet = xlsx.utils.aoa_to_sheet(rows, { dense: true });
    } else {
      const chunk = rows.map(values => values.map(csvCell).join(',') + '\r\n').join('');
      const encoded = encoder.encode(chunk);
      bytes += encoded.byteLength;
      if (bytes > limitMiB * mib) throw sizeError();
      parts.push(new Blob([encoded]));
    }
  };
  writeRows([titles]);
  await streamGeoJson(source, async features => {
    // A parser batch can contain many small features. Bound temporary row arrays.
    for (let index = 0; index < features.length; index += 100) {
      writeRows(features.slice(index, index + 100).map(feature => row(feature, keys, ++ordinal)));
    }
  }, progress(1));

  if (!xlsx || !sheet) return new Blob(parts, { type: 'text/csv;charset=utf-8' });
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book, sheet, 'Nesneler');
  const result: ArrayBuffer = xlsx.write(book, { type: 'array', bookType: 'xlsx', compression: true });
  return new Blob([result], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
