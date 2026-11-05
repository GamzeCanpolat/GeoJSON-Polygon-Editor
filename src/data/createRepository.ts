import type { GeoJsonRepository } from '../domain/contracts';
import { WorkerGeoJsonRepository } from '../adapters/local/WorkerGeoJsonRepository';

// Frontend workspace adapter only. The second developer's server adapter replaces
// this factory; React/map modules depend only on GeoJsonRepository.
export const createRepository = (): GeoJsonRepository => new WorkerGeoJsonRepository();
