import { backendLauncher, backendPython } from './backendRuntime';
import { it, expect } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { read, utils, write } from 'xlsx';
import { toLonLat } from 'ol/proj';

const pause=(ms=100)=>new Promise(r=>setTimeout(r,ms));
async function port(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const n=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));return n;}

// Explicit opt-in: requires local Chrome and the backend Python environment.
it.skipIf(!process.env.RUN_BROWSER_INTEGRATION)('Vite measures and edits polygons, navigates to coordinates, and exports three formats in Local/API modes',async()=>{
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
    const drawPolygon = async () => {
      // Capture the active controller through a normal toolbar action so assertions can
      // inspect OpenLayers and the same workspace that the app is displaying.
      await evaluate(`(async () => {
        const { MapController } = await import('/src/map/MapController.ts');
        const setMode = MapController.prototype.setMode;
        MapController.prototype.setMode = function(mode) {
          window.coordinateTestMap = this;
          return setMode.call(this, mode);
        };
        document.querySelector('[data-tool="draw"]').click();
      })()`);
      const box = await evaluate(`(() => {
        const { x, y, width, height } = document.querySelector('.ol-viewport').getBoundingClientRect();
        return { x, y, width, height };
      })()`);
      for (const [x, y] of [[.35, .35], [.6, .35], [.6, .6], [.35, .35]]) {
        const point = { x: box.x + box.width * x, y: box.y + box.height * y };
        await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
        await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
        await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
        await pause(100);
      }
    };
    const exportWorkspace = () => evaluate(`(async () =>
      (await window.coordinateTestMap.repository.export()).text())()`);
    const view = () => evaluate(`(() => {
      const map = window.coordinateTestMap.map;
      const view = map.getView();
      return { center: view.getCenter(), zoom: view.getZoom(), animating: view.getAnimating(),
        marker: map.getOverlayById('coordinate-navigation-marker').getPosition(),
        markerVisible: !!document.querySelector('.coordinate-location-marker').getClientRects().length };
    })()`);
    const verifyCoordinateNavigation = async () => {
      const originalData = await exportWorkspace();
      expect(JSON.parse(originalData).features[0].geometry.type).toBe('Polygon');
      await wait(async () => !(await view()).animating);
      const originalView = await view();
      const pressGo = () => evaluate(`document.querySelector('.coordinate-panel [type="submit"]').click()`);
      const enterInput = async (label: string, value: string) => {
        await evaluate(`(() => {
          const input = [...document.querySelectorAll('.coordinate-panel label')]
            .find(label => label.textContent.trim() === ${JSON.stringify(label)}).querySelector('input');
          input.focus();
          input.select();
        })()`);
        await call('Input.insertText', { text: value });
      };
      await evaluate(`document.querySelector('.coordinate-trigger').click()`);
      await pressGo();
      expect(await evaluate(`document.querySelector('.coordinate-panel [role="alert"]').textContent`)).toBe('Enlem girin.');
      expect(await view()).toEqual(originalView);
      await enterInput('Enlem', '41,0082');
      await enterInput('Boylam', '181');
      await pressGo();
      expect(await evaluate(`document.querySelector('.coordinate-panel [role="alert"]').textContent`)).toContain('-180 ile 180');
      expect(await view()).toEqual(originalView);

      await enterInput('Boylam', '28.9784');
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      const verifyLocation = async (longitude: number, latitude: number) => {
        await wait(async () => {
          const current = await view();
          return !!current.marker && !current.animating && current.markerVisible;
        });
        const current = await view();
        expect(current.zoom).toBeCloseTo(16);
        for (const location of [current.center, current.marker]) {
          const [lon, lat] = toLonLat(location);
          expect(lon).toBeCloseTo(longitude, 6);
          expect(lat).toBeCloseTo(latitude, 6);
        }
        expect(await evaluate(`document.querySelectorAll('.coordinate-location-marker').length`)).toBe(1);
      };
      await verifyLocation(28.9784, 41.0082);
      await enterInput('Enlem', '-33.86');
      await enterInput('Boylam', '151,21');
      await pressGo();
      await verifyLocation(151.21, -33.86);
      const { center } = await view();
      await evaluate(`document.querySelector('.coordinate-actions [type="button"]').click()`);
      expect(await view()).toMatchObject({ center, markerVisible: false });
      expect((await view()).marker).toBeUndefined();
      await evaluate(`document.querySelector('[aria-label="Koordinat panelini kapat"]').click()`);
      expect(await evaluate(`document.querySelector('.coordinate-panel') === null`)).toBe(true);
      expect(await exportWorkspace()).toBe(originalData);
    };
    const editPolygon = async () => {
      const before = JSON.parse(await exportWorkspace()).features[0].geometry;
      await evaluate(`document.querySelector('[aria-label="Tümünü göster"]').click()`);
      await wait(async () => !(await view()).animating);
      const point = await evaluate(`(() => {
        const controller = window.coordinateTestMap;
        const corner = controller.selectedSource.getFeatures()[0].getGeometry().getCoordinates()[0][2];
        const [x, y] = controller.map.getPixelFromCoordinate(corner);
        const box = controller.map.getViewport().getBoundingClientRect();
        return { x: box.left + x, y: box.top + y };
      })()`);
      const end = { x: point.x - 25, y: point.y - 18 };
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, buttons: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', clickCount: 1 });
      await wait(async () => {
        const { features } = JSON.parse(await exportWorkspace());
        return features.length === 1 && features[0].geometry.type === 'Polygon'
          && JSON.stringify(features[0].geometry) !== JSON.stringify(before);
      });
    };
    const verifyMeasurements = async () => {
      await wait(async () => await evaluate(`[...document.querySelectorAll('[role="tab"]')].some(el => el.textContent === 'Özellikler')`));
      await evaluate(`[...document.querySelectorAll('[role="tab"]')].find(el => el.textContent === 'Özellikler').click()`);
      const metrics = () => evaluate(`document.querySelector('.inspector .metrics')?.textContent`);
      const before = await metrics();
      expect(before).toMatch(/Alan.*m².*km².*Çevre.*m.*km/);
      await editPolygon();
      await wait(async () => (await metrics()) !== before);
      const edited = await metrics();
      expect(edited).toMatch(/Alan.*Çevre/);
      await evaluate(`document.querySelector('[aria-label="Geri al"]').click()`);
      await wait(async () => (await metrics()) === before);
      await evaluate(`document.querySelector('[aria-label="Yinele"]').click()`);
      await wait(async () => (await metrics()) === edited);
    };
    const verifyDownloads = async (mode: string) => {
      const dir = join(temporary, mode + '-downloads');
      mkdirSync(dir);
      await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
      const source = await exportWorkspace();
      const geometry = JSON.parse(source).features[0].geometry;
      for (const [extension, label] of [['geojson', 'GeoJSON (.geojson)'], ['xlsx', 'Excel (.xlsx)'], ['csv', 'CSV (.csv)']]) {
        await wait(async () => await evaluate(`!document.querySelector('.reference-file-actions [aria-label="Dışa aktar"]').disabled`));
        await evaluate(`document.querySelector('.reference-file-actions [aria-label="Dışa aktar"]').click()`);
        await evaluate(`[...document.querySelectorAll('.export-options button')].find(button => button.textContent === ${JSON.stringify(label)}).click()`);
        let filename: string | undefined;
        await wait(async () => !!(filename = readdirSync(dir).find(file => file.endsWith('.' + extension))));
        const bytes = readFileSync(join(dir, filename!));
        if (extension === 'geojson') {
          expect(bytes.toString('utf8')).toBe(source);
        } else {
          const workbook = read(bytes, { raw: true, FS: ',' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          expect(sheet.A1.v).toBe('Nesne ID');
          expect(sheet.B2.v).toBe('Polygon');
          expect(JSON.parse(sheet.F2.v)).toEqual(geometry);
        }
      }
      expect(await exportWorkspace()).toBe(source);
    };
    await drawPolygon();
    expect(await evaluate(`document.querySelector('.project-management')===null`)).toBe(true);
    await wait(async()=>count('features')===1);
    const geometry=execFileSync(python,['-c',`import sqlite3; print(sqlite3.connect(${JSON.stringify(database)}).execute('SELECT geometry_type FROM features').fetchone()[0])`],{env,cwd:backend,encoding:'utf8'}).trim();expect(geometry).toBe('Polygon');
    const activeDataset = () => execFileSync(python, ['-c', `import sqlite3
c = sqlite3.connect(${JSON.stringify(database)})
print(c.execute("SELECT w.active_dataset_id, d.revision, d.count FROM workspaces w JOIN datasets d ON d.id = w.active_dataset_id").fetchall())
`], { env, cwd: backend, encoding: 'utf8' });
    const initialDataset = activeDataset();
    await verifyCoordinateNavigation();
    expect(activeDataset()).toBe(initialDataset);
    expect(count('projects')).toBe(0);
    await verifyMeasurements();
    await verifyDownloads('api');
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
    await drawPolygon();
    await wait(async () => JSON.parse(await exportWorkspace()).features.length === 1);
    await verifyCoordinateNavigation();
    await verifyMeasurements();
    await verifyDownloads('local');
    await evaluate(`document.querySelector('[aria-label="Şekil listesini kapat"]')?.click();
      document.querySelector('[aria-label="Veri panelini kapat"]')?.click()`);
    await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 680, deviceScaleFactor: 2, mobile: true });
    await evaluate(`document.querySelector('.coordinate-trigger').click()`);
    for (const theme of ['light', 'dark']) {
      await evaluate(`if (document.documentElement.dataset.theme !== ${JSON.stringify(theme)}) document.querySelector('.theme-toggle').click()`);
      await wait(async () => await evaluate(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`));
      expect(await evaluate(`(() => {
        const panel = document.querySelector('.coordinate-panel');
        const { left, right, top, bottom } = panel.getBoundingClientRect();
        const target = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        return left >= 0 && right <= innerWidth && bottom <= innerHeight
          && panel.contains(target) && getComputedStyle(panel).backgroundColor !== getComputedStyle(panel).color;
      })()`)).toBe(true);
    }
    expect(await evaluate(`document.querySelector('.brand-logo').naturalWidth > 0`)).toBe(true);
    await evaluate(`document.querySelector('.reference-file-actions [aria-label="Dışa aktar"]').click()`);
    expect(await evaluate(`(() => {
      const dialog = document.querySelector('[aria-labelledby="export-title"]');
      const { left, right } = dialog.getBoundingClientRect();
      return left >= 0 && right <= innerWidth && dialog.querySelectorAll('button').length === 4;
    })()`)).toBe(true);
    await evaluate(`document.querySelector('.export-options button:last-child').click()`);
    await call('Emulation.clearDeviceMetricsOverride');
    const local=await evaluate(`(async()=>{const {createRepository}=await import('/src/data/createRepository.ts');const r=createRepository();await r.createEmpty();await r.mutate({feature:{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[29,41,3]}}});const total=(await r.list('',0,20)).total;r.dispose();return total})()`);expect(local).toBe(1);
  }finally{
    socket?.close();await Promise.all(children.reverse().map(async child=>{if(child.exitCode!==null)return;const done=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);await done;clearTimeout(timer);}));
    rmSync(temporary,{recursive:true,force:true});
  }
},90000);
