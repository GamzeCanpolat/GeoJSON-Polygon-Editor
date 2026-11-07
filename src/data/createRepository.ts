import type { GeoJsonRepository } from '../domain/contracts';
import { WorkerGeoJsonRepository } from '../adapters/local/WorkerGeoJsonRepository';
import { ApiGeoJsonRepository } from '../adapters/api/ApiGeoJsonRepository';

// React/map modules keep using the same port in both modes. Never fall back
// silently: an unavailable API must not create an unrelated local workspace.
export const createRepository = (): GeoJsonRepository => {
  const source = import.meta.env.VITE_DATA_SOURCE ?? 'local';
  if (source === 'local') return new WorkerGeoJsonRepository();
  if (source !== 'api') throw new Error('VITE_DATA_SOURCE local veya api olmalı.');
  const url = new URL(import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000');
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) {
    throw new Error('VITE_API_BASE_URL geçerli bir HTTP sunucu adresi olmalı.');
  }
  const root = url.href.replace(/\/+$/, '');
  return new ApiGeoJsonRepository({ baseUrl: root.endsWith('/api/v1') ? root : root + '/api/v1' });
};
