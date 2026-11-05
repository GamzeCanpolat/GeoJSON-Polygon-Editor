/// <reference lib="webworker" />
import { loadImportWorkbook,inspectImportSheet,convertImportSheet } from './spreadsheetImport';
import { mergeGeoJsonImports } from './mergeImports';
import type { SpreadsheetMapping } from './importTypes';

let workbook:ReturnType<typeof loadImportWorkbook>|null=null;
let queue=Promise.resolve();
self.onmessage=({data}:MessageEvent<{id:number;bytes?:ArrayBuffer;sheet?:string;mapping?:SpreadsheetMapping;existing?:Blob;incoming?:Blob}>)=>{
  queue=queue.then(async()=>{
    try{
      if(data.existing&&data.incoming){
        const result=await mergeGeoJsonImports(data.existing,data.incoming,progress=>self.postMessage({id:data.id,progress}));
        self.postMessage({id:data.id,...result});return;
      }
      if(data.bytes){workbook=null;workbook=loadImportWorkbook(data.bytes);}
      if(!workbook)throw new Error('Önce Excel dosyasını seçin.');
      if(data.mapping)self.postMessage({id:data.id,...convertImportSheet(workbook,data.mapping)});
      else self.postMessage({id:data.id,info:inspectImportSheet(workbook,data.sheet)});
    }catch(cause){self.postMessage({id:data.id,error:cause instanceof Error?cause.message:'Dosya okunamadı.'});}
  });
};
