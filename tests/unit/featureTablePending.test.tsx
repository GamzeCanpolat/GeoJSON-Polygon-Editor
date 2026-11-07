// @vitest-environment jsdom
import { act } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { FeatureTable } from '../../src/components/FeatureTable';
import { PendingEditorEdits } from '../../src/data/PendingEditorEdits';
import type { FeatureRecord,GeoJsonRepository } from '../../src/domain/contracts';
import { stringifyJson } from '../../src/domain/losslessJson';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function setup(){
  let stored:FeatureRecord={summary:{id:'g:0',label:'Original',geometryType:'Point',vertices:1,bounds:[29,41,29,41]},feature:{type:'Feature',id:'external',properties:{name:'Original',number:1},geometry:{type:'Point',coordinates:[29,41,42]}}};
  const repo={list:vi.fn().mockResolvedValue({items:[stored.summary],total:1}),get:vi.fn(async()=>structuredClone(stored))};
  const onApply=vi.fn(async(_record:FeatureRecord,feature:FeatureRecord['feature'])=>{stored={...stored,feature};return true;});const edits=new PendingEditorEdits();
  const render=async(revision=0)=>{await act(async()=>root.render(<FeatureTable edits={edits} repository={repo as unknown as GeoJsonRepository} dataset={{name:'a',revision,count:1,vertices:1,bounds:null,sourceBytes:0}} busy={false} onSelect={()=>{}} onApply={onApply}/>));};
  await render();return {repo,onApply,edits,render};
}
async function change(field:string,value:string){const e=host.querySelector<HTMLInputElement>(`input[aria-label^="${field} ·"]`)!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));});return e;}
it('blocks the snapshot barrier until a delayed GET and mutate finish, sharing the blur promise',async()=>{
  const s=await setup();let release!:(r:FeatureRecord)=>void;const record=await s.repo.get();s.repo.get.mockImplementationOnce(()=>new Promise(resolve=>release=resolve));
  const e=await change('name','Save click race');await act(async()=>{e.focus();e.blur();});
  let ready=false;const barrier=s.edits.flush().then(()=>ready=true);expect(s.edits.hasChanges()).toBe(true);expect(s.onApply).not.toHaveBeenCalled();expect(ready).toBe(false);
  await act(async()=>{release(record);await barrier;});expect(s.onApply).toHaveBeenCalledOnce();expect(s.onApply.mock.calls[0][1].properties?.name).toBe('Save click race');expect(s.edits.hasChanges()).toBe(false);expect(e.value).toBe('Save click race');
});
it('keeps failed text across refresh and stops subsequent saves until explicit retry',async()=>{
  const s=await setup();s.onApply.mockResolvedValueOnce(false);await change('name','Retained');
  await act(async()=>{await expect(s.edits.flush()).rejects.toThrow('Alan kaydedilemedi');});await s.render(1);
  expect(host.querySelector<HTMLInputElement>('input[aria-label^="name ·"]')?.value).toBe('Retained');
  await expect(s.edits.flush()).rejects.toThrow('Tekrar dene');expect(s.onApply).toHaveBeenCalledOnce();
  await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='Tekrar dene')!.click();});expect(s.onApply).toHaveBeenCalledTimes(2);expect(s.edits.hasChanges()).toBe(false);
});
it('does not leave a rejected pending promise stuck after synchronous validation fails',async()=>{
  const s=await setup();await change('number','not a number');await act(async()=>{await expect(s.edits.flush()).rejects.toThrow();});expect(s.onApply).not.toHaveBeenCalled();
  await change('number','2');await act(async()=>s.edits.flush());expect(s.onApply.mock.calls[0][1].properties?.number).toBe(2);expect(s.edits.hasChanges()).toBe(false);
});
it('flushes multiple cell drafts sequentially without losing the first property or Z',async()=>{
  const s=await setup();await change('name','Updated');await change('number','7');await act(async()=>s.edits.flush());
  expect(s.onApply).toHaveBeenCalledTimes(2);const feature=s.onApply.mock.calls[1][1];expect(feature.properties).toEqual({name:'Updated',number:7});expect(feature.geometry).toEqual({type:'Point',coordinates:[29,41,42]});expect(feature.id).toBe('external');
});
it('renders and edits large numeric cells without changing external IDs or nested values',async()=>{
  const s=await setup();const record=await s.repo.get();record.feature.id=9007199254740993n;
  record.feature.properties={name:'Original',exact:9007199254740993n,nested:[-9007199254740993n,9007199254740995n]};
  await act(async()=>s.onApply(record,record.feature));await s.render(1);
  expect(host.querySelector<HTMLInputElement>('input[aria-label^="exact ·"]')?.value).toBe('9007199254740993');
  await change('exact','9007199254740995');await act(async()=>s.edits.flush());
  const result=s.onApply.mock.calls.at(-1)![1];expect(stringifyJson(result)).toContain('"exact":9007199254740995');
  expect(result.id).toBe(9007199254740993n);expect(result.properties!.nested).toEqual([-9007199254740993n,9007199254740995n]);expect(result.geometry).toEqual(record.feature.geometry);
});
