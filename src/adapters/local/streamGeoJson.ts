import { JSONParser, TokenType } from '@streamparser/json';
import type { GeoFeature, ImportProgress } from '../../domain/contracts';
import { validateFeature } from './geometry';

/** Consume a FeatureCollection incrementally, including UTF-8 split across chunks. */
export async function streamGeoJson(
  file: Blob,
  onBatch: (features: GeoFeature[]) => Promise<void>,
  onProgress: (progress: ImportProgress) => void = () => {},
  cancelled: () => boolean = () => false,
  onMetadata: (root: Record<string, unknown>) => void = () => {},
) {
  let batch: GeoFeature[] = [];
  let count = 0, bytesRead = 0, root: unknown;
  const parser = new JSONParser({ paths: ['$.features.*', '$'], keepStack: false, stringBufferSize: 65536 });
  let previousString: string | undefined;
  parser.onToken = ({ token, value }) => {
    // This parser constructs ordinary objects. Reject the special prototype setter
    // rather than silently dropping a valid-looking property during object construction.
    if (token === TokenType.COLON && previousString === '__proto__') {
      throw new Error('Bu dosya desteklenmeyen bir __proto__ öznitelik anahtarı içeriyor.');
    }
    previousString = token === TokenType.STRING ? String(value) : undefined;
  };
  parser.onValue = ({ value, key, parent }) => {
    if (Array.isArray(parent) && typeof key === 'number') {
      batch.push(validateFeature(value)); count++;
      // The root is emitted to validate its envelope. Release each geometry immediately
      // instead of retaining the entire features array behind the parser's root stack.
      delete parent[key];
    } else if (key === undefined) root = value;
  };
  // Fixed-size reads bound the batch size even if a browser's stream chunk is huge.
  for (let offset = 0; offset < file.size; offset += 256 * 1024) {
    if (cancelled()) throw new Error('Dosya açma iptal edildi.');
    const buffer = new Uint8Array(await file.slice(offset, offset + 256 * 1024).arrayBuffer());
    parser.write(buffer);
    if (batch.length) { await onBatch(batch); batch = []; }
    bytesRead += buffer.byteLength;
    onProgress({ bytesRead, totalBytes: file.size, featuresRead: count });
    // Yield so cancellation messages can be handled, even on fast local storage.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!parser.isEnded) parser.end();
  if (cancelled()) throw new Error('Dosya açma iptal edildi.');
  if (typeof root !== 'object' || root === null) throw new Error('Dosya geçerli bir GeoJSON nesnesi içermiyor.');
  const r = root as Record<string, unknown>;
  if (r.type === 'FeatureCollection') {
    if (!Array.isArray(r.features)) throw new Error('FeatureCollection içinde features dizisi bulunmalı.');
    onMetadata(r);
  } else if (r.type === 'Feature') {
    if (count) throw new Error('Geçersiz GeoJSON kök nesnesi.');
    batch.push(validateFeature(r)); count++;
  } else if (typeof r.type === 'string' && ('coordinates' in r || r.type === 'GeometryCollection')) {
    if (count) throw new Error('Geçersiz GeoJSON kök nesnesi.');
    batch.push(validateFeature({ type: 'Feature', properties: {}, geometry: r })); count++;
  } else throw new Error('FeatureCollection, Feature veya GeoJSON geometrisi bekleniyor.');
  if (batch.length) await onBatch(batch);
  onProgress({ bytesRead, totalBytes: file.size, featuresRead: count });
  return count;
}
