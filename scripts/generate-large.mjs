import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { resolve } from 'node:path';

const count = Number(process.argv[2] ?? 200000);
const output = resolve(process.argv[3] ?? `fixtures/generated/polygons-${count}.geojson`);
if (!Number.isInteger(count) || count < 1 || count > 2000000) throw new Error('Şekil sayısı 1–2000000 arasında olmalı.');
await mkdir(resolve(output, '..'), { recursive: true });
const stream = createWriteStream(output);
stream.write('{"type":"FeatureCollection","features":[\n');
let bytes = 0;
for (let i = 0; i < count; i++) {
  const col = i % 1000, row = Math.floor(i / 1000);
  const x = 35 + col * .002, y = 38 + row * .002;
  // Detailed rings generate realistic geometry-heavy files rather than huge text properties.
  const ring = Array.from({ length: 24 }, (_, k) => {
    const angle = k / 24 * 2 * Math.PI;
    return [Number((x + Math.cos(angle) * .0007).toFixed(7)), Number((y + Math.sin(angle) * .0007).toFixed(7))];
  });
  ring.push([...ring[0]]);
  const text = `${i ? ',' : ''}${JSON.stringify({ type: 'Feature', id: i, properties: { name: `Test alanı ${i+1}`, kategori: 'Performans testi', not: 'Sentetik test verisidir.' }, geometry: { type: 'Polygon', coordinates: [ring] } })}\n`;
  bytes += Buffer.byteLength(text);
  if (!stream.write(text)) await once(stream, 'drain');
}
stream.end(']}'); await once(stream, 'finish');
console.log(`${count.toLocaleString('tr-TR')} poligon · ${(bytes / 1024 / 1024).toFixed(1)} MB\n${output}`);
