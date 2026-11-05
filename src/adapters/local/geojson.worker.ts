/// <reference lib="webworker" />
import { LocalEngine } from './localEngine';
import type { WorkerReply, WorkerRequest } from '../../domain/contracts';

const engine = new LocalEngine();
// Serialize dataset operations so edits cannot race an export/import or viewport query.
let queue = Promise.resolve();
let activeImportId: number | null = null;
const cancelled = new Set<number>();
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, method, args } = event.data;
  if (method === 'cancel') {
    const target = args[0] as number;
    cancelled.add(target);
    if (activeImportId === target) engine.cancel();
    return;
  }
  const send = (reply: Omit<WorkerReply, 'id'>) => self.postMessage({ id, ...reply });
  queue = queue.then(async () => {
    try {
      const progress = (value: import('../../domain/contracts').ImportProgress) => send({ progress: value });
      let result: unknown;
      switch (method) {
        case 'open':
          if (cancelled.has(id)) throw new Error('Dosya açma iptal edildi.');
          activeImportId = id;
          result = await engine.open(args[0] as File, progress);
          break;
        case 'createEmpty': result = await engine.createEmpty(); break;
        case 'query': result = await engine.query(args[0] as import('../../domain/contracts').ViewportRequest); break;
        case 'list': result = await engine.list(args[0] as string, args[1] as number, args[2] as number); break;
        case 'get': result = await engine.get(args[0] as string); break;
        case 'mutate': result = await engine.mutate(args[0] as import('../../domain/contracts').MutationRequest); break;
        case 'categories': result = await engine.categories(); break;
        case 'addCategory': result = await engine.addCategory(args[0] as string, args[1] as string | undefined); break;
        case 'export': result = await engine.export(progress); break;
        case 'dispose': engine.dispose(); self.close(); return;
      }
      send({ result });
    } catch (error) { send({ error: error instanceof Error ? error.message : 'Veri işlemi tamamlanamadı.' }); }
    finally { if (activeImportId === id) activeImportId = null; cancelled.delete(id); }
  });
};
