import { expect,it,vi } from 'vitest';
import { PendingEditorEdits } from '../../src/data/PendingEditorEdits';
it('waits for editor commits and checks they really cleared their drafts',async()=>{
  let dirty=true;let done!:()=>void;const changed=vi.fn();const edits=new PendingEditorEdits(changed);
  edits.register({dirty:()=>dirty,flush:()=>new Promise<void>(resolve=>{done=()=>{dirty=false;resolve();};})});
  let completed=false;const wait=edits.flush().then(()=>completed=true);await Promise.resolve();expect(completed).toBe(false);done();await wait;expect(completed).toBe(true);
});
it('rejects failures and never treats remaining drafts as successful commits',async()=>{
  const edits=new PendingEditorEdits();edits.register({dirty:()=>true,flush:async()=>{}});await expect(edits.flush()).rejects.toThrow('tamamlanmadı');
});
it('propagates failure before running later editors',async()=>{
  const edits=new PendingEditorEdits(),second=vi.fn();edits.register({dirty:()=>true,flush:async()=>{throw new Error('HTTP failed');}});edits.register({dirty:()=>true,flush:second});
  await expect(edits.flush()).rejects.toThrow('HTTP failed');expect(second).not.toHaveBeenCalled();
});
it('unregisters old workspace editors and notifies the dirty observer',()=>{
  const notify=vi.fn(),edits=new PendingEditorEdits(notify);const stop=edits.register({dirty:()=>true,flush:async()=>{}});expect(edits.hasChanges()).toBe(true);stop();expect(edits.hasChanges()).toBe(false);expect(notify).toHaveBeenLastCalledWith(false);
});
it('bounds a hung save wait without forgetting its still-pending editor',async()=>{
  vi.useFakeTimers();try{
    const edits=new PendingEditorEdits(()=>{},100);edits.register({dirty:()=>true,flush:()=>new Promise(()=>{})});
    const failure=expect(edits.flush()).rejects.toThrow('zaman aşımına');await vi.advanceTimersByTimeAsync(100);await failure;expect(edits.hasChanges()).toBe(true);
  }finally{vi.useRealTimers();}
});
