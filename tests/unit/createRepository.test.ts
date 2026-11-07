import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/adapters/local/WorkerGeoJsonRepository',()=>({WorkerGeoJsonRepository:vi.fn(function(){return {kind:'local'};})}));
vi.mock('../../src/adapters/api/ApiGeoJsonRepository',()=>({ApiGeoJsonRepository:vi.fn(function(options){return {kind:'api',options};})}));
import { createRepository } from '../../src/data/createRepository';
import { ApiGeoJsonRepository } from '../../src/adapters/api/ApiGeoJsonRepository';
describe('repository selection',()=>{
  afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
  it('defaults to local',()=>{vi.stubEnv('VITE_DATA_SOURCE',undefined);expect(createRepository()).toMatchObject({kind:'local'});});
  it('selects local explicitly',()=>{vi.stubEnv('VITE_DATA_SOURCE','local');expect(createRepository()).toMatchObject({kind:'local'});});
  it.each(['http://127.0.0.1:8000','http://127.0.0.1:8000/','http://127.0.0.1:8000/api/v1'])('uses API address %s',url=>{
    vi.stubEnv('VITE_DATA_SOURCE','api');vi.stubEnv('VITE_API_BASE_URL',url);createRepository();
    expect(ApiGeoJsonRepository).toHaveBeenCalledWith({baseUrl:'http://127.0.0.1:8000/api/v1'});
  });
  it('rejects unknown modes without local fallback',()=>{vi.stubEnv('VITE_DATA_SOURCE','typo');expect(createRepository).toThrow('local veya api');});
  it.each(['file:///tmp/data','http://secret:password@localhost:8000','http://localhost:8000?token=x'])('rejects unsafe configuration',url=>{
    vi.stubEnv('VITE_DATA_SOURCE','api');vi.stubEnv('VITE_API_BASE_URL',url);expect(createRepository).toThrow();
  });
});
