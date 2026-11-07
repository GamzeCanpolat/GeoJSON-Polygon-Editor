# Aşama 10C — Runtime entegrasyonu ve teslim

7 Kasım 2026. **Bağımsız runtime ile uygulama yerel ve izole kullanım için
doğrulandı.** FastAPI ve import worker Python 3.13.18 / SQLite 3.53.1 ile
çalıştı. API, worker, Vite ve Chrome test süreçleri kapatıldı.

## Başlatma

Varsayılan Python yolu kullanıcı dizininden hesaplanır.

```text
$HOME/Library/Application Support/GeoJSONEditor/Runtimes/cpython-3.13.18-sqlite-3.53.1/venv/bin/python
```

`bash scripts/run-backend.sh python-path` yolu doğrular ve yazdırır.
`api`, `worker` ve `migrate` aynı Python'u kullanır. Başlatıcı CPython'un
`sys.version_info` ve standart `sqlite3.sqlite_version` değerlerini kontrol
eder. Açık ve mutlak bir `GEOJSON_DATABASE_PATH` ister. Migration ayrı bir
komuttur. `GEOJSON_RUNTIME_PY` başka bir kurulumun mutlak yolunu seçer ve
boşluk içeren yollar tırnak içinde çalışır.

Başlatıcı denemelerinde eksik DB yolu, göreli DB yolu, bulunamayan Python ve
eski Python 3.13.5 / SQLite 3.49.1 reddedildi. Bu denemeler DB oluşturmadı.
Eksik runtime için otomatik geçiş bulunmuyor.

RUNBOOK kurulum bloğu boş ve boşluk içeren bir geçici dizinde tekrar
çalıştırıldı. uv 0.13.7, Python 3.13.18 ve SQLite 3.53.1 ile 33 uyumlu
paket doğrulandı. Geçici denemede yalnız kurulum hedefi ve başlatıcıya
verilen Python yolu değiştirildi. [Runtime kurulumu](RUNBOOK.md#bağımsız-python-ortamı-kurulumu)

## Testler

| Kontrol | Sonuç |
| --- | --- |
| Frontend | **148/148**, 15 dosya. Koşullu büyük dosya testi dahil |
| Backend | **315/315**, 24,82 sn. Migration ve worker kesintisi dahil |
| Gerçek HTTP ve Chrome | **8/8**, 7 dosya, 76,08 sn |
| Local ve API build | İkisi de başarılı. Her ikisi `tsc --noEmit` çalıştırdı |
| Mobil açık/koyu tema | Chrome emülasyonunda Local ve API başarılı, 320–1400 px arası yedi genişlik |
| Local büyük dosya | 96,70 MiB ve 140.000 poligon. Import/export semantik hash eşit |
| API büyük dosya | 105 MiB ve 91.727 Feature. Export'ta tüm kayıtlar ve metadata eşit |
| Yedekleme ve geri yükleme | Geçici kaynak ve yeni dizindeki geri yüklenen workspace eşit. Integrity, FK ve R-Tree kontrolleri geçti |

Dört Chrome test dosyası API, migration ve worker süreçlerini yeni
başlatıcıdan çalıştırdı. Polygon çizme, kaydetme, sayfa yenileme, Projelerim
üzerinden yeniden açma, geometriyi düzenleme ve yeniden kaydetme SQLite
snapshot kayıtları üzerinden doğrulandı. Sürüm çakışması, bekleyen değişiklik
ve silme onayı senaryoları da geçti.

GeoJSON import/export ve iptal gerçek worker ile çalıştı. Chrome arayüzünde
`.xlsx` dosyası dosya seçiciden yüklendi ve SQLite'ta Point koordinatları ile
özniteliği doğrulandı. Birim testleri `.xlsx` ve `.xls` biçimlerini kapsadı.
Ana ve alt kategori katalogları API ve GeoJSON turunda korundu. Güvenli
tamsayı sınırını aşan ID'ler tarayıcı JSON/tablo/export, HTTP ve SQLite
snapshot boyunca tam kaldı.

Tablo kaydetme yarışı 0, 200 ve 650 ms gecikmede, çift tıklamada, Enter ile
gönderimde ve HTTP hatası sonrası yeniden denemede doğrulandı. Chrome proje
testinin geçici DB'sinde `PRAGMA integrity_check` ve `rtreecheck` değeri
`ok`, `foreign_key_check` boş döndü. Backend testleri WAL ve kesinti
senaryolarını da kapsadı.

API proje menüsünün emülasyon ölçümlerinde en düşük buton kontrastı 4,57:1
oldu. 390 px'te mobil kaydetme ve proje listeleme çalıştı. Büyük Local dosya
denemesi Node ve fake-indexeddb ile yapıldı. API büyük dosya ölçümü loopback
HTTP üzerinden çalıştı. Bu süreler fiziksel mobil cihaz performansı ölçümü
değildir. Bu aşamada başarısız veya atlanan regresyon vakası kaydedilmedi.

## Veri ve ortam koruması

Testler geçici kaynak kopyası, DB, port ve Chrome profili kullandı. Gerçek
`.env` ve `backend/.venv` test kopyasına alınmadı. Test Python süreçlerinde
SQLite bağlantısı yalnız geçici kök altında açılabildi. Kullanıcı DB'sinde
uygulama başlatılmadı ve migration çalıştırılmadı.

Başlangıç ve bitişte gerçek `projects.db`, `projects.db-wal` ve
`projects.db-shm` için boyut, SHA-256 ve dosya kimliği eşleşti. Eski
`backend/.venv` içeriği ve bağlantıları, Desktop dışındaki Recovery
kopyası ve depo altındaki önceki kurtarma dosyalarının içerikleri korundu.
Eski ortam Python 3.13.5 / SQLite 3.49.1 olarak doğrulandı. Eski ortamın
bazı dizinlerinde yalnız zaman damgası farkı gözlendi. Dosya içerikleri,
izinler, dosya kimlikleri ve bağlantı hedefleri eşleşti. Önceki geçişteki
dosya yolu kaybının nedeni hâlâ belirsiz. [10B-2 incelemesi](STAGE10B_RUNTIME_REPORT.md)

## Dokümantasyon ve Git

README, RUNBOOK, backend README ve API modu kılavuzu yeni kurulum,
üç terminal, Local/API farkı, proje özelliği, test, yedekleme ve geri dönüş
adımlarını anlatıyor. Gamze'nin ayrıntılı frontend bölümü ve özgün README
arşivi korunuyor. Tarihsel 10A/10B raporları kendi aşama sonuçlarını taşıyor.
[İşletim rehberi](RUNBOOK.md) · [README birleştirme planı](README_MERGE_PLAN.md)

Yerel dal `abdullah-backend`, upstream `origin/abdullah-backend` ve HEAD
`bbf17d2`. GitHub uçları salt okunur sorguda `abdullah-backend` için
`bbf17d2`, `main` için `9c4ed5c`, `gamze-harita-arayuz` için `98509dc`
olarak doğrulandı. Çalışma ağacındaki önceki dosyalar ile bu aşamanın
başlatıcı, test ve belge değişiklikleri commit edilmemiş durumda. Stage
alanı boş. Commit, push, merge ve rebase yapılmadı.

**Teslim adayı incelemeye hazır.** Main birleştirmesi için değişikliklerin
onaylı PR'a alınması, önceki incelemede saptanan README çakışmasının aday
metinle çözülmesi ve birleşik kodda regresyonların tekrar çalıştırılması
gerekiyor. Bu aşama mevcut dalın çalışma ağacını doğruladı. [10A dal incelemesi](STAGE10A_REPORT.md#7-olası-merge-conflictler)

## Mac Terminal komutları

Aşağıdaki komutlar hazır bağımsız runtime ve **ayrı deneme DB'si** kullanır.
İlk frontend kurulumunda proje kökünde `npm ci` çalıştırın.

**Terminal 1 — FastAPI**

```bash
cd "$HOME/Desktop/GeoJSON-Polygon-Editor"
bash scripts/run-backend.sh python-path
export GEOJSON_DATABASE_PATH="$HOME/Library/Application Support/GeoJSONEditor/ManualCheck/projects.db"
export GEOJSON_CORS_ORIGINS='["http://127.0.0.1:5173"]'
bash scripts/run-backend.sh migrate && bash scripts/run-backend.sh api
```

**Terminal 2 — import worker**

```bash
cd "$HOME/Desktop/GeoJSON-Polygon-Editor"
export GEOJSON_DATABASE_PATH="$HOME/Library/Application Support/GeoJSONEditor/ManualCheck/projects.db"
bash scripts/run-backend.sh worker
```

**Terminal 3 — React/Vite**

```bash
cd "$HOME/Desktop/GeoJSON-Polygon-Editor"
VITE_DATA_SOURCE=api VITE_API_BASE_URL=http://127.0.0.1:8000 VITE_PROJECT_MANAGEMENT=true npm run dev -- --port 5173 --strictPort
```

Tarayıcıda [127.0.0.1:5173](http://127.0.0.1:5173) adresini açın. Deneme
bitince üç terminalde Ctrl+C kullanın. Local moda dönmek için
`VITE_DATA_SOURCE=local npm run dev -- --port 5173 --strictPort` yeterlidir.
Eski Python'u doğrulamak için `backend/.venv/bin/python -c 'import sys,sqlite3; print(sys.version,sqlite3.sqlite_version)'`
kullanılabilir. SQLite 3.49.1'in WAL-reset riski eski ortam için devam eder.

## Açık sınırlar

Apple Silicon macOS doğrulandı. Mobil sonuçlar Chrome emülasyonuna aittir.
Gerçek kullanıcı DB'siyle geçiş bu aşamadan ayrı bir işlemdir. Uygulamanın
mevcut tek kullanıcılı çalışma, kota ve veri biçimi sınırları geçerlidir.
[Bilinen sınırlar](../README.md#bilinen-sınırlar)
