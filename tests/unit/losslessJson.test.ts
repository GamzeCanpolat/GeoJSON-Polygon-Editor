import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { parseJson, parseJsonFallback, stringifyJson, stringifyJsonFallback } from '../../src/domain/losslessJson';
import { parseEditorDocument, featureFromEditor, formatEditorDocument, parseTableValue } from '../../src/domain/editorDocument';
import { LocalEngine } from '../../src/adapters/local/localEngine';
import { mergeGeoJsonImports } from '../../src/data/mergeImports';
import { readEditableFeature, writeEditedFeature } from '../../src/map/featureGeometry';
import { convertImportSheet, inspectImportSheet } from '../../src/data/spreadsheetImport';
import type Geometry from 'ol/geom/Geometry';

const integers=['9007199254740991','9007199254740992','9007199254740993','9007199254740995','-9007199254740993'];
const source=(id:string)=>`{"type":"Feature","id":${id},"properties":{"name":"Original","exact":${id},"nested":{"values":[${id},null,true,"${id}",1.25,-2]}},"geometry":{"type":"Polygon","coordinates":[[[29,41,7],[29.1,41,8],[29.1,41.1,9],[29,41,7]]]}}`;
for(const [label,parse,stringify] of [['native',parseJson,stringifyJson],['fallback',parseJsonFallback,stringifyJsonFallback]] as const){
 it.each(integers)(`${label}: preserves original numeric token %s and JSON types`,token=>{
  const data=parse(source(token)) as any,expected=BigInt(token);
  expect(String(data.id)).toBe(token);expect(typeof data.id).toBe(expected<=BigInt(Number.MAX_SAFE_INTEGER)&&expected>=BigInt(Number.MIN_SAFE_INTEGER)?'number':'bigint');
  expect(data.properties.nested.values.slice(1)).toEqual([null,true,token,1.25,-2]);
  const encoded=stringify(data);expect(encoded).toContain(`"id":${token}`);expect(encoded).toContain(`"exact":${token}`);expect(encoded).not.toContain(`"id":"${token}"`);
  expect(structuredClone(data)).toEqual(data);
 });
 it(`${label}: rejects decoded prototype keys and does not reject harmless string contents`,()=>{
  expect(()=>parse('{"__proto__":42}')).toThrow('__proto__');expect(()=>parse('{"\\u005f_proto__":{}}')).toThrow('__proto__');
  expect(parse('{"text":"\\\"__proto__\\\":42"}')).toEqual({text:'"__proto__":42'});
  const ordinary={isLosslessNumber:true,value:'9007199254740993',nested:{rawJSON:'9007199254740995',exact:9007199254740993n}};
  expect(parse(stringify(ordinary))).toEqual(ordinary);
 });
 it(`${label}: keeps normal decimals and exact exponent integers; rejects unsupported fractional precision`,()=>{
  expect(parse('[1.25,-2.5,1e-7,0,null,false]')).toEqual([1.25,-2.5,1e-7,0,null,false]);
  expect(stringify(parse('[9007199254740993.0,9007199254740993e0]'))).toBe('[9007199254740993,9007199254740993]');
  expect(()=>parse('{"value":1.123456789012345678901}')).toThrow('hassasiyet');expect(()=>parse('[1e-999]')).toThrow('hassasiyet');
  expect(()=>parse('[1e999]')).toThrow('taşması');
  expect(()=>stringify({value:Number('9007199254740993')})).toThrow('özgün değer');
 });
}
it('preserves IDs, nested properties, string/absent IDs, coordinates through Local import/map/table/merge/export',async()=>{
 const engine=new LocalEngine();try{
  const features=[...integers.map(source),source('0').replace('"id":0','"id":"9007199254740993"'),source('0').replace(',"id":0','')];
  await engine.open(new File([`{"type":"FeatureCollection","features":[${features.join(',')}]}`],'integers.geojson'));
  const page=await engine.list('',0,100);expect(page.total).toBe(7);const generation=page.items[0].id.split(':')[0];
  for(let i=0;i<page.items.length;i++){
   const record=await engine.get(page.items[i].id);expect(record.summary.id).toBe(`${generation}:${i}`);
   const before=structuredClone(record.feature.geometry);const editable=readEditableFeature(record);const feature=writeEditedFeature(record,editable.getGeometry() as Geometry);
   // An actual projection roundtrip need not preserve decimal XY bit-for-bit.
   // The property-only edit below always uses the original geometry.
   expect(feature.id).toEqual(record.feature.id);expect(feature.properties).toEqual(record.feature.properties);
   const changed={...record.feature,properties:{...record.feature.properties,name:'Edited',exact:i<5?parseTableValue(integers[(i+1)%5],record.feature.properties!.exact):record.feature.properties!.exact}};
   await engine.mutate({id:record.summary.id,feature:changed});expect((await engine.get(record.summary.id)).feature.geometry).toEqual(before);
  }
  const text=await(await engine.export()).text(),parsed=parseJson(text) as any;
  for(let i=0;i<5;i++){expect(text).toContain(`"id":${integers[i]}`);expect(String(parsed.features[i].properties.exact)).toBe(integers[(i+1)%5]);}
  expect(parsed.features[5].id).toBe('9007199254740993');expect(Object.hasOwn(parsed.features[6],'id')).toBe(false);
  const merged=await mergeGeoJsonImports(await engine.export(),new Blob([`{"type":"FeatureCollection","features":[${source(integers[2])}]}`]));expect(await merged.blob.text()).toContain('"id":9007199254740993');
  const revision=(await engine.get(page.items[0].id)).feature;
  await expect(engine.mutate({id:page.items[0].id,feature:{...revision,properties:{exact:Number('9007199254740993')}}})).rejects.toThrow('özgün değer');
  expect((await engine.get(page.items[0].id)).feature).toEqual(revision);
 }finally{engine.dispose()}
});
it('JSON and table editing preserve numeric types; unsupported drafts leave existing data untouched',()=>{
 const feature=featureFromEditor(source(integers[2]));feature.properties!.exact=parseTableValue(integers[4],feature.properties!.exact);
 const text=formatEditorDocument(feature);expect(text).toContain('9007199254740993');expect(text).toContain('-9007199254740993');
 expect(featureFromEditor(text)).toEqual(feature);expect(()=>parseEditorDocument(source(integers[2]).replace('[29,41,7]','[29,41,9007199254740993]'))).toThrow('Koordinat');
 expect(()=>parseEditorDocument(source(integers[2]).replace('[29,41,7]','[29.1234567890123456789,41,7]'))).toThrow('hassasiyet');
 expect(()=>parseTableValue('1.234567890123456789',1.2)).toThrow('hassasiyet');
});
it('Excel preserves text IDs and JSON numeric tokens, and rejects already unsafe numeric cells',async()=>{
 const book:any={SheetNames:['Data'],Sheets:{Data:{A1:{t:'s',v:'GeoJSON'},B1:{t:'s',v:'Dış kimlik'},A2:{t:'s',v:source(integers[2])},B2:{t:'s',v:integers[3]},'!ref':'A1:B2'}}};
 let result=convertImportSheet(book,inspectImportSheet(book));expect(result.issues).toEqual([]);const text=await result.blob!.text();expect(text).toContain('"id":9007199254740993');expect(text).toContain('"Dış kimlik":"9007199254740995"');
 book.Sheets.Data.B2={t:'n',v:Number(integers[2])};result=convertImportSheet(book,{...inspectImportSheet(book),kind:'geojson',geometry:0});expect(result.blob).toBeNull();expect(result.issues[0].message).toContain('geri getirilemez');
  book.Sheets.Data.B2={t:'n',v:9007199254740990};result=convertImportSheet(book,{...inspectImportSheet(book),kind:'geojson',geometry:0});expect(result.blob).toBeNull();expect(result.issues[0].message).toContain('15 basamak');
});
it('preserves an integer token split across fixed-size import chunks',async()=>{
 const engine=new LocalEngine();try{
  const before='{"type":"FeatureCollection","padding":"',after='","features":[{"type":"Feature","id":';
  const padding='x'.repeat(256*1024-8-before.length-after.length);
  const file=new File([before+padding+after+'9007199254740993,"properties":{},"geometry":{"type":"Point","coordinates":[29,41,7]}}]}'],'split.geojson');
  await engine.open(file);expect(await(await engine.export()).text()).toContain('"id":9007199254740993');
 }finally{engine.dispose()}
});
it('an unsupported fractional import preserves the old Local dataset and revision',async()=>{
 const engine=new LocalEngine();try{
  await engine.open(new File([source(integers[2])],'good.geojson'));const old=await(await engine.export()).text();
  await expect(engine.open(new File([source(integers[2]).replace('"exact":'+integers[2],'"exact":1.123456789012345678901')],'bad.geojson'))).rejects.toThrow('hassasiyet');
  await expect(engine.open(new File([source(integers[2]).replace('"id":'+integers[2]+',','"id":'+integers[2]+' '+integers[2]+',')],'syntax.geojson'))).rejects.toThrow('sözdizimi');
  expect(await(await engine.export()).text()).toBe(old);const id=(await engine.list('',0,1)).items[0].id;const record=await engine.get(id);expect(String(record.feature.id)).toBe(integers[2]);expect((await engine.mutate({id,feature:record.feature})).dataset.revision).toBe(1);
 }finally{engine.dispose()}
});
