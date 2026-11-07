# Aşama 9B — Büyük sayısal ID ve property değerlerinin korunması

Tarih: 6 Kasım 2026. Başlangıç commit'i: `b908ddd`.
Depo: `/Users/apocrc/Desktop/GeoJSON-Polygon-Editor`.

## 1. Sonuç ve sınırlar

P1'in tekrarlandığı Local import ve API → tarayıcı → mutate yolları düzeltildi.
Büyük tamsayılar özgün sayı token'ından okunuyor, uygulama içinde gerektiğinde
`bigint` olarak taşınıyor ve HTTP/export üzerinde **tırnaksız JSON sayısı** olarak
yazılıyor. Önce yuvarlanmış bir `Number`'dan özgün değerin geri çıkarıldığı iddia
edilmiyor. İç içe nesneler/diziler, dış Feature ID'leri ve normal JSON türleri
korunuyor. Dahili Feature kimlikleri bu dönüşümden bağımsız kalıyor.

Keyfi hassasiyette bütün kesirler desteklenmiyor. Normal `number` olarak
geri yazıldığında sayısal değeri değişecek kesirler, taşma/underflow ve güvenli
aralık dışında önceden oluşturulmuş JavaScript `Number` değerleri açık hatayla
engelleniyor. Böyle bir işlem başarılı gösterilmiyor. Geometri koordinatları
harita için sonlu `number` olmalı; güvenle temsil edilemeyen koordinat/Z reddediliyor.
Bu sınırlar veri değiştirmek yerine güvenli başarısızlık sağlar.

**Son doğrulama:** 147 standart frontend testi + ayrıca çalıştırılan 1 büyük
dosya testi, 315 backend testi, 8 gerçek HTTP/tarayıcı entegrasyon testi başarılı.
TypeScript kontrolü ve Vite build başarılı. Eski 300 backend ve 5 entegrasyon
testi de bu sayılara dahildir. Commit, stage veya uzak Git işlemi yapılmadı.

**Geliştirme DB'si için önemli gözlem:** Testler ayrı geçici DB'lerde çalıştı.
Ancak açık geliştirme uygulaması varken gerçek DB dosyasının tamamen değişmeden
kaldığı söylenemez: 9A kopyasıyla karşılaştırmada iki yeni, boş workspace/dataset
bulundu. Önceden mevcut tüm satırlar, kayıtlı proje ve Feature'lar birebir aynı.
Aşağıdaki veri güvenliği bölümünde ayrıntılar bulunuyor; hiçbir kayıt silinmedi.

## 2. Kesin kök nedenler ve veri yolları

| Yol | İlk kayıp noktası | Düzeltme |
| --- | --- | --- |
| Local dosya import | Akış parser'ının sayısal token'ı doğrudan `Number` yapması | Tokenizer'ın sayısal callback'i özgün metni `parseJsonNumber` ile okur; akış/batch düzeni korunur. |
| API get/query → düzenleme | `Response.json()` içindeki standart sayı ayrıştırması | Yanıt metni, özgün token'ı gören `parseJson` ile ayrıştırılır. |
| JSON editörü / Inspector / Excel JSON hücresi | `JSON.parse` ile taslağın sayıya çevrilmesi | Ortak kayıpsız codec kullanılır. |
| Tablo hücresi | Büyük sayıyı görüntüleme ve düzenlemeyi normal sayı sanma | `bigint` görüntülenir; sayısal hücre özgün metinden ayrıştırılır; string hücre string kalır. |
| Local export / merge / HTTP mutate | Standart `JSON.stringify` bigint'i desteklemez; Number'a dönüşüm veri kaybettirir | Ortak serializer bigint'i tırnaksız sayı olarak yazar. |
| Backend üslü/ondalıklı sayı | `ijson.Decimal` → koşulsuz `float`; standart JSON parse_float | Özgün Decimal üzerinden tam tamsayı dönüşümü veya güvenli float roundtrip kontrolü. |
| Excel sayısal hücre | Kaynak Excel veya SheetJS sayısal değeri zaten yuvarlamış olabilir | Şüpheli 16+ basamaklı tamsayı hücresi reddedilir; metin olarak saklanan ID korunur. |

`JSON.parse('9007199254740993')` sonrasındaki yuvarlanmış değeri `BigInt` yapmak
çözüm değildir. Yeni yol **dönüşümden önceki token'ı** kullanır. Python'un normal
JSON tamsayıları ve mevcut SQLite `feature_json` metni bu beş örneği zaten tam
saklayabiliyordu; tarayıcıdan tekrar yazma kaybı ayrıca giderildi. Snapshot ve
R-Tree şemasının değiştirilmesi gerekmedi.

## 3. Seçilen kayıpsız yaklaşım

`lossless-json` **4.3.1** tam sürümle eklendi. Kütüphanenin ayrıştırma ve sayı
güvenliği yardımcıları kullanılıyor; özel sınıf örnekleri tüm uygulamaya
yayılmıyor. Seçim sırasında resmi [kütüphane belgeleri](https://github.com/josdejong/lossless-json/blob/main/README.md)
ve kurulu kaynak incelendi.

- Güvenli tamsayılar ve normal ondalıklar `number`; güvenli aralığın dışındaki
  tam sayılar `bigint`; metin ID'ler `string` kalır.
- Modern tarayıcıda `JSON.parse` reviver `context.source` ve `JSON.rawJSON`
  yetenekleri kontrol edilir. Eski ortamda kütüphane parser'ı ve küçük bir
  açık JSON serializer fallback'i kullanılır. İki yol ayrı test edilir.
- `BigInt.prototype.toJSON`, global `JSON.parse` veya `JSON.stringify`
  değiştirilmez. Worker structured clone ve IndexedDB bigint'i taşıyabilir;
  Local gerçek Chrome testi bunu kullanır.
- Kütüphane serializer'ının nesne işareti tanımasına güvenilmez: kullanıcı
  properties'inde `isLosslessNumber` veya `rawJSON` adında sıradan alan bulunabilir.
  Bunların kaybolmadığı fallback testi vardır.
- Mevcut frontend'in `__proto__` reddi korunur. Fallback parse öncesi kaçışları
  açılmış anahtarlar kontrol edilir; API import/validation da bu alanı sessizce
  kabul edip sonradan okunamayan dataset oluşturmaz.
- Sayı token uzunluğu 4096 ve serializer nesne derinliği 512 ile sınırlanır.
  Mevcut Feature/batch/boyut limitleri geçerlidir.
- `GeoFeature.id` türü `string | number | bigint` destekleyecek şekilde dar bir
  TypeScript alias değişikliği aldı. `GeoJsonRepository` metotları, HTTP alan
  adları ve `FeatureSummary.id` değişmedi. Ağdaki ID türü hâlâ JSON string/number.
- İki dosya/nesne arasında whitespace, anahtar sırası veya `1e0`/`1.0` yazımı
  aynı kalmak zorunda değildir; sayısal değer ve JSON türü korunur.

Örnek veri HTTP ve export sonunda şu şekilde kalır:

```json
{"type":"Feature","id":9007199254740993,"properties":{"exact":-9007199254740993,"nested":{"values":[9007199254740995,"9007199254740993",null,true,1.25]}},"geometry":{"type":"Point","coordinates":[29.125,41.25,12.5]}}
```

| Kaynak sayı metni | İç temsil | Export sayı metni |
| --- | --- | --- |
| `9007199254740991` | number | `9007199254740991` |
| `9007199254740992` | bigint | `9007199254740992` |
| `9007199254740993` | bigint | `9007199254740993` |
| `9007199254740995` | bigint | `9007199254740995` |
| `-9007199254740993` | bigint | `-9007199254740993` |

`"9007199254740993"` baştan string ise string kalır. Olmayan `feature.id`
oluşturulmaz; tekrar eden dış ID'ler yeniden numaralandırılmaz. Testler çıktıdaki
özgün token'ı, bigint'i ve Python tamsayısını kontrol eder; yalnız JS Number
eşitliğine dayanmaz.

## 4. Değiştirilen / eklenen dosyalar

Yeni dosyalar aşağıda `(yeni)` ile belirtilmiştir. 9B kapsamında 29 dosya vardır;
önceden mevcut, korunmuş `docs/STAGE9A_REPORT.md` bu sayıya dahil değildir.

### Frontend kaynakları — 15 dosya

- `src/domain/losslessJson.ts` (yeni)
- `src/domain/contracts.ts`
- `src/domain/editorDocument.ts`
- `src/domain/geoJsonValidation.ts`
- `src/adapters/local/losslessStream.ts` (yeni)
- `src/adapters/local/streamGeoJson.ts`
- `src/adapters/local/localEngine.ts`
- `src/adapters/api/ApiGeoJsonRepository.ts`
- `src/components/DocumentEditor.tsx`
- `src/components/FeatureTable.tsx`
- `src/components/FeatureList.tsx`
- `src/components/Inspector.tsx`
- `src/components/ImportDialog.tsx`
- `src/data/mergeImports.ts`
- `src/data/spreadsheetImport.ts`

### Backend kaynakları — 4 dosya

- `backend/app/domain/json_numbers.py` (yeni)
- `backend/app/domain/geojson.py`
- `backend/app/domain/streaming_geojson.py`
- `backend/app/services/geometry_validation.py`

### Bağımlılık, test ve rapor — 10 dosya

- `package.json`
- `package-lock.json`
- `backend/tests/test_json_numbers.py` (yeni)
- `tests/unit/losslessJson.test.ts` (yeni)
- `tests/unit/featureTablePending.test.tsx`
- `tests/unit/large-file.test.ts`
- `tests/integration/losslessNumbers.test.ts` (yeni)
- `tests/integration/losslessNumbers.browser.test.ts` (yeni)
- `tests/fixtures/project-management.vite.config.ts`
- `docs/STAGE9B_REPORT.md` (bu rapor, yeni)

`App.tsx`, harita/OpenLayers bileşenleri, CSS, `createRepository.ts`,
`docs/INTEGRATION.md`, proje snapshot servisleri ve migration'lar değişmedi.
ImportDialog'a Excel sayı sınırını açıklayan tek not eklendi. Tablo tarafındaki
8B bekleyen düzenleme bariyeri yeniden yazılmadı.

## 5. Testler ve kanıtlar

| Kontrol | Sonuç | Kanıt / kapsam |
| --- | --- | --- |
| Standart frontend paketi | 147 geçti; koşullu perf testi bu koşuda atlandı | 14 başarılı test dosyası; 3,38 sn |
| Koşullu büyük dosya testi | Ayrı çalıştırıldı, başarılı | 101,4 MB normal ve 10 MB büyük ID dosyaları; aşağıdaki ölçümler |
| Frontend toplam benzersiz test | 148 başarılı | 147 standart + 1 ayrı perf testi; tekrar koşular ek test sayılmaz |
| Backend | 315/315 başarılı | Önceki 300 + 15 sayı/yapı testi; son koşu 14,45 sn |
| Gerçek entegrasyon | 8/8 başarılı | 7 dosya; son koşu 39,16 sn; önceki 5 test + 3 yeni test |
| TypeScript / Vite | Başarılı | `npm run build` içindeki `tsc --noEmit`; Vite 2,95 sn |
| 8B kaydetme yarışı | Başarılı | Mevcut deterministik 0/200/650 ms gecikme senaryoları yeniden geçti |

Yeni testlerin doğruladıkları:

1. Native ve fallback codec yollarında beş tamsayının her biri; güvenli sayı,
   normal negatif/ondalık, string, boolean/null, iç içe nesne/dizi ve structured clone.
2. Local import → get → property düzenle → export; dış string/olmayan/tekrar eden
   ID ile dahili ID ayrımı; geometri/Z eşitliği. Chunk sınırını aşan sayı token'ı.
3. JSON editörü ve tablo sayısal alanına özgün metinle giriş. Sayısal 993 → 995
   ve negatif büyük sayı; string kontrolünün string kalması.
4. Gerçek FastAPI + SQLite + worker üzerinden import → get → mutate → query →
   export; kategori kataloğu, kullanılmayan kategori, geometry/Z/ID/properties.
5. Proje kaydetme → repository'yi yeniden oluşturma/yenileme → açma → tekrar
   kaydetme; önceki snapshot bağımsızlığı, version/revision ve 409 kontrolü.
6. Gerçek Chrome'da Local Worker/IndexedDB ve API ayrı testleri. Harita seçimi,
   tablo Enter (Local) veya hücreden doğrudan Kaydet (API), JSON editöründe
   uygulama, geçersiz kesir taslağında devre dışı Apply ve mevcut verinin korunması.
   API'de sayfa yenileme → Projelerim → Aç sonrasında aynı değerler doğrulandı.
7. API browser testinde SQLite snapshot içindeki `feature_json`, Python ile
   okunarak dış ID'nin `9007199254740993`, düzenlenen property'nin
   `-9007199254740993` olduğu doğrulandı. Koordinatlar ve iç içe sayılar da eşleşti.
8. Backend'te unsupported kesir/koordinat/Z istekleri ve `__proto__` güvenli
   reddedildi; hatalı mutate/import aktif dataset/revision'ı değiştirmedi.
9. Excel metin ID, JSON hücresi ve normal property türleri korundu; güvensiz
   sayısal Excel hücreleri açık hata verdi. Önceden yuvarlanmış veri onarılmadı.

Gerçek Chrome: 157.0.8103.38, 1400×1000. Büyük sayı testleri küçük beş Polygon
örneğidir; bu sonuçlar 100 MB gerçek tarayıcı performansı olarak sunulmuyor.
Safari/Firefox ve mobil cihazda yeni codec'in gerçek cihaz testi yapılmadı;
fallback birim testleri gerçek cihaz testinin yerine geçmez.

Bir ilk entegrasyon koşusunda Vite soğuk cache'inde Worker'ın `rbush`
bağımlılığını sonradan optimize ettiği ve sayfayı yeniden yüklediği loglandı.
Test Vite fixture'ına `lossless-json` ve `rbush` açık prebundle listesi eklendi.
Sabit bekleme veya hatayı gizleyen retry eklenmedi. Sonrasında iki tam 8/8 koşu
geçti. Ürün Vite ayarı değiştirilmedi.

## 6. Büyük dosya performansı ve bellek

Donanım: Apple M2, 8 çekirdek, 8 GiB RAM; macOS 26.6.2; Node 24.11.0,
Python 3.13.5; SQLite 3.49.1. Açık kullanıcı servisleri durdurulmadı. OS cache,
GC ve sistem yükü kontrol altında değildir; az sayıda sıralı ölçüm SLA değildir.

### Local motor: Node + fake-indexeddb

Bu tablo **gerçek Chrome performansı değildir**. Karşılaştırma için `b908ddd`
kaynağı `git archive` ile geçici klasöre okundu; dal/checkout değiştirilmedi.
Aynı veri ve bağımlılık ortamında çalıştırıldı. Baseline'ın yalnız geçici test
ölçümüne ayrı export zamanlayıcısı eklendi, ürün kaynaklarına dokunulmadı.

Normal fixture: **101.396.107 byte = 101,40 MB = 96,70 MiB**, 140.000 Polygon,
3.500.000 vertex. Büyük sayı fixture: **10.000.053 byte**, 13.235 karma Feature,
66.176 vertex; ID, `exact` ve iç içe dizilerde beş sayı tekrarlanır.

| Kaynak / veri | Import sn | Export sn | Toplam sn | Tepe süreç ağacı RSS MiB | Örneklenmiş CPU sn |
| --- | ---: | ---: | ---: | ---: | ---: |
| b908ddd, normal 101,40 MB | 8,79 | 7,47 | 27,10 | 1449,50 | 31,23 |
| 9B son çözüm, aynı normal dosya | 9,51 | 6,45 | 28,75 | 1204,94 | 31,98 |
| 9B son çözüm, büyük ID 10 MB | 0,71 | 0,52 | 2,06 | 859,63 | 3,50 |

Toplam süre import/export dışında viewport, iki akışlı hash doğrulaması ve test
işlerini de içerir; import + export toplamı değildir. Her Feature'ın semantik
hash'i eşleşti; viewport 2500 kayıtla sınırlı kaldı. Büyük sayı koşusu ayrıca
ilk dış ID'nin tam bigint olduğunu doğruladı. İlk iki yanlış geçici dosya yolu
ile biten harness denemesi performans örneğine dahil edilmedi; doğru kaynak
yoluyla yukarıdaki koşular başarıyla tamamlandı.

Son eşleştirilmiş ölçümde import yaklaşık **%8**, toplam süre **%6** arttı.
Diğer optimize edilmiş eşleştirmede import 8,09 → 9,66 sn, toplam 24,44 →
29,49 sn idi: yaklaşık **%19 / %21** artış. Dolayısıyla çözümün sıfır maliyetli
olduğu söylenemez. İlk uygulamadaki 11,75 sn import / 37,53 sn toplam maliyeti,
normal veride gereksiz serializer replacer/nesne tahsislerini azaltarak düşürüldü.
Gözlenen RSS daha düşük olsa da GC/cache etkisi nedeniyle garantili bellek
iyileşmesi veya export hızlanması iddia edilmiyor. Büyük ID 10 MB ve normal
101 MB aynı iş yükü değildir; doğrudan hız oranı çıkarılmamalıdır.

RSS 50 ms aralıkla süreç ağacından örneklendi; ortak bellek iki kez sayılabilir,
anlık zirveler kaçabilir. 2,2 GiB RSS / 384 MiB kullanılabilir RAM gözetimi hiçbir
geçerli koşuyu kesmedi. Local fake-indexeddb testi yaklaşık 1,2 GiB tepe
gösterebildiği için düşük RAM cihazlarda Local büyük dosya sınırı devam eder.

### Gerçek localhost API + worker

Normal veri: **10.000.010 byte**, 16.320 Feature, 81.600 vertex. Büyük ID verisi
yukarıdaki 10 MB karma dosyadır. Worker süresi parse/validasyon/batch SQL ve
job ilerlemesini içerir; saf SQLite disk süresi değildir.

| Kaynak / veri | Worker sn | HTTP export sn | API tepe RSS MiB | Worker ağacı tepe RSS MiB | API+worker CPU sn |
| --- | ---: | ---: | ---: | ---: | ---: |
| b908ddd, normal 10 MB | 8,85 | 3,26 | 103,20 | 186,53 | 12,65 |
| 9B, aynı normal 10 MB | 8,26 | 2,85 | 103,14 | 187,83 | 11,99 |
| 9B, büyük ID 10 MB | 7,10 | 2,32 | 104,45 | 188,31 | 10,39 |

Bu küçük örneklemde önemli API bellek artışı görülmedi; sayısal kontrolün
her yükte hızlandırdığı sonucuna varılamaz. Bütün Feature hash'leri ve metadata
eşleşti; geçici DB'lerde integrity/foreign key/R-Tree kontrolleri geçti. 9B'de
50/100/200 MB sunucu matrisi veya büyük veri Chrome performansı tekrar
çalıştırılmadı; 9A'nın sonuçları yeni codec için yeniden ölçülmüş sayılmıyor.

## 7. Desteklenmeyen durumlar ve kullanım gereklilikleri

- `0.123456789012345678901` gibi normal Number'a kayıpsız dönemeyen kesirler
  otomatik string yapılmaz: işlem açık hatayla reddedilir. `1e999`, underflow,
  güvensiz tamsayı koordinat/Z ve limit aşımı da reddedilir.
- `.0`/üslü yazılmış, desteklenen sınırlar içindeki tam büyük sayılar tam sayısal
  değer olarak korunur; özgün yazım biçimi korunmak zorunda değildir.
- Önceden JS Number olarak gelen güvensiz tamsayı reddedilir. Zaten yuvarlanıp
  **güvenli aralık içinde** görünen eski değerlerde kayıp her zaman anlaşılamaz.
  Kaynak dosya olmadan orijinal değer tahmin edilmez.
- Excel'in yaklaşık 15 basamak sayısal sınırı nedeniyle 16+ basamaklı tamsayı
  sayısal hücresi (güvenli Number gibi görünse bile) engellenir. ID'yi kaynakta
  **metin hücresi** olarak tutmak gerekir. Kaynakta daha önce yuvarlanmış sayı,
  formül sonucu veya normal aralıktaki yuvarlanmış ondalık geri getirilemez.
- Bu değişiklik önceden kaydedilmiş bozuk verileri otomatik düzeltmez. Yeni
  kodun dışında başka istemci standart `JSON.parse` kullanırsa aynı riski taşır.
- Dahili bigint içeren GeoFeature'ı yeni bir özellikte ham `JSON.stringify`
  ile işlememek gerekir; ortak codec kullanılmalıdır.
- Mevcut uygulama tekil JSON taslak boyutu, Feature/batch/metadata sınırları ve
  topolojik kontrol politikası geçerlidir. Otomatik geometri düzeltme yoktur.
- **FastAPI, ayrı import worker ve Vite yeniden başlatılmalı; tarayıcı tam
  yenilenmelidir.** Worker kodu hot reload olmaz; HMR'dan kalmış repository
  örnekleri eski modülleri kullanabilir. Testler yeni süreçlerle çalıştırıldı.

## 8. Veri güvenliği, Git ve geçici çıktılar

Tüm otomatik test/benchmark SQLite dosyaları ve yüklemeleri geçici dizinlere
yönlendirildi. Geliştirme DB'sine test fixture'ı yazılmadı, migration çalıştırılmadı;
schema/migration değişikliği yok. Açık gerçek API/worker/Vite süreçleri
durdurulmadı veya yeniden başlatılmadı.

Gerçek DB'nin dosya hash'i 9A ile farklıydı. DB/WAL/SHM dosyaları yalnız okunup
kararlı bir geçici kopya alındı; SQLite karşılaştırması **kopyada** yapıldı.
`projects`, `features`, `categories`, `subcategories`, `jobs` ve önceki tüm
`workspaces`/`datasets` satırları aynıydı. Bir kayıtlı proje ve beş Feature korundu.
Eklenenler yalnız iki boş workspace ve bunların iki boş dataset'i, revision 0:
UTC `2026-11-06 17:55:25.439166` ve `18:21:22.602681`.

Bu zamanlar kaynak geliştirme/HMR yenilenmeleriyle uyumlu; hangi HTTP istemcisinin
oluşturduğu logla kanıtlanmadı. Bu nedenle “gerçek DB hiç değişmedi” denmiyor.
Mevcut satırların değişmediği karşılaştırmayla doğrulandı. Boş kayıtları temizlemek
için gerçek DB'den hiçbir şey silinmedi veya eski yedeğe dönülmedi.

Ham ölçüm ve test kanıtları `/private/tmp/geojson-stage9b/` altında; Git'e
eklenmedi. Özellikle:

- `frontend-optimized.log`, `backend-verified.log`, `integration-release-check.log`,
  `build-verified.log`
- `node-baseline-export.log`, `node-final-export.log`, `node-bigint-final.log`
  ve karşılık gelen `*-resources.json`
- `result-10-normal.json`, `result-10-bigint.json`,
  `baseline-bench/result-10-normal.json`
- `user-db-existing-rows.json`, `user-db-logical-comparison.json`,
  `additional-workspace-metadata.json`

Git: `abdullah-backend`, upstream `origin/abdullah-backend`, HEAD `b908ddd`.
29 adet 9B dosyası ve korunmuş 9A raporu ile toplam 30 bekleyen dosya vardır.
Stage alanı boş; commit/push/fetch/pull/merge/rebase yapılmadı. `.env`, SQLite,
WAL, `.venv`, node_modules ve ölçüm çıktıları izlemeye eklenmedi.

## 9. Mac üzerinde izole manuel doğrulama

Önce açık kullanıcı servislerindeki kodun eski olabileceğini dikkate alın.
Aşağıdaki alternatif portlar/geçici DB ile kullanıcı projelerinden ayrı test
yapılabilir. Diğer terminallerde **aynı geçici DB yolunu** kullanın.

Terminal 1 — backend:

```bash
cd /Users/apocrc/Desktop/GeoJSON-Polygon-Editor/backend
export GEOJSON_DATABASE_PATH="$(mktemp -d /private/tmp/geojson-9b-manual.XXXXXX)/projects.db"
export GEOJSON_CORS_ORIGINS='["http://127.0.0.1:5175"]'
echo "$GEOJSON_DATABASE_PATH"
.venv/bin/python -m alembic upgrade head
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8100
```

Terminal 2 — yukarıdaki `echo` çıktısını birebir kullanarak worker:

```bash
cd /Users/apocrc/Desktop/GeoJSON-Polygon-Editor/backend
export GEOJSON_DATABASE_PATH='/private/tmp/geojson-9b-manual.XXXXXX/projects.db'
.venv/bin/python -m app.workers.import_worker
```

Buradaki `XXXXXX` bir örnektir; Terminal 1'de üretilen gerçek dizinle değiştirin.

Terminal 3 — API frontend:

```bash
cd /Users/apocrc/Desktop/GeoJSON-Polygon-Editor
npm install
VITE_DATA_SOURCE=api VITE_PROJECT_MANAGEMENT=true VITE_API_BASE_URL=http://127.0.0.1:8100 npm run dev -- --port 5175 --strictPort
```

Tarayıcı: `http://127.0.0.1:5175`. Swagger: `http://127.0.0.1:8100/docs`.
Küçük test dosyası bu çalışma sırasında
`/private/tmp/geojson-stage9b/manual-integers.geojson` konumunda hazırlandı;
geçici dizin temizlenirse aynı beş sayı ile yeniden oluşturulmalıdır.

1. Dosyayı import edin. `exact` alanında beş özgün sayıyı, string ID kontrolünü
   ve Z koordinatlarını inceleyin.
2. Tablo sayısal hücresindeki `9007199254740993` değerini
   `9007199254740995` yapıp Enter'a basmadan Kaydet'e tıklayın. Kaydedin,
   yenileyin, Projelerim'den açın; son değer korunmalı.
3. JSON editöründe property'yi `-9007199254740993` ve iç içe sayısal diziyle
   güncelleyip uygulayın. Normal ondalık/boolean/null/string alanları korunmalı.
4. Export dosyasını **metin editöründe** inceleyin: büyük sayılar tam ve
   tırnaksız; baştan string olan ID tırnaklı olmalı. Standart JS JSON.parse ile
   kontrol etmek ölçümün kendisinde yeniden yuvarlama oluşturabilir.
5. `0.123456789012345678901` gibi desteklenmeyen kesri taslağa yazın: hata
   görünmeli, Apply engellenmeli, önceki kayıt değişmemeli. Taslağı açıkça geri alın.
6. Excel'de büyük ID'yi metin hücresinde deneyin; korunmalı. 16+ basamaklı
   sayısal hücrede açık hassasiyet uyarısı bekleyin; onarım iddiası olmamalı.
7. Vite'ı durdurup aynı portta `VITE_DATA_SOURCE=local npm run dev -- --port
   5175 --strictPort` ile Local akışı tekrar edin. API workspace'i ile Local
   verisinin otomatik taşınması beklenmez.

Test bitince yalnız bu üç test terminalindeki süreçleri Ctrl+C ile durdurun.
Gerçek kullanıcı DB/WAL dosyalarını silmeyin. Bu aşamada sonraki geliştirmeye
geçilmedi; değişiklikler inceleme için commit edilmeden bırakıldı.
