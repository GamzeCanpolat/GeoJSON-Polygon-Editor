# SQLite çalışma ortamını güvenli güncelleme — Aşama 10B

**Güncel durum (7 Kasım 2026):** Koşullu onayla asıl geçiş denendi. Yeni
ortamda 315 backend ve 8 entegrasyon testi geçti, ancak son dosya yolu kontrolü
başarısız oldu. Eski .venv doğrulanmış bağımsız yedekten geri yüklendi; etkin
sürümler 3.13.5 / 3.49.1. Geçiş tamamlanmadı. Kullanıcı DB/WAL verileri korundu.
[Geçiş ve geri dönüş raporu](STAGE10B_MIGRATION_REPORT.md).

Aşağıdaki izole deneme ve onay bekleyen plan, ilk 10B çalışmasının tarihsel
kaydını açıklar; onay sonrası gerçekleşen son durum yukarıdaki ek rapordadır.

## Test edilen yöntem

| Bileşen | Mevcut ortam | İzole aday |
| --- | --- | --- |
| Python | 3.13.5, python.org Framework | 3.13.18, uv-managed CPython |
| Standart sqlite3 | 3.49.1 | 3.53.1 |
| _sqlite3 uygulaması | Framework içindeki uzantıya gömülü | CPython built-in modülü |
| SQLAlchemy | 2.0.57, sqlite+pysqlite | Aynı URL ve sürüm; DBAPI sqlite3.dbapi2 |
| WAL / FK / timeout | WAL / ON / 5000 ms | WAL / ON / 5000 ms |
| Geliştirme DB'si | Olduğu gibi korundu | Yalnız geçici DB'ler kullanıldı |

uv 0.13.7 ile CPython 3.13.18'in 20261026 macOS arm64 standalone dağıtımı
kullanıldı. Bu, macOS sistem Python'unun güncellenmesi değildir.
[uv Python yönetimi](https://docs.astral.sh/uv/guides/install-python/).
SQLite sürümü indirme aracından veya CLI'dan varsayılmadı: standart sqlite3,
SELECT sqlite_version() ve SQLAlchemy DBAPI üzerinden ayrı doğrulandı.

Düzeltmenin dayanağı [SQLite 3.51.3 sürüm notu](https://sqlite.org/releaselog/3_51_3.html)
ve [WAL açıklamasıdır](https://sqlite.org/wal.html). 3.53.1 bu düzeltmeden sonraki
sürümdür; en yeni SQLite dağıtımı olduğu iddia edilmez.

## İzole ortamı yeniden üretme

Aşağıdaki örnek Apple Silicon macOS içindir. Mevcut .venv'e yazmaz, PATH'i veya
sistem Python'unu değiştirmez. Komutlar proje kökünde çalıştırılır.
İzole kurulum indirme erişimi ve disk alanı gerektirir.

~~~bash
export GEOJSON_RUNTIME_ROOT="$(mktemp -d /private/tmp/geojson-runtime-check.XXXXXX)"
backend/.venv/bin/python -m venv "$GEOJSON_RUNTIME_ROOT/tooling"
"$GEOJSON_RUNTIME_ROOT/tooling/bin/python" -m pip --isolated install --cache-dir "$GEOJSON_RUNTIME_ROOT/pip-cache" uv==0.13.7

"$GEOJSON_RUNTIME_ROOT/tooling/bin/uv" python install 3.13.18 --install-dir "$GEOJSON_RUNTIME_ROOT/python" --no-bin --cache-dir "$GEOJSON_RUNTIME_ROOT/uv-cache" --no-config --system-certs

export GEOJSON_CANDIDATE_PYTHON="$GEOJSON_RUNTIME_ROOT/python/cpython-3.13.18-macos-aarch64-none/bin/python3.13"
"$GEOJSON_CANDIDATE_PYTHON" -c 'import sys,sqlite3; print(sys.executable); print(sqlite3.sqlite_version); assert sqlite3.sqlite_version_info >= (3,51,3)'

"$GEOJSON_RUNTIME_ROOT/tooling/bin/uv" venv "$GEOJSON_RUNTIME_ROOT/backend-venv" --python "$GEOJSON_CANDIDATE_PYTHON" --cache-dir "$GEOJSON_RUNTIME_ROOT/uv-cache" --no-config
"$GEOJSON_RUNTIME_ROOT/tooling/bin/uv" pip install --python "$GEOJSON_RUNTIME_ROOT/backend-venv/bin/python" --constraint backend/constraints/sqlite-runtime-10b.txt -e 'backend[dev]' --cache-dir "$GEOJSON_RUNTIME_ROOT/uv-cache" --no-config --system-certs
"$GEOJSON_RUNTIME_ROOT/tooling/bin/uv" pip check --python "$GEOJSON_RUNTIME_ROOT/backend-venv/bin/python" --cache-dir "$GEOJSON_RUNTIME_ROOT/uv-cache" --no-config
~~~

constraints dosyası test edilen Python paketlerini sınırlar; **SQLite'ı
güncellemez**. Standart sqlite3, seçilen Python dağıtımından gelir. Eski Python
ile yeni venv oluşturmak tek başına SQLite sürümünü değiştirmez.

Deneme API ve worker'ı aynı geçici DB'ye yönlendirin. Terminal 1'de proje kökünden:

~~~bash
export GEOJSON_TEST_PYTHON="$GEOJSON_RUNTIME_ROOT/backend-venv/bin/python"
export GEOJSON_DATABASE_PATH="$GEOJSON_RUNTIME_ROOT/test-data/projects.db"
export GEOJSON_CORS_ORIGINS='["http://127.0.0.1:5175"]'
echo "$GEOJSON_TEST_PYTHON"
echo "$GEOJSON_DATABASE_PATH"
cd backend
"$GEOJSON_TEST_PYTHON" -m alembic upgrade head
"$GEOJSON_TEST_PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8100
~~~

Terminal 2'de aynı **yazdırılan gerçek Python ve DB yollarını** kullanın:

~~~bash
export GEOJSON_TEST_PYTHON='/private/tmp/geojson-runtime-check.GERCEK_DIZIN/backend-venv/bin/python'
export GEOJSON_DATABASE_PATH='/private/tmp/geojson-runtime-check.GERCEK_DIZIN/test-data/projects.db'
cd backend
"$GEOJSON_TEST_PYTHON" -m app.workers.import_worker --poll-interval 0.25
~~~

Terminal 3'te proje kökünde:

~~~bash
VITE_DATA_SOURCE=api VITE_API_BASE_URL=http://127.0.0.1:8100 VITE_PROJECT_MANAGEMENT=true npm run dev -- --port 5175 --strictPort
~~~

http://127.0.0.1:5175 ve Swagger http://127.0.0.1:8100/docs.
GEOJSON_RUNTIME_ROOT, Python ve DB yolu terminaller arasında kendiliğinden
paylaşılmaz. GERCEK_DIZIN örneğini gerçek çıktı ile değiştirin.
Aktif kullanıcı servislerine veya onların DB yoluna bu komutları yönlendirmeyin.

**Test altyapısı notu:** Mevcut entegrasyon testleri backend/.venv/bin/python
yolunu kullanır. 10B'de bu yolu gerçek depoda değiştirmedik; geçici kaynak
kopyasında aynı yol yeni test venv'ine bağlandı. Bu nedenle yukarıdaki ayrı
runtime kurulmuş olsa bile asıl depoda entegrasyon paketini çalıştırmak henüz
otomatik olarak yeni Python'u seçmez. Backend pytest'i yeni Python ile açıkça
çalıştırılabilir; tüm E2E'nin yeni runtime'ı kullanması asıl geçiş sonrası
doğrulanmalıdır.

## Asıl geliştirme ortamına geçiş — onay bekleyen plan

Bu plan 10B'de **uygulanmadı**. Kullanıcı onayı olmadan backend/.venv taşınmaz,
yeniden kurulmaz ve kullanıcı DB'si yeni ortamda açılmaz.

1. Kalıcı, kullanıcıya ait ayrı bir runtime dizinine aynı CPython 3.13.18
   dağıtımını kurun; sqlite3 sürümünü yeniden doğrulayın. Geçici dizini kalıcı
   runtime olarak kabul etmeyin; venv klasörünü kopyalayarak taşımayın.
2. Çalışmayı kaydedin; importları tamamlayın/iptal edin. API ve worker'ı kendi
   terminallerinde güvenli durdurun. [RUNBOOK yedeğini](RUNBOOK.md#yedekleme-ve-geri-yükleme)
   alın ve ayrı restore kopyasını doğrulayın.
3. Eski backend/.venv'in pyvenv.cfg, interpreter ve paket sürümlerini kaydedin.
   Klasörü Git tarafından dışlanan backend/var/runtime-backups/ altında
   benzersiz bir yedek adına taşıyarak **tümünü koruyun**. Yedek klasöründeki
   entrypoint'ler eski mutlak yolu içerir; o konumdan çalıştırmaya güvenmeyin.
4. Yeni kalıcı Python'dan **özgün backend/.venv yolunda** taze venv oluşturun;
   constraints ile bağımlılıkları yeniden kurun. Test venv'ini buraya kopyalamayın;
   script shebang'leri ve base interpreter yolları farklıdır.
5. Yeni .venv ile bütün testleri önce geçici DB'lerde çalıştırın. API/worker'ın
   kullandığı sqlite3/SELECT sqlite_version() değerlerini doğrulayın.
6. Şema değişikliği yok: head 0003_spatial_index korunur. Kullanıcı DB'sine
   downgrade/reset uygulamayın. Onaylı geçişte asıl DB yolu ve yedeği yeniden
   doğrulayıp üç servisi başlatın; browser'ı tam yenileyin.
7. Başlatma sonrası küçük bir kopya projede kaydet/aç, import/export, ID koruması,
   tablo Save bariyeri ve mobil menüyü doğrulayın.

### Geri dönüş

Yeni ortam kurulamazsa veya regresyon varsa kullanıcı DB'sini eski yedekle
otomatik ezmeyin. API/worker durmuşken başarısız yeni .venv'i ayrı bir tanılama
dizinine kaldırıp **eski venv'i özgün backend/.venv adına geri taşıyın**.
Bu, eski mutlak script yollarını yeniden geçerli kılar. Sistem Python'una,
kullanıcı DB'sine veya WAL/SHM'ye elle müdahale edilmez.

10B'de yeni SQLite'ın ürettiği **geçici, kapalı DB kopyası** eski SQLite 3.49.1
ile salt okunur açıldı; integrity/FK/R-Tree geçti. Bu, her gelecekteki şema/
veri değişikliğinin geriye uyum garantisi değildir. Eski runtime'a dönmek
tespit edilen SQLite riskini de geri getirir; kalıcı güvenlik çözümü sayılmaz.

## Riskler ve kabul sınırı

- Yeni Python patch sürümü ve dağıtım sağlayıcısı değişir; yeni ortam taze
  oluşturulmalı, compiled wheel/SSL/worker uyumu kontrol edilmelidir.
- 33 paket sürümü constraints dosyasında kaydedildi; bu dosya Python binary'si,
  işletim sistemi veya bütün artefaktlar için hash lock değildir.
- Normal WAL, eşzamanlı yazma ve kesinti testleri geçti; özel SQLite WAL-reset
  hatasını kaynak koduna müdahaleyle tetikleyen resmi test burada tekrarlanmadı.
- Gerçek kullanıcı DB'si yeni runtime'da denenmedi. Bu geçişin tamamlandığı
  iddia edilmez; mevcut geliştirme .venv'i hâlâ SQLite 3.49.1'dir.
- Test edilen ortam macOS arm64'tür. Intel Mac/Windows/Linux ve fiziksel
  mobil cihaz kabulü ayrı çalışmadır.

Son ölçümler, dosyalar ve test sayıları [10B raporundadır](STAGE10B_REPORT.md).
