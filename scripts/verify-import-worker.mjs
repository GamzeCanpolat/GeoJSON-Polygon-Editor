// Smoke-test the production Web Worker bundle in a Node worker_threads bridge.
// This does not exercise a browser's native file picker or download UI.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { write, utils } from 'xlsx';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const filename=(await fs.readdir(path.join(root,'dist/assets'))).find(name=>/^import\.worker-.*\.js$/.test(name));
assert.ok(filename,'Run npm run build first.');
const workerUrl=pathToFileURL(path.join(root,'dist/assets',filename)).href;
const worker=new Worker(`const {parentPort}=require('node:worker_threads');global.self=global;self.postMessage=value=>parentPort.postMessage(value);import(${JSON.stringify(workerUrl)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});});`,{eval:true});
const pending=new Map();let id=0,progressCount=0;
const timer=setTimeout(()=>{worker.terminate();throw new Error('Production import worker timed out.');},30000);
worker.on('message',reply=>{if(reply.progress){progressCount++;return;}const task=pending.get(reply.id);if(task){pending.delete(reply.id);task.resolve(reply);}});
const call=data=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});worker.postMessage({id:request,...data});});
try {
  await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
  worker.on('error',error=>{for(const task of pending.values())task.reject(error);pending.clear();});
  const feature={type:'Feature',id:'external-id',properties:{name:'Kaynak'},geometry:{type:'Polygon',coordinates:[[[28.84,40.98],[28.85,40.98],[28.85,40.99],[28.84,40.98]]]}};
  const workbook=utils.book_new();
  utils.book_append_sheet(workbook,utils.aoa_to_sheet([['JSON'],['Poligonlar JSON sayfasında.']]),'Açıklama');
  utils.book_append_sheet(workbook,utils.aoa_to_sheet([['Alan verisi','İsim'],['\u200b','Boş'],['NaN','Boş'],[JSON.stringify(JSON.stringify(feature)),'Klinik']]),'JSON');
  utils.book_append_sheet(workbook,utils.aoa_to_sheet([['WKT'],['POLYGON ((28 40,29 40,29 41,28 40))']]),'WKT');
  utils.book_append_sheet(workbook,utils.aoa_to_sheet([['Enlem','Boylam'],[41,29]]),'Noktalar');
  utils.book_append_sheet(workbook,utils.aoa_to_sheet([['GeoJSON'],['{"invalid":']]),'Hatalı');
  for(const bookType of ['xlsx','biff8']) {
    const loaded=await call({bytes:write(workbook,{type:'array',bookType})});
    assert.equal(loaded.info.kind,'geojson');
    assert.equal(loaded.info.sheet,'JSON');assert.equal(loaded.info.geometry,0);
    const converted=await call({mapping:loaded.info});assert.deepEqual(converted.issues,[]);
    assert.equal(converted.skippedRows,2);
    const result=JSON.parse(await converted.blob.text());
    assert.equal(result.features[0].id,'external-id');assert.equal(result.features[0].properties.İsim,'Klinik');
    assert.deepEqual(result.features[0].geometry,feature.geometry);
  }
  const wkt=await call({sheet:'WKT'}),wktOutput=await call({mapping:wkt.info});
  assert.equal(JSON.parse(await wktOutput.blob.text()).features[0].geometry.type,'Polygon');
  const points=await call({sheet:'Noktalar'}),pointOutput=await call({mapping:points.info});
  assert.deepEqual(JSON.parse(await pointOutput.blob.text()).features[0].geometry,{type:'Point',coordinates:[29,41]});
  const bad=await call({sheet:'Hatalı'}),rejected=await call({mapping:bad.info});
  assert.equal(rejected.blob,null);assert.equal(rejected.issues[0].row,2);
  const merged=await call({existing:wktOutput.blob,incoming:pointOutput.blob});
  assert.equal(merged.count,2);assert.equal(JSON.parse(await merged.blob.text()).features.length,2);assert.ok(progressCount>0);
  const invalid=await call({existing:merged.blob,incoming:new Blob(['{"type":'])});assert.ok(invalid.error);
  console.log('Production import worker passed: XLS/XLSX, mappings, WKT/Point/GeoJSON, ID/properties, atomic row rejection, streaming append/progress and invalid input.');
} finally {clearTimeout(timer);await worker.terminate();}
