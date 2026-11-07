# Kurulum, işletim ve güvenli teslim rehberi

## Bağımsız Python ortamı kurulumu

Proje kökünde Node.js 22.12+ veya 24 LTS ile `npm ci` çalıştırın.
Local mod yalnız Node ve Vite kullanır. API ve import worker için
**Python 3.13.18 / SQLite 3.53.1** gerekir. Python'un kendi `sqlite3`
kitaplığını başlangıçta başlatıcı doğrular.

Bu Mac'te 10B-2 kurulumu hazırdır. Proje kökünde yolu doğrulayın.

~~~bash
bash scripts/run-backend.sh python-path
~~~

Başka bir Mac'te uv 0.13.7 ve ağ erişimiyle aşağıdaki adımları proje
kökünden çalıştırın. Kurulum Apple Silicon macOS üzerinde doğrulandı.
Dizin kullanıcıya özeldir. Yeni dizinde oluşturulan venv o dizinde kalır.
Var olan bir kurulum için yukarıdaki kontrolü kullanın.

~~~bash
(
  set -eu
  runtimes="$HOME/Library/Application Support/GeoJSONEditor/Runtimes"
  runtime_dir="$runtimes/cpython-3.13.18-sqlite-3.53.1"
  mkdir -p "$runtimes"
  mkdir "$runtime_dir"
  uv python install 3.13.18 --install-dir "$runtime_dir/python" --no-bin --no-config --cache-dir "$runtime_dir/cache"
  base_python="$(UV_PYTHON_INSTALL_DIR="$runtime_dir/python" uv python find --managed-python --no-config --cache-dir "$runtime_dir/cache" 3.13.18)"
  "$base_python" -I -B -c 'import sqlite3,sys; print(sys.version, sqlite3.sqlite_version); assert sys.version_info[:3] == (3,13,18) and sqlite3.sqlite_version == "3.53.1"'
  uv venv "$runtime_dir/venv" --python "$base_python" --no-config --cache-dir "$runtime_dir/cache"
  uv pip install --python "$runtime_dir/venv/bin/python" --requirements backend/pyproject.toml --extra dev --constraint backend/constraints/sqlite-runtime-10b.txt --link-mode copy --no-config --cache-dir "$runtime_dir/cache"
  uv pip check --python "$runtime_dir/venv/bin/python" --no-config --cache-dir "$runtime_dir/cache"
  bash scripts/run-backend.sh python-path
)
~~~

Başka bir konum seçtiyseniz her backend/test terminalinde
`GEOJSON_RUNTIME_PY` değişkenine Python çalıştırılabilir dosyasının **mutlak
yolunu** verin. Yol boşluk içerebilir.

~~~bash
export GEOJSON_RUNTIME_PY="$HOME/Benim Runtime Dizim/venv/bin/python"
bash scripts/run-backend.sh python-path
~~~

Uyumsuz veya bulunamayan runtime başlatmayı hata ile durdurur.
`backend/.venv` eski ortam olarak yerinde durur. Python 3.13.5 /
SQLite 3.49.1 ortamı uygulamayı başlatmak için uygun değildir.
[10B-2 doğrulaması](STAGE10B_RUNTIME_REPORT.md) ·
[SQLite WAL-reset açıklaması](https://sqlite.org/wal.html)

## Üç terminalle başlatma

Her terminali proje kökünden başlatın. Aşağıdaki yol ayrı bir deneme
veritabanıdır. Başlatıcı `GEOJSON_DATABASE_PATH` için açık bir mutlak yol
ister. API ve worker aynı yolu kullanır. `migrate` açık bir işlemdir ve
`api` komutunun parçası değildir.

Terminal 1, FastAPI ve deneme DB'sinin migration'ı

~~~bash
export GEOJSON_DATABASE_PATH="$HOME/Library/Application Support/GeoJSONEditor/ManualCheck/projects.db"
export GEOJSON_CORS_ORIGINS='["http://127.0.0.1:5173"]'
bash scripts/run-backend.sh migrate && bash scripts/run-backend.sh api
~~~

Terminal 2, import worker

~~~bash
export GEOJSON_DATABASE_PATH="$HOME/Library/Application Support/GeoJSONEditor/ManualCheck/projects.db"
bash scripts/run-backend.sh worker
~~~

Terminal 3, Vite API modu

~~~bash
VITE_DATA_SOURCE=api VITE_API_BASE_URL=http://127.0.0.1:8000 VITE_PROJECT_MANAGEMENT=true npm run dev -- --port 5173 --strictPort
~~~

Arayüz [127.0.0.1:5173](http://127.0.0.1:5173), API [sağlık](http://127.0.0.1:8000/api/v1/health)
ve [Swagger](http://127.0.0.1:8000/docs) adreslerinden açılır.
`--strictPort` Vite portunu sabit tutar. CORS için `localhost` ve
`127.0.0.1` farklı origin'lerdir. API ile worker farklı DB'lere bakarsa import
sırada kalır. Yüklemeler seçilen DB'nin dizinindeki `imports/` altında tutulur.

Kayıtlı kullanıcı DB'si için ayrıca doğru yolu seçin ve migration öncesi yedek
alın. Her çalıştırmada temiz bir deneme isterseniz birinci terminalde
`mktemp -d "${TMPDIR:-/tmp}/geojson-acceptance.XXXXXX"` ile dizin oluşturun
ve çıkan yolun sonuna `/projects.db` ekleyip iki terminalde de kullanın.
[Yedekleme ve geri yükleme](#yedekleme-ve-geri-yükleme)

## Local ve API modu

~~~bash
VITE_DATA_SOURCE=local npm run dev -- --port 5173 --strictPort
~~~

Varsayılan Local mod tarayıcı Worker ve IndexedDB kullanır. API modu
FastAPI ve SQLite kullanır. `VITE_PROJECT_MANAGEMENT` varsayılan olarak
`false` değerindedir. Kaydet ve Projelerim için API modu ile birlikte
`true` verin. API'ye bağlanılamadığında bağlantı hatası gösterilir.
Vite ayarları başlangıç ve build sırasında okunur. `VITE_*` değişkenleri
tarayıcıya açıktır. `.env.example` örnek ayarları gösterir.

Uygulama tek kullanıcılı ve yerel kullanım içindir. FastAPI başlatıcısı
loopback adresini varsayılan alır. CORS yetkilendirme sağlamaz.
Kod güncellemesinden önce aktif importu tamamlayın veya iptal edin. API, worker
ve Vite'ı kendi terminallerinde Ctrl+C ile durdurup yeniden başlatın.
`worker --once` tek bakım/iş alma turu yapar.

## Eski ortama dönüş

Deneme bitince üç terminali Ctrl+C ile durdurun. Local moda dönmek için
yukarıdaki Local Vite komutunu kullanın. Önceki sanal ortamın sürümünü
aşağıdaki komutla inceleyebilirsiniz. SQLite 3.49.1 ile gerçek kullanıcı
DB'sinde API veya worker çalıştırmayın.

~~~bash
backend/.venv/bin/python -c 'import sqlite3,sys; print(sys.version, sqlite3.sqlite_version)'
~~~

## Veri ve proje akışı

- İlk açılış veya sayfa yenileme yeni boş workspace oluşturur.
- Kaydet, çalışma dataset'inden bağımsız snapshot üretir. Sonraki çizimler eski
  snapshot'ı değiştirmez. Farklı Kaydet ayrı proje kaydıdır.
- Projelerim → Aç yeni düzenlenebilir workspace oluşturur; eski seçim ve geçmiş
  temizlenir. Başarısız açmada mevcut çalışma korunur.
- Dataset revision ile project.version farklıdır. 409'da yeniden kaydetme
  otomatik tekrarlanmaz; karşı tarafın sürümünü/çalışmanızı karşılaştırın.
- Tablo hücresinden doğrudan Kaydet önce hücre değişimini tamamlar. Hücre hatası
  varsa proje başarılı kaydedilmiş gösterilmez.
- Geçersiz/uygulanmamış JSON taslağını uygulayın veya açıkça geri yükleyin.
  Taslak snapshot'a dahil edilmez. Yarım çizimi tamamlayın ya da Escape kullanın.
- Ctrl/Cmd+S dosya export'udur. Otomatik save veya otomatik proje açma yoktur.
- Sayfa yenilemeden önce projeyi kaydedin; yenilemeden sonra Projelerim'den açın.
- Workspace/dataset/job kayıtları için otomatik genel arşiv temizleme politikası
  yoktur; DB büyümesi izlenmelidir. Elle SQL silme önerilmez.

GeoJSON örneği:

~~~json
{"type":"FeatureCollection","category_catalog":[{"name":"Arazi","subcategories":["Park"]}],"features":[{"type":"Feature","id":9007199254740993,"properties":{"name":"Deneme","exact":9007199254740993,"ana_kategori":"Arazi","alt_kategori":"Park"},"geometry":{"type":"Polygon","coordinates":[[[29,41,7],[29.01,41,8],[29.01,41.01,9],[29,41,7]]]}}]}
~~~

Bu metni .geojson dosyası olarak kaydedip İçe aktar ile açın. Export'u metin
editöründe karşılaştırın; standart JavaScript JSON.parse ile karşılaştırma
yapmak ölçüm sırasında yeniden yuvarlama oluşturabilir.

Excel koordinat örneği:

| İsim | Enlem | Boylam | Dış kimlik (metin hücresi) |
| --- | --- | --- | --- |
| Deneme parkı | 41.0 | 29.0 | 9007199254740993 |

Enlem/Boylam eşleştirmesi Point üretir. Polygon/MultiPolygon için GeoJSON veya
WKT hücresi kullanın. Başka sütunlar properties'e eklenir. Formüller çalıştırılmaz;
kaydedilmiş sonuç gerekir. Hatalı satır varsa dönüştürme tamamlanmış sayılmaz.
Kaynakta yuvarlanmış Excel sayısı geri getirilemez; büyük ID'yi sonradan metne
çevirmek kaybolan basamakları geri getirmez.

## Test ve doğrulama

Proje kökünde:

~~~bash
npm test
VITE_DATA_SOURCE=local VITE_PROJECT_MANAGEMENT=false npm run build
RUN_BROWSER_INTEGRATION=1 ./node_modules/.bin/vitest run --config tests/api.integration.config.ts
~~~

Backend:

~~~bash
runtime_python="$(bash scripts/run-backend.sh python-path)" &&
  (cd backend && "$runtime_python" -m pytest -q)
~~~

Tarayıcı paketi gerçek Google Chrome çalıştırır. macOS Chrome uygulama yolu ve
doğrulanmış bağımsız Python gerekir. Ayrı profil/port/DB kullanır. Başka işletim sisteminde
Chrome yolunun uyarlanması gerekebilir. Fiziksel iPhone/Android testinin yerine
geçmez. Tarayıcı opt-in olmadan atlanan testleri geçti saymayın.

Büyük Local dosya:

~~~bash
npm run generate:large -- 140000
PERF_FILE="$PWD/fixtures/generated/polygons-140000.geojson" npm test -- tests/unit/large-file.test.ts
~~~

Node + fake-indexeddb kullanır. Kaynak dosya yoksa koşul atlanır; bu sonuç
tarayıcı hızını ölçmez. PERF_EXACT_INTEGER_EXPECTED değişkeni verilirse ilk
Feature'ın büyük tamsayı ID'si ayrıca kontrol edilir.

İzole büyük sunucu benchmark'ı:

~~~bash
runtime_python="$(bash scripts/run-backend.sh python-path)" &&
  (cd backend && "$runtime_python" scripts/benchmark_import.py --mib 105 --report /private/tmp/geojson-import-benchmark.json)
runtime_python="$(bash scripts/run-backend.sh python-path)" &&
  (cd backend && "$runtime_python" scripts/benchmark_viewport.py --features 100000 --report /private/tmp/geojson-viewport-benchmark.json)
~~~

Benchmark'lar kendi geçici DB'lerini kullanır; raporu Git'e eklemeyin.
Boyut/geometry sayısı/RAM farkı nedeniyle tek ölçümü kapasite garantisi saymayın.
API modu proje ekranları açık build:

~~~bash
VITE_DATA_SOURCE=api VITE_API_BASE_URL=http://127.0.0.1:8000 VITE_PROJECT_MANAGEMENT=true npm run build
~~~

Migration durumunu **test DB'sinde** kontrol etmek için aynı GEOJSON_DATABASE_PATH
ile doğrulanmış Python yolundan `python -m alembic current` / `heads` kullanın. Güncel head 0003_spatial_index'tir.
Proje tablolarını elle SQL veya Base.metadata.create_all ile yeniden kurmayın.

## Yedekleme ve geri yükleme

Önce yeni kullanıcı işlemlerini durdurun, importu tamamlayın/iptal edin, ardından
Vite, API ve worker'ı kendi terminallerinde Ctrl+C ile durdurun. Böylece job
dosyaları ve DB aynı uygulama durumunu temsil eder. WAL içindeki commit'ler
nedeniyle çalışan DB'nin yalnız projects.db dosyasını kopyalamak yeterli
olmayabilir; WAL/SHM'yi elle silmeyin. [SQLite WAL açıklaması](https://sqlite.org/wal.html#the_wal_file).

Aşağıdaki yöntem yeni bir yedek dizini oluşturur, SQLite backup API'siyle DB
snapshot'ı alır ve imports/ dosyalarını kopyalar. Orijinal DB'nin üstüne yazmaz.
[SQLite Backup API](https://sqlite.org/backup.html).

Proje kökünde kaynağın yolunu açıkça verin.

~~~bash
export GEOJSON_BACKUP_SOURCE="$PWD/backend/var/database/projects.db"
export GEOJSON_BACKUP_ROOT="$HOME/GeoJSON-Backups"
runtime_python="$(bash scripts/run-backend.sh python-path)" && \
  "$runtime_python" - <<'PY'
import os, sqlite3, shutil, tempfile
from pathlib import Path
source = Path(os.environ["GEOJSON_BACKUP_SOURCE"]).expanduser().resolve()
assert source.is_file(), "Kaynak DB bulunamadı; boş DB oluşturulmayacak."
root = Path(os.environ["GEOJSON_BACKUP_ROOT"]).expanduser()
root.mkdir(parents=True, exist_ok=True)
destination = Path(tempfile.mkdtemp(prefix="geojson-backup-", dir=root))
with sqlite3.connect(source.as_uri()+"?mode=ro", uri=True) as src:
    with sqlite3.connect(destination/"projects.db") as dst:
        src.backup(dst)
        assert dst.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert dst.execute("PRAGMA foreign_key_check").fetchall() == []
        assert dst.execute("SELECT rtreecheck('feature_rtree')").fetchone()[0] == "ok"
if (source.parent/"imports").exists():
    shutil.copytree(source.parent/"imports", destination/"imports")
print(destination)
PY
~~~

Yedek de gerçek veri içerir; erişimini sınırlayın, Git'e yüklemeyin ve ayrı
güvenli yerde tutun. Disk dolması/başarısız kontrol halinde yedeği geçerli saymayın.

Geri yükleme için yeni bir dizin oluşturun. Komutları proje kökünde çalıştırın.

~~~bash
export GEOJSON_RESTORE_SOURCE='/yedegin/gercek/dizini'
export GEOJSON_RESTORE_ROOT="$HOME/GeoJSON-Restored"
runtime_python="$(bash scripts/run-backend.sh python-path)" && \
  "$runtime_python" - <<'PY'
import os, shutil, sqlite3, tempfile
from pathlib import Path
source = Path(os.environ["GEOJSON_RESTORE_SOURCE"]).expanduser().resolve()
assert (source/"projects.db").is_file(), "Yedek DB yok."
root = Path(os.environ["GEOJSON_RESTORE_ROOT"]).expanduser()
root.mkdir(parents=True, exist_ok=True)
restored = Path(tempfile.mkdtemp(prefix="geojson-restored-", dir=root))
shutil.copy2(source/"projects.db", restored/"projects.db")
if (source/"imports").exists():
    shutil.copytree(source/"imports", restored/"imports")
with sqlite3.connect((restored/"projects.db").as_uri()+"?mode=ro", uri=True) as c:
    assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert c.execute("PRAGMA foreign_key_check").fetchall() == []
    assert c.execute("SELECT rtreecheck('feature_rtree')").fetchone()[0] == "ok"
print(restored/"projects.db")
PY
~~~

Kontrol edilen kopyayı API ve worker'a aynı GEOJSON_DATABASE_PATH ile vererek
önce ayrı test portlarında açın. Orijinal DB ve eski yedekleri koruyun. Kopyayı
doğruladıktan sonra kullanıcı servislerini bu yeni yol ile başlatmak mümkündür;
eski dosyanın üstüne kopyalamak gerekmez. Mevcut DB'yi “sıfırlama” veya WAL'yi
silme adımı yoktur. Yarım job'lar worker başladığında lease/cleanup kurallarına
göre failed/cancelled olabilir; devam edecekleri varsayılmamalıdır.

10A denemesinde yedek ve geri yüklenen kopyanın tüm tabloları geçici kaynakla
eşleşti. 10C'de bu komutlar yeni runtime ile geçici bir DB üzerinde tekrar
çalıştırıldı ve workspace kaydı kaynakla eşleşti. [10C sonuçları](STAGE10C_REPORT.md)

## Hata giderme

| Belirti | Kontrol / güvenli davranış |
| --- | --- |
| Runtime bulunamadı veya sürüm uyuşmuyor | Kurulumu tamamlayın veya GEOJSON_RUNTIME_PY ile doğrulanmış mutlak Python yolunu verin. |
| Proje butonları görünmüyor | api ve VITE_PROJECT_MANAGEMENT=true birlikte mi? Vite/build yeniden başlatıldı mı? |
| Import queued kalıyor | Worker açık mı; API ve worker aynı DB yolunu mu kullanıyor? Job GET yanıtını inceleyin. |
| CORS / Failed to fetch | API health, port, localhost/127.0.0.1 ve GEOJSON_CORS_ORIGINS eşleşmesini kontrol edin. |
| 409 | Revision/project.version/generation çakışması; sessiz tekrar yok. Mevcut çalışmayı koruyup güncel kayıtla karşılaştırın. |
| 422 | İstek/GeoJSON yapısı, koordinatlar veya desteklenmeyen sayısal hassasiyet. Taslak hata mesajını düzeltin. |
| 413 / 415 / 429 / 507 | Sırasıyla boyut, uzantı, kapasite veya disk/kota sınırı. Job hata alanını da kontrol edin. |
| database is locked | Aynı DB'ye yazan süreçleri ve uzun işlemleri inceleyin; kontrolsüz tekrar/elle DB düzenleme yapmayın. |
| disk I/O / readonly database | DB ve ana dizin yazma/arama izinleri, yerel disk alanı, doğru DB yolu, WAL/SHM erişimi ve disk sağlığını kontrol edin. Kullanıcı verisini silmeyin. |
| Tüm dosya JSON görünmüyor | Büyük dosya editör sınırı; seçili Feature veya export kullanın. |
| Yenilemede boş harita | Yeni workspace beklenen davranıştır. Önceden kaydedilmiş projeyi Projelerim'den açın. |
| Büyük ID değişmiş | Önceden bozulmuş değer otomatik onarılmaz. Özgün dosyadan yeniden alın; üç servisi ve tarayıcıyı yenileyin. |

SQLite DB'sini ağ diski/senkronizasyon üzerinden eşzamanlı paylaşmak desteklenen
çalışma düzeni değildir. Topolojik uyarılar otomatik düzeltme anlamına gelmez.
Kapasite ve ölçüm ayrıntıları STAGE9A_REPORT.md, STAGE9B_REPORT.md ve
STAGE10A_REPORT.md içindedir.
