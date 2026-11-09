import { convertTabularExport, type TabularFormat, type TabularReply } from './tabularExport';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async ({ data }: MessageEvent<{ source: Blob; format: TabularFormat }>) => {
  const send = (result: TabularReply) => scope.postMessage(result);
  try {
    const blob = await convertTabularExport(data.source, data.format, progress => send({ progress }));
    send({ blob });
  } catch (error) {
    send({ error: error instanceof Error ? error.message : 'Tablo dosyası oluşturulamadı.' });
  }
};
