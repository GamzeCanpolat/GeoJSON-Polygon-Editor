import { it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
async function waitFor(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(100);
  }
  throw new Error('Timed out waiting for ' + label);
}

it.skipIf(!process.env.RUN_BROWSER_INTEGRATION)('serves the compiled Local app across three Chrome restarts without optimizer chunks', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'geojson-launcher-browser-'));
  const [port, debugPort] = await Promise.all([freePort(), freePort()]);
  const children: { child: ChildProcess; exited: Promise<unknown> }[] = [];
  let socket: WebSocket | undefined;
  let logs = '';
  const launch = (command: string, args: string[], env = process.env) => {
    const child = spawn(command, args, { cwd: resolve('.'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', data => { logs += data; });
    child.stderr!.on('data', data => { logs += data; });
    const tracked = { child, exited: once(child, 'exit') };
    children.push(tracked);
    return tracked;
  };
  const stop = async (tracked: typeof children[number]) => {
    if (tracked.child.exitCode !== null || tracked.child.signalCode !== null) return;
    tracked.child.kill('SIGINT');
    await tracked.exited;
    expect(tracked.child.exitCode).toBe(0);
  };
  try {
    launch('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
      '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--user-data-dir=' + join(temporary, 'chrome'), '--remote-debugging-port=' + debugPort, 'about:blank',
    ]);
    let tab: { webSocketDebuggerUrl: string } | undefined;
    await waitFor(async () => {
      try {
        tab = (await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json())
          .find((item: { type: string }) => item.type === 'page');
        return !!tab;
      } catch { return false; }
    }, 'Chrome');
    socket = new WebSocket(tab!.webSocketDebuggerUrl);
    await once(socket, 'open');
    let sequence = 0;
    const pending = new Map<number, (message: any) => void>();
    const failures: string[] = [];
    const optimizerRequests: string[] = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      pending.get(message.id)?.(message);
      if (message.method === 'Runtime.exceptionThrown') {
        failures.push(JSON.stringify(message.params.exceptionDetails));
      }
      if (message.method === 'Network.responseReceived') {
        const response = message.params.response;
        if (response.url.startsWith('http://127.0.0.1:' + port + '/')) {
          if (response.url.includes('/.vite/deps/')) optimizerRequests.push(response.url);
          if (response.status >= 400 && !response.url.endsWith('/favicon.ico')) failures.push(response.url);
        }
      }
    });
    const call = (method: string, params = {}) => new Promise<any>((resolveCall, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => reject(new Error('CDP ' + method)), 15000);
      pending.set(id, message => {
        clearTimeout(timeout);
        pending.delete(id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolveCall(message.result);
      });
      socket!.send(JSON.stringify({ id, method, params }));
    });
    await call('Page.enable');
    await call('Runtime.enable');
    await call('Network.enable');
    const launcher = pathToFileURL(resolve('scripts/start-local.mjs')).href;
    for (let run = 0; run < 3; run++) {
      logs = '';
      const server = launch(process.execPath, ['--input-type=module', '-e',
        'import(' + JSON.stringify(launcher) + ').then(m=>m.startLocal({port:' + port +
        '})).catch(e=>{console.error(e);process.exitCode=1;})'],
      { ...process.env, GEOJSON_OPEN_BROWSER: '0', VITE_DATA_SOURCE: 'api', VITE_PROJECT_MANAGEMENT: 'true' });
      await waitFor(async () => {
        if (server.child.exitCode !== null) throw new Error(logs);
        return logs.includes('GeoJSON Editor hazır:');
      }, 'compiled server');
      const response = await fetch('http://127.0.0.1:' + port);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const html = await response.text();
      expect(html).not.toContain('/@vite/client');
      expect(html).not.toContain('/src/main.tsx');
      expect(html).toContain('/assets/');
      await call('Page.navigate', { url: 'http://127.0.0.1:' + port + '/?testRun=' + run });
      await waitFor(async () => {
        const result = await call('Runtime.evaluate', {
          expression: "!!document.querySelector('.ol-viewport') && !document.querySelector('.map-loading') " +
            "&& document.querySelector('.brand-logo')?.naturalWidth > 0 " +
            "&& !!document.querySelector('.coordinate-trigger') && !document.querySelector('.project-management')",
          returnByValue: true,
        });
        return result.result.value === true;
      }, 'Local app, logo and map');
      await stop(server);
      if (run > 0) expect(logs).not.toContain('Local sürüm hazırlanıyor');
    }
    expect(failures).toEqual([]);
    expect(optimizerRequests).toEqual([]);
  } finally {
    socket?.close();
    for (const tracked of children.reverse()) {
      if (tracked.child.exitCode !== null || tracked.child.signalCode !== null) continue;
      tracked.child.kill('SIGTERM');
      const timeout = setTimeout(() => tracked.child.kill('SIGKILL'), 3000);
      await tracked.exited;
      clearTimeout(timeout);
    }
    await rm(temporary, { recursive: true, force: true });
  }
}, 120000);
