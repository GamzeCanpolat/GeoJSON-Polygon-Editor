import { parseJson, stringifyJson } from '../../src/domain/losslessJson';
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
for(const mode of ['local','api']) it.skipIf(!process.env.RUN_BROWSER_INTEGRATION)(`lossless ${mode} UI preserves integers through Worker/table/JSON/export and API project refresh`,async()=>{
  const temporary=mkdtempSync(join(tmpdir(),'geojson-browser-')); const children:ChildProcess[]=[];
  const backend=resolve('backend'),python=join(backend,'.venv/bin/python'),database=join(temporary,'projects.db');
  const [apiPort,vitePort,debugPort]=await Promise.all([port(),port(),port()]);
  const env={...process.env,PROJECT_UI_CACHE_DIR:join(temporary,'vite-cache'),GEOJSON_DATABASE_PATH:database,GEOJSON_CORS_ORIGINS:JSON.stringify([`http://127.0.0.1:${vitePort}`])};
  let logs='';
  const launch=(command:string,args:string[],cwd:string,environment=env)=>{const child=spawn(command,args,{cwd,env:environment,stdio:['ignore','pipe','pipe']});children.push(child);child.stderr!.on('data',x=>logs+=String(x));child.stdout!.on('data',x=>logs+=String(x));return child;};
  let socket:WebSocket|undefined;
  const wait=async(test:()=>Promise<boolean>)=>{for(let i=0;i<150;i++){try{if(await test())return;}catch{}await pause();}throw new Error('Timed out: '+logs.split('\n').filter(l=>/INFO:|ERROR|error|VITE|vite/.test(l)).slice(-35).join('\n'));};
  try{
    execFileSync(python,['-m','alembic','upgrade','head'],{cwd:backend,env,stdio:'pipe'});
    launch(python,['-m','uvicorn','app.main:app','--host','127.0.0.1','--port',String(apiPort)],backend);
    launch(python,['-m','app.workers.import_worker','--poll-interval','0.05'],backend);
    launch(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'--config',resolve('tests/fixtures/project-management.vite.config.ts'),'--host','127.0.0.1','--port',String(vitePort)],resolve('.'),{...env,VITE_PROJECT_MANAGEMENT:'true',VITE_DATA_SOURCE:mode,VITE_API_BASE_URL:`http://127.0.0.1:${apiPort}`});
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
    await wait(async()=>(mode==='local'||count('workspaces')===1) && await evaluate(`!!document.querySelector('.ol-viewport') && !document.querySelector('.map-loading')`));
    const integers=['9007199254740991','9007199254740992','9007199254740993','9007199254740995','-9007199254740993'];
    const feature=(token:string,i:number)=>`{"type":"Feature","id":${token},"properties":{"name":"Feature${i}","exact":${token},"nested":[${token},null,true,"${token}",1.25]},"geometry":{"type":"Polygon","coordinates":[[[29,41,7],[29.1,41,8],[29.1,41.1,9],[29,41,7]]]}}`;
    const source=`{"type":"FeatureCollection","category_catalog":[{"name":"Unused","subcategories":[]}],"features":[${integers.map(feature).join(',')}]}`;
    const file=join(temporary,'integers.geojson');writeFileSync(file,source);
    // Capture existing controller instance for observing the REAL active repo.
    await evaluate(`(async()=>{const {MapController}=await import('/src/map/MapController.ts');const fit=MapController.prototype.fit;MapController.prototype.fit=function(...args){window.__testMap=this;return fit.apply(this,args)}})()`);
    await evaluate(`document.querySelector('[aria-label="İçe aktar"]').click()`);await wait(async()=>await evaluate(`!!document.querySelector('[aria-label="İçe aktarılacak dosya"]')`));
    const doc=await call('DOM.getDocument'),input=await call('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[aria-label="İçe aktarılacak dosya"]'});
    await call('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[file]});
    await wait(async()=>await evaluate(`document.querySelector('.map-counter').textContent.includes('5 şekil')&&!document.querySelector('.standard-import-dialog')&&!!window.__testMap`));
    const output=async()=>evaluate(`(async()=>await(await window.__testMap.repository.export()).text())()`);
    const original=parseJson(await output()) as any;for(let i=0;i<5;i++)expect(String(original.features[i].id)).toBe(integers[i]);
    await evaluate(`[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='Tablo').click()`);
    const selector='input[aria-label="exact · Feature2"]';await wait(async()=>await evaluate(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`));
    expect(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`)).toBe('9007199254740993');
    await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select()})()`);await call('Input.insertText',{text:'9007199254740995'});
    if(mode==='api'){
      // Native Save must flush this focused cell without Enter, preserving 8B.
      const b=await evaluate(`(()=>{const r=document.querySelector('.project-toolbar-actions button').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await call('Input.dispatchMouseEvent',{type:'mousePressed',...b,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',clickCount:1});
      await wait(async()=>await evaluate(`!!document.querySelector('.project-dialog input')`));
      await evaluate(`(()=>{const e=document.querySelector('.project-dialog input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Exact UI');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await wait(async()=>await evaluate(`![...document.querySelectorAll('.project-dialog button')].find(b=>b.textContent==='Onayla').disabled`));
      await evaluate(`[...document.querySelectorAll('.project-dialog button')].find(b=>b.textContent==='Onayla').click()`);
      await wait(async()=>await evaluate(`document.querySelector('.project-management [role=status]')?.textContent.includes('kaydedildi')`));
    }else{
      expect(await evaluate(`document.querySelector('.project-management')===null`)).toBe(true);
      await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
      await wait(async()=>await evaluate(`!document.querySelector(${JSON.stringify(selector)}).disabled`));
    }
    await wait(async()=>String((parseJson(await output()) as any).features[2].properties.exact)==='9007199254740995');
    let text=await output();expect(text).toMatch(/"exact"\s*:\s*9007199254740995/);let data=parseJson(text) as any;expect(String(data.features[2].id)).toBe('9007199254740993');expect(String(data.features[2].properties.exact)).toBe('9007199254740995');
    await evaluate(`document.querySelectorAll('.reference-feature-select')[2].click();`);await wait(async()=>await evaluate(`!!document.querySelector('.reference-feature-row.selected')`));
    await evaluate(`[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent==='JSON').click()`);
    await evaluate(`(()=>{const s=document.querySelector('[aria-label="JSON kapsamı"]');s.value='feature';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(async()=>await evaluate(`!document.querySelector('[aria-label="GeoJSON kod editörü"]').readOnly&&document.querySelector('[aria-label="GeoJSON kod editörü"]').value.includes('Feature2')`));
    const edited={...data.features[2],properties:{...data.features[2].properties,exact:-9007199254740993n,nested:[9007199254740995n,-9007199254740993n],note:'JSON edited'}};
    const editedText=stringifyJson(edited);
    await evaluate(`(()=>{const auto=document.querySelector('.code-status input');if(auto.checked)auto.click();const e=document.querySelector('[aria-label="GeoJSON kod editörü"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(editedText)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait(async()=>await evaluate(`![...document.querySelectorAll('.code-status button')].find(b=>b.textContent==='Uygula').disabled`));
    await evaluate(`[...document.querySelectorAll('.code-status button')].find(b=>b.textContent==='Uygula').click()`);await wait(async()=>await evaluate(`document.querySelector('.code-status [role=status]').textContent.includes('Senkronize')`));
    data=parseJson(await output()) as any;expect(data.features[2]).toEqual(edited);expect(data.features[2].geometry).toEqual(original.features[2].geometry);
    const invalidText=editedText.replace('"exact":-9007199254740993','"exact":1.123456789012345678901');
    await evaluate(`(()=>{const e=document.querySelector('[aria-label="GeoJSON kod editörü"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(invalidText)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait(async()=>await evaluate(`document.querySelector('.document-editor .code-error')?.textContent.includes('hassasiyet')`));
    expect(await evaluate(`[...document.querySelectorAll('.code-status button')].find(b=>b.textContent==='Uygula').disabled`)).toBe(true);
    expect((parseJson(await output()) as any).features[2]).toEqual(edited);
    await evaluate(`document.querySelector('[aria-label="Haritadaki JSON’u yükle"]').click()`);await wait(async()=>await evaluate(`document.querySelector('.code-status [role=status]').textContent.includes('Senkronize')`));
    if(mode==='api'){
      await evaluate(`document.querySelector('.project-toolbar-actions button').click()`);await wait(async()=>await evaluate(`document.querySelector('.project-management [role=status]')?.textContent.includes('Sürüm 2')`));
      await call('Page.reload');await wait(async()=>await evaluate(`!!document.querySelector('.ol-viewport')&&!document.querySelector('.map-loading')&&document.querySelector('.map-counter').textContent.includes('0 şekil')`));
      await evaluate(`[...document.querySelectorAll('.project-toolbar-actions button')].find(b=>b.textContent==='Projelerim').click()`);await wait(async()=>await evaluate(`!![...document.querySelectorAll('.project-dialog button')].find(b=>b.textContent==='Aç'&&!b.disabled)`));
      await evaluate(`[...document.querySelectorAll('.project-dialog button')].find(b=>b.textContent==='Aç').click()`);await wait(async()=>await evaluate(`!document.querySelector('.project-dialog')&&document.querySelector('.map-counter').textContent.includes('5 şekil')`));
      const sql=execFileSync(python,['-c',`import sqlite3; c=sqlite3.connect(${JSON.stringify(database)});print(c.execute('SELECT f.feature_json FROM projects p JOIN features f ON f.dataset_id=p.saved_dataset_id WHERE f.ordinal=2').fetchone()[0])`],{encoding:'utf8'});
      expect(parseJson(sql)).toEqual(edited);expect(sql).toMatch(/"id"\s*:\s*9007199254740993/);expect(sql).toMatch(/"exact"\s*:\s*-9007199254740993/);
    }
    console.log('EXACT_BROWSER',mode,mode==='api'?'table/JSON/export, SQLite snapshot + page refresh preserve integer tokens':'real Worker/IndexedDB/table/JSON/export preserve integer tokens');
  }finally{
    socket?.close();await Promise.all(children.reverse().map(async child=>{if(child.exitCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);await done;clearTimeout(timer);}));
    rmSync(temporary,{recursive:true,force:true});
  }
},120000);
