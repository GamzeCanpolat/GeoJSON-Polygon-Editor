import { backendLauncher, backendPython } from './backendRuntime';
import { it, expect } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';

const pause=(ms=100)=>new Promise(r=>setTimeout(r,ms));
async function port(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const n=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));return n;}

// Explicit opt-in: requires local Chrome and the backend Python environment.
it.skipIf(!process.env.RUN_BROWSER_INTEGRATION)('table Save barrier preserves values under gated requests, latency and HTTP failure',async()=>{
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
    await call('Page.enable');await call('Emulation.setFocusEmulationEnabled',{enabled:true});
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


    const sql=(statement:string)=>JSON.parse(execFileSync(python,['-c',`import sqlite3,json,sys;print(json.dumps(sqlite3.connect(${JSON.stringify(database)}).execute(sys.argv[1]).fetchall()))`,statement],{env,cwd:backend,encoding:'utf8'}));
    const live=()=>JSON.parse(sql('SELECT f.feature_json FROM workspaces w JOIN features f ON f.dataset_id=w.active_dataset_id WHERE f.is_deleted=0 ORDER BY w.created_at DESC LIMIT 1')[0][0]);
    const saved=()=>JSON.parse(sql('SELECT f.feature_json FROM projects p JOIN features f ON f.dataset_id=p.saved_dataset_id LIMIT 1')[0][0]);
    const version=()=>sql('SELECT version FROM projects')[0][0];
    const action=async(text:string)=>evaluate(`(()=>{const b=[...document.querySelectorAll('.project-management button,.project-dialog button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b||b.disabled)throw new Error('Unavailable '+${JSON.stringify(text)});b.click();})()`);
    const nativeSave=async()=>{const box=await evaluate(`(()=>{const b=document.querySelector('.project-toolbar-actions button');const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mouseMoved',...box});await call('Input.dispatchMouseEvent',{type:'mousePressed',...box,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...box,button:'left',clickCount:1});};
    const table=async()=>{await evaluate(`[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='Tablo').click()`);await wait(async()=>await evaluate(`!!document.querySelector('.feature-table-panel tbody tr')`));};
    const type=async(value:string)=>{await wait(async()=>await evaluate(`!![...document.querySelectorAll('.feature-table-panel input')].find(e=>e.getAttribute('aria-label')?.startsWith('name ·')&&!e.disabled)`));await evaluate(`(()=>{const e=[...document.querySelectorAll('.feature-table-panel input')].find(e=>e.getAttribute('aria-label')?.startsWith('name ·'));e.focus();e.select()})()`);await call('Input.insertText',{text:value});};
    await table();await evaluate(`(()=>{const e=document.querySelector('[aria-label="Yeni öznitelik adı"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'name');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate(`document.querySelector('[aria-label="Öznitelik sütunu ekle"]').click()`);await type('Original');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
    await wait(async()=>live().properties.name==='Original'&&await evaluate(`!document.querySelector('.project-toolbar-actions button').disabled`));
    await action('Projeyi Kaydet');await evaluate(`(()=>{const e=document.querySelector('.project-dialog input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Race project');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await action('Onayla');
    await wait(async()=>count('projects')===1&&await evaluate(`document.querySelector('.project-management [role=status]')?.textContent.includes('kaydedildi')`));
    let gateNext=false,held:string|undefined,failNext=false,failedRequests=0;
    socket!.addEventListener('message',event=>{const e=JSON.parse(String(event.data));if(e.method!=='Fetch.requestPaused')return;const {requestId,request}=e.params;
      if(gateNext&&request.method==='GET'&&request.url.includes('/features/')){gateNext=false;held=requestId;return;}
      if(failNext&&request.method==='POST'&&request.url.endsWith('/mutations')){failNext=false;failedRequests++;void call('Fetch.fulfillRequest',{requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({detail:'Injected cell HTTP failure'})).toString('base64')});return;}
      void call('Fetch.continueRequest',{requestId});
    });
    await call('Fetch.enable',{patterns:[{urlPattern:'*/features/*',requestStage:'Request'},{urlPattern:'*/mutations',requestStage:'Request'}]});await call('Network.enable');
    for(const latency of [0,200,650]){
      await call('Network.emulateNetworkConditions',{offline:false,latency,downloadThroughput:-1,uploadThroughput:-1});const previous=version();held=undefined;
      // Arm only after the previous table refresh is finished and this cell is
      // focused. Otherwise a background row refresh could consume the gate.
      await type('Save click race '+latency);gateNext=true;await nativeSave();await wait(async()=>!!held);
      expect(version()).toBe(previous);await evaluate(`document.querySelector('.project-toolbar-actions button').click();document.querySelector('.project-toolbar-actions button').click()`);expect(version()).toBe(previous);
      await call('Fetch.continueRequest',{requestId:held});held=undefined;
      await wait(async()=>saved().properties.name==='Save click race '+latency&&await evaluate(`document.querySelector('.project-management [role=status]')?.textContent.includes('kaydedildi')`));
      expect(live().properties.name).toBe('Save click race '+latency);expect(version()).toBe(previous+1);
      console.log('GATED_SAVE_EQUAL',latency,live().properties.name,saved().properties.name,version());
    }
    await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    const oldCount=count('workspaces');await call('Page.reload');await wait(async()=>count('workspaces')>oldCount&&await evaluate(`!!document.querySelector('.ol-viewport')&&!document.querySelector('.map-loading')`));
    await action('Projelerim');await wait(async()=>await evaluate(`!![...document.querySelectorAll('.project-dialog button')].find(b=>b.textContent==='Aç'&&!b.disabled)`));await action('Aç');await wait(async()=>await evaluate(`!document.querySelector('.project-dialog')&&document.querySelector('.map-counter').textContent.includes('1 şekil')`));
    expect(live().properties.name).toBe('Save click race 650');await table();
    await type('Enter then Save');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
    await wait(async()=>live().properties.name==='Enter then Save'&&await evaluate(`!document.querySelector('.project-toolbar-actions button').disabled`));const previous=version();await nativeSave();await wait(async()=>version()===previous+1&&await evaluate(`document.querySelector('.project-management [role=status]')?.textContent.includes('kaydedildi')`));expect(saved().properties.name).toBe('Enter then Save');
    const beforeFailure=version();failNext=true;await type('Retained after HTTP error');await nativeSave();
    await wait(async()=>await evaluate(`!!document.querySelector('.project-management [role=alert]')&&!!document.querySelector('.feature-table-panel [role=alert]')`));
    expect(version()).toBe(beforeFailure);expect(saved().properties.name).toBe('Enter then Save');expect(live().properties.name).toBe('Enter then Save');
    expect(await evaluate(`[...document.querySelectorAll('.feature-table-panel input')].find(e=>e.getAttribute('aria-label')?.startsWith('name ·')).value`)).toBe('Retained after HTTP error');
    await nativeSave();await wait(async()=>await evaluate(`document.querySelector('.project-management [role=alert]')?.textContent.includes('Tekrar dene')`));expect(failedRequests).toBe(1);expect(version()).toBe(beforeFailure);
    await evaluate(`[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='JSON').click();`);await table();expect(await evaluate(`[...document.querySelectorAll('.feature-table-panel input')].find(e=>e.getAttribute('aria-label')?.startsWith('name ·')).value`)).toBe('Retained after HTTP error');
    await evaluate(`[...document.querySelectorAll('.feature-table-panel button')].find(b=>b.textContent==='Tekrar dene').click()`);await wait(async()=>live().properties.name==='Retained after HTTP error'&&await evaluate(`!document.querySelector('.project-toolbar-actions button').disabled`));await nativeSave();await wait(async()=>saved().properties.name==='Retained after HTTP error'&&await evaluate(`document.querySelector('.project-management [role=status]')?.textContent.includes('kaydedildi')`));
    held=undefined;const beforeOpen=count('workspaces');await type('Pending project switch');gateNext=true;await action('Projelerim');await wait(async()=>!!held);expect(count('workspaces')).toBe(beforeOpen);await call('Fetch.continueRequest',{requestId:held});
    await wait(async()=>await evaluate(`!![...document.querySelectorAll('.project-dialog button')].find(b=>b.textContent==='Aç'&&!b.disabled)`));expect(live().properties.name).toBe('Pending project switch');await action('Aç');await action('Kaydet');
    await wait(async()=>count('workspaces')>beforeOpen&&await evaluate(`!document.querySelector('.project-dialog')&&!document.querySelector('.project-toolbar-actions button').disabled`));expect(live().properties.name).toBe('Pending project switch');expect(saved().properties.name).toBe('Pending project switch');
    // A JSON draft created during the wait must be checked live, not via the
    // stale React props captured when Save was first clicked.
    await table();await wait(async()=>await evaluate(`!document.querySelector('[aria-label="GeoJSON kod editörü"]').disabled`));
    const beforeJson=version();await type('Table before JSON guard');held=undefined;gateNext=true;await nativeSave();await wait(async()=>!!held);
    await evaluate(`[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='JSON').click();`);
    await wait(async()=>await evaluate(`(()=>{const e=document.querySelector('[aria-label="GeoJSON kod editörü"]');return !e.disabled&&e.getClientRects().length>0})()`));
    await evaluate(`const e=document.querySelector('[aria-label="GeoJSON kod editörü"]');e.focus();e.select();`);await call('Input.insertText',{text:'{'});
    expect(await evaluate(`document.querySelector('[aria-label="GeoJSON kod editörü"]').value`)).toBe('{');
    await call('Fetch.continueRequest',{requestId:held});
    await wait(async()=>await evaluate(`document.querySelector('.project-management [role=alert]')?.textContent.includes('JSON taslağını')`));
    expect(version()).toBe(beforeJson);expect(saved().properties.name).toBe('Pending project switch');expect(live().properties.name).toBe('Table before JSON guard');
    expect(await evaluate(`document.querySelector('[aria-label="GeoJSON kod editörü"]').value`)).toBe('{');
    console.log('TABLE_BARRIER_PASS: gated 0/200/650ms; duplicate Save; refresh/reopen; Enter; HTTP error no snapshot; retained retry; pending project switch; live invalid JSON guard');
  }finally{
    socket?.close();await Promise.all(children.reverse().map(async child=>{if(child.exitCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);await done;clearTimeout(timer);}));
    rmSync(temporary,{recursive:true,force:true});
  }
},120000);
