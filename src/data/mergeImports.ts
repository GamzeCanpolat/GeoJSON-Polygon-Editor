import { stringifyJson } from '../domain/losslessJson';
import { streamGeoJson } from '../adapters/local/streamGeoJson';
import { CategoryCatalog } from '../domain/categories';
import type { ImportProgress } from '../domain/contracts';

/** Build a new file without mutating the active repository or making one giant string. */
export async function mergeGeoJsonImports(existing:Blob,incoming:Blob,onProgress:(value:ImportProgress)=>void=()=>{}) {
  const parts:BlobPart[]=[],catalog=new CategoryCatalog();let count=0,completedBytes=0;
  for(const file of [existing,incoming]){
    await streamGeoJson(file,async batch=>{
      const encoded=batch.map(feature=>stringifyJson(feature)).join(',');
      if(encoded){parts.push(new Blob([`${count?',':''}${encoded}`]));count+=batch.length;}
    },progress=>onProgress({bytesRead:completedBytes+progress.bytesRead,totalBytes:existing.size+incoming.size,featuresRead:count}),undefined,root=>catalog.import(root.category_catalog));
    completedBytes+=file.size;
  }
  return {count,blob:new Blob(['{"type":"FeatureCollection","category_catalog":',JSON.stringify(catalog.list()),',"features":[',...parts,']}'],{type:'application/geo+json'})};
}
