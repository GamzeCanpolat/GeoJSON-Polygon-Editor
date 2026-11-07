# Aşama 7D-3 — Ana uygulamada proje yönetimi

Proje kontrolleri gerçek `src/App.tsx` üst çubuğuna bağlandı. Aynı
ApiGeoJsonRepository örneğinin `.projects` servisi kullanılır; ikinci repository
veya ikinci çalışma bağlamı oluşturulmaz. Açma sırasında backend'in oluşturduğu
yeni workspace, mevcut adaptörün kuyruğu üzerinden etkinleşir. Başarısız yanıtta
App resetlenmez; eski workspace ve çalışma verileri korunur.

## Etkinleştirme ve terminal komutları

Varsayılanlar değişmedi: local mod ve kapalı proje bayrağı. Ekranlar **yalnız**
`VITE_DATA_SOURCE=api` ve `VITE_PROJECT_MANAGEMENT=true` birlikteyken görünür.
API bağlantısı bozuksa local moda geçilmez. VITE değişkenleri herkese açık
yapılandırmadır; gizli bilgi içermemelidir. Gerçek .env dosyası oluşturulmadı.

Terminal 1 — mevcut kurulu backend ortamında:

```bash
cd ~/Desktop/GeoJSON-Polygon-Editor/backend
.venv/bin/python -m alembic upgrade head
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Terminal 2 — JSON/Excel dosya importları için worker:

```bash
cd ~/Desktop/GeoJSON-Polygon-Editor/backend
.venv/bin/python -m app.workers.import_worker --poll-interval 0.25
```

Terminal 3 — proje ekranları açık gerçek uygulama:

```bash
cd ~/Desktop/GeoJSON-Polygon-Editor
VITE_DATA_SOURCE=api VITE_API_BASE_URL=http://127.0.0.1:8000 VITE_PROJECT_MANAGEMENT=true npm run dev
```

http://127.0.0.1:5173 adresini açın. Aynı portta sunucu zaten varsa ilgili terminalde
Ctrl+C ile durdurup doğru ortam değişkenleriyle yeniden başlatın. Sayfa yenilemek
Vite ortam değişkenlerini yeniden okumaz. Worker proje snapshot kaydı/açılması için
zorunlu değildir; büyük GeoJSON ve Excel'den dönüştürülmüş dosya importunda gerekir.

Local: `VITE_DATA_SOURCE=local npm run dev`. Proje ekranları kapalı API:
`VITE_DATA_SOURCE=api VITE_PROJECT_MANAGEMENT=false npm run dev`.
Üretim build'inde de aynı değişkenler build sırasında verilmelidir.

## Kullanıcı akışı

Masaüstünde Kaydet/Farklı Kaydet/Projelerim kontrolleri üst çubuktadır. Dar ekranda
aynı işlemler `Projeler` açılır menüsüne taşınır. Çubuk yüksekliği değişmedi; harita
alanı için yeni satır eklenmedi. Aktif proje adı/sürümü, başarı ve işlem mesajları
gösterilir. Liste içinden Aç, Adını değiştir, Sil kullanılabilir.

İlk Kaydet isim ister, Farklı Kaydet bağımsız proje oluşturur. Tekrar Kaydet aktif
projenin beklenen version değeriyle yeni snapshot kaydeder. Dataset revision ile
proje version birbirine eşit varsayılmaz. Rename sonrası gelen version takip edilir.
GeoJSON indirmek API proje modunda proje dirty durumunu temizlemez: indirme ve
sunucuya proje kaydetme farklı işlemlerdir. Ctrl+S mevcut GeoJSON export davranışını
korur; sunucu snapshot'ı için Kaydet kontrolleri kullanılır.

Kaydedilmemiş değişiklikle başka kayıt açılırken Kaydet / Kaydetmeden Devam Et /
İptal sunulur. Kaydet önce mevcut çalışmayı kaydeder; isimsizse ad ister. Aynı
projeyi kaydedip yeniden açarken dönen yeni version kullanılır. Başarısız kayıtta
açma işlemi yapılmaz. Kaydetmeden Devam Et, eski workspace'i sunucuda korur ama
uygulanmamış JSON taslağını yalnız başarılı açmadan sonra bırakır. İptal mevcut
çalışmayı ve taslağı değiştirmez. Yeni boş çalışma komutu da API proje modunda
aynı üç kararı sunar; local modun önceki uyarı akışı korunur.

Uygulanmamış JSON taslağı snapshot'a dahilmiş gibi kaydedilmez. Taslak varken
Kaydet kapalıdır; kullanıcı taslağı uygulamak/iptal etmek için çalışmasına dönebilir.
Yarım çizim veya sürükleme algılanırsa proje işlemi başlatılmaz; önce tamamlaması
veya Escape ile çizimi iptal etmesi istenir. Böylece map interaction'ı disable
ederken yarım Polygon sessizce bırakılmaz. Devam eden ağ/import işlemlerinde de
proje kontrolleri kapalıdır.

Silme açık onay ister; iptal hiçbir DELETE göndermez. Snapshot silinse bile açık
düzenlenebilir workspace korunur. 409'da sürüm çakışması görünür, otomatik tekrar
yoktur. 422 ve bağlantı hataları mesaj olarak gösterilir. Kayıt/istek sırasında
başarı varsayılmaz; otomatik save, local fallback veya otomatik proje açma yoktur.

## State ve async güvenliği

Başarılı proje açmada resetState; seçim sürümünü, seçili Feature'ı, undo/redo,
gizli kimlikleri, arama/sayfa ve JSON taslağını sıfırlar. Eski liste, kategori ve
viewport sayaçları temizlenir; workspaceKey JSON/tablo panellerini yeniden kurar.
Yeni dataset özeti mevcut efektlerle kategori ve Feature listesini yeniden okutur;
harita fit ve refresh olur. Yeni aktif proje bilgisi reset sonrasında yerleştirilir.

App workspaceVersion ve selectionVersion, eski async liste/kategori/seçim
sonuçlarını reddeder. MapController requestVersion eski viewport sonuç/hatalarını
yenisine uygulamaz. API adaptörünün kuyruk epoch koruması da eski workspace için
bekleyen yazmaları reddeder. Repository dispose veya değiştirme yapılmaz.

Ham dosya/JSON importu backend'de aynı workspace'in proje bağlantısını korur;
App de aktif projeyi koruyup çalışmayı dirty işaretler. Yeni boş çalışma ise
bağlantıyı temizler. Sayfa yenilemek yine yeni boş workspace oluşturur: Projelerim
ile kayıtlar yeniden listelenir ve kullanıcı seçerse açılır. Snapshot'lar kalıcıdır;
her geçici workspace'in otomatik geri yükleneceği varsayılmamalıdır.

## Testler ve dosyalar

`tests/fixtures/project-management.vite.config.ts` artık App kaynak koduna hiçbir
mount enjekte etmez; yalnız test önbelleğini ayırır. Yeni gerçek tarayıcı testi:
çiz–kaydet–yenile–aç–koordinat/properties doğrula–düzenle–yeniden kaydet–yeniden aç;
Kaydet/İptal/Kaydetmeden Devam Et; JSON taslağı iptali; yarım çizim; Yeni öncesi
kaydetme; 409; silme onayı/iptali; mobil menü ve yatay taşma kontrollerini kapsar.
Eski tarayıcı testi local modda bayrak açıkken ve API modda bayrak kapalıyken
kontrollerin görünmediğini doğrular. Bütün test DB'leri geçici ve izoledir.

```bash
npm test
RUN_BROWSER_INTEGRATION=1 ./node_modules/.bin/vitest run --config tests/api.integration.config.ts
npm run build
cd backend
.venv/bin/python -m pytest -q
```

2026-11-06 son sonuçlar: **115 frontend testi geçti**, PERF_FILE isteyen mevcut
büyük dosya testi atlandı; **4 gerçek entegrasyon testi geçti**; **300 backend
testi geçti** (16,22 sn). TypeScript kontrolü ve özellik açık API Vite build'i
başarılı. Local mod ile özellik kapalı API modu gerçek tarayıcıda doğrulandı.
Tüm geliştirme/test veritabanları birbirinden ayrı tutuldu. Açık kalan test hatası
yoktur. Yenilemede boş workspace, uygulanmamış JSON'u kaydetmeden önce uygulama
gerekliliği ve Ctrl+S'nin export davranışı yukarıda açıklanan bilinçli sınırlardır.

Başlıca değişiklikler: App.tsx bağlantısı; üç proje bileşen/stil dosyası; MapController
için pending-edit ve eski viewport hata koruması; .env.example açıklaması; iki
tarayıcı testi, unit test ve test Vite config'i. Backend endpointi, veri modeli,
migration ve GeoJsonRepository sözleşmesi değişmedi. Tema ve temel harita/çizim
algoritmaları yeniden yazılmadı.

Tam dosya listesi (yeni olan yalnız bu rehberdir):

```text
.env.example
docs/API_MODE.md
docs/PROJECT_UI.md
docs/PROJECT_UI_INTEGRATION.md
src/App.tsx
src/components/projects/ProjectDialogs.tsx
src/components/projects/ProjectManagement.tsx
src/components/projects/projects.css
src/map/MapController.ts
tests/fixtures/project-management.vite.config.ts
tests/integration/browserModes.test.ts
tests/integration/projectManagement.browser.test.ts
tests/unit/projectManagement.test.tsx
```

7D-2 dosyaları güvenlik kontrolünden sonra yerel `df03231` commit'ine alındı.
Önceki b9a6398 ve c287927 commit'leri korundu. Dal abdullah-backend, upstream
origin/abdullah-backend; dal üç commit ileride. 7D-3 değişiklikleri commit edilmedi;
push/pull/fetch/merge/rebase yapılmadı. Test verileri ve gizli .env dosyaları Git'e
alınmadı. Sonraki aşama kullanıcı onayına bağlıdır.
