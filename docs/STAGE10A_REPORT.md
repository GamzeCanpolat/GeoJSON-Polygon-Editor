# Aşama 10A — Son kabul testleri ve teslim hazırlığı

Tarih: 6 Kasım 2026. Test edilen ürün commit'i: **bbf17d2**.
Yalnız test, analiz ve dokümantasyon çalışması yapıldı.

**Kabul kararı:** İşlevsel test paketleri başarılı; PR incelemesine hazırlanabilir.
Ancak mevcut çalışma ortamına koşulsuz gerçek veri teslim onayı verilmiyor:
SQLite sürümü için P1 ortam riski, mobil aydınlık temada P2 okunabilirlik sorunu
ve main birleştirmesinde README çakışması açık. Ürün kodu veya ortam bu aşamada
değiştirilmedi.

## 1. Tamamlanan özellikler

React + TypeScript + OpenLayers frontend; Local Worker/IndexedDB ve
FastAPI + SQLAlchemy + SQLite API modları; Alembic 0001/0002/0003 migration'ları;
SQLite R-Tree; ijson import worker'ı; Shapely doğrulama servisleri hazır.

| Özellik | Kabul sonucu / kapsam |
| --- | --- |
| Polygon çizme/düzenleme/silme | Mevcut Chrome testleri native çizim ve SQLite kaydını; ek koşu native köşe sürüklemesini doğruladı. |
| Point, LineString | Ek Chrome koşularında araçtan çizildi, JSON panelinde koordinatı değiştirildi; undo/redo ile önceki/yeni geometri doğrulandı. Mobilde dokunmayla Point çizildi. |
| MultiPolygon | Import ile oluşturuldu, gerçek harita köşesi sürüklendi. Dış ID, properties ve Z korundu. Ayrı MultiPolygon çizim aracı yoktur. |
| Undo/redo | Gerçek UI ve mevcut birim testleri başarılı; silme/aynı dahili ID ile geri yükleme ayrıca API/DB testlerinde geçti. |
| GeoJSON import/export | Local/API, iptal, geçersiz dosya, tam Feature hash karşılaştırması ve bütün kayıtları export başarılı. |
| Excel | Dönüştürücü regresyonları ve gerçek .xlsx dosya seçimi/worker dönüşümü/API importu geçti; 10.000 satır mevcut 16.320 Feature'a eklenerek 26.320 oldu. |
| Ana/alt kategori | Gerçek UI'de Türkçe ana/alt kategori oluşturuldu. Atama, normalizasyon, kullanılmayan katalog koruması mevcut test paketlerinde başarılı. |
| JSON / Tablo | JSON koordinat/property düzenleme, taslak engelleri, büyük sayı hücreleri ve bekleyen hücre kaydı bariyeri geçti. |
| Properties / koordinat | İç içe alanlar, normal JSON türleri, dış/dahili ID ayrımı ve Z korunması birim, HTTP ve Chrome testlerinde doğrulandı. |
| Kaydet / Farklı Kaydet | Snapshot oluşturma, bağımsız kopya, proje version/revision ayrımı ve gerçek UI'de iki ayrı kayıt başarılı. |
| Yenileme / tekrar açma | Yeni boş workspace sonrası Projelerim → Aç; koordinat/property ve büyük sayılar korundu. Otomatik proje açılması beklenmedi. |
| Yeniden adlandırma / silme | UI rename ve liste güncellemesi geçti; silme onayı/iptali mevcut Chrome paketinde başarılı. |
| Kaydedilmemiş değişiklik | Kaydet / Kaydetmeden Devam Et / İptal; geçersiz JSON ve yarım çizim koruması geçti. |
| 409 / 422 / bağlantı | Gerçek 409 UI, gerçek API 422 ve veri koruma testleri geçti. Chrome offline kayıt denemesinde hata gösterildi ve snapshot/version değişmedi. |
| Local / API / özellik bayrağı | Local ve proje bayrağı kapalı API modu mevcut Chrome testinde doğrulandı; sessiz local fallback yok. |
| Masaüstü / mobil | 1400×1000 ve 390×844 Chrome emülasyonu; panelleri kapatıp haritaya erişim, dokunma, mobil proje menüsü ve taşma kontrolü geçti. Görsel kontrast kusuru bölüm 3'te. |

Tablodaki bütün işlemler her tarayıcıda ve her veri boyutunda test edilmiş
değildir. API 422 testinin ana UI üzerinden bütün olası sunucu doğrulama
hatalarını ürettiği iddia edilmiyor; gerçek API/adapter ve UI hata testleri birlikte
değerlendirildi. Point/LineString koordinat düzenlemesi JSON editöründen,
Polygon/MultiPolygon düzenlemesi native köşe sürüklemesiyle yapıldı.

### Önceki P1'lerin tekrar doğrulanması

**A — Hücreden doğrudan Kaydet:** tableSave.browser.test.ts içinde mutation
isteği deterministik kapıda bekletildi; 0/200/650 ms gecikme ve yinelenen Kaydet
tıklamaları tekrar geçti. Aktif dataset ve proje snapshot'ında son
“Save click race …” değeri aynıydı. Hücre HTTP 503 hatasında başarı mesajı/snapshot
üretilmedi, taslak korundu ve açık Tekrar dene sonrası kaydedilebildi.
Enter, yenileme/açma ve bekleyen hücreyle proje değiştirme de geçti.

**B — Büyük sayılar:** losslessJson ve losslessNumbers testlerinde
9007199254740991, 9007199254740992, 9007199254740993, 9007199254740995 ve
-9007199254740993 tekrar korundu. Kontrol yalnız JS Number eşitliğiyle yapılmadı:
özgün JSON sayı token'ı, bigint ve SQLite/Python tamsayıları karşılaştırıldı.
Local Worker/IndexedDB, API get/mutate/export, JSON/tablo düzenleme ve
snapshot → yenileme → tekrar açma geçti. String ID string kaldı; olmayan ID
üretilmedi; Z/özgün properties değişmedi. 10 MB büyük ID fixture'ı da ayrıca geçti.

## 2. Test sonuçları

Bütün aşağıdaki sonuçlar **10A'da yeniden çalıştırıldı**. Önceki raporlardaki
sonuçlar yeni koşu gibi sunulmadı. Özel testler yalnız geçici dizinlerdeydi;
depo test kaynakları değiştirilmedi.

| Komut / paket | Sonuç |
| --- | --- |
| npm test | 147 geçti, 1 koşullu büyük dosya testi bu komutta atlandı; 2,82 sn |
| PERF_FILE ile large-file.test.ts | 101,40 MB normal ve 10 MB büyük ID verisinde ayrı başarılı koşular |
| Frontend benzersiz test toplamı | **148 başarılı**: 147 standart + 1 koşullu test; aynı testi iki fixture ile çalıştırmak toplamı artırmaz |
| backend/.venv/bin/python -m pytest -q | **315/315 başarılı**, 14,95 sn |
| RUN_BROWSER_INTEGRATION=1 vitest …api.integration.config.ts | **8/8 başarılı**, 39,37 sn: 3 gerçek HTTP + 5 Chrome vakası |
| Ek masaüstü/10 MB kabul script'i | Local ve API **2/2 başarılı** |
| Ek mobil dokunma script'i | Local ve API **2/2 başarılı**; fiziksel cihaz değildir |
| npm run build | TypeScript ve varsayılan Local Vite build başarılı; Vite 2,50 sn |
| API + proje bayrağı açık npm run build | TypeScript ve Vite build başarılı; Vite 2,68 sn |
| pip check / npm ls --depth=0 | Bağımlılık tutarsızlığı bulunmadı |
| Geçici DB yedek / ayrı dizine restore | Kaynak, yedek ve restore'daki tüm tablolar eşleşti; integrity/FK/R-Tree geçti |
| Görsel mobil aydınlık tema kontrolü | **Başarısız okunabilirlik bulgusu**: Projeler etiketi, bölüm 3 |

Ek ad hoc script'ler ana test sayısına eklenmedi. Kontrast gözlemi için yapılan
tekrar yeni benzersiz test olarak sayılmadı. Otomatik işlev testlerinin geçmesi
görsel kusurun olmadığı veya SQLite kitaplık hatasının giderildiği anlamına gelmez.

### Ortam ve izolasyon

Apple M2, 8 çekirdek, 8 GiB RAM; macOS 26.6.2 arm64; Node 24.11.0,
Python 3.13.5; Python SQLite 3.49.1; gerçek headless Google Chrome 157.
Uygulama servisleri rastgele loopback portları, ayrı Chrome profilleri ve ayrı
SQLite/upload/cache dizinleri kullandı. Backend testleri ek olarak geçici
fallback DB ve pytest basetemp ile çalıştırıldı.

Kullanıcının gerçek DB'si test/benchmark/backup için açılmadı; kullanıcı kayıtları,
WAL/SHM dosyaları ve açık kullanıcı servisleri değiştirilmedi veya silinmedi.
9B raporundaki önceki iki boş workspace gözlemi bu aşamada temizlenmeye çalışılmadı.
Yeni kaynak kodu değişmediği için kullanıcı arayüzüne bir kod HMR güncellemesi
gönderilmedi.

Kanıtlar 10A denemesine ayrılan geçici dizinde tutuldu.
frontend.log, backend.log, integration.log, build.log, build-api.log,
browser-results.json, mobile-results.json, contrast-results.json,
durability-results.json, backup-restore.json, node-large.log,
node-large-resources.json, node-bigint.log ve server-large-105mib.json.
Bunlar geçici test çıktılarıdır; Git'e eklenmedi ve kalıcı dağıtım bağımlılığı değildir.

### Büyük dosya koruması ve ölçümler

| Test / veri | Ölçülen sonuç |
| --- | --- |
| Node + fake-indexeddb: 101.396.107 byte, 140.000 Polygon, 3.500.000 vertex | Import 10,12 sn; export 8,90 sn; hash/viewport dahil toplam 34,46 sn; süreç ağacı tepe RSS 1162,55 MiB; örneklenmiş CPU 34,35 sn |
| Node + fake-indexeddb: 10.000.053 byte, 13.235 karma Feature, 66.176 vertex, büyük ID'ler | Import 0,77 sn; export 0,68 sn; toplam 2,39 sn; bütün Feature hash'leri ve ilk exact bigint ID eşleşti |
| Gerçek Chrome Local: 10.000.010 byte, 16.320 karma Feature, 81.600 vertex | UI import 1,23 sn; Polygon/MultiPolygon native edit, zoom/pan ve paneller başarılı |
| Gerçek Chrome API: aynı karma 10 MB | UI import 12,63 sn; snapshot kaydet 0,27 sn; aç 0,76 sn; 10.000 Excel satırı append 13,99 sn |
| Gerçek HTTP API + worker: 110.100.709 byte = 105,00 MiB, 91.727 Point/Z + payload | Upload 1,251 sn; worker 12,912 sn; aktivasyon 0,005 sn; export 13,535 sn; tüm Feature hash'leri ve metadata eşleşti |
| Aynı 105 MiB API koşusu RSS | API tepe 88,58 MiB; işleyen çocuk 87,30 MiB; worker ağacı 186,34 MiB |
| Ek Chrome kabul script'i toplam süreç ağacı | Tepe 1314,22 MiB; örneklenmiş CPU 69,23 sn; iki mod ve Vite/Chrome/API/worker süreçleri birlikte, tek renderer heap'i değildir |

Node toplam süreleri export/import dışında iki akışlı hash doğrulamasını ve
viewport işlemlerini içerir. Node sonuçları gerçek tarayıcı hızı olarak sunulmaz.
UI import yalnız worker süresi değildir; dialog/HTTP/aktivasyon/state akışını da
içerir. 105 MiB Point/payload dosyası, 9A'nın 100 MB karma veya 101 MB çok köşeli
Polygon fixture'ıyla aynı iş yükü değildir.

Bazı Node/büyük sunucu koşuları ek Chrome kabulüyle aynı zaman aralığındaydı.
Örnekleme 25/50 ms, OS yükü/cache/GC kontrolsüzdür; sayılar tek koşu gözlemidir,
p95/SLA veya sürümler arası hızlanma/yavaşlama kanıtı değildir. 2,2 GiB RSS /
384 MiB kullanılabilir RAM gözetimi geçerli Node/Chrome koşularını kesmedi.

9A'daki 10/50/100/200 MB sunucu matrisi ile 10/50 MB Chrome ölçümleri ve 9B'deki
kayıpsız codec karşılaştırması incelendi. **10A'da 200 MB, 50 MB Chrome veya
100 MB Chrome performans matrisi yeniden çalıştırılmadı.** 50 MB veri bu aşamada
iptal/kesinti fixture'ı olarak kullanıldı; tam başarı performans ölçümü değildir.
9A/9B sonuçları tarihsel kapsam kanıtıdır, yeni koşu sayılmaz.

### SQLite dayanıklılığı

36,65 sn süren ayrı izole senaryoda:

- 10 MB / 16.320 Feature import edildi, 100 ardışık güncelleme 2,88 sn'de geçti.
- Silme ve aynı dahili kimlikle restore geçti.
- Aynı revision'a sekiz eşzamanlı mutation: **1×200, 7×409**.
- Aynı project.version'a iki Kaydet: **1×200, 1×409**.
- 36 eşzamanlı okuma: tamamı 200.
- Geçersiz koordinatlı mutation 422 verdi; dataset değişmedi.
- 50 MB import 500 Feature işlendiğinde iptal edildi; eski aktif dataset korundu,
  staging temizlendi.
- Sonu kesilmiş dosya 16.000 kayıttan sonra failed oldu; yarım dataset
  etkinleşmedi, staging temizlendi.
- Worker SIGKILL ve lease süresi sonrası yeniden başlatmada job failed olarak
  temizlendi; eski dataset korundu.
- Import sırasında workspace/proje açma sonrası eski job aktivasyonu 409 verdi.
- Snapshot yazma transaction'ı sürerken geçici API SIGKILL edildi. Yeniden
  açmada eski snapshot, version ve workspace korundu.

İptal, bozuk dosya ve iki yeniden başlatma sonrasında:
PRAGMA integrity_check=ok, foreign_key_check=[], rtreecheck=ok;
eksik/fazla R-Tree satırı 0. SQLAlchemy bağlantılarında foreign key/WAL ayarı
mevcut backend testlerinde ayrıca doğrulandı. Bu testler elektrik kesintisi,
fiziksel disk arızası veya özel SQLite WAL-reset yarışını simüle etmez.

Yedekleme/restore denemesinde 48.960 Feature satırı, üç dataset, proje, job,
katalog ve R-Tree gölge tabloları dahil bütün tablolar kaynakla aynıydı.
Bu sayılar yalnız sentetik test verisidir.

## 3. Eksik veya sorunlu özellikler

### P1 — SQLite çalışma ortamı teslim koşulu açık

Python SQLite sürümü yerel ölçümde **3.49.1**. Resmi belgede nadir WAL-reset
bozulma yarışı kapsamı 3.7.0–3.51.2 olarak veriliyor; düzeltme 3.51.3 ve belirli
backport'larda bulunuyor. [WAL açıklaması](https://sqlite.org/wal.html),
[3.51.3 sürüm kaydı](https://sqlite.org/releaselog/3_51_3.html).

API ve worker aynı WAL DB'sini ayrı bağlantılardan kullanıyor. Bu nedenle
ortamın risk kapsamına girdiği değerlendirmesi bir **uygulanabilirlik çıkarımıdır**;
özel hata bu projede tekrarlanmadı, veri bozulması gözlenmedi ve önceki disk I/O
hatasına neden olduğu kanıtlanmadı. Geçen regresyonlar bu kitaplık kusurunu gidermez.

**Gerekli işlem:** Python'un kullandığı SQLite'ı düzeltmeli sürüme taşıyın,
sürümü aynı .venv içinden doğrulayın ve DB/worker/eşzamanlılık testlerini tekrar
çalıştırın. Ortam yükseltmesi bu test/dokümantasyon aşamasında yapılmadı.
Genel “Python 3.11+” koşulu tek başına yeterli değildir.

### P2 — Aydınlık temada mobil Projeler etiketi okunaksız

390×844 ekran görüntüsünde Projeler yazısı koyu başlıkta çok düşük kontrastlı.
Computed renkler: yazı rgb(20,33,56), başlık rgb(0,36,43); hesaplanan oran
yaklaşık **1,01:1**. Menü açılıyor, taşmıyor ve işlevsel test geçiyor; görsel
okunabilirlik kabulü başarısız.

İlgili kural src/components/projects/projects.css içindeki project-management
color:var(--ink) mirası ve mobil summary; başlık koyu kalırken aydınlık --ink koyu.
**Öneri:** üst çubuk proje etiketi için uygun tema rengi tanımlayıp hem tema hem
dar/masaüstü menüyü test edin. Stil kodu değiştirilmedi. Bu bir veri kaybı bulgusu
değildir.

### Hazırlık / doğrulama açıkları

- main ile README çakışması var; bölüm 7. Bu aşamada çözmek için merge yapılmadı.
- Yeni, sıfır bir Python dağıtımı/venv üzerinde kurulum yapılmadı. Mevcut ortamda
  pip check, test ve build geçti; düzeltilmiş SQLite ortamında temiz kurulum
  kabulü henüz yapılmış sayılmaz.
- Backend bağımlılıkları pyproject.toml'de sürüm aralıklarıyla tanımlı; tam
  bağımlılık lock dosyası yok. Farklı tarihte temiz kurulum aynı sürümleri
  getirmeyebilir. Frontend package-lock mevcut.
- Fiziksel iPhone/Android, Safari/Firefox, uzun süreli soak ve gerçek güç
  kesintisi testleri yapılmadı. Chrome mobil emülasyonu bunların yerine geçmez.
- Geçmiş disk I/O hatasının kesin nedeni belirlenmiş değildir. Geçici DB'lerde
  bu aşamada yeniden görülmedi; kullanıcı DB'sine test yazımı/probe yapılmadı.

## 4. Bilinen sınırlamalar

- Tek kullanıcılı yerel kullanım; auth/izin/çok kullanıcılı paylaşım ve güvenli
  internet yayını kapsam dışı. Varsayılan bind 127.0.0.1.
- Yenilemede yeni workspace. Yalnız açıkça kaydedilmiş proje kalıcı kullanıcı
  kaydıdır; otomatik save/açma veya workspace resume yok.
- Geçici workspace/dataset birikimi için genel GC/retention yok.
- Ctrl/Cmd+S export; proje kaydı ayrı buton. Uygulanmamış JSON kaydedilemez;
  yarım çizim önce tamamlanmalı/iptal edilmeli.
- Harita limit 2500, seçili kayıt özgün geometriyle getirilir. Tam eşleşme sayımı
  ve büyük snapshot/export işlemleri yine boyuta bağlı maliyet taşır.
- JSON editörü 2 MiB; büyük veri seçili Feature kapsamına geçer. Undo 30 işlem /
  yaklaşık 32 MiB. Çok ayrıntılı tek Feature/token belleğe sığmalıdır.
- Excel 25 MiB, 100 sütun, 100.000 satır, 250.000 Feature, 200 MiB çıktı;
  formül çalıştırma yok. Büyük tamsayı ID hücresi kaynakta metin olmalıdır.
- Büyük tamsayılar exact bigint iç temsiliyle JSON number kalır. Normal float'a
  kayıpsız dönemeyen kesir/koordinat reddedilir; eski yuvarlanmış veri onarılmaz.
- API varsayılan import 512 MiB, kota 4 GiB, batch 500 Feature / 4 MiB;
  işleyen çocuk bellek bütçesi 512 MiB. 100–500 MB her cihaz/dosya için garanti
  edilmez. Disk rezervasyonu da kabul sınırını etkiler.
- Senkron geometri validation 5 MiB / 500 Feature; büyük import limitleri farklı.
  Shapely XY kullanır. Topolojik hatalı import uyarıyla korunabilir; otomatik
  make_valid yok. Feature'lar arası genel örtüşme analizi yapılmaz.
- Local ve istemcide append/merge, category_catalog dışındaki kök metadata'yı
  korumaz; API doğrudan import/export farklıdır. Özgün Feature alanları korunur.
- Kategori ekleme/atama var; katalog rename/delete UI'si yok.
- Altlık döşemeleri dış servis/lisansa bağlı. Testlerde altlık kapatılarak veri
  işlemleri izole edildi; dış harita servislerinin erişilebilirliği kabul kapsamı
  değildir.
- Mobilde paneller haritanın üstüne açılabilir; kapatıldığında harita erişimi ve
  dokunma doğrulandı. Menü okunabilirlik kusuru bölüm 3'te.

## 5. Kurulum durumu

Mevcut kurulu ortamda uygulama ve üç servis birlikte çalıştı; Alembic yalnız
geçici DB'lerde 0003_spatial_index'e yükseltildi. Normal API health, CORS,
R-Tree ve Swagger şeması mevcut testlerde doğrulandı. Gerçek kullanıcı DB'sinde
migration/backup/reset yapılmadı.

Güncellenen belgeler:
README.md, backend/README.md, docs/API_MODE.md;
yeni docs/RUNBOOK.md ve bu docs/STAGE10A_REPORT.md.
Kurulum, mod/özellik bayrakları, üç terminal, testler, kullanım örnekleri,
hata giderme, güvenli backup ve ayrı dizine restore açıklanıyor.
Docs/INTEGRATION.md ve 9A/9B raporları korundu. Kaynak/test/config dosyaları
değiştirilmedi. Yeni gizli .env veya kişisel kullanıcı verisi belgeye eklenmedi.

İşletim rehberindeki backup/restore yöntemi izole DB'de test edildi; kullanıcı
verisine uygulanmadı. İlk gerçek teslim öncesi bölüm 3'teki SQLite önkoşulu
karşılanmalıdır.

## 6. GitHub dal karşılaştırması

Yalnız izin verilen **git fetch origin** çalıştırıldı. Checkout, commit, stage,
push, merge veya rebase yapılmadı. Fetch sonrası ref'ler:

| Ref | Commit |
| --- | --- |
| abdullah-backend / origin/abdullah-backend | bbf17d2405b10fdcda898224af703fc997bf6fe3 |
| origin/main | 9c4ed5cb59f79134d906e90fd8737fbf17f2bd28 |
| origin/gamze-harita-arayuz | 98509dc16582c4eff803a958713e7e5b40f748c5 |

origin/gamze-harita-arayuz, abdullah-backend'in atasıdır: **0/8** ayrı commit.
Gamze dalında alınıp alınmadığı belirsiz yeni frontend commit'i yoktur.

origin/main ile ortak ata ccdc0b9. Ana dala özgü 4, backend dalına özgü 9 commit
var. Main'in ortak atadan sonraki net değişikliği yalnız README.md ve
docs/WORK_PLAN.md'dir; src veya paket kaynaklarında yeni frontend farkı yoktur.
Ayrı main commit'leri: e6239dd (ilk PR merge'i), ab73e16, 6937e27, 9c4ed5c.

**Dosya farkları:** origin/main → bbf17d2 arasında 132 yol:
76 backend, 26 src, 17 tests, 7 docs, 6 kök dosya.
Gamze dalı → bbf17d2 arasında 131 yol. Tam main fark listesi Ek A'da.
Bu liste commit'leri karşılaştırır; henüz commit edilmemiş 10A belgelerini
içermez. Mevcut çalışma ağacındaki beş dosya yalnız dokümantasyondur.

## 7. Olası merge conflict'ler

Salt okunur eski üç argümanlı git merge-tree önizlemesi kullanıldı; çalışma
ağacı veya index'te merge yapılmadı, birleşik kod oluşturulmadı. Çıktıdaki
conflict marker'ları incelendi; exit 0 tek başına çakışmasız kabul edilmedi.

- **README.md: çakışma önizlemede doğrulandı.** Main'in belge sadeleştirmesi ile
  backend dalının eski geliştirme/kaynak notları aynı bölgeye dokunuyor.
  Yeni 10A README de henüz commit edilmediği için gelecekteki merge sonucunu
  şimdiden temiz ilan etmek mümkün değil.
- docs/WORK_PLAN.md iki tarafta da silinmiş; önizlemede silme/silme çakışması yok.
  Bu dosyayı yanlışlıkla geri getirmeyin.
- Diğer mevcut kod dosyalarında bu ref'ler için çakışma marker'ı görülmedi.
  Bu durum yeni commit'ler sonrası veya gerçek birleştirmede garanti değildir.

README çözümünde main'in amaç/geliştirici ayrımını ifade etme niyetini koruyup
artık uygulanmış backend'i “yok” diye anlatan cümleleri taşımamak gerekir.
Kaynak lisans/atıf bilgisi silinmemeli; güncel kurulum ve mod bayrakları korunmalı.

## 8. Teslime hazır olup olmadığı

**İşlevsel kabul başarılı, koşulsuz son teslim onayı verilmedi.**

Kritik uygulama regresyonları A/B tekrar üretilemedi; bütün zorunlu otomatik
testler ve gerekli büyük dosya koruma testleri çalıştı. İptal/kesinti ve snapshot
bütünlüğü geçti. Buna karşın SQLite ortam koşulu çözülmeden gerçek veriye tam
dayanıklılık onayı verilmemeli. Mobil aydınlık tema okunabilirliği düzeltilmeli;
README çakışması ve birleşik kod testi tamamlanmalıdır.

Kaynak kodunu değiştiren bir düzeltme bu aşamada yapılmadı. Yapılmayan donanım/
tarayıcı/temiz ortam testleri başarılı gibi gösterilmedi.

## 9. Main dalına birleştirme önerisi

1. Mevcut dalda SQLite/Python çalışma ortamı kararını ve mobil kontrast
   düzeltmesini ayrı onaylı iş olarak tamamlayın; ilgili testleri tekrar çalıştırın.
2. 10A belgelerini birlikte gözden geçirin. Bu aşamada commit yapılmadı;
   gelecekteki PR, onaylı belge/düzeltme commit'lerini de kapsamalıdır.
3. PR yönü **abdullah-backend → main** olmalı. Gamze'nin dalını yeniden
   birleştirmek gerekmez; zaten atadır. main'i bu aşamada değiştirmeyin.
4. README çakışmasını kontrollü PR/aday dalda çözün; WORK_PLAN silinmiş kalsın.
   Sonraki yeni remote commit'leri varsa karşılaştırmayı güncelleyin.
5. **Birleşik aday kodda** frontend/backend/Chrome entegrasyon, iki kritik P1
   regresyonu, TypeScript/build ve veri bütünlüğü kontrollerini tekrar çalıştırın.
   Bu aşamadaki testler birleşik adayda çalıştırılmış sayılmaz.
6. Gerçek DB'yi yedekleyip geri yükleme kopyasını kontrol edin; migration ve üç
   servis başlatma adımlarını kararlaştırın. Son onaydan sonra merge edin.

PR için önerilen başlık:
“Add persistent GeoJSON projects, API workflows and exact integer preservation”.

PR açıklamasında: varsayılan Local davranışı ve API/proje bayrakları; kalıcı
snapshot/version çatışması; akışlı worker import, R-Tree ve Alembic head;
büyük tamsayı koruması ve güvenli reddetme sınırları; tablo Save bariyeri;
çalıştırılan testler ve gerçek boyutlar; SQLite önkoşulu, mobil kontrast durumu,
README çözümü ve backup planı yer almalı. Kamuya açık çok kullanıcılı üretim
hazırlığı iddia edilmemeli. Bu aşamada PR oluşturulmadı veya merge edilmedi.

## 10. Mac üzerinde son kontroller

1. Python .venv içinden SQLite sürümünü ölçün; düzeltmeli ortamı hazırlayın.
   Sadece sistem sqlite3 sürümünü kontrol etmek yeterli değildir.
2. RUNBOOK.md'deki geçici DB / 8100 / 5175 örneğiyle üç terminali başlatın.
   Gerçek kullanıcı DB'sini kabul testine bağlamayın.
3. Polygon çiz → hücre değerini değiştir → Enter'sız Kaydet → yenile →
   Projelerim'den Aç; son değeri ve geometriyi doğrulayın.
4. RUNBOOK örnek GeoJSON'undaki 9007199254740993 sayısını import, tablo/JSON
   düzenleme, export ve proje tekrar açmada kontrol edin. Export'u metin olarak
   inceleyin; sayı tırnaksız kalmalı. String kontrolünü ayrıca koruyun.
5. Point/LineString çizip düzenleyin, MultiPolygon dosyasını açıp köşe taşıyın;
   undo/redo ve sil/geri al deneyin.
6. Excel metin ID, WKT/GeoJSON ve koordinat eşleştirmesini deneyin. Önceden
   yuvarlanmış sayının onarıldığını varsaymayın.
7. Farklı Kaydet, rename, silme onayı/iptali ve kaydedilmemiş JSON uyarısını
   deneyin. Backend kapalıyken hatanın görünür olduğunu doğrulayın.
8. Aydınlık/koyu tema ve dar ekranı kontrol edin; Projeler etiketindeki bilinen
   kontrast sorunu giderilmeden görsel kabulü tamamlanmış saymayın.
9. Local modda ve proje bayrağı kapalı API modunda proje butonlarının
   görünmediğini doğrulayın. Worker/Vite'ı güncelleme sonrası yeniden başlatın.
10. Gerçek DB'ye geçmeden önce güvenli yedek/restore kopyasını doğrulayın ve
    birleşik aday testlerini tamamlayın.

### Son Git durumu

Dal abdullah-backend; upstream origin/abdullah-backend; HEAD bbf17d2 ile
senkronize. Başlangıç çalışma ağacı temizdi. Son durumda yalnız:

~~~text
 M README.md
 M backend/README.md
 M docs/API_MODE.md
?? docs/RUNBOOK.md
?? docs/STAGE10A_REPORT.md
~~~

Stage alanı boş. Commit/push/merge/rebase yok; main ve gamze-harita-arayuz
yerel dalları değiştirilmedi. Fetch yalnız remote tracking ref'lerini yeniledi.
Gerçek DB, WAL, .env, venv, yükleme ve benchmark dosyaları Git'e eklenmedi.

## Ek A — origin/main ile bbf17d2 arasındaki tam dosya farkı

Durum harfleri Git'in main → backend karşılaştırmasına aittir; aşağıdaki
listeye henüz commit edilmemiş 10A belge eklemeleri dahil değildir.

~~~text
A	.env.example
M	.gitignore
M	README.md
A	backend/.env.example
A	backend/README.md
A	backend/alembic.ini
A	backend/app/__init__.py
A	backend/app/api/__init__.py
A	backend/app/api/errors.py
A	backend/app/api/router.py
A	backend/app/api/routes/__init__.py
A	backend/app/api/routes/geometry.py
A	backend/app/api/routes/health.py
A	backend/app/api/routes/imports.py
A	backend/app/api/routes/projects.py
A	backend/app/api/routes/repository.py
A	backend/app/api/routes/workspaces.py
A	backend/app/core/__init__.py
A	backend/app/core/config.py
A	backend/app/db/__init__.py
A	backend/app/db/base.py
A	backend/app/db/models.py
A	backend/app/db/session.py
A	backend/app/domain/__init__.py
A	backend/app/domain/categories.py
A	backend/app/domain/geojson.py
A	backend/app/domain/json_numbers.py
A	backend/app/domain/preview.py
A	backend/app/domain/streaming_geojson.py
A	backend/app/domain/topology.py
A	backend/app/main.py
A	backend/app/schemas/__init__.py
A	backend/app/schemas/datasets.py
A	backend/app/schemas/geometry_validation.py
A	backend/app/schemas/health.py
A	backend/app/schemas/jobs.py
A	backend/app/schemas/projects.py
A	backend/app/schemas/repository.py
A	backend/app/services/__init__.py
A	backend/app/services/catalog.py
A	backend/app/services/datasets.py
A	backend/app/services/errors.py
A	backend/app/services/geojson_export.py
A	backend/app/services/geometry_validation.py
A	backend/app/services/import_upload.py
A	backend/app/services/jobs.py
A	backend/app/services/projects.py
A	backend/app/services/repository.py
A	backend/app/services/snapshots.py
A	backend/app/services/spatial.py
A	backend/app/workers/__init__.py
A	backend/app/workers/import_worker.py
A	backend/docs/REPOSITORY_API.md
A	backend/docs/STAGE7A_REPORT.md
A	backend/migrations/env.py
A	backend/migrations/script.py.mako
A	backend/migrations/versions/.gitkeep
A	backend/migrations/versions/0001_data_models.py
A	backend/migrations/versions/0002_import_jobs.py
A	backend/migrations/versions/0003_spatial_index.py
A	backend/pyproject.toml
A	backend/scripts/benchmark_import.py
A	backend/scripts/benchmark_viewport.py
A	backend/tests/conftest.py
A	backend/tests/test_categories.py
A	backend/tests/test_database.py
A	backend/tests/test_datasets.py
A	backend/tests/test_geojson_structure.py
A	backend/tests/test_geometry_validation.py
A	backend/tests/test_health.py
A	backend/tests/test_imports.py
A	backend/tests/test_json_numbers.py
A	backend/tests/test_migrations.py
A	backend/tests/test_model_integrity.py
A	backend/tests/test_preview_limits.py
A	backend/tests/test_projects.py
A	backend/tests/test_repository_api.py
A	backend/tests/test_repository_failures.py
A	backend/tests/test_stream_root_compatibility.py
A	docs/API_MODE.md
A	docs/PROJECT_REPOSITORY.md
A	docs/PROJECT_UI.md
A	docs/PROJECT_UI_INTEGRATION.md
A	docs/STAGE8B_REPORT.md
A	docs/STAGE9A_REPORT.md
A	docs/STAGE9B_REPORT.md
M	package-lock.json
M	package.json
M	src/App.tsx
A	src/adapters/api/ApiGeoJsonRepository.ts
A	src/adapters/api/ApiProjectRepository.ts
A	src/adapters/api/README.md
M	src/adapters/local/localEngine.ts
A	src/adapters/local/losslessStream.ts
M	src/adapters/local/streamGeoJson.ts
M	src/components/DataPanel.tsx
M	src/components/DocumentEditor.tsx
M	src/components/FeatureList.tsx
M	src/components/FeatureTable.tsx
M	src/components/ImportDialog.tsx
M	src/components/Inspector.tsx
A	src/components/projects/ProjectDialogs.tsx
A	src/components/projects/ProjectManagement.tsx
A	src/components/projects/projects.css
A	src/data/PendingEditorEdits.ts
M	src/data/createRepository.ts
M	src/data/mergeImports.ts
M	src/data/spreadsheetImport.ts
M	src/domain/contracts.ts
M	src/domain/editorDocument.ts
M	src/domain/geoJsonValidation.ts
A	src/domain/losslessJson.ts
A	src/domain/projects.ts
M	src/map/MapController.ts
A	tests/api.integration.config.ts
A	tests/fixtures/project-management.vite.config.ts
A	tests/integration/apiRepository.test.ts
A	tests/integration/browserModes.test.ts
A	tests/integration/losslessNumbers.browser.test.ts
A	tests/integration/losslessNumbers.test.ts
A	tests/integration/projectManagement.browser.test.ts
A	tests/integration/projectRepository.test.ts
A	tests/integration/tableSave.browser.test.ts
A	tests/unit/apiRepository.test.ts
A	tests/unit/createRepository.test.ts
A	tests/unit/featureTablePending.test.tsx
M	tests/unit/large-file.test.ts
A	tests/unit/losslessJson.test.ts
A	tests/unit/pendingEditorEdits.test.ts
A	tests/unit/projectManagement.test.tsx
A	tests/unit/projectRepository.test.ts
M	vitest.config.ts
~~~
