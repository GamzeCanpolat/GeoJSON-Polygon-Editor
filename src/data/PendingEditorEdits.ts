/** Barrier for editors whose blur handler may still be awaiting HTTP work. */
export class PendingEditorEdits {
  private editors = new Set<{ flush(): Promise<void>; dirty(): boolean }>();
  constructor(private readonly changed: (dirty: boolean) => void = () => {}, private readonly timeoutMs = 30_000) {}
  register(editor: { flush(): Promise<void>; dirty(): boolean }) {
    this.editors.add(editor); this.notify();
    return () => { this.editors.delete(editor); this.notify(); };
  }
  hasChanges() { return [...this.editors].some(editor => editor.dirty()); }
  notify() { this.changed(this.hasChanges()); }
  async flush() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async () => {
      for (const editor of this.editors) await editor.flush();
      if (this.hasChanges()) throw new Error('Tablo değişiklikleri tamamlanmadı. Hücreleri kontrol edin.');
    };
    try {
      await Promise.race([work(), new Promise<never>((_resolve,reject) => {
        timer=setTimeout(()=>reject(new Error('Tablo kaydı zaman aşımına uğradı; proje kaydedilmedi. Bağlantıyı ve hücre durumunu kontrol edin.')),this.timeoutMs);
      })]);
    } finally { if(timer!==undefined)clearTimeout(timer); }
    // A timeout does not cancel/forget an already sent mutation. It remains
    // tracked by its editor, so a later save cannot claim it completed.
  }
}
