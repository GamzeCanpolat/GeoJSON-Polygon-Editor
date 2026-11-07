# Aşama 8B — Tablo düzenlemesi ve proje snapshot kaydı

Tarih: 2026-11-06. Çalışılan depo:
`/Users/apocrc/Desktop/GeoJSON-Polygon-Editor`.

## P1: kesin neden

Eski sıralama şöyleydi:

1. Tablo input'u odağı kaybedince asenkron hücre kaydı başlıyordu.
2. FeatureTable, özgün Feature'ı almak için `repository.get()` bekliyordu.
   Henüz App'in `operationLock` kilidi alınmamıştı.
3. Projeyi Kaydet, aynı kilidi hemen alıp ProjectRepository üzerinden snapshot
   kaydını başlatıyordu.
4. GET tamamlanınca hücrenin `onApply` çağrısı App.commit'e ulaşıyordu.
   Proje işlemi kilidi tuttuğundan commit `false` dönüyordu.
5. Hücre uygulanamıyor, fakat eski dataset snapshot'ı başarıyla kaydediliyordu.

API adaptöründeki FIFO tek başına bunu çözmez: hücrenin mutate isteği GET
tamamlanana kadar kuyruğa eklenmez. Proje kaydı araya girebilir. Dataset revision
ve project.version kontrolleri kendi açısından doğru olan eski snapshot'ı
reddetmez; sorun snapshot'tan **önce** frontend düzenlemesinin tamamlanmamasıdır.

## Uygulanan çözüm

- `PendingEditorEdits`: editörlerin taslak ve devam eden işlem durumunu izleyen
  ortak bariyer. Hücrenin aynı bekleyen Promise'ını hem blur hem Kaydet bekler.
- FeatureTable, input'u kontrollü tutar; draft'ları dahili Feature ID ve alan
  adıyla saklar. Her hücre tam Feature'ı okuyup yalnız ilgili property'yi
  değiştirir. Birden çok hücre sırayla uygulanır; dış ID, diğer properties ve Z
  koordinatları korunur.
- ProjectManagement önce kendi tekrar tıklama kilidini alır; hücre bariyerini
  bekler; devam eden harita düzenlemesini yeniden kontrol eder; **sonra** App'in
  snapshot kilidini alır. Hücre commit'inin ihtiyaç duyduğu kilidi önceden
  tutmadığından deadlock oluşmaz.
- Hücre hatası, doğrulama hatası veya bekleme zaman aşımında snapshot çağrılmaz;
  başarı mesajı verilmez. Hücre değeri korunur. Hata sonrasında Kaydet sessizce
  mutation'ı tekrar göndermez. Kullanıcı hücreyi düzeltebilir, Escape ile kendi
  taslağını bırakabilir veya açıkça **Tekrar dene** seçebilir.
- Bariyerin bekleme sınırı 30 saniyedir. Zaman aşımı gönderilmiş bir HTTP
  mutation'ının iptal edildiği anlamına gelmez; editör bu işlemi izlemeye devam
  eder. Sonradan gelen yanıt proje snapshot'ını kendiliğinden kaydetmez.
- Tablo bir kez açıldıktan sonra JSON sekmesine geçildiğinde unmount edilmez;
  hatalı/bekleyen hücre taslağı korunur. Yeni workspace'te mevcut workspaceKey
  mekanizmasıyla editör yeniden oluşturulur.
- Yeni çalışmaya geçmeden Kaydet akışı da aynı bariyeri bekler. Tablo taslağı
  dirty, sayfadan ayrılma ve panel kapatma kontrollerine katılır. Uygulanmamış
  tablo taslağı varken JSON'dan değiştirme ve undo/redo engellenir.
- Uygulanmamış JSON otomatik kaydedilmez. Bariyer beklerken yeni JSON taslağı
  oluşmuşsa canlı ref üzerinden tekrar kontrol edilir. Devam eden çizim ve
  düzenleme korumaları sürer; bariyer sonrası da kontrol edilir.

Backend modelleri, transaction/snapshot servisleri, API adaptörleri,
`contracts.ts`, `INTEGRATION.md` ve çalışma modu seçimi değiştirilmedi.

## Değişen dosyalar

Ürün kaynakları:

- `src/App.tsx`
- `src/components/DataPanel.tsx`
- `src/components/FeatureTable.tsx`
- `src/components/projects/ProjectManagement.tsx`
- `src/data/PendingEditorEdits.ts` (yeni)

Test ve dokümantasyon:

- `tests/unit/projectManagement.test.tsx`
- `tests/unit/featureTablePending.test.tsx` (yeni)
- `tests/unit/pendingEditorEdits.test.ts` (yeni)
- `tests/integration/tableSave.browser.test.ts` (yeni)
- `tests/integration/browserModes.test.ts`
- `tests/fixtures/project-management.vite.config.ts`
- `docs/STAGE8B_REPORT.md` (bu dosya)

## P1 için gerçek Chrome kanıtı

Yeni browser testi ayrı geçici SQLite, FastAPI, worker, Vite önbelleği ve Chrome
profili oluşturur. Native klavye/fare ile hücre düzenleyip doğrudan Kaydet'e
tıklar. Chrome Fetch interception ile hücre GET isteğini bilinçli olarak
bekletir. İstek serbest bırakılmadan proje sürümünün değişmediğini doğrular.
Böylece yarış penceresi yalnız şansa veya sabit sleep'e bağlı değildir.

| Ek ağ gecikmesi | Aktif SQLite Feature name | Snapshot Feature name | Project.version |
| --- | --- | --- | --- |
| 0 ms | Save click race 0 | Save click race 0 | 2 |
| 200 ms | Save click race 200 | Save click race 200 | 3 |
| 650 ms | Save click race 650 | Save click race 650 | 4 |

Her turda birden çok Kaydet tıklaması yalnız **bir** yeni proje sürümü üretir.
Aktif workspace ve kaydedilmiş proje Feature JSON'u SQL ile ayrı ayrı okunur.

Diğer doğrulamalar:

| Senaryo | Doğrulanan sonuç |
| --- | --- |
| Yenile, Projelerim, Aç | Son `Save click race 650` değeri geri gelir |
| Enter ile uygula, Kaydet | Aktif veri ve snapshot `Enter then Save` olur |
| Hücre mutation'ına enjekte edilen HTTP 503 | Snapshot ve sürüm değişmez; aktif veri de eski kalır; yeni input değeri korunur |
| Hata sonrası tekrar Kaydet | Otomatik hücre retry veya snapshot isteği yapılmaz |
| JSON/Tablo sekmeleri arasında geçiş | Hatalı hücrenin metni korunur |
| Tekrar dene, ardından Kaydet | Yeni değer hem aktif veriye hem snapshot'a geçer |
| Bekleyen hücre varken Projelerim/Aç | Bariyer bitmeden workspace değiştirilmez; Kaydet ile geçişte hücre snapshot'a dahil edilir |
| Hücre beklerken yeni geçersiz JSON taslağı | Tablo değişikliği tamamlanır; proje sürümü/snapshot değişmez; `{` taslağı editörde kalır |
| Devam eden çizim | Kaydet/Proje işlemi başlamaz; çizim kullanıcıda kalır |

Aşama 8A'nın orijinal 200 ms reproducer'ı da düzeltme üzerinde geçti:
`savedName = liveName = "Save click race"`; proje sürümü 3. Yeni deterministik
test bu geçici reproducer'ın yerine depoda kalıcı regresyon kapsamı sağlar.

## P2: browserModes gezinme hatası

Hata yeni günlüklerle tekrar üretildi. Aynı anda şu iki kanıt görüldü:

```text
[vite] new dependencies optimized: ol/format/WKT, ol/format/Polyline
[vite] optimized dependencies changed. reloading
Page.frameRequestedNavigation reason=reload
Runtime.evaluate: Inspected target navigated or closed
```

Excel converter modülü uzun asenkron testin ortasında import ediliyordu. Soğuk
Vite optimizer bu formatları sonradan bulup tam sayfa reload tetikliyordu.
HTTP `/` hazır yanıtı ve haritanın yüklenmesi bu geç optimizasyonu engellemez.
Reload, devam eden evaluate bağlamını yok ediyordu. API/local süreçlerinin
ortak cache kullanması da güvenli bir izolasyon değildi.

Test fixture'ında lazy bağımlılıklar (`xlsx`, `@streamparser/json`,
`ol/format/WKT`, `ol/format/Polyline`) başlangıçta optimize edilir. Her API/local
Vite süreci ayrı geçici cache kullanır. Belge hazır olma kontrolü ve hata
halinde gezinme/Vite günlükleri eklendi. Sayfa, test tamamlanıp sonuçlar
alınmadan kapatılmıyor; teardown mevcut finally içinde kalıyor.

Mutasyon yapan evaluate çağrılarına retry veya hatayı gizleyen sabit sleep
eklenmedi. Düzeltme sonrasında browserModes **üç ayrı soğuk cache çalışmasında**
geçti (9,27 sn, 8,53 sn, 10,28 sn test süreleri). Bunların son ikisi toplu
paket çalışmasıydı. Bu ölçümler önceki tek olayın günlüğünü geriye dönük
oluşturmaz; aynı hatanın yeni tekrarındaki neden doğrudan gözlemlenmiştir.

## Regresyon sonuçları

- Frontend standart paket: **127 geçti**, PERF_FILE gerektiren 1 test bu komutta
  atlandı. Önceki 115 test korunur; 12 yeni unit senaryosu vardır.
- Atlanan büyük dosya testi ayrıca çalıştırıldı ve **geçti**: 96,70 MiB,
  140.000 Feature, 3.500.000 vertex; import 8,72 sn, toplam 24,77 sn,
  viewport 2.500 kayıt; import/export Feature hash'leri eşit.
  Bu Node + fake-indexeddb ölçümüdür, Chrome performans ölçümü değildir.
- Böylece frontend unit kapsamının tamamı ayrı çalıştırmalar toplamında
  **128 başarılı** testtir; sonuçta çalıştırılmamış unit testi kalmadı.
- Backend: **300 geçti**, 23,24 sn; geçici SQLite fixture'ları kullanıldı.
- Gerçek API/browser entegrasyonu: **5 geçti** (3 Chrome, 2 HTTP).
- Aşama 8A'nın ek geçici UI regresyonu da yeniden çalıştırıldı: **1 geçti**,
  9,95 sn. Tablo, tam koordinat/ID/properties, undo/redo, sil/geri al,
  ana/alt kategori, tema, Farklı Kaydet snapshot izolasyonu, yeniden adlandırma,
  mobil 390×844 menü ve çevrimdışı hata/no-fallback kontrolleri kapsanır.
- TypeScript `tsc --noEmit` ve Vite production build geçti.
- `git diff --check` temiz.

Test geliştirme sırasında iki senkronizasyon sorunu giderildi: GET kapısının
önceki tablo refresh isteğini yakalaması ve JSON sekmesi görünür olmadan
focus verilmesi. Test artık önce hücrenin hazır olduğunu bekler, kapıyı blur'dan
hemen önce kurar; JSON'da görünürlük ve girilen gerçek değeri ayrıca doğrular.
Bu test sorunları ürün hatası olarak raporlanmamıştır.

Tekrar çalıştırma (depo kökünden):

```bash
npm test
RUN_BROWSER_INTEGRATION=1 npx vitest run --config tests/api.integration.config.ts
npm run build
cd backend
.venv/bin/python -m pytest -q
```

Entegrasyon komutu gerekli geçici sunucuları ve worker'ı kendi başlatır/kapatır;
mevcut geliştirme servislerinin veya gerçek veritabanının kullanılması gerekmez.
Büyük dosya testi `PERF_FILE` ile var olan bir test dosyasına açıkça işaret edilerek
çalıştırılır; bu aşamada önceki aşamanın geçici üretilmiş dosyası kullanıldı.

## Mac üzerinde manuel doğrulama

Kaydedilmiş kullanıcı projeleri yerine ayrı bir test ortamı/projesi kullanın.
API modu ve proje yönetimi açık olmalıdır.

1. Polygon oluşturun, tabloya `name` alanı ekleyin, bir test projesi kaydedin.
2. Chrome DevTools Network'te özel throttling ile 200 ms, ardından 650 ms gecikme
   ayarlayın. Hücreye yeni değer yazıp Enter'a basmadan doğrudan Projeyi Kaydet'e
   tıklayın. İşlem tamamlanana kadar başarı mesajı gelmemeli.
3. Yenileyin; Projelerim'den açın. Son hücre değeri aynı kalmalı. Enter ile
   uygulayıp kaydetme yolunu da deneyin.
4. DevTools Request blocking ile `*/mutations` isteğini engelleyip hücre
   değiştirin ve Kaydet'e tıklayın. Proje başarı bildirimi gelmemeli; hücre metni
   ve hata görünmeli. Projeyi yeniden açmadan önce metni kontrol edin. Engeli
   kaldırıp Tekrar dene'ye, ardından Kaydet'e tıklayın.
5. Kaydet'e art arda tıklayın; tek yeni sürüm oluşmalı. Bekleyen hücre varken
   Projelerim'e geçişi ve açma uyarısındaki İptal/Kaydet seçeneklerini kontrol edin.
6. Geçersiz JSON `{` taslağıyla kaydetmeyi deneyin; taslak korunmalı, proje
   kaydedilmemeli. Yarım çizimde de Kaydet yerine tamamla/Escape uyarısı görülmeli.

## Git ve veri güvenliği

Dal `abdullah-backend`, upstream `origin/abdullah-backend`.
Başlangıç ve bitiş HEAD: `2fe441a2b3539411ae61fdc011983ebda205da34`.
Değişiklikler stage edilmedi; commit veya uzak Git işlemi yapılmadı.
Backend kaynakları ve migration'lar değiştirilmedi; gerçek geliştirme SQLite
veritabanı bu aşamanın testlerine açılmadı, silinmedi veya sıfırlanmadı.
SQLite/upload dosyaları, gerçek .env, sanal ortam ve node_modules stage edilmedi.

Aşama 8B kapsamındaki P1 ve yeniden üretilen P2 için açık kalan hata yoktur.
Yeni bir aşamaya geçilmedi.
