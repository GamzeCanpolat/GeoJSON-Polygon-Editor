import type { ImportProgress } from '../domain/contracts';
import type { TabularFormat, TabularReply } from './tabularExport';

export async function exportTabularFile(source: Blob, format: TabularFormat, progress: (p: ImportProgress) => void): Promise<Blob> {
  const worker = new Worker(new URL('./tabularExport.worker.ts', import.meta.url), { type: 'module' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const unavailable = () => reject(new Error('Dışa aktarma işçisi çalışamadı. Dosyayı tekrar deneyin.'));
      worker.onerror = unavailable;
      worker.onmessageerror = unavailable;
      worker.onmessage = ({ data }: MessageEvent<TabularReply>) => {
        if ('progress' in data) progress(data.progress);
        else if ('error' in data) reject(new Error(data.error));
        else resolve(data.blob);
      };
      timer = setTimeout(() => reject(new Error('Tablo hazırlama zaman aşımına uğradı. GeoJSON seçin veya daha küçük bir veri kümesi deneyin.')), 300_000);
      worker.postMessage({ source, format });
    });
  } finally {
    clearTimeout(timer);
    worker.terminate();
  }
}
