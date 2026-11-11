import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const fixtures: Fixture[] = [];
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(25);
  }
  throw new Error('Timed out waiting for ' + label);
}

const fakeVite = [
  "import {mkdir,writeFile,appendFile,readFile,rm} from 'node:fs/promises';",
  "import {createServer} from 'node:http';",
  "import {once} from 'node:events';",
  "import {join,dirname,resolve} from 'node:path';",
  "import {fileURLToPath} from 'node:url';",
  "const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');",
  "export async function build(options){",
  " await appendFile(join(root,'trace.log'),JSON.stringify({event:'build',outDir:options.build.outDir,mode:process.env.VITE_DATA_SOURCE})+'\\n');",
  " if(process.env.FAKE_BUILD_FAILURE)throw new Error('Fixture build failed');",
  " if(options.build.emptyOutDir)await rm(options.build.outDir,{recursive:true,force:true});",
  " await mkdir(join(options.build.outDir,'assets'),{recursive:true});",
  " await writeFile(join(options.build.outDir,'index.html'),'<html>mode='+process.env.VITE_DATA_SOURCE+'</html>');",
  " await writeFile(join(options.build.outDir,'assets/main.js'),'valid local javascript');",
  "}",
  "export async function preview(options){",
  " await appendFile(join(root,'trace.log'),JSON.stringify({event:'preview',outDir:options.build.outDir})+'\\n');",
  " const server=createServer(async(req,res)=>{",
  "   res.writeHead(200,options.preview.headers);",
  "   res.end(await readFile(join(options.build.outDir,'index.html')));",
  " });",
  " server.listen(options.preview.port,options.preview.host);",
  " await once(server,'listening');",
  " return {httpServer:server};",
  "}"
].join('\n');

type Running = {
  child: ChildProcess;
  done: Promise<[number | null, NodeJS.Signals | null]>;
  log: () => string;
};
class Fixture {
  root = '';
  port = 0;
  running: Running[] = [];
  async prepare() {
    this.root = await realpath(await mkdtemp(join(tmpdir(), 'geojson launcher test ')));
    const probe = createPortProbe().listen(0, '127.0.0.1');
    await once(probe, 'listening');
    this.port = (probe.address() as { port: number }).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    for (const directory of ['scripts', 'src', 'node_modules/vite', 'node_modules/typescript/bin',
      'node_modules/@vitejs/plugin-react']) await mkdir(join(this.root, directory), { recursive: true });
    await copyFile(resolve('scripts/start-local.mjs'), join(this.root, 'scripts/start-local.mjs'));
    for (const filename of ['package.json', 'node_modules/.package-lock.json', 'package-lock.json',
      'node_modules/typescript/package.json', 'node_modules/@vitejs/plugin-react/package.json']) {
      await writeFile(join(this.root, filename), '{}');
    }
    await writeFile(join(this.root, 'index.html'), '<html></html>');
    await writeFile(join(this.root, 'vite.config.ts'), 'export default {};');
    await writeFile(join(this.root, 'tsconfig.json'), '{}');
    await writeFile(join(this.root, 'src/main.ts'), 'export const value = 1;');
    await writeFile(join(this.root, 'node_modules/vite/package.json'),
      JSON.stringify({ name: 'vite', type: 'module', exports: './index.js' }));
    await writeFile(join(this.root, 'node_modules/vite/index.js'), fakeVite);
    await writeFile(join(this.root, 'node_modules/typescript/bin/tsc'), [
      "require('fs').appendFileSync('trace.log',JSON.stringify({event:'typecheck',pid:process.pid})+'\\n');",
      "if(process.env.FAKE_TSC_DELAY_MS)setTimeout(()=>{},Number(process.env.FAKE_TSC_DELAY_MS));"
    ].join('\n'));
    await writeFile(join(this.root, 'runner.mjs'), [
      "import {startLocal} from './scripts/start-local.mjs';",
      "startLocal({port:Number(process.env.FIXTURE_PORT)}).catch(e=>{console.error(e.message);process.exitCode=1;});"
    ].join('\n'));
    fixtures.push(this);
    return this;
  }
  cache(path: string) { return join(this.root, 'node_modules/.cache/geojson-local', path); }
  launch(env: NodeJS.ProcessEnv = {}) {
    let output = '';
    const child = spawn(process.execPath, [join(this.root, 'runner.mjs')], {
      cwd: tmpdir(),
      env: { ...process.env, VITE_DATA_SOURCE: 'api', VITE_PROJECT_MANAGEMENT: 'true',
        GEOJSON_OPEN_BROWSER: '0', FIXTURE_PORT: String(this.port), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout!.on('data', data => { output += data; });
    child.stderr!.on('data', data => { output += data; });
    const running = { child, done: once(child, 'exit') as Running['done'], log: () => output };
    this.running.push(running);
    return running;
  }
  async ready(running: Running) {
    await waitFor(async () => {
      if (running.child.exitCode !== null) throw new Error(running.log());
      return running.log().includes('GeoJSON Editor hazır:');
    }, 'ready message');
    const response = await fetch('http://127.0.0.1:' + this.port);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('<html>mode=local</html>');
  }
  async stop(running: Running) {
    running.child.kill('SIGINT');
    expect((await running.done)[0]).toBe(0);
  }
  async events() {
    try {
      return (await readFile(join(this.root, 'trace.log'), 'utf8')).trim().split('\n')
        .filter(Boolean).map(line => JSON.parse(line));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    for (const running of fixture.running) {
      if (running.child.exitCode === null && running.child.signalCode === null) {
        running.child.kill('SIGTERM');
        await running.done;
      }
    }
    await rm(fixture.root, { recursive: true, force: true });
  }
});

describe('macOS Local launcher lifecycle in isolated processes', () => {
  it('builds on first launch, forces Local mode, and reuses the verified output', async () => {
    const f = await new Fixture().prepare();
    const first = f.launch();
    await f.ready(first);
    await f.stop(first);
    const second = f.launch();
    await f.ready(second);
    await f.stop(second);
    const events = await f.events();
    expect(events.filter(e => e.event === 'build')).toHaveLength(1);
    expect(events.filter(e => e.event === 'typecheck')).toHaveLength(1);
    expect(events.find(e => e.event === 'build').outDir).toBe(f.cache('dist'));
    expect(second.log()).not.toContain('Local sürüm hazırlanıyor');
  });

  it.each(['missing chunk', 'missing html', 'changed chunk', 'changed html', 'broken manifest'])('rebuilds after %s', async damage => {
    const f = await new Fixture().prepare();
    const first = f.launch();
    await f.ready(first);
    await f.stop(first);
    if (damage === 'missing chunk') await rm(f.cache('dist/assets/main.js'));
    if (damage === 'missing html') await rm(f.cache('dist/index.html'));
    if (damage === 'changed chunk') await writeFile(f.cache('dist/assets/main.js'), 'corrupt');
    if (damage === 'changed html') await writeFile(f.cache('dist/index.html'), '<html>mode=api</html>');
    if (damage === 'broken manifest') await writeFile(f.cache('build.json'), '{');
    const second = f.launch();
    await f.ready(second);
    await f.stop(second);
    expect((await f.events()).filter(e => e.event === 'build')).toHaveLength(2);
    expect(await readFile(f.cache('dist/assets/main.js'), 'utf8')).toBe('valid local javascript');
  });

  it('rebuilds after a source edit', async () => {
    const f = await new Fixture().prepare();
    const first = f.launch();
    await f.ready(first);
    await f.stop(first);
    await writeFile(join(f.root, 'src/main.ts'), 'export const value = 2;');
    const second = f.launch();
    await f.ready(second);
    await f.stop(second);
    expect((await f.events()).filter(e => e.event === 'build')).toHaveLength(2);
  });

  it('reports an occupied port and preserves the service that owns it', async () => {
    const f = await new Fixture().prepare();
    const occupied = createServer((_req, res) => res.end('existing service')).listen(f.port, '127.0.0.1');
    await once(occupied, 'listening');
    try {
      const run = f.launch();
      expect((await run.done)[0]).toBe(1);
      expect(run.log()).toMatch(/EADDRINUSE|already in use/);
      expect(await (await fetch('http://127.0.0.1:' + f.port)).text()).toBe('existing service');
      expect(await f.events()).toEqual([]);
    } finally {
      occupied.closeAllConnections();
      await new Promise<void>(resolve => occupied.close(() => resolve()));
    }
  });

  it('releases the listener after Ctrl+C (SIGINT)', async () => {
    const f = await new Fixture().prepare();
    const run = f.launch();
    await f.ready(run);
    await f.stop(run);
    const probe = createPortProbe().listen(f.port, '127.0.0.1');
    await once(probe, 'listening');
    await new Promise<void>(resolve => probe.close(() => resolve()));
  });

  it('stops the compiler and releases its reservation when interrupted during typecheck', async () => {
    const f = await new Fixture().prepare();
    const run = f.launch({ FAKE_TSC_DELAY_MS: '20000' });
    await waitFor(async () => (await f.events()).some(e => e.event === 'typecheck'), 'compiler');
    const compiler = (await f.events()).find(e => e.event === 'typecheck').pid;
    await f.stop(run);
    expect(() => process.kill(compiler, 0)).toThrow();
    const probe = createPortProbe().listen(f.port, '127.0.0.1');
    await once(probe, 'listening');
    await new Promise<void>(resolve => probe.close(() => resolve()));
  });

  it('keeps a valid cache when moved to a different directory containing spaces', async () => {
    const f = await new Fixture().prepare();
    const first = f.launch();
    await f.ready(first);
    await f.stop(first);
    const old = f.root;
    f.root += ' moved';
    await rename(old, f.root);
    const second = f.launch();
    await f.ready(second);
    await f.stop(second);
    expect((await f.events()).filter(e => e.event === 'build')).toHaveLength(1);
  });

  it('leaves an API build in dist intact and ignores changes to it', async () => {
    const f = await new Fixture().prepare();
    await mkdir(join(f.root, 'dist'));
    await writeFile(join(f.root, 'dist/index.html'), 'API build');
    const first = f.launch();
    await f.ready(first);
    await f.stop(first);
    await writeFile(join(f.root, 'dist/index.html'), 'new API build');
    const second = f.launch();
    await f.ready(second);
    await f.stop(second);
    expect(await readFile(join(f.root, 'dist/index.html'), 'utf8')).toBe('new API build');
    expect((await f.events()).filter(e => e.event === 'build')).toHaveLength(1);
  });

  it('reports missing development dependencies with an npm ci instruction', async () => {
    const f = await new Fixture().prepare();
    await rm(join(f.root, 'node_modules/typescript'), { recursive: true });
    const run = f.launch();
    expect((await run.done)[0]).toBe(1);
    expect(run.log()).toContain('Geliştirme bağımlılıkları eksik');
    expect(run.log()).toContain('npm ci');
    expect(await f.events()).toEqual([]);
  });

  it('does not serve an old cache after a failed rebuild and retries next time', async () => {
    const f = await new Fixture().prepare();
    const first = f.launch();
    await f.ready(first);
    await f.stop(first);
    await writeFile(f.cache('dist/assets/main.js'), 'corrupt');
    const failed = f.launch({ FAKE_BUILD_FAILURE: '1' });
    expect((await failed.done)[0]).toBe(1);
    expect(failed.log()).toContain('Fixture build failed');
    await expect(readFile(f.cache('build.json'))).rejects.toThrow();
    const retry = f.launch();
    await f.ready(retry);
    await f.stop(retry);
    expect((await f.events()).filter(e => e.event === 'build')).toHaveLength(3);
  });

  it('holds its port throughout compilation so a concurrent launcher cannot touch the cache', async () => {
    const f = await new Fixture().prepare();
    const first = f.launch({ FAKE_TSC_DELAY_MS: '20000' });
    await waitFor(async () => (await f.events()).some(e => e.event === 'typecheck'), 'compiler');
    const second = f.launch();
    expect((await second.done)[0]).toBe(1);
    expect(second.log()).toMatch(/EADDRINUSE|already in use/);
    expect((await f.events()).filter(e => e.event === 'typecheck')).toHaveLength(1);
    await f.stop(first);
  });
});
