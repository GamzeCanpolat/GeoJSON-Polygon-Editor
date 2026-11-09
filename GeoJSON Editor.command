#!/bin/bash
set -u

# Finder can start Terminal with a shorter PATH than an interactive shell.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

pause_on_error() {
  if [[ -t 0 ]]; then
    read -r -p 'Bu pencereyi kapatmak için Enter tuşuna basın. ' unused
  fi
}

fail() {
  printf '%s\n' "$1" >&2
  pause_on_error
  exit 1
}

cd -- "$(dirname -- "$0")" || fail 'GeoJSON Editor klasörü açılamadı.'
command -v node >/dev/null && command -v npm >/dev/null ||
  fail 'Node.js ve npm bulunamadı. Node.js 22.12 veya daha yeni bir sürüm kurup tekrar deneyin.'
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)' ||
  fail "Node.js 22.12 veya daha yeni bir sürüm gerekiyor. Bulunan: $(node --version)."
[[ -x node_modules/.bin/vite ]] ||
  fail 'Bağımlılıklar eksik. Bu proje klasöründe Terminal ile bir kez npm ci çalıştırıp tekrar çift tıklayın.'

export VITE_DATA_SOURCE=local
export VITE_PROJECT_MANAGEMENT=false

node --input-type=module - <<'NODE'
import { execFile } from 'node:child_process';

const host = '127.0.0.1';
const port = 5173;
let server;
try {
  const { createServer } = await import('vite');
  server = await createServer({ server: { host, port, strictPort: true } });
  await server.listen();
} catch (error) {
  await server?.close();
  if (error.code === 'EADDRINUSE' || error.message?.includes('already in use')) {
    console.error('5173 portu kullanımda. Önce o portu kullanan uygulamayı kendi penceresinden kapatın.');
  } else {
    console.error('GeoJSON Editor başlatılamadı:', error.message);
  }
  process.exit(1);
}

const url = `http://${host}:${port}`;
console.log(`GeoJSON Editor hazır: ${url}`);
console.log('Uygulamayı kapatmak için bu Terminal penceresinde Ctrl+C tuşlarına basın.');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
execFile('open', [url], error => {
  if (error) console.error(`Tarayıcı otomatik açılamadı. Şu adresi açın: ${url}`);
});
NODE
result=$?
if [[ "$result" != 0 ]]; then pause_on_error; fi
exit "$result"
