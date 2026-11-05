import type { ImportWorkerReply,SpreadsheetInfo,SpreadsheetMapping } from './importTypes';

export class ImportReader {
  private worker=new Worker(new URL('./import.worker.ts',import.meta.url),{type:'module'});
  private next=1;
  private closed=false;
  private pending=new Map<number,{resolve(value:ImportWorkerReply):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>;progress?:(value:import('../domain/contracts').ImportProgress)=>void}>();
  constructor(){
    this.worker.onmessage=({data}:MessageEvent<ImportWorkerReply>)=>{const request=this.pending.get(data.id);if(!request)return;if(data.progress){request.progress?.(data.progress);return;}clearTimeout(request.timer);this.pending.delete(data.id);if(data.error)request.reject(new Error(data.error));else request.resolve(data);};
    this.worker.onerror=()=>this.dispose('Dosya okuyucusu durdu. Dosyayı tekrar seçin.');
  }
  async load(bytes:ArrayBuffer):Promise<SpreadsheetInfo>{return (await this.call({bytes},[bytes])).info!;}
  async sheet(sheet:string):Promise<SpreadsheetInfo>{return (await this.call({sheet})).info!;}
  convert(mapping:SpreadsheetMapping){return this.call({mapping});}
  async merge(existing:Blob,incoming:Blob,progress?:(value:import('../domain/contracts').ImportProgress)=>void):Promise<Blob>{return (await this.call({existing,incoming},[],300000,progress)).blob!;}
  private call(data:object,transfer:Transferable[]=[],timeout=45000,progress?:(value:import('../domain/contracts').ImportProgress)=>void):Promise<ImportWorkerReply>{
    if(this.closed)return Promise.reject(new Error('Dosya okuyucusu kapalı.'));
    const id=this.next++;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.dispose('Dosya işlemi zaman aşımına uğradı. Daha küçük bir dosya deneyin.'),timeout);this.pending.set(id,{resolve,reject,timer,progress});this.worker.postMessage({id,...data},transfer);});
  }
  dispose(message='Dosya işlemi iptal edildi.') {this.closed=true;this.worker.terminate();for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(new Error(message));}this.pending.clear();}
}
