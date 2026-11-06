# Local / FastAPI çalışma modları — Aşama 7C

Proje yönetimi için artık API moduna ek olarak `VITE_PROJECT_MANAGEMENT=true`
verilebilir; varsayılan kapalıdır. Bu değişiklik Vite'ın yeniden başlatılmasını
gerektirir. Güncel ekranlar ve komutlar: [7D-3 rehberi](PROJECT_UI_INTEGRATION.md).

`src/data/createRepository.ts` yalnızca adaptörü seçer. Harita, React bileşenleri,
OpenLayers, tablo, kategori, Excel dönüşümü, tema ve veri sözleşmesi değiştirilmedi.

- Değişken yoksa veya `VITE_DATA_SOURCE=local` ise mevcut WorkerGeoJsonRepository.
- `VITE_DATA_SOURCE=api` ise ApiGeoJsonRepository.
- `VITE_API_BASE_URL=http://127.0.0.1:8000` API sunucu köküdür. Fabrika `/api/v1`
  ekler; adres zaten `/api/v1` ile bitiyorsa tekrar eklemez.
- Tanımsız mod veya geçersiz adres hata verir. API erişilemiyorsa local moda geçiş yoktur.
- VITE değişkenleri tarayıcıya açıktır; parola veya API anahtarı içermemelidir.

Kök `.env.example` örnektir. İsterseniz kendi `.env.local` dosyanıza kopyalayıp
modu değiştirebilirsiniz; gerçek .env dosyaları ignore edilir. Vite değişkenleri
başlangıçta/build sırasında okunur; değiştirdikten sonra Vite'ı yeniden başlatın.
Var olan terminal sunucusu aynı portu kullanıyorsa önce o terminalde Ctrl+C yapın.

## macOS: API modunu başlatma

Terminal 1 — FastAPI (mevcut Python sanal ortamıyla):

```bash
cd ~/Desktop/GeoJSON-Polygon-Editor/backend
.venv/bin/python -m alembic upgrade head
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Terminal 2 — import worker (JSON ve dönüştürülmüş Excel importu için gereklidir):

```bash
cd ~/Desktop/GeoJSON-Polygon-Editor/backend
.venv/bin/python -m app.workers.import_worker --poll-interval 0.25
```

Terminal 3 — Vite API modu:

```bash
cd ~/Desktop/GeoJSON-Polygon-Editor
VITE_DATA_SOURCE=api VITE_API_BASE_URL=http://127.0.0.1:8000 npm run dev
```

Uygulama: http://127.0.0.1:5173. Swagger: http://127.0.0.1:8000/docs.
Worker yoksa import sırada kalır; tarayıcıda iptal edilebilir. Backend yoksa
bağlantı hatası gösterilir; tarayıcıda ayrı bir local veri kümesi oluşturulmaz.

Local mod için yalnızca Terminal 3:

```bash
cd ~/Desktop/GeoJSON-Polygon-Editor
VITE_DATA_SOURCE=local npm run dev
```

## Workspace yaşam döngüsü

Uygulama açılışta createEmpty çağırır. API modu sunucuda yeni bir workspace ve
revision 0 dataset oluşturur. Workspace kimliği adaptör belleğindedir; bu aşamada
URL'ye/localStorage'a yazılmaz. Sayfa yenilenirken mevcut değişiklik uyarısı kabul
edildikten sonra yeni boş workspace açılır. Önceki SQLite kayıtlarının kalması,
bu kayıtların yeni sayfada otomatik açılması anlamına gelmez.

Geçici API workspace, kaydedilmiş Project snapshot'ı değildir. Kalıcı proje
listeleme/kaydetme/açma ekranları henüz yoktur. Yeni sekmelerin/workspace'lerin
otomatik birleştirilmesi veya aynı aktif projeyi paylaşması uygulanmadı.

## Testler

```bash
npm test
npm run build
./node_modules/.bin/vitest run --config tests/api.integration.config.ts
RUN_BROWSER_INTEGRATION=1 ./node_modules/.bin/vitest run --config tests/api.integration.config.ts tests/integration/browserModes.test.ts
cd backend
.venv/bin/python -m pytest -q
```

Tarayıcı testi macOS Google Chrome ve backend/.venv gerektirir. Normal testlere
isteğe bağlıdır. Ayrı Chrome profili, rastgele loopback portları, Vite API/local
sunucuları, FastAPI, worker ve geçici SQLite kullanır; geliştirme veritabanını
kullanmaz. Alt süreçler ve geçici dosyalar sonunda temizlenir.

Gerçek UI testinde araç çubuğundan Polygon aracı seçilir ve haritaya fare
tıklamaları gönderilir. SQLite features tablosunda Polygon kaydı sorgulanır.
Diğer metotlar aynı Vite fabrikasının seçtiği adaptörle gerçek tarayıcı/CORS
üzerinden denenir: update/delete/restore, viewport, list/get, kategori, JSON
roundtrip, mevcut Excel dönüştürücüsünün çıktısının importu, ilerleme/iptal,
export ve gerçek 409/422 yanıtları. Excel dosya seçme diyaloğunun tamamı bu
tarayıcı testinin kapsamında değildir; dönüştürücü mevcut testlerde ayrıca kapsanır.

2026-11-06 doğrulama sonucu:

- Frontend: **80 geçti**, PERF_FILE isteyen mevcut büyük dosya testi atlandı.
  Bu sayı mevcut 22 API adaptör testi ve yeni 9 fabrika testini içerir.
- Gerçek HTTP ve Vite/Chrome entegrasyonları birlikte: **2 geçti**.
- Backend: **300 geçti** (13,90 sn), geçici izole veritabanlarıyla.
- TypeScript `tsc --noEmit` ve Vite build: hem local varsayılan hem API modunda başarılı.
- Yenilemede mevcut kaydedilmemiş değişiklik uyarısı kabul edildi; yeni workspace
  oluşturuldu. Eski Feature satırları veritabanında kaldı, Project tablosu boş kaldı.
- Tarayıcı testinin ilk sürümü bu uyarıyı kabul etmediği için bekledi; yalnız testin
  dialog yönetimi düzeltildi. Ürün kodunda bunu aşan bir değişiklik yapılmadı.
- Geliştirme veritabanına test verisi yazılmadı; gerçek .env oluşturulmadı.

Git başlangıcı: temiz `abdullah-backend`, upstream `origin/abdullah-backend`,
HEAD `331e17f6cef7725a9412e65be783a7afb6b38934`. Bu aşamada commit veya uzak Git
işlemi yapılmadı. Değiştirilen tek mevcut kaynak `src/data/createRepository.ts`.
Yeni dosyalar kök `.env.example`, bu belge, `tests/unit/createRepository.test.ts`
ve `tests/integration/browserModes.test.ts`. contracts.ts, INTEGRATION.md,
backend ve mevcut UI kaynakları değişmedi.

## Gamze ile kararlaştırılacak sonraki ekranlar

- Proje listesi, adlandırarak kaydetme, kayıtlı projeyi açma ve yeniden kaydetme.
- Ayrı ProjectRepository ile ortak workspace bağlamı ve project.version kontrolü.
- Sayfa yenileme sonrasında workspace devam ettirme veya proje seçme tercihi.
- Proje/import değişiminde seçim, undo geçmişi, tablo ve haritanın yenilenmesi.
- Bağlantı kaybı, worker bekleme, 409 çatışması ve büyük export için kullanıcı akışı.

Bu aşamada bu ekranlar veya tasarım değişiklikleri yapılmadı. Sonraki aşama
kullanıcı onayına bağlıdır.
