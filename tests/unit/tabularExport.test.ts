import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { read, utils } from 'xlsx';
import { convertTabularExport, type TabularFormat } from '../../src/data/tabularExport';
import { parseJson } from '../../src/domain/losslessJson';

const source = new Blob([`{"type":"FeatureCollection","features":[
 {"type":"Feature","id":9007199254740993,"properties":{"name":"İğdır, \\"Köy\\"","ana_kategori":"Arazi","alt_kategori":"Çayır","exact":-9007199254740995,"details":{"array":[9007199254740995,"ı"]},"formula":" =HYPERLINK(\\"https://example.invalid\\")","line":"1. satır\\n2. satır"},"geometry":{"type":"Point","coordinates":[28.9784,41.0082,13]}},
 {"type":"Feature","id":"00042","properties":{"onlySecond":true,"fullwidth":"＝1+1"},"geometry":null},
 {"type":"Feature","id":-9007199254740993,"properties":null,"geometry":null},
 {"type":"Feature","properties":null,"geometry":null}
]}`]);

async function fileContents(format: TabularFormat, geojson = source) {
  const dir = await mkdtemp(join(tmpdir(), 'tabular-export-'));
  try {
    const output = await convertTabularExport(geojson, format);
    const file = join(dir, `shapes.${format}`);
    await writeFile(file, Buffer.from(await output.arrayBuffer()));
    return await readFile(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

it('writes an Excel workbook with explicit text IDs, original geometry, properties and no formulas', async () => {
  const bytes = await fileContents('xlsx');
  const workbook = read(bytes);
  expect(workbook.SheetNames).toEqual(['Nesneler']);
  const sheet = workbook.Sheets.Nesneler;
  expect(sheet.A1.v).toBe('Nesne ID');
  expect(sheet.A2).toMatchObject({ t: 's', v: '9007199254740993' });
  expect(sheet.A3).toMatchObject({ t: 's', v: '00042' });
  expect(sheet.A4).toMatchObject({ t: 's', v: '-9007199254740993' });
  expect(sheet.A5.v).toBe('');
  expect(sheet.C2.v).toBe('İğdır, "Köy"');
  expect(sheet.D2.v).toBe('Arazi');
  expect(sheet.E2.v).toBe('Çayır');
  expect(JSON.parse(sheet.F2.v).coordinates).toEqual([28.9784, 41.0082, 13]);
  expect(sheet.F3.v).toBe('null');
  expect(parseJson(sheet.G2.v)).toMatchObject({ exact: -9007199254740995n, details: { array: [9007199254740995n, 'ı'] } });
  expect(Object.values(sheet).some(cell => cell?.f)).toBe(false);
  expect(Object.values(sheet)).toContainEqual(expect.objectContaining({ t: 's', v: ' =HYPERLINK("https://example.invalid")' }));
  expect(Object.values(sheet)).toContainEqual(expect.objectContaining({ t: 's', v: '-9007199254740995' }));
});

it('writes UTF-8 CSV with quoted cells, untouched digits and neutralized formula-like strings', async () => {
  const bytes = await fileContents('csv');
  expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
  expect(bytes.toString('utf8')).toContain('"İğdır, ""Köy"""');
  expect(bytes.toString('utf8')).toContain('"\t =HYPERLINK(""https://example.invalid"")"');
  expect(bytes.toString('utf8')).toContain('"\t＝1+1"');
  expect(bytes.toString('utf8')).toContain('"1. satır\n2. satır"');
  const parsed = read(bytes, { raw: true, FS: ',' });
  const rows = utils.sheet_to_json<string[]>(parsed.Sheets[parsed.SheetNames[0]], { header: 1, defval: '' });
  expect(rows.map(row => row[0])).toEqual(['Nesne ID', '9007199254740993', '00042', '-9007199254740993', '']);
  expect(rows[1].slice(1, 6)).toEqual(['Point', 'İğdır, "Köy"', 'Arazi', 'Çayır', '{"type":"Point","coordinates":[28.9784,41.0082,13]}']);
  expect(parseJson(rows[1][6])).toMatchObject({ exact: -9007199254740995n });
  expect(rows[2][rows[0].indexOf('Öznitelik: onlySecond')]).toBe('true');
  expect(rows[1][rows[0].indexOf('Öznitelik: onlySecond')]).toBe('');
});

it('reports the Excel character limit instead of truncating data', async () => {
  const oversized = new Blob([JSON.stringify({ type: 'Feature', properties: { payload: 'ı'.repeat(32_768) }, geometry: null })]);
  await expect(convertTabularExport(oversized, 'xlsx')).rejects.toThrow('32.767 karakteri');
  const csv = await fileContents('csv', oversized);
  expect(csv.toString('utf8')).toContain('ı'.repeat(32_768));
});

it('handles an empty dataset with a header row', async () => {
  const bytes = await fileContents('xlsx', new Blob(['{"type":"FeatureCollection","features":[]}']));
  const workbook = read(bytes);
  expect(workbook.Sheets.Nesneler['!ref']).toBe('A1:G1');
});

it('rejects excessive property columns without silently dropping them', async () => {
  const properties = Object.fromEntries(Array.from({ length: 257 }, (_, i) => ['property' + i, i]));
  const geojson = new Blob([JSON.stringify({ type: 'Feature', properties, geometry: null })]);
  await expect(convertTabularExport(geojson, 'csv')).rejects.toThrow('256 ayrı özniteliği');
});
