import { read, utils, type CellObject, type WorkBook, type WorkSheet } from 'xlsx';
import WKT from 'ol/format/WKT';
import Polyline from 'ol/format/Polyline';
import GeoJSON from 'ol/format/GeoJSON';
import type { GeoFeature } from '../domain/contracts';
import { validateFeature } from '../domain/geoJsonValidation';
import { CategoryCatalog } from '../domain/categories';
import { MAX_EXCEL_BYTES, type ImportIssue, type ImportKind, type SpreadsheetInfo, type SpreadsheetMapping } from './importTypes';

const MAX_ROWS=100000,MAX_FEATURES=250000,MAX_OUTPUT=200*1024*1024;
const normalized=(text:string)=>text.trim().toLocaleLowerCase('tr-TR').replace(/ı/g,'i').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
const aliases={latitude:['enlem','enlemy','lat','latitude','y'],longitude:['boylam','boylamx','lon','lng','longitude','x'],geojson:['geojson','json','geometry','geometri','jsonkodu','jsonverisi','jsondata','geojsondata','geometryjson','polygonjson','poligonjson','polygongeojson'],wkt:['wkt','wellknowntext'],polyline:['polyline','encodedpolyline']};
const bounds=(sheet:WorkSheet)=>utils.decode_range(sheet['!ref']??'A1');
function cell(sheet:WorkSheet,row:number,column:number):CellObject|undefined {
  if(sheet['!merges']?.some(({s,e})=>row>=s.r&&row<=e.r&&column>=s.c&&column<=e.c))throw new Error('Veri sütunlarında birleştirilmiş hücre kullanmayın.');
  const value=sheet[utils.encode_cell({r:row,c:column})] as CellObject|undefined;
  if((value?.f!==undefined||value?.F!==undefined)&&(value.v===undefined||value.v===null))throw new Error('Hücrenin hesaplanmış değeri yok. Excel’de hesaplayıp kaydedin.');
  return value;
}
const empty=(value:CellObject|undefined)=>!value||value.v===null||value.v===undefined||value.t==='z'||typeof value.v==='string'&&!value.v.trim();
function text(value:CellObject|undefined):string {
  if(empty(value))return '';
  if(value!.t!=='s'&&value!.t!=='n')throw new Error('Metin veya sayı bekleniyor.');
  return String(value!.v).trim();
}
const trimJsonCell=(raw:string)=>raw.replace(/^[\s\u200b-\u200d\u2060]+|[\s\u200b-\u200d\u2060]+$/g,'');
function parseJsonCell(raw:string):unknown {
  // Some Excel exports store the JSON itself as a JSON-encoded string.
  for(let depth=0;depth<3;depth++){
    raw=trimJsonCell(raw);
    if(!raw||/^(?:null|nan|none|undefined|n\/a|#n\/a)$/i.test(raw))return null;
    let value:unknown;
    try{value=JSON.parse(raw,(key,value:unknown)=>{if(key==='__proto__')throw new Error('unsafe');return value;});}
    catch(cause){
      const message=(cause as Error).message;
      if(message==='unsafe')throw new Error('Desteklenmeyen __proto__ alanı.');
      const position=/position (\d+)/i.exec(message),location=position?` (${Number(position[1])+1}. karakter)`:'';
      const hint=/end of|unterminated/i.test(message)?'Metin yarım kalmış; kapanış tırnağı veya parantezi eksik olabilir.':'Virgül, çift tırnak ve parantezleri kontrol edin.';
      throw new Error(`JSON okunamadı${location}. ${hint}`);
    }
    if(typeof value!=='string')return value;
    raw=value;
  }
  throw new Error('JSON çok fazla metin katmanı içeriyor.');
}
const wktStart=/^(?:SRID=\d+;)?(?:POINT|MULTIPOINT|LINESTRING|MULTILINESTRING|POLYGON|MULTIPOLYGON|GEOMETRYCOLLECTION)\s*\(/i;
function detectGeometry(raw:string):'geojson'|'wkt'|null {
  raw=trimJsonCell(raw);
  if(wktStart.test(raw))return 'wkt';
  if(!/^[{["\uFEFF]/.test(raw))return null;
  try{
    const isGeoJson=(value:unknown,depth=0):boolean=>depth<8&&(Array.isArray(value)?value.some(item=>isGeoJson(item,depth+1)):!!value&&typeof value==='object'&&['FeatureCollection','Feature','Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon','GeometryCollection'].includes(String((value as Record<string,unknown>).type)));
    return isGeoJson(parseJsonCell(raw.replace(/^\uFEFF/,'')))?'geojson':null;
  }catch{return null;}
}
function headerInfo(sheet:WorkSheet) {
  const range=bounds(sheet);
  let headerRow=range.s.r+1;
  for(let r=range.s.r;r<=Math.min(range.e.r,range.s.r+19);r++) {
    const names=Array.from({length:Math.min(range.e.c+1,100)},(_,c)=>{try{return normalized(text(cell(sheet,r,c)));}catch{return '';}});
    if(names.some(name=>[...aliases.geojson,...aliases.wkt,...aliases.polyline].includes(name))||names.some(name=>aliases.latitude.includes(name))&&names.some(name=>aliases.longitude.includes(name))){headerRow=r+1;break;}
    if(r===range.s.r&&Array.from({length:Math.min(range.e.c+1,100)},(_,c)=>{try{const raw=text(cell(sheet,r,c));return /^[{[]/.test(raw)||!!detectGeometry(raw);}catch{return false;}}).some(Boolean)){headerRow=0;break;}
  }
  const used=new Set<string>();
  const columns=Array.from({length:Math.min(range.e.c+1,100)},(_,index)=>{
    let name='';if(headerRow)try{name=text(cell(sheet,headerRow-1,index));}catch{ /* use column letter */ }
    name=name||`Sütun ${utils.encode_col(index)}`;
    if(used.has(name))name=`${name} (${utils.encode_col(index)})`;used.add(name);
    return {index,name};
  });
  return {headerRow,columns};
}
export function loadImportWorkbook(bytes:ArrayBuffer):WorkBook {
  if(bytes.byteLength>MAX_EXCEL_BYTES)throw new Error('Excel dosyası en fazla 25 MB olabilir. Büyük veriyi GeoJSON olarak açın.');
  const first=new Uint8Array(bytes,0,Math.min(bytes.byteLength,8));
  const zip=first[0]===0x50&&first[1]===0x4b&&first[2]===3&&first[3]===4;
  const binary=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((byte,index)=>first[index]===byte);
  if(!zip&&!binary)throw new Error('Geçerli bir .xls veya .xlsx dosyası seçin.');
  try {
    const workbook=read(new Uint8Array(bytes),{type:'array',cellFormula:true,cellHTML:false,cellDates:true,WTF:true});
    if(!workbook.SheetNames.length)throw new Error('empty');
    return workbook;
  }catch{throw new Error('Excel dosyası okunamadı. Şifresiz bir .xls/.xlsx dosyası seçin.');}
}
function inspectSheet(workbook:WorkBook,sheetName:string):{info:SpreadsheetInfo;detected:boolean} {
  const sheet=workbook.Sheets[sheetName];
  if(!sheet)throw new Error('Çalışma sayfası bulunamadı.');
  if(bounds(sheet).e.c>=100)throw new Error('Excel sayfası en fazla 100 sütun içerebilir. Kullanılmayan sütunları kaldırın.');
  const {headerRow,columns}=headerInfo(sheet),names=columns.map(col=>normalized(col.name));
  const find=(keys:string[])=>names.findIndex(name=>keys.includes(name));
  const latitude=find(aliases.latitude),longitude=find(aliases.longitude);
  let geometry=-1,kind:ImportKind=latitude>=0&&longitude>=0?'coordinates':'geojson';
  for(const candidate of ['geojson','wkt','polyline'] as const){const index=find(aliases[candidate]);if(index>=0){kind=candidate;geometry=index;break;}}
  // Inspect actual cells, not just the first data row or a specific column name.
  // JSON polygons take precedence over optional centroid latitude/longitude fields.
  let detected:{kind:'geojson'|'wkt';geometry:number}|undefined;
  const start=Math.max(headerRow,bounds(sheet).s.r);
  for(const column of columns){
    for(let row=start;row<=Math.min(bounds(sheet).e.r,start+49);row++){
      try{
        const found=detectGeometry(text(cell(sheet,row,column.index)));
        if(found&&(!detected||found==='geojson'))detected={kind:found,geometry:column.index};
        if(found)break;
      }catch{ /* conversion reports invalid cells */ }
    }
    if(detected?.kind==='geojson')break;
  }
  if(detected){kind=detected.kind;geometry=detected.geometry;}
  return {info:{sheets:workbook.SheetNames,sheet:sheetName,columns,headerRow,rowCount:Math.max(0,bounds(sheet).e.r+1-headerRow),kind,longitude,latitude,geometry},detected:!!detected};
}
export function inspectImportSheet(workbook:WorkBook,requested?:string):SpreadsheetInfo {
  if(requested!==undefined)return inspectSheet(workbook,requested).info;
  let first:SpreadsheetInfo|undefined,fallback:SpreadsheetInfo|undefined,firstError:unknown;
  for(const name of workbook.SheetNames){
    try{
      const {info,detected}=inspectSheet(workbook,name);first??=info;
      const coordinates=info.kind==='coordinates'&&info.latitude>=0&&info.longitude>=0;
      if(detected||coordinates)return info;
      if(info.geometry>=0)fallback??=info;
    }catch(cause){firstError??=cause;}
  }
  if(fallback||first)return (fallback??first)!;
  throw firstError??new Error('Çalışma sayfası bulunamadı.');
}
function numeric(value:CellObject|undefined,label:string) {
  const raw=text(value);
  if(!raw||!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(raw))throw new Error(`${label} sayısal olmalı.`);
  const number=Number(raw.replace(',','.'));if(!Number.isFinite(number))throw new Error(`${label} sonlu bir sayı olmalı.`);return number;
}
function properties(sheet:WorkSheet,row:number,info:SpreadsheetInfo,excluded:Set<number>) {
  const result:Record<string,unknown>=Object.create(null);
  for(const column of info.columns){
    if(excluded.has(column.index))continue;
    const value=cell(sheet,row,column.index);if(empty(value))continue;
    if(column.name==='__proto__')throw new Error('__proto__ sütunu desteklenmiyor.');
    if(value!.t==='e')throw new Error(`“${column.name}” hücresinde Excel hatası var.`);
    result[column.name]=value!.v instanceof Date?value!.v.toISOString():value!.v;
  }
  return result;
}
function fromJson(value:unknown,catalog:CategoryCatalog,depth=0):GeoFeature[] {
  if(depth>12)throw new Error('JSON çok fazla iç içe geçmiş.');
  if(Array.isArray(value))return value.flatMap(item=>fromJson(item,catalog,depth+1));
  if(!value||typeof value!=='object')throw new Error('GeoJSON geometri, Feature veya FeatureCollection gerekli.');
  const object=value as Record<string,unknown>;
  if(object.type==='FeatureCollection'){
    if(!Array.isArray(object.features))throw new Error('features dizisi bulunamadı.');
    catalog.import(object.category_catalog);return object.features.map(validateFeature);
  }
  if(object.type==='Feature')return [validateFeature(object)];
  return [validateFeature({type:'Feature',properties:{},geometry:object})];
}
function validPolyline(source:string) {
  if(!/^[\x3f-\x7e]+$/.test(source))throw new Error('Geçersiz kodlanmış polyline.');
  let completed=0,run=0;
  for(const character of source){if(++run>6)throw new Error('Polyline koordinatı geçersiz.');if(!((character.charCodeAt(0)-63)&32)){completed++;run=0;}}
  if(run||completed<4||completed%2)throw new Error('Polyline eksik veya en az iki nokta içermiyor.');
}
export function convertImportSheet(workbook:WorkBook,mapping:SpreadsheetMapping):{blob:Blob|null;count:number;skippedRows:number;issues:ImportIssue[]} {
  const info=inspectImportSheet(workbook,mapping.sheet),sheet=workbook.Sheets[mapping.sheet];
  const issues:ImportIssue[]=[],chunks:BlobPart[]=[],catalog=new CategoryCatalog(),encoder=new TextEncoder();
  let count=0,bytes=0,skippedRows=0;
  const required=mapping.kind==='coordinates'?[mapping.latitude,mapping.longitude]:[mapping.geometry];
  if(required.some(index=>!Number.isInteger(index)||index<0||index>=info.columns.length)||new Set(required).size!==required.length)return {blob:null,count,skippedRows,issues:[{row:0,message:'Farklı ve geçerli veri sütunlarını seçin.'}]};
  if(info.rowCount>MAX_ROWS)return {blob:null,count,skippedRows,issues:[{row:0,message:'Excel’den en fazla 100.000 veri satırı alınabilir.'}]};
  const excluded=new Set(required),geojson=new GeoJSON();
  for(let r=info.headerRow;r<=bounds(sheet).e.r;r++){
    try{
      const source=required.map(col=>cell(sheet,r,col));if(source.every(empty)){skippedRows++;continue;}
      let parsed:unknown;
      if(mapping.kind==='geojson'){
        try{parsed=parseJsonCell(text(source[0]));}
        catch(cause){throw new Error(`${utils.encode_cell({r,c:mapping.geometry})}: ${(cause as Error).message}`);}
        if(parsed===null){skippedRows++;continue;}
      }
      const attrs=properties(sheet,r,info,excluded);let features:GeoFeature[];
      if(mapping.kind==='coordinates')features=[validateFeature({type:'Feature',properties:attrs,geometry:{type:'Point',coordinates:[numeric(cell(sheet,r,mapping.longitude),'Boylam'),numeric(cell(sheet,r,mapping.latitude),'Enlem')]}})];
      else{
        const raw=text(cell(sheet,r,mapping.geometry));if(!raw)throw new Error('Geometri hücresi boş.');
        if(mapping.kind==='geojson'){
          features=fromJson(parsed,catalog).map(feature=>({...feature,properties:{...feature.properties,...attrs}}));
        }else{
          let geometry;
          if(mapping.kind==='wkt'){
            const srid=/^SRID=(\d+);/i.exec(raw);if(srid&&srid[1]!=='4326')throw new Error('WKT için WGS84 / SRID 4326 gerekli.');
            geometry=new WKT().readGeometry(raw.replace(/^SRID=4326;/i,''));
          }else{validPolyline(raw);geometry=new Polyline().readGeometry(raw);}
          features=[validateFeature({type:'Feature',properties:attrs,geometry:geojson.writeGeometryObject(geometry)})];
        }
      }
      for(const feature of features){
        if(count>=MAX_FEATURES)throw new Error('Excel’den en fazla 250.000 şekil alınabilir.');
        const encoded=JSON.stringify(validateFeature(feature));bytes+=encoder.encode(encoded).byteLength;
        if(bytes>MAX_OUTPUT)throw new Error('Dönüştürülmüş veri 200 MB sınırını aşıyor; doğrudan GeoJSON kullanın.');
        chunks.push(`${count?',':''}${encoded}`);count++;
      }
    }catch(cause){issues.push({row:r+1,message:(cause as Error).message});if(issues.length>=50||bytes>MAX_OUTPUT||count>=MAX_FEATURES)break;}
  }
  if(!count&&!issues.length)issues.push({row:0,message:'Seçilen sayfa ve sütunlarda geometri bulunamadı.'});
  return {count,skippedRows,issues,blob:issues.length?null:new Blob(['{"type":"FeatureCollection","category_catalog":',JSON.stringify(catalog.list()),',"features":[',...chunks,']}'],{type:'application/geo+json'})};
}
