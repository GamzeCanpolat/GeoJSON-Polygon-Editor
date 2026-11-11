import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, access, rm, rename } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const manifestVersion = 1;

async function filesIn(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) {
      files.push(...await filesIn(join(directory, entry.name), relative + '/'));
    } else {
      if (!entry.isFile()) throw new Error('Normal dosya gerekli: ' + join(directory, entry.name));
      files.push(relative);
    }
  }
  return files;
}

async function fileHash(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex');
}

async function inputHash() {
  const inputs = ['index.html', 'package.json', 'package-lock.json', 'vite.config.ts',
    'scripts/start-local.mjs', 'node_modules/.package-lock.json'];
  inputs.push(...(await filesIn(join(projectRoot, 'src'))).map(name => 'src/' + name));
  try {
    inputs.push(...(await filesIn(join(projectRoot, 'public'))).map(name => 'public/' + name));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of await readdir(projectRoot)) {
    if (/^tsconfig.*\.json$/.test(name) || /^\.env(?:\.|$)/.test(name)) inputs.push(name);
  }
  const hash = createHash('sha256').update(process.version + '\0production\0local\0projects=false');
  for (const name of [...new Set(inputs)].sort()) {
    hash.update('\0' + name + '\0' + await fileHash(join(projectRoot, name)));
  }
  return hash.digest('hex');
}

async function outputHashes(directory) {
  const names = await filesIn(directory);
  if (!names.includes('index.html')) throw new Error('Derlenmiş index.html bulunamadı.');
  return Promise.all(names.map(async name => ({ name, hash: await fileHash(join(directory, name)) })));
}

async function isCurrent(manifestPath, directory, digest) {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.version !== manifestVersion || manifest.inputHash !== digest) return false;
    await access(join(directory, 'index.html'));
    return JSON.stringify(manifest.outputs) === JSON.stringify(await outputHashes(directory));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return false;
    throw error;
  }
}

async function checkDependencies() {
  for (const name of ['vite', 'typescript', '@vitejs/plugin-react']) {
    try {
      await access(join(projectRoot, 'node_modules', name, 'package.json'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error('Geliştirme bağımlılıkları eksik. Proje klasöründe npm ci çalıştırın. ' +
        'Kurulumda --omit=dev kullanmayın. Eksik paket: ' + name);
    }
  }
}

// The CLI always uses 5173. An isolated test process can supply a temporary port.
export async function startLocal({ port = 5173 } = {}) {
  process.chdir(projectRoot);
  process.env.NODE_ENV = 'production';
  process.env.VITE_DATA_SOURCE = 'local';
  process.env.VITE_PROJECT_MANAGEMENT = 'false';

  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!(major > 22 || major === 22 && minor >= 12)) {
    throw new Error('Node.js 22.12 veya üstü gerekli. Bulunan sürüm: ' + process.version);
  }

  let reservation;
  let server;
  let compiler;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (compiler) {
      const exited = once(compiler, 'exit');
      compiler.kill('SIGTERM');
      await exited;
    }
    if (reservation?.listening) await new Promise(resolve => reservation.close(resolve));
    if (server) {
      server.httpServer.closeAllConnections?.();
      await new Promise(resolve => server.httpServer.close(resolve));
    }
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    // Hold the port during compilation so two launchers cannot rebuild the same cache.
    reservation = createServer(socket => socket.destroy());
    const listening = once(reservation, 'listening');
    reservation.listen(port, host);
    await listening;
    await checkDependencies();
    const { build, preview } = await import('vite');
    const cache = join(projectRoot, 'node_modules/.cache/geojson-local');
    const directory = join(cache, 'dist');
    const manifestPath = join(cache, 'build.json');
    const digest = await inputHash();

    if (!await isCurrent(manifestPath, directory, digest)) {
      console.log('Local sürüm hazırlanıyor. İlk açılış biraz daha uzun sürebilir.');
      await rm(manifestPath, { force: true });
      compiler = spawn(process.execPath, [join(projectRoot, 'node_modules/typescript/bin/tsc'), '--noEmit'],
        { stdio: 'inherit' });
      const [code, signal] = await once(compiler, 'exit');
      compiler = undefined;
      if (code !== 0) throw new Error('TypeScript kontrolü başarısız: ' + (signal ?? code));

      await build({ mode: 'production', cacheDir: join(cache, 'vite'),
        build: { outDir: directory, emptyOutDir: true } });
      const manifest = { version: manifestVersion, inputHash: digest, outputs: await outputHashes(directory) };
      await mkdir(cache, { recursive: true });
      await writeFile(manifestPath + '.tmp', JSON.stringify(manifest));
      await rename(manifestPath + '.tmp', manifestPath);
    }
    const previewOptions = { host, port, strictPort: true, headers: { 'Cache-Control': 'no-store' } };
    await new Promise(resolve => reservation.close(resolve));
    server = await preview({ mode: 'production', build: { outDir: directory }, preview: previewOptions });
    const url = 'http://' + host + ':' + port + '/';
    console.log('GeoJSON Editor hazır: ' + url);
    console.log('Local mod. Kapatmak için bu Terminal penceresinde Ctrl+C kullanın.');
    if (process.env.GEOJSON_OPEN_BROWSER !== '0') {
      execFile('/usr/bin/open', [url], error => {
        if (error) console.error('Tarayıcı açılamadı. Şu adresi açın: ' + url);
      });
    }
  } catch (error) {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (reservation?.listening) await new Promise(resolve => reservation.close(resolve));
    if (server) {
      server.httpServer.closeAllConnections?.();
      await new Promise(resolve => server.httpServer.close(resolve));
    }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startLocal().catch(error => {
    if (error.code === 'EADDRINUSE' || /already in use/.test(error.message)) {
      console.error('5173 portu kullanımda. Bu portu kullanan uygulamayı kendi penceresinden kapatıp tekrar deneyin.');
    } else {
      console.error('GeoJSON Editor başlatılamadı: ' + error.message);
    }
    process.exitCode = 1;
  });
}
