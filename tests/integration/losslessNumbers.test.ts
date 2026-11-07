import { backendPython } from './backendRuntime';
import { parseJson, stringifyJson } from '../../src/domain/losslessJson';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { it, expect } from 'vitest';
import { ApiGeoJsonRepository } from '../../src/adapters/api/ApiGeoJsonRepository';
import type { GeoFeature } from '../../src/domain/contracts';

it('preserves exact JSON integers across HTTP mutations, snapshots and fresh repository instances', async () => {
  const temporary = mkdtempSync(join(tmpdir(),'geojson-api-'));
  const cwd = resolve('backend'); const python = backendPython();
  const env = {...process.env,GEOJSON_DATABASE_PATH:join(temporary,'projects.db')};
  const children: ChildProcess[] = [];
  const launch = (args:string[]) => { const child=spawn(python,args,{cwd,env,stdio:['ignore','pipe','pipe']}); children.push(child); return child; };
  const server = launch(['-u','-c', `
import socket, uvicorn
from alembic import command
from alembic.config import Config
command.upgrade(Config('alembic.ini'),'head')
sock=socket.socket(); sock.bind(('127.0.0.1',0))
print('PORT='+str(sock.getsockname()[1]),flush=True)
uvicorn.run('app.main:app',fd=sock.fileno(),log_level='warning')
`]);
  let logs=''; server.stderr!.on('data',chunk=>{logs+=String(chunk);});
  let repo: ApiGeoJsonRepository | undefined;
  try {
    const port=await new Promise<number>((resolvePort,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('API startup timed out: '+logs)),15000);
      server.on('error',reject); server.on('exit',code=>{clearTimeout(timeout);reject(new Error('API exited '+code+': '+logs));});
      server.stdout!.on('data',chunk=>{const match=/PORT=(\d+)/.exec(String(chunk));if(match){clearTimeout(timeout);resolvePort(Number(match[1]));}});
    });
    const base=`http://127.0.0.1:${port}/api/v1`;
    let healthy=false;
    for(let i=0;i<100;i++){try{healthy=(await fetch(base+'/health')).ok;}catch{}if(healthy)break;await new Promise(r=>setTimeout(r,50));}
    expect(healthy,logs).toBe(true);
    const worker=launch(['-m','app.workers.import_worker','--poll-interval','0.05']); worker.stderr!.on('data',chunk=>{logs+=String(chunk);});
    repo=new ApiGeoJsonRepository({baseUrl:base,pollIntervalMs:20});
    const integers=['9007199254740991','9007199254740992','9007199254740993','9007199254740995','-9007199254740993'];
    const feature=(token:string)=>`{"type":"Feature","id":${token},"properties":{"name":"Original","exact":${token},"nested":{"values":[${token},null,true,"${token}",1.25,-2]}},"geometry":{"type":"Polygon","coordinates":[[[29,41,7],[29.1,41,8],[29.1,41.1,9],[29,41,7]]]}}`;
    const inputs=[...integers.map(feature),feature('0').replace('"id":0','"id":"9007199254740993"'),feature('0').replace(',"id":0','')];
    const summary=await repo.open(new File([`{"type":"FeatureCollection","category_catalog":[{"name":"Unused","subcategories":["Empty"]}],"features":[${inputs.join(',')}]}`],'exact.geojson'));
    expect(summary.revision).toBe(0);const page=await repo.list('',0,100);expect(page.total).toBe(7);
    for(let i=0;i<5;i++){
      const record=await repo.get(page.items[i].id);expect(String(record.feature.id)).toBe(integers[i]);expect(record.summary.id).not.toBe(integers[i]);
      const properties={...record.feature.properties,name:'Edited',exact:parseJson(integers[(i+1)%5])};
      const result=await repo.mutate({id:record.summary.id,feature:{...record.feature,properties}});expect(result.dataset.revision).toBe(i+1);
      expect(result.record!.feature.geometry).toEqual(record.feature.geometry);
    }
    const text=await(await repo.export()).text(),output=parseJson(text) as any;
    for(let i=0;i<5;i++){expect(text).toContain(`"id": ${integers[i]}`);expect(String(output.features[i].properties.exact)).toBe(integers[(i+1)%5]);}
    expect(output.features[5].id).toBe('9007199254740993');expect(Object.hasOwn(output.features[6],'id')).toBe(false);
    const view=await repo.query({bounds:[28,40,30,42],tolerance:0,limit:100});expect(view.matched).toBe(7);expect(String(view.records[2].feature.id)).toBe(integers[2]);
    const saved=await repo.projects.create('Exact snapshot');expect(saved.version).toBe(1);expect(saved.dataset.revision).toBe(5);
    repo.dispose();repo=new ApiGeoJsonRepository({baseUrl:base,pollIntervalMs:20});
    const opened=await repo.projects.open(saved.id,saved.version);expect(opened.workspace.dataset.revision).toBe(5);
    expect(parseJson(await(await repo.export()).text())).toEqual(output);
    expect((await repo.categories()).some(c=>c.name==='Unused'&&c.subcategories.includes('Empty'))).toBe(true);
    const record=await repo.get((await repo.list('',0,10)).items[2].id);
    const edited={...record.feature,properties:{...record.feature.properties,note:'After snapshot'}};
    await repo.mutate({id:record.summary.id,feature:edited});
    const observer=new ApiGeoJsonRepository({baseUrl:base});try{
      await observer.projects.open(saved.id,1);expect(parseJson(await(await observer.export()).text())).toEqual(output);
    }finally{observer.dispose();}
    const resaved=await repo.projects.save(saved.id,1);expect(resaved.version).toBe(2);expect(resaved.dataset.revision).toBe(6);
    await expect(repo.projects.save(saved.id,1)).rejects.toMatchObject({status:409});
    const before=await(await repo.export()).text();
    await expect(repo.mutate({id:record.summary.id,feature:{...edited,properties:{bad:Number('9007199254740993')}}})).rejects.toThrow('özgün değer');
    expect(await(await repo.export()).text()).toBe(before);
    const invalid=feature(integers[2]).replace('"exact":'+integers[2],'"exact":1.123456789012345678901');
    await expect(repo.open(new File([`{"type":"FeatureCollection","features":[${invalid}]}`],'unsupported.geojson'))).rejects.toThrow('hassasiyet');
    expect(await(await repo.export()).text()).toBe(before);
    console.log('EXACT_HTTP: all 5 integer tokens, nested JSON, string/absent IDs, geometry/Z, revision, save/refresh/open/resave and atomic rejection preserved');
  } finally {
    repo?.dispose();
    await Promise.all(children.reverse().map(async child=>{if(child.exitCode!==null)return; const ended=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await ended;clearTimeout(timer);}));
    rmSync(temporary,{recursive:true,force:true});
  }
});
