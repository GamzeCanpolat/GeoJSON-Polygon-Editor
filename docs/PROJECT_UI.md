# Proje yönetimi arayüzü — Aşama 7D-2

## Teslim ve özellik bayrağı

Yeni bileşenler hazırdır; **App.tsx içinde import/mount edilmedi**. Mevcut ekranda
yeni buton yoktur. `VITE_PROJECT_MANAGEMENT` varsayılanı kapalıdır; `.env.example`
`false` içerir. Tek başına bayrağı true yapmak da mevcut App'e ekran eklemez.
Aktif bağlantı için kullanıcı onayı ve Gamze ile yerleşim kararı beklenir.

Onay sonrası kullanılacak tek giriş `ProjectManagementFeature` bileşenidir.
Bayrak tam olarak `true` değilse veya repository ApiGeoJsonRepository değilse
hiçbir şey render etmez ve istek göndermez. Local veriler API'ye taşınmaz.

## Bileşenler

- `src/components/projects/ProjectManagement.tsx`: Kaydet/Farklı Kaydet/Projelerim
  kontrolleri, proje/sürüm bildirimi, asenkron işlem kilidi, hata ve başarı mesajları.
  Aynı repository örneğinin `.projects` servisini kullanır.
- `ProjectDialogs.tsx`: isim vererek kaydetme, sürümlü proje listesi ve arama/
  sayfalama, ad değiştirme, açma uyarısı ve silme onayı. Klavye odağı dialog içinde
  tutulur; Escape/geri dönüş ve dosya drop olayları arka plandaki editöre geçmez.
- `projects.css`: yalnız yeni sınıfları kapsar; mevcut tema değişkenlerini ve
  button sınıflarını kullanır. Global tema veya mevcut CSS dosyaları değiştirilmedi.

İlk Kaydet ve Farklı Kaydet `create(name)` çağırır. Sonraki Kaydet son bilinen
id/version ile `save` çağırır. İsim değiştirme version'ı günceller ama kaydedilmemiş
geometriyi kaydedildi saymaz. Silme ayrı bir onay olmadan çağrılmaz; açık workspace
verisi silinmez. Başarısız işlemler aktif proje veya editör reset callback'ini
çalıştırmaz. 409 kullanıcıya açıkça gösterilir; listeyi yenileyip karar vermesi
istenir. Eski yazma otomatik tekrarlanmaz. Ağ hatasında local moda geçiş yoktur.

Kaydetme, uygulanmamış JSON taslağı varken kapalıdır. Proje açma sırasında dirty
veya JSON taslağı varsa onay istenir. Önceki workspace sunucuda korunur; uygulanmamış
tarayıcı taslağı bırakılır. Kayıtlı snapshot yeni workspace'e kopyalanır; eski
snapshot kendiliğinden değişmez. Otomatik save veya otomatik proje açma yoktur.

## Onay sonrası gereken en küçük App bağlantısı

Bu değişiklikler **yalnız test eklentisinde örneklenmiştir; App'e uygulanmadı**:

1. `activeProject: Project | null` durumunu ve bir Feature mount noktasını eklemek.
   Aynı `repository` örneği, dataset, dirty/codeDirty ve busy bilgilerini vermek.
2. `onOperationBusyChange`: mevcut operationLock ve busy durumunu eşzamanlı
   güncellemek. İstek sürerken harita, import ve klavye yazmaları kilitlenmelidir.
3. `onSaved`: başarı yanıtındaki proje sürümünü kullanmak, dirty'yi temizlemek.
   Snapshot kaydı ile dataset revision birbirine eşit varsayılmamalıdır.
4. `onOpened`: mevcut resetState helper'ını çalıştırmak; selectionVersion, seçim,
   undo/redo, gizli ID'ler, arama/sayfa ve JSON taslağını temizlemek. Yeni
   workspace.dataset özetini set etmek, haritayı fit/refresh etmek. workspaceKey
   değişimi JSON/tablo panellerini yeniden oluşturur; mevcut dataset efektleri
   kategori ve listeyi yeni repository bağlamından okur. Callback senkron ve
   hatasız state güncellemesi olmalıdır; service o sırada yeni workspace'e geçmiştir.
5. `onActiveProjectChange`: kontrollü activeProject durumunu güncellemek. Dışarıdan
   Yeni/import/reset yapıldığında aktif proje bağlantısını da sıfırlamak; proje
   açma callback'inden sonra gelen yeni proje bilgisini yerleştirmek.
6. `onDeleted(id)`: yalnız silinen proje aktif projeyse kalan düzenlenebilir
   workspace'i kaydedilmemiş olarak işaretlemek. Başka projeyi silmek mevcut
   editörün dirty durumunu değiştirmemelidir.

Gamze ile buton yerleşimi, dialog metinleri, dirty uyarısından Kaydet'e dönüş,
çatışma sonrası Farklı Kaydet/Aç seçenekleri ve sayfa yenileme sonrası proje
seçimi kararlaştırılmalıdır. Yenilemede yeni boş workspace davranışı korunur;
kullanıcı Projelerim'i açınca kayıtlar tekrar listelenir, otomatik açılmaz.

## Gerçek tarayıcı testi ve sonuçlar

`tests/fixtures/project-management.vite.config.ts` yalnız test komutuyla yüklenir.
App kaynak metnine **bellekte** bir mount ekler; diskteki App değiştirilmez. Bu
bağlantı test ortamında bayrak açıkken çalışır. Fixture, onay bekleyen gerçek
yerleşim tasarımı değildir. Teste özel Vite önbelleği geçici klasördedir.

`tests/integration/projectManagement.browser.test.ts` ayrı headless Chrome profili,
Vite/FastAPI/worker ve geçici SQLite kullanır. Gerçek editörde Polygon çizilir;
isimle Kaydet yapılır; sayfa yenilenir; boş workspace doğrulanır; Projelerim'den
proje açılır. Koordinat/properties snapshot ile karşılaştırılır, seçim ve geri alma
geçmişinin temiz olduğu kontrol edilir. Gerçek JSON panelinde geometri/properties,
dış id ve Z değiştirilip yeniden kaydedilir. Harici version artışından sonra
Kaydet'in 409 göstermesi, Sil/Vazgeç'in kaydı koruması ve açık silme onayı test edilir.
Eski üç entegrasyon testi de çalıştırılır. Geliştirme veritabanı kullanılmaz.

Sonuçlar (2026-11-06):

- Frontend: **111 geçti**; PERF_FILE gerektiren mevcut büyük dosya testi atlandı.
  Yeni bileşen testleri 12 senaryo: kapalı bayrak, API/local ayrımı, kaydetme,
  Farklı Kaydet, taslak, çift tıklama, dirty açma, silme onayı, isim değişikliği ve hatalar.
- Gerçek entegrasyon: **4 geçti** (proje UI dahil iki tarayıcı + iki HTTP testi).
- Backend: **300 geçti** (21,15 sn); backend koduna/migration'a dokunulmadı.
- TypeScript ve Vite build başarılı. Proje ekranları ana build'de mount edilmez.
- İlk toplu çalıştırmada iki Vite tarayıcı testi ortak optimizer önbelleği nedeniyle
  birbirini yeniden yükledi. Önbellek ayrılıp entegrasyon dosyaları sıralandıktan
  sonra dört test birlikte başarılı oldu; ürün kaynaklarına workaround eklenmedi.

## Terminalde yapılacaklar

Mevcut uygulamayı normal kullanmak için önceki API/local komutları değişmedi
([API_MODE.md](API_MODE.md)). Bu teslimi görmek için gerçek App'i değiştirmeniz veya
.env oluşturmanız gerekmez. Otomatik test aşağıdaki komutla bileşenleri yalnız
izole test ortamında etkinleştirir (macOS Chrome ve kurulu backend/.venv gerekir):

```bash
cd ~/Desktop/GeoJSON-Polygon-Editor
npm test
RUN_BROWSER_INTEGRATION=1 ./node_modules/.bin/vitest run --config tests/api.integration.config.ts
npm run build
```

İsterseniz test görüntüsü üretmek için ikinci komuta
`PROJECT_UI_SCREENSHOT=/private/tmp/geojson-project-ui.png` değişkenini ekleyin.
Backend doğrulaması:

```bash
cd ~/Desktop/GeoJSON-Polygon-Editor/backend
.venv/bin/python -m pytest -q
```

## Git durumu ve dosyalar

7D-1'in altı ilgili kaynak dosyası güvenlik kontrolü sonrası yalnız yerelde
`c287927` (`Add shared project repository and snapshot integration tests`)
commit'ine alındı. Dal abdullah-backend, upstream origin/abdullah-backend korunuyor.
Başlangıçta bulunan b9a6398 commit'i de korundu; dal origin'den iki commit ileride.
Push/pull/fetch/merge/rebase veya dal değiştirme yapılmadı. 7D-2 henüz commit edilmedi.

Yeni dosyalar: üç `src/components/projects/` dosyası, bu belge,
`tests/unit/projectManagement.test.tsx`, test Vite fixture'ı ve yeni tarayıcı testi.
Güncellenen mevcut dosyalar: `.env.example` (kapalı bayrak), `vitest.config.ts`
(tsx test keşfi), `tests/api.integration.config.ts` (sıralı entegrasyon).
App/harita/tema/çizim/kategori/import bileşenleri, GeoJsonRepository sözleşmesi ve
backend değişmedi. SQLite, .env ve test çıktıları Git'e eklenmedi.
