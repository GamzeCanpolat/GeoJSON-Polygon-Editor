import { backendLauncher, backendPython } from './backendRuntime';
import { it, expect } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';

const pause=(ms=100)=>new Promise(r=>setTimeout(r,ms));
async function port(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const n=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));return n;}

// Explicit opt-in: requires local Chrome and the backend Python environment.
it.skipIf(!process.env.RUN_BROWSER_INTEGRATION)('project UI saves a drawn polygon, survives refresh, reopens, resaves and confirms deletion',async()=>{
  const temporary=mkdtempSync(join(tmpdir(),'geojson-browser-')); const children:ChildProcess[]=[];
  const backend=resolve('backend'),python=backendPython(),database=join(temporary,'projects.db');
  const [apiPort,vitePort,debugPort]=await Promise.all([port(),port(),port()]);
  const env={...process.env,PROJECT_UI_CACHE_DIR:join(temporary,'vite-cache'),GEOJSON_DATABASE_PATH:database,GEOJSON_CORS_ORIGINS:JSON.stringify([`http://127.0.0.1:${vitePort}`])};
  let logs='';
  const launch=(command:string,args:string[],cwd:string,environment=env)=>{const child=spawn(command,args,{cwd,env:environment,stdio:['ignore','pipe','pipe']});children.push(child);child.stderr!.on('data',x=>logs+=String(x));child.stdout!.on('data',x=>logs+=String(x));return child;};
  let socket:WebSocket|undefined;
  const wait=async(test:()=>Promise<boolean>)=>{for(let i=0;i<150;i++){try{if(await test())return;}catch{}await pause();}throw new Error('Timed out: '+logs.split('\n').filter(l=>/INFO:|ERROR|error|VITE|vite/.test(l)).slice(-35).join('\n'));};
  try{
    execFileSync('bash',[backendLauncher,'migrate'],{cwd:backend,env,stdio:'pipe'});
    launch('bash',[backendLauncher,'api','--port',String(apiPort)],backend);
    launch('bash',[backendLauncher,'worker','--poll-interval','0.05'],backend);
    launch(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'--config',resolve('tests/fixtures/project-management.vite.config.ts'),'--host','127.0.0.1','--port',String(vitePort)],resolve('.'),{...env,VITE_PROJECT_MANAGEMENT:'true',VITE_DATA_SOURCE:'api',VITE_API_BASE_URL:`http://127.0.0.1:${apiPort}`});
    await wait(async()=> (await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`)).ok);
    await wait(async()=> (await fetch(`http://127.0.0.1:${vitePort}`)).ok);
    launch('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',`--user-data-dir=${join(temporary,'chrome')}`,`--remote-debugging-port=${debugPort}`,'--window-size=1400,1000','about:blank'],resolve('.'));
    let target:{webSocketDebuggerUrl:string}|undefined;
    await wait(async()=>{target=(await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((t:{type:string})=>t.type==='page');return !!target;});
    socket=new WebSocket(target!.webSocketDebuggerUrl);await once(socket,'open');let id=0;
    const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
    socket.addEventListener('message',event=>{const value=JSON.parse(String(event.data));const p=pending.get(value.id);if(p){pending.delete(value.id);if(value.error)p.reject(new Error(JSON.stringify(value.error)));else p.resolve(value.result);}});
    const call=(method:string,params:object={})=>new Promise<any>((resolveCall,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout '+method+' '+JSON.stringify(params).slice(0,140)+' LOGS '+logs.slice(-5000)));},20000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolveCall(v);},reject:e=>{clearTimeout(timer);reject(e);}});socket!.send(JSON.stringify({id:n,method,params}));});
    const evaluate=async(expression:string)=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
    await call('Page.enable');
    socket.addEventListener('message',event=>{if(JSON.parse(String(event.data)).method==='Page.javascriptDialogOpening')void call('Page.handleJavaScriptDialog',{accept:true});});
    await call('Page.navigate',{url:`http://127.0.0.1:${vitePort}`});
    const count=(table:string)=>Number(execFileSync(python,['-c',`import sqlite3; print(sqlite3.connect(${JSON.stringify(database)}).execute('SELECT count(*) FROM ${table}').fetchone()[0])`],{env,cwd:backend,encoding:'utf8'}).trim());
    await wait(async()=>count('workspaces')===1 && await evaluate(`!!document.querySelector('.ol-viewport') && !document.querySelector('.map-loading')`));
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.title.includes('Poligon çiz')||b.getAttribute('aria-label')?.includes('Poligon çiz')).click()`);
    const box=await evaluate(`(()=>{const r=document.querySelector('.ol-viewport').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    const points=[[.35,.35],[.6,.35],[.6,.6],[.35,.35]];
    const sx=box.x+box.width*.35,sy=box.y+box.height*.35;
    await call('Input.dispatchMouseEvent',{type:'mousePressed',x:sx,y:sy,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:sx,y:sy,button:'left',clickCount:1});await pause(100);
    await evaluate(`[...document.querySelectorAll('.project-toolbar-actions button')].find(b=>b.textContent==='Projeyi Kaydet').click()`);
    await wait(async()=>await evaluate(`document.querySelector('.project-management [role=alert]')?.textContent.includes('Devam eden çizimi')`));expect(count('projects')).toBe(0);
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.title.includes('Poligon çiz')||b.getAttribute('aria-label')?.includes('Poligon çiz')).click()`);
    for(const [x,y] of points){const px=box.x+box.width*x,py=box.y+box.height*y;await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:px,y:py});await call('Input.dispatchMouseEvent',{type:'mousePressed',x:px,y:py,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:px,y:py,button:'left',clickCount:1});await pause(100);}
    await wait(async()=>count('features')===1);
    const geometry=execFileSync(python,['-c',`import sqlite3; print(sqlite3.connect(${JSON.stringify(database)}).execute('SELECT geometry_type FROM features').fetchone()[0])`],{env,cwd:backend,encoding:'utf8'}).trim();expect(geometry).toBe('Polygon');

    const sql=(statement:string)=>JSON.parse(execFileSync(python,['-c',`import sqlite3,json,sys; print(json.dumps(sqlite3.connect(${JSON.stringify(database)}).execute(sys.argv[1]).fetchall()))`,statement],{env,cwd:backend,encoding:'utf8'}));
    const snapshot=()=>JSON.parse(sql('SELECT feature_json FROM features JOIN projects ON features.dataset_id=projects.saved_dataset_id LIMIT 1')[0][0]);
    const button=async(text:string)=>evaluate(`(()=>{const b=[...document.querySelectorAll('.project-management button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b||b.disabled)throw new Error('Button unavailable: '+${JSON.stringify(text)});b.click();})()`);
    const input=async(value:string)=>evaluate(`(()=>{const e=document.querySelector('.project-dialog input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const original=JSON.parse(sql('SELECT feature_json FROM features LIMIT 1')[0][0]);
    await button('Projeyi Kaydet');await input('Tarayıcı projesi');await button('Onayla');
    await wait(async()=>count('projects')===1&&await evaluate(`document.querySelector('.project-management [role=status]')?.textContent.includes('kaydedildi')`));
    expect(snapshot()).toEqual(original);
    const previousWorkspaces=count('workspaces');await call('Page.reload');
    await wait(async()=>count('workspaces')>previousWorkspaces&&await evaluate(`!!document.querySelector('.ol-viewport')&&!document.querySelector('.map-loading')`));
    expect(await evaluate(`document.querySelector('.map-counter').textContent.includes('0 şekil')`)).toBe(true);
    await button('Projelerim');await wait(async()=>await evaluate(`!![...document.querySelectorAll('.project-management button')].find(b=>b.textContent==='Aç'&&!b.disabled)`));
    if(process.env.PROJECT_UI_SCREENSHOT){const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync(process.env.PROJECT_UI_SCREENSHOT,Buffer.from(shot.data,'base64'));}
    await button('Aç');await wait(async()=>await evaluate(`document.querySelector('.map-counter').textContent.includes('1 şekil')&&!document.querySelector('.project-dialog')`));
    expect(snapshot()).toEqual(original);
    expect(await evaluate(`document.querySelector('[aria-label="Geri al"]').disabled`)).toBe(true);
    expect(await evaluate(`document.querySelectorAll('.reference-feature-row.selected').length`)).toBe(0);
    const editFeature=async(edited:any)=>{
    await evaluate(`document.querySelector('.reference-feature-select').click()`);
    await wait(async()=>await evaluate(`!!document.querySelector('.reference-feature-row.selected')`));
    await evaluate(`(()=>{const s=document.querySelector('[aria-label="JSON kapsamı"]');s.value='feature';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(async()=>await evaluate(`(()=>{try{return JSON.parse(document.querySelector('[aria-label="GeoJSON kod editörü"]').value).type==='Feature';}catch{return false;}})()`));
    await evaluate(`(()=>{const auto=document.querySelector('.code-status input');if(auto.checked)auto.click();const e=document.querySelector('[aria-label="GeoJSON kod editörü"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(JSON.stringify(edited))});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait(async()=>await evaluate(`!![...document.querySelectorAll('.code-status button')].find(b=>b.textContent==='Uygula'&&!b.disabled)`));
    await evaluate(`[...document.querySelectorAll('.code-status button')].find(b=>b.textContent==='Uygula').click()`);
    await wait(async()=>await evaluate(`!document.querySelector('.map-loading')&&!document.querySelector('.project-management button').disabled`));
    };
    const edited=structuredClone(original);edited.properties={...edited.properties,name:'Edited polygon',unknown:{keep:true}};edited.geometry.coordinates[0][1][0]+=.001;
    edited.geometry.coordinates[0].forEach((position:number[])=>position[2]=5);edited.id='browser-external-id';
    await editFeature(edited);
    await button('Projeyi Kaydet');await wait(async()=>sql('SELECT version FROM projects')[0][0]===2);
    expect(snapshot()).toEqual(edited);
    await button('Projelerim');await wait(async()=>await evaluate(`!![...document.querySelectorAll('.project-management button')].find(b=>b.textContent==='Aç'&&!b.disabled)`));
    await button('Aç');await wait(async()=>await evaluate(`!document.querySelector('.project-dialog')&&!document.querySelector('.project-management button').disabled`));
    await wait(async()=>await evaluate(`(()=>{try{return JSON.parse(document.querySelector('[aria-label="GeoJSON kod editörü"]').value).features?.[0]?.id==='browser-external-id';}catch{return false;}})()`));
    await evaluate(`(()=>{const auto=document.querySelector('.code-status input');if(auto.checked)auto.click();const e=document.querySelector('[aria-label="GeoJSON kod editörü"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'{');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await button('Projelerim');await wait(async()=>await evaluate(`!![...document.querySelectorAll('.project-management button')].find(b=>b.textContent==='Aç'&&!b.disabled)`));await button('Aç');
    expect(await evaluate(`[...document.querySelectorAll('.project-dialog button')].find(b=>b.textContent==='Kaydet').disabled`)).toBe(true);await button('İptal');
    await evaluate(`document.querySelector('[aria-label="Proje penceresini kapat"]').click()`);expect(await evaluate(`document.querySelector('[aria-label="GeoJSON kod editörü"]').value`)).toBe('{');
    await evaluate(`document.querySelector('[aria-label="Haritadaki JSON’u yükle"]').click()`);
    await wait(async()=>await evaluate(`(()=>{try{return JSON.parse(document.querySelector('[aria-label="GeoJSON kod editörü"]').value).type==='FeatureCollection';}catch{return false;}})()`));
    const pendingFeature=structuredClone(edited);pendingFeature.properties.name='Pending edit';await editFeature(pendingFeature);
    await button('Projelerim');await wait(async()=>await evaluate(`!![...document.querySelectorAll('.project-management button')].find(b=>b.textContent==='Aç'&&!b.disabled)`));await button('Aç');
    expect(await evaluate(`document.querySelector('.project-dialog').textContent.includes('Kaydedilmemiş değişiklikler')`)).toBe(true);
    await button('İptal');expect(snapshot()).toEqual(edited);
    expect(await evaluate(`document.querySelector('[aria-label="GeoJSON kod editörü"]').value.includes('Pending edit')`)).toBe(true);
    await button('Aç');await button('Kaydet');await wait(async()=>sql('SELECT version FROM projects')[0][0]===3&&await evaluate(`!document.querySelector('.project-dialog')&&!document.querySelector('.project-management button').disabled`));
    expect(snapshot()).toEqual(pendingFeature);
    const discard=structuredClone(pendingFeature);discard.properties.name='Discard this';await editFeature(discard);
    await button('Projelerim');await wait(async()=>await evaluate(`!![...document.querySelectorAll('.project-management button')].find(b=>b.textContent==='Aç'&&!b.disabled)`));await button('Aç');await button('Kaydetmeden Devam Et');
    await wait(async()=>await evaluate(`!document.querySelector('.project-dialog')&&!document.querySelector('.project-management button').disabled`));
    expect(snapshot()).toEqual(pendingFeature);expect(sql('SELECT version FROM projects')[0][0]).toBe(3);
    const [projectId,version]=sql('SELECT id,version FROM projects')[0];
    const external=await fetch(`http://127.0.0.1:${apiPort}/api/v1/projects/${projectId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Externally renamed',expectedVersion:version})});expect(external.status).toBe(200);
    await wait(async()=>await evaluate(`!document.querySelector('.project-management button').disabled`));
    await button('Projeyi Kaydet');await wait(async()=>await evaluate(`document.querySelector('.project-management [role=alert]')?.textContent.includes('Sürüm çakışması')`));
    expect(sql('SELECT version FROM projects')[0][0]).toBe(4);expect(snapshot()).toEqual(pendingFeature);
    await button('Projelerim');await wait(async()=>await evaluate(`!![...document.querySelectorAll('.project-management button')].find(b=>b.textContent==='Sil'&&!b.disabled)`));
    await button('Sil');expect(count('projects')).toBe(1);await button('Vazgeç');expect(count('projects')).toBe(1);
    await button('Sil');await button('Silmeyi onayla');await wait(async()=>count('projects')===0);expect(count('features')).toBeGreaterThan(0);
    await button('Proje penceresini kapat').catch(()=>evaluate(`document.querySelector('[aria-label="Proje penceresini kapat"]').click()`));
    await evaluate(`document.querySelector('[aria-label="Yeni dosya"]').click()`);
    await evaluate(`[...document.querySelectorAll('.confirm-modal button')].find(b=>b.textContent==='İptal').click()`);expect(await evaluate(`document.querySelector('.map-counter').textContent.includes('1 şekil')`)).toBe(true);
    await evaluate(`document.querySelector('[aria-label="Yeni dosya"]').click()`);await evaluate(`[...document.querySelectorAll('.confirm-modal button')].find(b=>b.textContent==='Kaydet').click()`);
    await input('Recovered before New');await evaluate(`[...document.querySelectorAll('.project-dialog button')].find(b=>b.textContent==='Onayla').click()`);
    await wait(async()=>count('projects')===1&&await evaluate(`document.querySelector('.map-counter').textContent.includes('0 şekil')&&!document.querySelector('.project-dialog')`));expect(snapshot()).toEqual(pendingFeature);
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await wait(async()=>await evaluate(`getComputedStyle(document.querySelector('.project-mobile-menu')).display!=='none'`));
    await evaluate(`document.querySelector('.project-mobile-menu summary').click()`);
    expect(await evaluate(`(()=>{const r=document.querySelector('.project-mobile-menu>div').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})()`)).toBe(true);
    expect(await evaluate(`document.documentElement.scrollWidth<=innerWidth`)).toBe(true);
    expect(sql('PRAGMA integrity_check')).toEqual([['ok']]);
    expect(sql('PRAGMA foreign_key_check')).toEqual([]);
    expect(sql("SELECT rtreecheck('feature_rtree')")).toEqual([['ok']]);

  }finally{
    socket?.close();await Promise.all(children.reverse().map(async child=>{if(child.exitCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);await done;clearTimeout(timer);}));
    rmSync(temporary,{recursive:true,force:true});
  }
},90000);
