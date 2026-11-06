import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config';

// Real App, no source injection. Only isolate the browser test optimizer cache.
export default mergeConfig(base,defineConfig({cacheDir:process.env.PROJECT_UI_CACHE_DIR??'node_modules/.vite-project-ui-test'}));
