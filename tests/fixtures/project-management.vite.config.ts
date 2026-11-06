import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config';

// Real App, no source injection. Only isolate the browser test optimizer cache.
// Spreadsheet conversion is loaded lazily by the test's browser module import.
// Discover its formats at startup so Vite cannot force a reload mid-import.
export default mergeConfig(base,defineConfig({cacheDir:process.env.PROJECT_UI_CACHE_DIR??'node_modules/.vite-project-ui-test',optimizeDeps:{include:['xlsx','@streamparser/json','ol/format/WKT','ol/format/Polyline']}}));
