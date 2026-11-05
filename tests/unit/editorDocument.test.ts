import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { EMPTY_DOCUMENT, featureFromEditor, formatEditorDocument, isLargeDocument, MAX_EDITOR_TEXT, parseEditorDocument, parseTableValue } from '../../src/domain/editorDocument';
import { LocalEngine } from '../../src/adapters/local/localEngine';
import { readEditableFeature, writeEditedFeature } from '../../src/map/featureGeometry';
import type Polygon from 'ol/geom/Polygon';

const feature={type:'Feature',id:'editor-1',properties:{name:'Alan',ana_kategori:'Arazi',alt_kategori:'Park',number:3,bool:true,custom:{keep:true}},geometry:{type:'Polygon',coordinates:[[[29,41,10],[29.01,41,11],[29.01,41.01,12],[29,41,10]]]}};
const document={type:'FeatureCollection',category_catalog:[{name:'Kullanılmayan',subcategories:['Alt']}],features:[feature]};
describe('map / JSON / table editing contract',()=>{
  it('formats coordinate tuples compactly while preserving nested data and numeric precision',()=>{
    const source={...document,other:{numbers:[-1,2.5,1e-10],nested:[[2,3],[4,5]],text:'[1,2]'}};
    const formatted=formatEditorDocument(source);
    expect(formatted).toContain('[29, 41, 10]');
    expect(JSON.parse(formatted)).toEqual(source);
  });
  it('accepts an empty workspace, complete documents, single Features and bare geometry',()=>{
    expect(parseEditorDocument(EMPTY_DOCUMENT)).toEqual({type:'FeatureCollection',features:[]});
    expect(parseEditorDocument(JSON.stringify(document))).toEqual(document);
    expect(featureFromEditor(JSON.stringify(feature))).toEqual(feature);
    expect(parseEditorDocument(JSON.stringify(feature.geometry))).toEqual(feature.geometry);
    expect(()=>featureFromEditor(JSON.stringify(document))).toThrow('Feature');
  });
  it('rejects invalid drafts, invalid members and broken metadata before changing live data',()=>{
    expect(()=>parseEditorDocument('{')).toThrow();
    expect(()=>parseEditorDocument(JSON.stringify({type:'FeatureCollection'}))).toThrow('features');
    expect(()=>parseEditorDocument(JSON.stringify({...document,features:[{...feature,properties:[]}]}))).toThrow('properties');
    expect(()=>parseEditorDocument(JSON.stringify({...document,category_catalog:[{name:'Bad',subcategories:false}]}))).toThrow('Kategori');
    expect(()=>parseEditorDocument('{"type":"Feature","properties":{"__proto__":{}},"geometry":null}')).toThrow('__proto__');
  });
  it('preserves data through code replacement, map edits, a typed table edit and a document snapshot undo',async()=>{
    const engine=new LocalEngine();
    try{
      await engine.open(new File([JSON.stringify(parseEditorDocument(JSON.stringify(document)))],'editor.geojson'));
      const snapshot=await (await engine.export()).text();
      const record=await engine.get((await engine.list('',0,1)).items[0].id);
      const geometry=readEditableFeature(record).getGeometry() as Polygon;geometry.translate(100,0);
      await engine.mutate({id:record.summary.id,feature:writeEditedFeature(record,geometry)});
      const afterMap=await engine.get(record.summary.id);
      await engine.mutate({id:record.summary.id,feature:{...afterMap.feature,properties:{...afterMap.feature.properties,number:parseTableValue('42',3)}}});
      const exported=JSON.parse(await (await engine.export()).text());
      expect(exported.features[0].id).toBe('editor-1');
      expect(exported.features[0].properties).toEqual({...feature.properties,number:42});
      expect(exported.features[0].geometry.coordinates[0][0][0]).not.toBe(29);
      expect(exported.features[0].geometry.coordinates[0][0][2]).toBe(10);
      expect(exported.category_catalog).toContainEqual(document.category_catalog[0]);
      await engine.open(new File([snapshot],'editor.geojson'));
      const restored=JSON.parse(await (await engine.export()).text());expect(restored.features).toEqual([feature]);
    }finally{engine.dispose();}
  });
  it('keeps string, numeric, boolean, null and structured table values meaningful',()=>{
    expect(parseTableValue('001','old')).toBe('001');
    expect(parseTableValue('42',1)).toBe(42);
    expect(parseTableValue('false',true)).toBe(false);
    expect(parseTableValue('null',null)).toBeNull();
    expect(parseTableValue('{"x":2}',{})).toEqual({x:2});
    expect(()=>parseTableValue('"42"',1)).toThrow('sayı');
    expect(()=>parseTableValue('1',true)).toThrow('true');
  });
  it('limits full-document editing independently of file opening and measures UTF-8 size',()=>{
    const small={name:'x',count:1,vertices:5,bounds:null,sourceBytes:100,revision:0};
    expect(isLargeDocument(small)).toBe(false);
    expect(isLargeDocument({...small,sourceBytes:MAX_EDITOR_TEXT+1})).toBe(true);
    expect(isLargeDocument({...small,vertices:30001})).toBe(true);
    expect(isLargeDocument({...small,count:5001})).toBe(true);
    const tooLarge=JSON.stringify({type:'FeatureCollection',features:[],note:'ğ'.repeat(MAX_EDITOR_TEXT/2)});
    expect(()=>parseEditorDocument(tooLarge)).toThrow('2 MB');
    expect(()=>formatEditorDocument({note:'x'.repeat(MAX_EDITOR_TEXT)})).toThrow('sınırını');
  });
});
