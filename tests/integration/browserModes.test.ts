import { backendLauncher, backendPython } from './backendRuntime';
import { it, expect } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { utils, write } from 'xlsx';

const pause=(ms=100)=>new Promise(r=>setTimeout(r,ms));
async function port(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const n=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));return n;}

// Explicit opt-in: requires local Chrome and the backend Python environment.
it.skipIf(!process.env.RUN_BROWSER_INTEGRATION)('Vite UI draws to SQLite; browser API/Excel lifecycle and local mode work',async()=>{
  const temporary=mkdtempSync(join(tmpdir(),'geojson-browser-')); const children:ChildProcess[]=[];
  const backend=resolve('backend'),python=backendPython(),database=join(temporary,'projects.db');
  const [apiPort,vitePort,debugPort]=await Promise.all([port(),port(),port()]);
  const env={...process.env,GEOJSON_DATABASE_PATH:database,GEOJSON_CORS_ORIGINS:JSON.stringify([`http://127.0.0.1:${vitePort}`])};
  let logs='';
  const launch=(command:string,args:string[],cwd:string,environment=env)=>{const child=spawn(command,args,{cwd,env:environment,stdio:['ignore','pipe','pipe']});children.push(child);child.stderr!.on('data',x=>logs+=String(x));child.stdout!.on('data',x=>logs+=String(x));return child;};
  let socket:WebSocket|undefined;
  const wait=async(test:()=>Promise<boolean>)=>{for(let i=0;i<150;i++){try{if(await test())return;}catch{}await pause();}throw new Error('Timed out: '+logs.split('\n').filter(l=>/INFO:|ERROR|error|VITE|vite/.test(l)).slice(-35).join('\n'));};
  try{
    execFileSync('bash',[backendLauncher,'migrate'],{cwd:backend,env,stdio:'pipe'});
    launch('bash',[backendLauncher,'api','--port',String(apiPort)],backend);
    launch('bash',[backendLauncher,'worker','--poll-interval','0.05'],backend);
    launch(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'--config',resolve('tests/fixtures/project-management.vite.config.ts'),'--host','127.0.0.1','--port',String(vitePort)],resolve('.'),{...env,PROJECT_UI_CACHE_DIR:join(temporary,'api-vite-cache'),VITE_PROJECT_MANAGEMENT:'false',VITE_DATA_SOURCE:'api',VITE_API_BASE_URL:`http://127.0.0.1:${apiPort}`});
    await wait(async()=> (await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`)).ok);
    await wait(async()=> (await fetch(`http://127.0.0.1:${vitePort}`)).ok);
    launch('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',`--user-data-dir=${join(temporary,'chrome')}`,`--remote-debugging-port=${debugPort}`,'--window-size=1400,1000','about:blank'],resolve('.'));
    let target:{webSocketDebuggerUrl:string}|undefined;
    await wait(async()=>{target=(await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((t:{type:string})=>t.type==='page');return !!target;});
    socket=new WebSocket(target!.webSocketDebuggerUrl);await once(socket,'open');let id=0;
    const navigationLog:string[]=[];
    socket.addEventListener('message',event=>{const e=JSON.parse(String(event.data));if(['Page.frameNavigated','Page.frameStartedLoading','Page.frameRequestedNavigation','Runtime.executionContextsCleared'].includes(e.method)){navigationLog.push(JSON.stringify(e));if(navigationLog.length>8)navigationLog.shift();}});
    const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
    socket.addEventListener('message',event=>{const value=JSON.parse(String(event.data));const p=pending.get(value.id);if(p){pending.delete(value.id);if(value.error)p.reject(new Error(JSON.stringify(value.error)+' navigation='+navigationLog.join(' | ')));else p.resolve(value.result);}});
    const call=(method:string,params:object={})=>new Promise<any>((resolveCall,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout '+method+' '+JSON.stringify(params).slice(0,140)+' LOGS '+logs.slice(-5000)));},20000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolveCall(v);},reject:e=>{clearTimeout(timer);reject(e);}});socket!.send(JSON.stringify({id:n,method,params}));});
    const evaluate=async(expression:string)=>{try{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}catch(error){throw new Error(String(error)+' expression='+expression.slice(0,240)+' VITE/API LOGS='+logs.slice(-4500));}};
    await call('Page.enable');await call('Runtime.enable');
    socket.addEventListener('message',event=>{if(JSON.parse(String(event.data)).method==='Page.javascriptDialogOpening')void call('Page.handleJavaScriptDialog',{accept:true});});
    await call('Page.navigate',{url:`http://127.0.0.1:${vitePort}`});
    const count=(table:string)=>Number(execFileSync(python,['-c',`import sqlite3; print(sqlite3.connect(${JSON.stringify(database)}).execute('SELECT count(*) FROM ${table}').fetchone()[0])`],{env,cwd:backend,encoding:'utf8'}).trim());
    await wait(async()=>count('workspaces')===1 && await evaluate(`document.readyState==='complete' && !!document.querySelector('.ol-viewport') && !document.querySelector('.map-loading')`));
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.title.includes('Poligon çiz')||b.getAttribute('aria-label')?.includes('Poligon çiz')).click()`);
    expect(await evaluate(`document.querySelector('.project-management')===null`)).toBe(true);
    const box=await evaluate(`(()=>{const r=document.querySelector('.ol-viewport').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    const points=[[.35,.35],[.6,.35],[.6,.6],[.35,.35]];
    for(const [x,y] of points){const px=box.x+box.width*x,py=box.y+box.height*y;await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:px,y:py});await call('Input.dispatchMouseEvent',{type:'mousePressed',x:px,y:py,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:px,y:py,button:'left',clickCount:1});await pause(100);}
    await wait(async()=>count('features')===1);
    const geometry=execFileSync(python,['-c',`import sqlite3; print(sqlite3.connect(${JSON.stringify(database)}).execute('SELECT geometry_type FROM features').fetchone()[0])`],{env,cwd:backend,encoding:'utf8'}).trim();expect(geometry).toBe('Polygon');
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([
      ['Enlem', 'Boylam', 'Name'],
      [41.125, 29.25, 'Chrome XLSX import'],
    ]), 'Noktalar');
    const excelPath = join(temporary, 'noktalar.xlsx');
    writeFileSync(excelPath, write(workbook, { type: 'buffer', bookType: 'xlsx' }));
    await evaluate(`document.querySelector('.reference-file-actions [aria-label="İçe aktar"]').click()`);
    await wait(async()=>await evaluate(`!!document.querySelector('.standard-import-dialog input[type="file"]')`));
    const { root } = await call('DOM.getDocument');
    const { nodeId } = await call('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '.standard-import-dialog input[type="file"]',
    });
    await call('DOM.setFileInputFiles', { nodeId, files: [excelPath] });
    await wait(async()=>await evaluate(`document.querySelector('[aria-label="Çalışma sayfası"]')?.value==='Noktalar'
      && !document.querySelector('.standard-import-dialog button[type="submit"]')?.disabled`));
    await evaluate(`document.querySelector('.standard-import-dialog button[type="submit"]').click()`);
    await wait(async()=>await evaluate(`!document.querySelector('.standard-import-dialog') && !document.querySelector('.map-loading')`));
    const importedPoint = JSON.parse(execFileSync(python, ['-c', `import sqlite3; c=sqlite3.connect(${JSON.stringify(database)}); print(c.execute("SELECT feature_json FROM features WHERE geometry_type = 'Point'").fetchone()[0])`],
      { env, cwd: backend, encoding: 'utf8' }));
    expect(importedPoint.properties.Name).toBe('Chrome XLSX import');
    expect(importedPoint.geometry.coordinates).toEqual([29.25, 41.125]);

    // Exercise the actual Vite-selected factory in the browser, under real CORS.
    const result=await evaluate(`(async()=>{
      const {createRepository}=await import('/src/data/createRepository.ts');const repo=createRepository();await repo.createEmpty();
      const polygon={type:'Feature',id:'outside',properties:{foreign:'İğdır'},geometry:{type:'Polygon',coordinates:[[[29,41,10],[30,41,11],[30,42,12],[29,41,10]]]}};
      const added=await repo.mutate({feature:polygon});const full=await repo.get(added.id);
      await repo.mutate({id:added.id,feature:{...full.feature,properties:{...full.feature.properties,edited:true}}});
      await repo.mutate({id:added.id,feature:null});await repo.mutate({id:added.id,feature:polygon});
      const viewport=await repo.query({bounds:[28,40,31,43],tolerance:0,limit:20});await repo.addCategory('Unused');await repo.addCategory('Child','Unused');
      const exported=await repo.export();await repo.open(new File([exported],'roundtrip.geojson'));
      const roundtripCatalog=await repo.categories();
      const {convertImportSheet}=await import('/src/data/spreadsheetImport.ts');
      const workbook={SheetNames:['Sheet1'],Sheets:{Sheet1:{'!ref':'A1:A2',A1:{t:'s',v:'GeoJSON'},A2:{t:'s',v:JSON.stringify(polygon)}}}};
      const converted=convertImportSheet(workbook,{sheet:'Sheet1',kind:'geojson',geometry:0,latitude:-1,longitude:-1});
      if(converted.issues.length)throw new Error(JSON.stringify(converted.issues));await repo.open(new File([converted.blob],'excel-converted.geojson'));
      const cancel=new AbortController();let cancelled=false;try{await repo.open(new File([exported],'cancel.geojson'),()=>cancel.abort(),cancel.signal);}catch(e){cancelled=e.message.includes('iptal');}
      let conflict=false;const latest=await repo.get((await repo.list('',0,20)).items[0].id);
      const w=repo.workspace;
      await fetch('http://127.0.0.1:${apiPort}/api/v1/workspaces/'+w.id+'/mutations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:latest.summary.id,feature:polygon,expectedDatasetId:w.activeDatasetId,expectedGenerationId:w.generationId,expectedRevision:w.dataset.revision})});
      try{await repo.mutate({id:latest.summary.id,feature:polygon});}catch(e){conflict=e.status===409;}
      let missing=false;try{await repo.get('not-valid');}catch(e){missing=e.status===422;}
      const output=JSON.parse(await (await repo.export()).text());const catalog=await repo.categories();
      repo.dispose();return {viewport:viewport.matched,output,catalog,roundtripCatalog,cancelled,conflict,missing};
    })()`);
    expect(result.conflict).toBe(true);expect(result.missing).toBe(true);expect(result.viewport).toBe(1);expect(result.cancelled).toBe(true);expect(result.output.features[0].id).toBe('outside');expect(result.output.features[0].geometry.coordinates[0][0]).toEqual([29,41,10]);
    expect(result.roundtripCatalog).toContainEqual({name:'Unused',subcategories:['Child']});
    const before=count('workspaces');await call('Page.reload');await wait(async()=>count('workspaces')>before);expect(count('projects')).toBe(0);expect(count('features')).toBeGreaterThan(0);
    // Real local Worker/IndexedDB path in a separate Vite process.
    const localPort=await port();launch(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'--config',resolve('tests/fixtures/project-management.vite.config.ts'),'--host','127.0.0.1','--port',String(localPort)],resolve('.'),{...env,PROJECT_UI_CACHE_DIR:join(temporary,'local-vite-cache'),VITE_DATA_SOURCE:'local',VITE_PROJECT_MANAGEMENT:'true'});
    await wait(async()=>(await fetch(`http://127.0.0.1:${localPort}`)).ok);await call('Page.navigate',{url:`http://127.0.0.1:${localPort}`});
    await wait(async()=>await evaluate(`document.readyState==='complete' && !!document.querySelector('.ol-viewport') && !document.querySelector('.map-loading')`));
    expect(await evaluate(`document.querySelector('.project-management')===null`)).toBe(true);
    const local=await evaluate(`(async()=>{const {createRepository}=await import('/src/data/createRepository.ts');const r=createRepository();await r.createEmpty();await r.mutate({feature:{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[29,41,3]}}});const total=(await r.list('',0,20)).total;r.dispose();return total})()`);expect(local).toBe(1);
  }finally{
    socket?.close();await Promise.all(children.reverse().map(async child=>{if(child.exitCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);await done;clearTimeout(timer);}));
    rmSync(temporary,{recursive:true,force:true});
  }
},90000);
