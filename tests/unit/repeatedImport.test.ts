// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalEngine } from '../../src/adapters/local/localEngine';
import { App } from '../../src/App';
import { write,utils,type WorkBook } from 'xlsx';

let engine: LocalEngine;
vi.mock('../../src/data/createRepository',()=>({createRepository:()=>engine}));
vi.mock('../../src/components/MapCanvas',()=>({MapCanvas:()=>null}));
vi.mock('../../src/data/ImportReader',()=>({ImportReader:class {
  private workbook:WorkBook|null=null;
  async load(bytes:ArrayBuffer){
    const {loadImportWorkbook,inspectImportSheet}=await import('../../src/data/spreadsheetImport');
    this.workbook=loadImportWorkbook(bytes);return inspectImportSheet(this.workbook);
  }
  async sheet(name:string){return (await import('../../src/data/spreadsheetImport')).inspectImportSheet(this.workbook!,name);}
  async convert(mapping:import('../../src/data/importTypes').SpreadsheetMapping){return (await import('../../src/data/spreadsheetImport')).convertImportSheet(this.workbook!,mapping);}
  async merge(existing:Blob,incoming:Blob,progress:never){
    const {mergeGeoJsonImports}=await import('../../src/data/mergeImports');
    return (await mergeGeoJsonImports(existing,incoming,progress)).blob;
  }
  dispose(){}
}}));

let host:HTMLDivElement,root:Root;
const feature=(id:string)=>({type:'Feature',id,properties:{name:id},geometry:{type:'Polygon',coordinates:[[[28,40],[29,40],[29,41],[28,40]]]}});
const jsonFile=(id:string,name=`${id}.json`)=>new File([JSON.stringify({type:'FeatureCollection',features:[feature(id)]})],name,{type:'application/json'});
const button=(label:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>(el.getAttribute('aria-label')??el.textContent?.trim())===label)!;
const dialog=()=>host.querySelector<HTMLElement>('.standard-import-dialog');
const editor=()=>host.querySelector<HTMLTextAreaElement>('textarea[aria-label="GeoJSON kod editörü"]')!;
async function output(){let result:unknown;await act(async()=>{result=JSON.parse(await(await engine.export()).text());});return result as {features:ReturnType<typeof feature>[]};}
async function settle(check:()=>boolean){
  for(let i=0;i<100;i++){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});if(check())return;}
  throw new Error(`UI did not settle: ${host.textContent}`);
}
async function click(element:HTMLElement){await act(async()=>element.click());}
async function choose(file:File,input:HTMLInputElement){
  Object.defineProperty(input,'files',{configurable:true,value:[file]});
  await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
}
beforeEach(async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('Blob',NodeBlob);vi.stubGlobal('File',NodeFile);
  engine=new LocalEngine();host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root.render(createElement(App)));
  await settle(()=>!button('İçe aktar').disabled);
});
afterEach(async()=>{await act(async()=>root.unmount());await new Promise(resolve=>setTimeout(resolve,10));host.remove();vi.unstubAllGlobals();});

describe('repeated file imports through the React UI',()=>{
  it('adds the first, second and third JSON as soon as each file is selected',async()=>{
    for(const id of ['first','second','third']){
      await click(button('İçe aktar'));
      expect(dialog()).not.toBeNull();
      await choose(jsonFile(id),dialog()!.querySelector('input[type=file]')!);
      await settle(()=>dialog()===null&&editor().value.includes(`"${id}"`));
    }
    expect((await output()).features.map(f=>f.id)).toEqual(['first','second','third']);
    expect(host.querySelector('.map-counter')?.textContent).toContain('3');
    expect(button('İçe aktar').disabled).toBe(false);
  });
  it('reopens the direct picker and accepts even the same file again',async()=>{
    const input=host.querySelector<HTMLInputElement>('input[aria-label="Harita dosyası seç"]')!;
    const file=jsonFile('same','alan.json');
    for(const count of [1,2,3]){
      await choose(file,input);
      await settle(()=>dialog()===null&&host.querySelector('.map-counter')?.textContent?.includes(`${count} şekil`)===true);
      expect(input.value).toBe('');
    }
    expect((await output()).features.map(f=>f.id)).toEqual(['same','same','same']);
    expect(button('İçe aktar').disabled).toBe(false);
  });
  it('keeps the previous polygons after a bad file and accepts a new selection in the same dialog',async()=>{
    const input=host.querySelector<HTMLInputElement>('input[aria-label="Harita dosyası seç"]')!;
    await choose(jsonFile('keep'),input);
    await settle(()=>dialog()===null&&editor().value.includes('"keep"'));
    await click(button('İçe aktar'));
    const picker=dialog()!.querySelector<HTMLInputElement>('input[type=file]')!;
    await choose(new File(['{"type":'],'invalid.json'),picker);
    await settle(()=>!!dialog()?.querySelector('[role=alert]')&&!dialog()!.querySelector<HTMLButtonElement>('.import-file-picker button')!.disabled);
    expect((await output()).features.map(f=>f.id)).toEqual(['keep']);
    await choose(jsonFile('recovered'),picker);
    await settle(()=>dialog()===null&&editor().value.includes('"recovered"'));
    expect((await output()).features.map(f=>f.id)).toEqual(['keep','recovered']);
  });
  it('waits for explicit submit when replacing existing work instead of appending',async()=>{
    await choose(jsonFile('keep'),host.querySelector<HTMLInputElement>('input[aria-label="Harita dosyası seç"]')!);
    await settle(()=>dialog()===null&&editor().value.includes('"keep"'));
    await click(button('İçe aktar'));
    await click(dialog()!.querySelector<HTMLInputElement>('.import-append input')!);
    await choose(jsonFile('replace'),dialog()!.querySelector('input[type=file]')!);
    expect(dialog()).not.toBeNull();expect((await output()).features.map(f=>f.id)).toEqual(['keep']);
    await click(dialog()!.querySelector<HTMLButtonElement>('button[type=submit]')!);
    await settle(()=>dialog()===null&&editor().value.includes('"replace"'));
    expect((await output()).features.map(f=>f.id)).toEqual(['replace']);
  });
  it('detects the separate JSON column in Excel and appends its polygons to the current workspace',async()=>{
    await choose(jsonFile('keep'),host.querySelector<HTMLInputElement>('input[aria-label="Harita dosyası seç"]')!);
    await settle(()=>dialog()===null&&editor().value.includes('"keep"'));
    const workbook=utils.book_new();
    utils.book_append_sheet(workbook,utils.aoa_to_sheet([['Açıklama'],['Poligonlar diğer sayfada.']]),'Notlar');
    utils.book_append_sheet(workbook,utils.aoa_to_sheet([['İsim','Alan verisi'],['Boş','\u200b'],['Boş','NaN'],['Boş','""'],['Excel alanı',JSON.stringify(feature('excel-polygon'))]]),'Avrupa');
    await click(button('İçe aktar'));
    await choose(new File([write(workbook,{type:'array',bookType:'xlsx'})],'poligonlar.xlsx'),dialog()!.querySelector('input[type=file]')!);
    await settle(()=>!!dialog()?.querySelector<HTMLInputElement>('input[value=geojson]')?.checked&&!dialog()!.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled);
    expect(dialog()!.querySelector<HTMLSelectElement>('select[aria-label="Çalışma sayfası"]')!.value).toBe('Avrupa');
    expect(dialog()!.querySelector<HTMLSelectElement>('select[aria-label="GeoJSON sütunu"]')!.value).toBe('1');
    await click(dialog()!.querySelector<HTMLButtonElement>('button[type=submit]')!);
    await settle(()=>dialog()===null&&editor().value.includes('"excel-polygon"'));
    expect((await output()).features.map(f=>f.id)).toEqual(['keep','excel-polygon']);
    expect(host.querySelector('.toast')?.textContent).toContain('3 boş geometri satırı atlandı.');
  });
});
