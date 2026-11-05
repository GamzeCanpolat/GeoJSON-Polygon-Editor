import type { FeatureRecord } from '../../domain/contracts';

export interface StoredRecord extends FeatureRecord { dataset: string; ordinal: number }

export class LocalDatabase {
  private db?: IDBDatabase;
  readonly name = `geojson-studio-session-${crypto.randomUUID()}`;
  async connect() {
    const request = indexedDB.open(this.name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('features', { keyPath: ['dataset', 'ordinal'] });
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Tarayıcı depolaması açılamadı. Özel pencere veya depolama izinlerini kontrol edin.'));
    });
  }
  private transaction(mode: IDBTransactionMode) {
    if (!this.db) throw new Error('Veri deposu hazır değil.');
    return this.db.transaction('features', mode);
  }
  private done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error(tx.error?.name === 'QuotaExceededError' ? 'Tarayıcı depolama alanı doldu. Daha küçük bir dosya deneyin veya disk alanı açın.' : 'Yerel veri işlemi tamamlanamadı.'));
    });
  }
  async put(records: StoredRecord[]) {
    const tx = this.transaction('readwrite');
    const done = this.done(tx);
    for (const record of records) tx.objectStore('features').put(record);
    await done;
  }
  async get(dataset: string, ordinal: number): Promise<StoredRecord> {
    const tx = this.transaction('readonly');
    const request = tx.objectStore('features').get([dataset, ordinal]);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => request.result ? resolve(request.result) : reject(new Error('Şekil bulunamadı.'));
      request.onerror = () => reject(request.error);
    });
  }
  async getMany(dataset: string, ordinals: number[]): Promise<StoredRecord[]> {
    if (!ordinals.length) return [];
    const tx = this.transaction('readonly');
    const store = tx.objectStore('features');
    return Promise.all(ordinals.map((ordinal) => new Promise<StoredRecord>((resolve, reject) => {
      const request = store.get([dataset, ordinal]);
      request.onsuccess = () => request.result ? resolve(request.result) : reject(new Error('Şekil bulunamadı.'));
      request.onerror = () => reject(request.error);
    })));
  }
  async remove(dataset: string, ordinal: number) {
    const tx = this.transaction('readwrite'); const done = this.done(tx);
    tx.objectStore('features').delete([dataset, ordinal]); await done;
  }
  async removeDataset(dataset: string) {
    const tx = this.transaction('readwrite'); const done = this.done(tx);
    tx.objectStore('features').delete(IDBKeyRange.bound([dataset, 0], [dataset, Number.MAX_SAFE_INTEGER]));
    await done;
  }
  dispose() { this.db?.close(); indexedDB.deleteDatabase(this.name); }
}
