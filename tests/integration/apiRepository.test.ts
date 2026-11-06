import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { it, expect } from 'vitest';
import { ApiGeoJsonRepository } from '../../src/adapters/api/ApiGeoJsonRepository';
import type { GeoFeature } from '../../src/domain/contracts';

it('uses real isolated FastAPI, SQLite, worker, R-Tree and streamed export', async () => {
  const temporary = mkdtempSync(join(tmpdir(),'geojson-api-'));
  const cwd = resolve('backend'); const python = join(cwd,'.venv/bin/python');
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
    expect((await repo.createEmpty()).revision).toBe(0);
    const original:GeoFeature={type:'Feature',id:'outside',properties:{ana_kategori:'Arazi',unknown:{keep:true}},geometry:{type:'Point',coordinates:[29,41,123]}};
    const added=await repo.mutate({feature:original}); expect((await repo.get(added.id)).feature).toEqual(original);
    const updated={...original,properties:{...original.properties,label:'edited'}};
    await repo.mutate({id:added.id,feature:updated});
    await repo.mutate({id:added.id,feature:null}); expect((await repo.list('',0,20)).total).toBe(0);
    await repo.mutate({id:added.id,feature:updated});
    expect((await repo.query({bounds:[28,40,30,42],tolerance:.001,limit:10})).matched).toBe(1);
    await repo.addCategory('Unused'); expect((await repo.categories()).some(c=>c.name==='Unused')).toBe(true);
    const exported=JSON.parse(await (await repo.export()).text()); expect(exported.features).toEqual([updated]);
    const imported=await repo.open(new File([JSON.stringify(exported)],'roundtrip.geojson'));
    expect(imported.count).toBe(1); expect(imported.revision).toBe(0);
    expect((await repo.query({bounds:[28,40,30,42],tolerance:0,limit:10})).matched).toBe(1);
    expect(JSON.parse(await (await repo.export()).text())).toEqual(exported);
    await expect(repo.open(new File(['{"type":"FeatureCollection","features":['], 'broken.geojson'))).rejects.toThrow();
    expect((await repo.list('',0,20)).total).toBe(1);
    const cancellation=new AbortController();
    await expect(repo.open(new File([JSON.stringify(exported)],'cancel.geojson'),()=>cancellation.abort(),cancellation.signal)).rejects.toThrow('iptal');
    expect((await repo.list('',0,20)).total).toBe(1);
    expect((await repo.createEmpty()).revision).toBe(0); expect((await repo.list('',0,20)).total).toBe(0);
  } finally {
    repo?.dispose();
    await Promise.all(children.reverse().map(async child=>{if(child.exitCode!==null)return; const ended=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await ended;clearTimeout(timer);}));
    rmSync(temporary,{recursive:true,force:true});
  }
});
