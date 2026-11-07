import 'fake-indexeddb/auto';
import { openAsBlob } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { LocalEngine } from '../../src/adapters/local/localEngine';
import { streamGeoJson } from '../../src/adapters/local/streamGeoJson';
import { stringifyJson } from '../../src/domain/losslessJson';

it.skipIf(!process.env.PERF_FILE)('imports a real large file, bounds viewport output, and preserves every feature on export', async () => {
  const blob = await openAsBlob(process.env.PERF_FILE!);
  const file = new File([blob], basename(process.env.PERF_FILE!));
  const engine = new LocalEngine();
  const start = performance.now();
  try {
    const summary = await engine.open(file);
    const opened = performance.now();
    expect(summary.count).toBeGreaterThan(0);
    if(process.env.PERF_EXACT_INTEGER_EXPECTED){
      const first=await engine.get((await engine.list('',0,1)).items[0].id);
      expect(String(first.feature.id)).toBe(process.env.PERF_EXACT_INTEGER_EXPECTED);
      expect(typeof first.feature.id).toBe('bigint');
    }
    const query = await engine.query({ bounds: [-180,-90,180,90], tolerance: .001, limit: 2500 });
    expect(query.records.length).toBeLessThanOrEqual(2500);
    expect(query.matched).toBe(summary.count);
    const exportStarted = performance.now();
    const exported = await engine.export();
    const exportSeconds = (performance.now()-exportStarted)/1000;
    const expectedHash = createHash('sha256'), actualHash = createHash('sha256');
    const hashOriginal = await streamGeoJson(file, async (batch) => { for (const f of batch) expectedHash.update(stringifyJson(f)); });
    const hashExported = await streamGeoJson(exported, async (batch) => { for (const f of batch) actualHash.update(stringifyJson(f)); });
    expect(hashOriginal).toBe(summary.count); expect(hashExported).toBe(summary.count);
    expect(actualHash.digest('hex')).toBe(expectedHash.digest('hex'));
    console.log(JSON.stringify({ megabytes: +(file.size / 1024 / 1024).toFixed(2), features: summary.count, vertices: summary.vertices, importSeconds: +((opened-start)/1000).toFixed(2), exportSeconds:+exportSeconds.toFixed(2), totalSeconds: +((performance.now()-start)/1000).toFixed(2), viewportRecords: query.records.length, environment: 'Node.js + fake-indexeddb; not a browser speed benchmark' }));
  } finally { engine.dispose(); }
}, 300000);
