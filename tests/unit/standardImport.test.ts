import 'fake-indexeddb/auto';
import { describe,expect,it } from 'vitest';
import { write,type WorkBook,type WorkSheet } from 'xlsx';
import { convertImportSheet,inspectImportSheet,loadImportWorkbook } from '../../src/data/spreadsheetImport';
import { LocalEngine } from '../../src/adapters/local/localEngine';
import { readEditableFeature,writeEditedFeature } from '../../src/map/featureGeometry';
import type Polygon from 'ol/geom/Polygon';
import { mergeGeoJsonImports } from '../../src/data/mergeImports';

const feature={type:'Feature',id:'hastane-1',properties:{name:'Eski ad',ana_kategori:'Sağlık',custom:{keep:true}},geometry:{type:'Polygon',coordinates:[[[28.84,40.98,4],[28.85,40.98,5],[28.85,40.99,6],[28.84,40.98,4]]]}};
const book=(sheet:WorkSheet):WorkBook=>({SheetNames:['Avrupa'],Sheets:{Avrupa:sheet}});
const text=(value:unknown)=>({t:'s' as const,v:JSON.stringify(value)});
describe('shared import dialog data contract',()=>{
  it('appends files while keeping all IDs, coordinates, metadata and progress without replacing the active data prematurely',async()=>{
    const previous=new File([JSON.stringify({type:'FeatureCollection',features:[feature],category_catalog:[{name:'Old',subcategories:['Unused']} ]})],'old.geojson');
    const next=new File([JSON.stringify({type:'FeatureCollection',features:[{...feature,id:'second'}],category_catalog:[{name:'New',subcategories:[]}]})],'new.geojson');
    const progress:{bytesRead:number;totalBytes:number;featuresRead:number}[]=[];
    const merged=await mergeGeoJsonImports(previous,next,value=>progress.push(value));
    const output=JSON.parse(await merged.blob.text());expect(merged.count).toBe(2);expect(output.features).toEqual([feature,{...feature,id:'second'}]);
    expect(output.category_catalog).toEqual([{name:'New',subcategories:[]},{name:'Old',subcategories:['Unused']}]);
    expect(progress.at(-1)).toMatchObject({bytesRead:previous.size+next.size,totalBytes:previous.size+next.size,featuresRead:2});
    const engine=new LocalEngine();try{await engine.open(previous);await expect(mergeGeoJsonImports(await engine.export(),new Blob(['{"type":']))).rejects.toThrow();expect((await engine.list('',0,10)).total).toBe(1);expect(JSON.parse(await(await engine.export()).text()).features).toEqual([feature]);}finally{engine.dispose();}
  });
  it.each(['xlsx','biff8'] as const)('reads %s workbook and preserves geometry, external ID and extra columns through polygon editing',async(bookType)=>{
    const source=book({A1:{t:'s',v:'İsim'},B1:{t:'s',v:'GeoJSON'},C1:{t:'s',v:'Yatak'},A2:{t:'s',v:'Hastane'},B2:text(feature),C2:{t:'n',v:120},'!ref':'A1:C2'});
    const bytes=write(source,{type:'array',bookType}) as ArrayBuffer;
    const workbook=loadImportWorkbook(bytes),mapping=inspectImportSheet(workbook);
    expect(mapping).toMatchObject({kind:'geojson',geometry:1,sheet:'Avrupa'});
    const result=convertImportSheet(workbook,mapping);expect(result.issues).toEqual([]);expect(result.count).toBe(1);
    const engine=new LocalEngine();
    try{
      await engine.open(new File([result.blob!],'hastaneler.geojson'));
      const record=await engine.get((await engine.list('',0,1)).items[0].id);
      const geometry=readEditableFeature(record).getGeometry() as Polygon;geometry.translate(100,0);
      await engine.mutate({id:record.summary.id,feature:writeEditedFeature(record,geometry)});
      const exported=JSON.parse(await(await engine.export()).text());
      expect(exported.features[0].id).toBe('hastane-1');
      expect(exported.features[0].properties).toEqual({...feature.properties,İsim:'Hastane',Yatak:120});
      expect(exported.features[0].geometry.coordinates[0][0][0]).not.toBe(28.84);
      expect(exported.features[0].geometry.coordinates[0][0][2]).toBe(4);
    }finally{engine.dispose();}
  });
  it('imports coordinate rows as points and preserves typed attributes',async()=>{
    const workbook=book({A1:{t:'s',v:'İsim'},B1:{t:'s',v:'Enlem'},C1:{t:'s',v:'Boylam'},D1:{t:'s',v:'Aktif'},A2:{t:'s',v:'Klinik'},B2:{t:'s',v:'40,98'},C2:{t:'n',v:28.84},D2:{t:'b',v:true},'!ref':'A1:D2'});
    const result=convertImportSheet(workbook,inspectImportSheet(workbook));expect(result.issues).toEqual([]);
    expect(JSON.parse(await result.blob!.text()).features[0]).toEqual({type:'Feature',properties:{İsim:'Klinik',Aktif:true},geometry:{type:'Point',coordinates:[28.84,40.98]}});
  });
  it('supports WKT polygons with holes, MultiPolygon and explicit WGS84 SRID',async()=>{
    const workbook=book({A1:{t:'s',v:'wkt'},A2:{t:'s',v:'SRID=4326;POLYGON ((28 40,29 40,29 41,28 40),(28.5 40.2,28.6 40.2,28.6 40.3,28.5 40.2))'},A3:{t:'s',v:'MULTIPOLYGON (((28 40,29 40,29 41,28 40)))'},'!ref':'A1:A3'});
    const result=convertImportSheet(workbook,inspectImportSheet(workbook));expect(result.issues).toEqual([]);
    const output=JSON.parse(await result.blob!.text());expect(output.features[0].geometry.coordinates).toHaveLength(2);expect(output.features[1].geometry.type).toBe('MultiPolygon');
  });
  it('decodes standard encoded polyline with longitude/latitude in GeoJSON order',async()=>{
    const workbook=book({A1:{t:'s',v:'polyline'},A2:{t:'s',v:'_p~iF~ps|U_ulLnnqC_mqNvxq`@'},'!ref':'A1:A2'});
    const result=convertImportSheet(workbook,inspectImportSheet(workbook));expect(result.issues).toEqual([]);
    expect(JSON.parse(await result.blob!.text()).features[0].geometry.coordinates).toEqual([[-120.2,38.5],[-120.95,40.7],[-126.453,43.252]]);
  });
  it('keeps all Features from a cell, unused catalog metadata and other Excel column values',async()=>{
    const workbook=book({A1:{t:'s',v:'GeoJSON'},B1:{t:'s',v:'name'},A2:text({type:'FeatureCollection',features:[feature,{...feature,id:'second'}],category_catalog:[{name:'Unused',subcategories:['Child']}]}),B2:{t:'s',v:'Satır adı'},'!ref':'A1:B2'});
    const result=convertImportSheet(workbook,inspectImportSheet(workbook));expect(result.count).toBe(2);
    const output=JSON.parse(await result.blob!.text());expect(output.features[0].properties.name).toBe('Satır adı');expect(output.features[1].id).toBe('second');expect(output.category_catalog).toContainEqual({name:'Unused',subcategories:['Child']});
  });
  it('supports sheet selection, headerless GeoJSON and custom geometry column mapping',()=>{
    const workbook=book({C1:text(feature),'!ref':'C1:C1'});workbook.SheetNames.unshift('Notlar');workbook.Sheets.Notlar={A1:{t:'s',v:'Not'},'!ref':'A1'};
    const info=inspectImportSheet(workbook,'Avrupa');expect(info).toMatchObject({headerRow:0,geometry:2,kind:'geojson'});expect(convertImportSheet(workbook,info).count).toBe(1);
    expect(()=>inspectImportSheet(workbook,'missing')).toThrow('bulunamadı');
  });
  it.each(['xlsx','biff8'] as const)('finds a custom JSON column beyond the first data row and skips an instruction sheet in %s',async(bookType)=>{
    const workbook:WorkBook={SheetNames:['Açıklama','Avrupa'],Sheets:{
      Açıklama:{A1:{t:'s',v:'JSON'},A2:{t:'s',v:'Alanları Avrupa sayfasında bulabilirsiniz.'},'!ref':'A1:A2'},
      Avrupa:{A1:{t:'s',v:'İsim'},B1:{t:'s',v:'Enlem'},C1:{t:'s',v:'Boylam'},D1:{t:'s',v:'Alan verisi'},A2:{t:'s',v:'Boş alan'},B2:{t:'n',v:41},C2:{t:'n',v:29},A4:{t:'s',v:'Klinik'},B4:{t:'n',v:41},C4:{t:'n',v:29},D4:text(feature),'!ref':'A1:D4'}
    }};
    const loaded=loadImportWorkbook(write(workbook,{type:'array',bookType}) as ArrayBuffer),mapping=inspectImportSheet(loaded);
    expect(mapping).toMatchObject({sheet:'Avrupa',kind:'geojson',geometry:3});
    const result=convertImportSheet(loaded,mapping);expect(result.issues).toEqual([]);expect(result.count).toBe(1);
    const shape=JSON.parse(await result.blob!.text()).features[0];
    expect(shape.geometry).toEqual(feature.geometry);expect(shape.properties.İsim).toBe('Klinik');expect(shape.properties.Enlem).toBe(41);
    expect(inspectImportSheet(loaded,'Açıklama').sheet).toBe('Açıklama');
  });
  it('reads a JSON-encoded GeoJSON string and does not mistake ordinary JSON metadata for geometry',async()=>{
    const workbook=book({A1:{t:'s',v:'Geometry'},B1:{t:'s',v:'Alan'},A2:text({source:'metadata'}),B2:text(JSON.stringify(feature)),'!ref':'A1:B2'});
    const mapping=inspectImportSheet(workbook);expect(mapping).toMatchObject({kind:'geojson',geometry:1});
    const result=convertImportSheet(workbook,mapping);expect(result.issues).toEqual([]);
    expect(JSON.parse(await result.blob!.text()).features[0].geometry).toEqual(feature.geometry);
    workbook.Sheets.Avrupa.B2=text('{"type":"Feature","properties":{"__proto__":{}},"geometry":null}');
    expect(convertImportSheet(workbook,mapping).blob).toBeNull();
  });
  it('recognizes polygon_json headers below introductory rows without requiring the first geometry cell to be populated',async()=>{
    const workbook=book({A1:{t:'s',v:'Poligonlar'},A3:{t:'s',v:'İsim'},B3:{t:'s',v:'polygon_json'},A4:{t:'s',v:'Boş'},A5:{t:'s',v:'Alan'},B5:text(feature),'!ref':'A1:B5'});
    const mapping=inspectImportSheet(workbook);expect(mapping).toMatchObject({headerRow:3,kind:'geojson',geometry:1});
    const result=convertImportSheet(workbook,mapping);expect(result.issues).toEqual([]);expect(result.count).toBe(1);
    expect(JSON.parse(await result.blob!.text()).features[0].id).toBe(feature.id);
  });
  it('reads cached formula values without evaluating formulas and rejects formulas without a cached result',()=>{
    const workbook=book({A1:{t:'s',v:'GeoJSON'},A2:{...text(feature),f:'CONCAT("a")'},'!ref':'A1:A2'});
    expect(convertImportSheet(workbook,inspectImportSheet(workbook)).issues).toEqual([]);
    workbook.Sheets.Avrupa.A2={t:'s',f:'CONCAT("a")'};
    const result=convertImportSheet(workbook,inspectImportSheet(workbook));expect(result.blob).toBeNull();expect(result.issues[0].row).toBe(2);
  });
  it('rejects invalid row data atomically and reports its source row',()=>{
    const workbook=book({A1:{t:'s',v:'GeoJSON'},A2:text(feature),A3:{t:'s',v:'{"broken":'},'!ref':'A1:A3'});
    const result=convertImportSheet(workbook,inspectImportSheet(workbook));expect(result.count).toBe(1);expect(result.blob).toBeNull();expect(result.issues[0].row).toBe(3);
    workbook.Sheets.Avrupa.A3={t:'s',v:'{"type":"Feature","properties":{"__proto__":{}},"geometry":null}'};
    expect(convertImportSheet(workbook,inspectImportSheet(workbook)).blob).toBeNull();
  });
  it.each(['xlsx','biff8'] as const)('skips missing JSON cells including invisible text and blank markers in %s without blocking valid polygons',async(bookType)=>{
    const source=book({A1:{t:'s',v:'İsim'},B1:{t:'s',v:'JSON'},B2:text(feature),A75:{t:'s',v:'Geometri yok'},B75:{t:'s',v:'\u200b\u200c\u2060'},B80:{t:'s',v:'NaN'},B90:{t:'s',v:'null'},B105:{t:'s',v:'""'},B149:{t:'s',v:' \t '},B150:{t:'s',v:'None'},B151:text({...feature,id:'last'}),'!ref':'A1:B151'});
    const workbook=loadImportWorkbook(write(source,{type:'array',bookType}) as ArrayBuffer),result=convertImportSheet(workbook,inspectImportSheet(workbook));
    expect(result.issues).toEqual([]);expect(result.count).toBe(2);expect(result.skippedRows).toBe(148);
    expect(JSON.parse(await result.blob!.text()).features.map((shape:{id:string})=>shape.id)).toEqual([feature.id,'last']);
  });
  it('reports the exact JSON cell for real syntax errors and keeps import atomic',()=>{
    const workbook=book({A1:{t:'s',v:'İsim'},B1:{t:'s',v:'JSON'},B2:text(feature),B75:{t:'s',v:'{"type":"Feature",'},'!ref':'A1:B75'});
    const result=convertImportSheet(workbook,inspectImportSheet(workbook));
    expect(result.blob).toBeNull();expect(result.issues).toHaveLength(1);expect(result.issues[0].row).toBe(75);
    expect(result.issues[0].message).toContain('B75');expect(result.issues[0].message).toContain('JSON okunamadı');expect(result.skippedRows).toBe(72);
  });
  it('preserves a valid Feature with null geometry and invisible characters inside properties',async()=>{
    const shape={...feature,properties:{name:'\u200bAlan\u200b'},geometry:null};
    const workbook=book({A1:{t:'s',v:'JSON'},A2:{t:'s',v:`\u200b${JSON.stringify(shape)}\u2060`},A3:{t:'s',v:'"null"'},'!ref':'A1:A3'});
    const result=convertImportSheet(workbook,inspectImportSheet(workbook));expect(result.issues).toEqual([]);expect(result.skippedRows).toBe(1);
    expect(JSON.parse(await result.blob!.text()).features).toEqual([shape]);
  });
  it('rejects conflicting coordinate fields, out-of-range coordinates, projected WKT and truncated polyline',()=>{
    const workbook=book({A1:{t:'s',v:'Enlem'},B1:{t:'s',v:'Boylam'},A2:{t:'n',v:41},B2:{t:'n',v:181},'!ref':'A1:B2'}),info=inspectImportSheet(workbook);
    expect(convertImportSheet(workbook,info).issues[0].message).toContain('WGS84');
    expect(convertImportSheet(workbook,{...info,latitude:info.longitude}).issues[0].message).toContain('Farklı');
    workbook.Sheets.Avrupa={A1:{t:'s',v:'WKT'},A2:{t:'s',v:'SRID=3857;POINT(28 41)'},'!ref':'A1:A2'};
    expect(convertImportSheet(workbook,inspectImportSheet(workbook)).issues[0].message).toContain('4326');
    workbook.Sheets.Avrupa={A1:{t:'s',v:'polyline'},A2:{t:'s',v:'_p~iF~'},'!ref':'A1:A2'};
    expect(convertImportSheet(workbook,inspectImportSheet(workbook)).blob).toBeNull();
  });
  it('rejects non-workbooks, oversized files, merged data cells and more than 100,000 rows',()=>{
    expect(()=>loadImportWorkbook(new TextEncoder().encode('text').buffer)).toThrow('Geçerli');
    expect(()=>loadImportWorkbook(new ArrayBuffer(25*1024*1024+1))).toThrow('25 MB');
    const workbook=book({A1:{t:'s',v:'GeoJSON'},A2:text(feature),'!ref':'A1:B2','!merges':[{s:{r:1,c:0},e:{r:1,c:1}}]});
    expect(convertImportSheet(workbook,{...inspectImportSheet(workbook),kind:'geojson',geometry:0}).issues[0].row).toBe(2);
    workbook.Sheets.Avrupa['!ref']='A1:B100002';expect(convertImportSheet(workbook,{...inspectImportSheet(workbook),kind:'geojson',geometry:0}).issues[0].message).toContain('100.000');
    workbook.Sheets.Avrupa['!ref']='A1:CW2';expect(()=>inspectImportSheet(workbook)).toThrow('100 sütun');
  });
});
