import 'fake-indexeddb/auto';
import { openAsBlob } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalEngine } from '../../src/adapters/local/localEngine';
import { streamGeoJson } from '../../src/adapters/local/streamGeoJson';

it.skipIf(!process.env.PERF_FILE)('imports a real large file, bounds viewport output, and preserves every feature on export', async () => {
  const blob = await openAsBlob(process.env.PERF_FILE!);
  const file = new File([blob], basename(process.env.PERF_FILE!));
  const engine = new LocalEngine();
  const start = performance.now();
  try {
    const summary = await engine.open(file);
    const opened = performance.now();
    expect(summary.count).toBeGreaterThan(0);
    const query = await engine.query({ bounds: [-180,-90,180,90], tolerance: .001, limit: 2500 });
    expect(query.records.length).toBeLessThanOrEqual(2500);
    expect(query.matched).toBe(summary.count);
    const exported = await engine.export();
    const expectedHash = createHash('sha256'), actualHash = createHash('sha256');
    const hashOriginal = await streamGeoJson(file, async (batch) => { for (const f of batch) expectedHash.update(JSON.stringify(f)); });
    const hashExported = await streamGeoJson(exported, async (batch) => { for (const f of batch) actualHash.update(JSON.stringify(f)); });
    expect(hashOriginal).toBe(summary.count); expect(hashExported).toBe(summary.count);
    expect(actualHash.digest('hex')).toBe(expectedHash.digest('hex'));
    console.log(JSON.stringify({ megabytes: +(file.size / 1024 / 1024).toFixed(2), features: summary.count, vertices: summary.vertices, importSeconds: +((opened-start)/1000).toFixed(2), totalSeconds: +((performance.now()-start)/1000).toFixed(2), viewportRecords: query.records.length, environment: 'Node.js + fake-indexeddb; not a browser speed benchmark' }));
  } finally { engine.dispose(); }
}, 300000);
