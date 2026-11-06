import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { ApiGeoJsonRepository } from '../../src/adapters/api/ApiGeoJsonRepository';
import type { GeoFeature } from '../../src/domain/contracts';

it('saves isolated snapshots, reopens without data loss, and enforces project versions against real SQLite',async()=>{
  const temporary=mkdtempSync(join(tmpdir(),'geojson-projects-'));
  const cwd=resolve('backend'),python=join(cwd,'.venv/bin/python');
  const env={...process.env,GEOJSON_DATABASE_PATH:join(temporary,'projects.db')};
  const server=spawn(python,['-u','-c',`
import socket, uvicorn
from alembic import command
from alembic.config import Config
command.upgrade(Config('alembic.ini'),'head')
sock=socket.socket();sock.bind(('127.0.0.1',0))
print('PORT='+str(sock.getsockname()[1]),flush=True)
uvicorn.run('app.main:app',fd=sock.fileno(),log_level='warning')
`],{cwd,env,stdio:['ignore','pipe','pipe']});
  let logs='';server.stderr.on('data',chunk=>logs+=String(chunk));
  let repo:ApiGeoJsonRepository|undefined,other:ApiGeoJsonRepository|undefined;
  try{
    const port=await new Promise<number>((resolvePort,reject)=>{
      const timer=setTimeout(()=>reject(new Error('API startup timed out: '+logs)),15000);
      server.on('error',reject);server.on('exit',code=>{clearTimeout(timer);reject(new Error('API exited '+code+': '+logs));});
      server.stdout.on('data',chunk=>{const match=/PORT=(\d+)/.exec(String(chunk));if(match){clearTimeout(timer);resolvePort(Number(match[1]));}});
    });
    const base=`http://127.0.0.1:${port}/api/v1`;
    let healthy=false;for(let i=0;i<100;i++){try{healthy=(await fetch(base+'/health')).ok;}catch{}if(healthy)break;await new Promise(r=>setTimeout(r,50));}expect(healthy,logs).toBe(true);
    repo=new ApiGeoJsonRepository({baseUrl:base});other=new ApiGeoJsonRepository({baseUrl:base});
    // Listing global project metadata does not create an empty workspace.
    expect((await repo.projects.list()).total).toBe(0);
    const polygon:GeoFeature={type:'Feature',id:'external',properties:{ana_kategori:'Arazi',alt_kategori:'Park',kategori:'Arazi',unknown:{keep:[true,null,'İğdır']}},geometry:{type:'Polygon',coordinates:[[[29,41,10],[30,41,11],[30,42,12],[29,41,10]]]}};
    const added=await repo.mutate({feature:polygon});await repo.addCategory('Unused');await repo.addCategory('Child','Unused');
    const saved=await repo.projects.create('Park projesi');expect(saved.version).toBe(1);expect(saved.dataset.revision).toBe(3);
    const catalog=await repo.categories();const original=JSON.parse(await(await repo.export()).text());
    await repo.mutate({feature:{type:'Feature',id:'unsaved',properties:{pending:true},geometry:null}});
    expect((await repo.projects.get(saved.id)).dataset.count).toBe(1);
    const opened=await repo.projects.open(saved.id,1);expect(opened.previousWorkspace).not.toBeNull();expect(opened.workspace.id).not.toBe(opened.previousWorkspace!.id);
    expect(opened.workspace.activeDatasetId).not.toBe(saved.savedDatasetId);expect(opened.workspace.dataset.revision).toBe(3);
    expect((await repo.get(added.id)).feature).toEqual(polygon);expect(await repo.categories()).toEqual(catalog);
    expect(JSON.parse(await(await repo.export()).text())).toEqual(original);
    const previous=await(await fetch(base+'/workspaces/'+opened.previousWorkspace!.id)).json();expect(previous.dataset.count).toBe(2);
    const renamedFeature={...polygon,properties:{...polygon.properties,name:'Edited'}};await repo.mutate({id:added.id,feature:renamedFeature});
    expect((await repo.projects.get(saved.id)).dataset.revision).toBe(3);
    const savedAgain=await repo.projects.save(saved.id,1);expect(savedAgain.version).toBe(2);expect(savedAgain.dataset.revision).toBe(4);
    await expect(repo.projects.save(saved.id,1)).rejects.toMatchObject({status:409});
    await expect(repo.projects.open(saved.id,1)).rejects.toMatchObject({status:409});
    expect((await repo.get(added.id)).feature).toEqual(renamedFeature);
    const named=await repo.projects.rename(saved.id,'Yeni proje',2);expect(named.version).toBe(3);expect(named.dataset.revision).toBe(4);
    expect((await repo.projects.list('Yeni',0,1)).items[0].name).toBe('Yeni proje');
    expect((await repo.projects.list('Yeni',1,1)).items).toEqual([]);
    await expect(repo.projects.rename(saved.id,'Stale',2)).rejects.toMatchObject({status:409});
    await expect(repo.projects.remove(saved.id,2)).rejects.toMatchObject({status:409});
    // An independent working copy cannot silently save into this project.
    await other.createEmpty();await expect(other.projects.save(saved.id,3)).rejects.toMatchObject({status:409});
    const otherProject=await other.projects.create('Other');
    const reopened=await repo.projects.open(saved.id,3);expect(reopened.workspace.dataset.revision).toBe(4);expect((await repo.get(added.id)).feature).toEqual(renamedFeature);
    await repo.projects.remove(saved.id,3);await expect(repo.projects.get(saved.id)).rejects.toMatchObject({status:404});
    expect((await repo.projects.list()).total).toBe(1);expect((await other.projects.get(otherProject.id)).version).toBe(1);
    expect((await repo.get(added.id)).feature).toEqual(renamedFeature);
    expect((await(await fetch(base+'/workspaces/'+opened.previousWorkspace!.id)).json()).dataset.count).toBe(2);
  }finally{
    repo?.dispose();other?.dispose();
    if(server.exitCode===null){const ended=once(server,'exit');server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),3000);await ended;clearTimeout(timer);}
    rmSync(temporary,{recursive:true,force:true});
  }
});
