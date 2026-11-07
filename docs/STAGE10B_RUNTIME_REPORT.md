# Aşama 10B-2 — Bağımsız Python / SQLite çalışma ortamı

**7 Kasım 2026 · Sonuç: Bağımsız ortam kuruldu ve geçici verilerle doğrulandı.**
Uygulamanın varsayılan ortamı değiştirilmedi. Gerçek kullanıcı veritabanıyla
FastAPI, import worker veya migration çalıştırılmadı.

## Önceki geçişte ne oldu?

[10B raporu](STAGE10B_REPORT.md), [geçiş ve geri dönüş raporu](STAGE10B_MIGRATION_REPORT.md),
[SQLite yükseltme notları](SQLITE_RUNTIME_UPGRADE.md) ve [işletim rehberi](RUNBOOK.md)
korundu. Önceki kurulum logu ve geçiş betiği, eski `backend/.venv` dizininin
`retired-original-venv` yoluna yeniden adlandırıldığını, sonra yeni venv'in
**aynı özgün yolda** kurulduğunu gösteriyor. O sırada yeni ortamın
`sys.executable` yolu `backend/.venv/bin/python`, temel Python yolu ise depo
altındaki `backend/var/runtime/` idi. Kurulum ve testler bu yollarla çalışmıştı.

Son kontrolde özgün yol artık yoktu. Emekliye ayrılan dizindeki mevcut
`pyvenv.cfg` yeni 3.13.18 tabanına işaret ediyor; `bin 2/python3.13` bağlantısı
ise eski `/Library/Frameworks/Python.framework/Versions/3.13/bin/python3.13`
hedefini taşıyor. Önceki manifest karşılaştırmasında taşınan dizinde 1.696
eksik, 6.277 ek ve 1.809 değişmiş girdi vardı. Bu bulgular iki ortama ait
dosyaların karıştığını gösteriyor. **Yolu hangi işlem ve mekanizmanın ortadan
kaldırdığı kanıtlanamadı.** Önceki geçiş zamanında proje yoluyla filtrelenen
macOS `bird` / `fileproviderd` log sorgusu eşleşme döndürmedi. Bu sonuç,
senkronizasyonun neden olduğunu ya da olmadığını kanıtlamıyor.

Yeni kurulum aynı dizini yeniden kullanmadı ve hiçbir eski ortamı taşımadı.

## Sabit yol ve sürüm kanıtı

Yollar kullanıcı dizinine göre gösterilmiştir.

- `sys.executable`:
  `$HOME/Library/Application Support/GeoJSONEditor/Runtimes/cpython-3.13.18-sqlite-3.53.1/venv/bin/python`
- `sys._base_executable`:
  `$HOME/Library/Application Support/GeoJSONEditor/Runtimes/cpython-3.13.18-sqlite-3.53.1/python/cpython-3.13.18-macos-aarch64-none/bin/python3.13`
- `sys.version`: `3.13.18 (main, Oct 26 2026, 13:59:02) [Clang 23.1.3 ]`.
- `sqlite3.sqlite_version` ve SQLAlchemy `sqlite3.dbapi2` bağlantısındaki
  `SELECT sqlite_version()`: **3.53.1**. SQLite CLI kullanılmadı.
- SQLite source ID: `2026-05-05 10:34:17 c88b22011a54b4f6fbd149e9f8e4de77658ce58143a1af0e3785e4e6475127e9`.

uv 0.13.7 ile macOS arm64 CPython 3.13.18 ayrı dizine indirildi. Venv doğrudan
son konumunda oluşturuldu. Sistem Python'u ve PATH ayarları değiştirilmedi.
Testler bittikten ve servisler durduktan sonra Python, farklı bir çalışma
dizininde temiz ortamla yeniden başlatıldı. Aynı sürümler döndü; Python arama
yolu ve sembolik bağlantılar bu runtime dizininin dışına çıkmıyordu.

## Bağımlılıklar

`backend/pyproject.toml` içindeki backend ve `dev` bağımlılıkları
`backend/constraints/sqlite-runtime-10b.txt` ile kuruldu. Paketler cache'e
bağlanmak yerine kopyalandı. Uygulama modülleri komutların çalıştığı
`backend/` dizininden yükleniyor; runtime'da depo yoluna bağlı editable kurulum
yok. `uv pip check` 33 paketi doğruladı.

| Paket | Sürüm | Paket | Sürüm |
| --- | --- | --- | --- |
| FastAPI | 0.162.0 | Uvicorn | 0.54.0 |
| SQLAlchemy | 2.0.57 | Alembic | 1.20.1 |
| Shapely | 2.2.0 | ijson | 3.6.0 |
| Pydantic | 2.14.3 | pydantic-settings | 2.16.2 |
| python-multipart | 0.0.33 | psutil | 7.2.2 |
| pytest | 9.2.0 | httpx2 | 2.16.0 |

Tam paket listesi ve ölçümler runtime altındaki `verification/cold-restart.json`
ve `verification/runtime-smoke.json` dosyalarındadır.

## İzole testler

Mevcut kaynak dosyalarının geçici kopyası kullanıldı. Gerçek `.env`, eski
venv ve kullanıcı verisi kopyalanmadı. Entegrasyon testlerinin beklediği
`backend/.venv` bağlantısı **yalnız geçici kaynak kopyasında** oluşturuldu.
Python başlangıç denetimi 202 süreçte yeni sürümleri doğruladı; SQLite
bağlantılarına sadece geçici test kökü altında izin verildi. Test koruması
ayrı bir örnek yolla sınandı; korunan gerçek veritabanı için bağlantı denemesi
gözlenmedi.

| Kontrol | Sonuç |
| --- | --- |
| Backend | **315 başarılı** (18,62 sn) |
| Gerçek HTTP ve Chrome | **8 başarılı**, 7 dosya (66,93 sn) |
| Alembic migration | Boş geçici DB'de `0003_spatial_index (head)` |
| SQLAlchemy SQLite ayarları | WAL, `foreign_keys=1`, `busy_timeout=5000` ms |
| Bütünlük | `integrity_check=ok`; `foreign_key_check` boş; `rtreecheck=ok` |
| Ek eşzamanlılık ve kesinti denemesi | **Başarılı** (52,27 sn) |
| Temiz süreçte tekrar açılış | **Python 3.13.18 / SQLite 3.53.1** |

İlk backend çalıştırmasında 314 test geçti; bir worker SIGKILL testi macOS
sandbox'ının `psutil.pids()` / `sysctl` erişimini engellemesi nedeniyle
başarısız oldu. Aynı izolasyonla, süreç listesine izin verilen tam tekrarda
315 testin tamamı geçti. Önceki 148 frontend birim testi bu aşamada tekrar
çalıştırılmadı; Chrome entegrasyonları yeniden çalıştırıldı.

Kapsam: proje oluşturma, kaydetme, tekrar açma ve snapshot'ın korunması;
GeoJSON import/export; büyük sayısal ID'lerin HTTP, SQLite, JSON, tablo ve
export boyunca tam korunması. Ek denemede sekiz eşzamanlı düzenlemenin biri
200, yedisi beklenen 409 döndürdü; eşzamanlı iki proje kaydı 200/409,
36 okuma 200 döndürdü. 50 MB import 500 Feature sonrası iptal edildi.
Bozuk import, worker SIGKILL ve yeniden başlatma, snapshot sırasında API
SIGKILL ve yeniden başlatma sonrasında DB, foreign key ve R-Tree bütünlüğü
doğrulandı; R-Tree'de eksik veya fazla kayıt görülmedi.

## Eski ortam, yedekler ve kullanıcı verisi

`backend/.venv` taşınmadı, değiştirilmedi ve içine paket kurulmadı. Başta ve
sonda **Python 3.13.5 / SQLite 3.49.1** verdi. Eski ortamın 6.236 girdisinin
(kök dizin dahil) dosya içerikleri, izinleri ve sembolik bağlantı hedefleri
eşleşti. Desktop dışındaki `Recovery/` yedeğinin 6.270 girdisi değişmedi.

Gerçek `projects.db`, `projects.db-wal` ve `projects.db-shm` dosyalarının
başlangıç ve bitiş boyutları, SHA-256 değerleri ve dosya kimlikleri eşleşti.

Eski venv'in ve depo içindeki eski kurtarma arşivinin bazı dizinlerinde
yalnız dizin zaman damgası farkları gözlendi. Dosya içerikleri, izinler,
inode değerleri ve bağlantı hedefleri eşleşti; eklenen veya kaybolan girdi
yoktu. Bu konumlara yazma veya taşıma işlemi yapılmadı; zaman damgası
değişikliğinin nedeni bilinmiyor. Karşılaştırma özeti runtime altındaki
`verification/protected-final.json` dosyasındadır.

## İleride başlatma komutları

Aşağıdaki üç terminal, **kullanıcı DB'sinden ayrı** bir deneme veritabanı
kullanır. Bu çalışma sonunda hiçbir servis açık bırakılmadı. Gerçek DB
yoluna geçiş ayrı onay gerektirir.

Terminal 1 — FastAPI:

```bash
cd "$HOME/Desktop/GeoJSON-Polygon-Editor/backend"
GEOJSON_RUNTIME_PY="$HOME/Library/Application Support/GeoJSONEditor/Runtimes/cpython-3.13.18-sqlite-3.53.1/venv/bin/python"
export GEOJSON_DATABASE_PATH="$HOME/Library/Application Support/GeoJSONEditor/ManualCheck/projects.db"
export GEOJSON_CORS_ORIGINS='["http://127.0.0.1:5173"]'
"$GEOJSON_RUNTIME_PY" -m alembic upgrade head &&
  "$GEOJSON_RUNTIME_PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Terminal 2 — Import worker (Terminal 1 başladıktan sonra):

```bash
cd "$HOME/Desktop/GeoJSON-Polygon-Editor/backend"
GEOJSON_RUNTIME_PY="$HOME/Library/Application Support/GeoJSONEditor/Runtimes/cpython-3.13.18-sqlite-3.53.1/venv/bin/python"
export GEOJSON_DATABASE_PATH="$HOME/Library/Application Support/GeoJSONEditor/ManualCheck/projects.db"
"$GEOJSON_RUNTIME_PY" -m app.workers.import_worker --poll-interval 0.25
```

Terminal 3 — Vite:

```bash
cd "$HOME/Desktop/GeoJSON-Polygon-Editor"
VITE_DATA_SOURCE=api VITE_API_BASE_URL=http://127.0.0.1:8000 VITE_PROJECT_MANAGEMENT=true \
  npm run dev -- --port 5173 --strictPort
```

Arayüz: http://127.0.0.1:5173 · API sağlık: http://127.0.0.1:8000/api/v1/health

## Geri dönüş, Git ve açık riskler

Kurulum eski ortamı devreden çıkarmadığı için geri yükleme gerekmiyor.
Yukarıdaki denemeyi sonlandırmak için üç terminalde Ctrl+C kullanın. Eski
Python'u doğrulamak için `backend/.venv/bin/python -c 'import sys,sqlite3; print(sys.version); print(sqlite3.sqlite_version)'`
komutunu proje kökünde çalıştırabilirsiniz. Eski SQLite 3.49.1 için önceki
WAL-reset güvenlik engeli devam ediyor; bu kontrol eski ortamda gerçek
veriyle servis başlatma onayı değildir.

Dal `abdullah-backend`, upstream `origin/abdullah-backend`, HEAD `bbf17d2`.
Önceki 12 bekleyen dosya korundu. Bu aşamada yalnız bu rapor eklendi; hiçbir
Git yazma işlemi yapılmadı. Önceki Desktop yol kaybının nedeni açık.
Kullanıcı verisi üzerinde yeni runtime ile çalışma ve varsayılan başlatma
yönteminin değiştirilmesi bu aşamanın dışında kaldı.
