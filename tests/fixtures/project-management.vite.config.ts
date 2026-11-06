import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config';

// TEST ONLY. App.tsx on disk stays unchanged. Production Vite never loads this.
export default mergeConfig(base,defineConfig({cacheDir:process.env.PROJECT_UI_CACHE_DIR??'node_modules/.vite-project-ui-test',plugins:[{
  name:'project-management-test-mount',enforce:'pre',
  transform(source,id){
    if(!id.endsWith('/src/App.tsx'))return;
    const marker='<header className="topbar">';
    if(!source.includes(marker))throw new Error('Test mount anchor changed; review UI integration.');
    return `import { ProjectManagementFeature } from './components/projects/ProjectManagement';
import type { Project } from './domain/projects';\n`+source
      .replace('const [repository] = useState(createRepository);','const [repository] = useState(createRepository); const [activeProject,setActiveProject]=useState<Project|null>(null);')
      .replace('const resetState = () => {','const resetState = () => { setActiveProject(null);')
      .replace(marker,`<div style={{position:'fixed',top:2,left:230,zIndex:1200}}><ProjectManagementFeature repository={repository} dataset={dataset} activeProject={activeProject} dirty={dirty} hasDraft={codeDirty} editorBusy={!!busy}
        onActiveProjectChange={setActiveProject} onSaved={()=>setDirty(false)}
        onOpened={result=>{resetState();setDataset(result.workspace.dataset);requestAnimationFrame(()=>{map.current?.fit(result.workspace.dataset.bounds);map.current?.refresh();});}}
        onDeleted={id=>{if(activeProject?.id===id)setDirty(true);}} onOperationBusyChange={value=>{operationLock.current=value;setBusy(value?'edit':null);}}/></div>`+marker);
  },
}]}));
