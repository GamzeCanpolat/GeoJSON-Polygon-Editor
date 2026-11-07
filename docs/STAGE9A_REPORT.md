# Aşama 9A — Performans, dayanıklılık ve veri bütünlüğü

Tarih: 6 Kasım 2026. İncelenen commit: `b908ddd`.
Depo: `/Users/apocrc/Desktop/GeoJSON-Polygon-Editor`.

## 1. Sonuç ve kapsam

10, 50, 100 ve 200 MB karma GeoJSON dosyaları sunucuda başarıyla işlendi.
Feature içerikleri import/export boyunca semantik SHA-256 ile eşleşti;
SQLite, foreign key ve R-Tree kontrolleri geçti. İptal, bozuk dosya, worker
kesintisi ve snapshot sırasında API kesintisinde önceki kayıtlar korundu.

**Yeni P1 bulundu: JavaScript'in güvenli tamsayı aralığı dışındaki sayısal
GeoJSON ID/property değerleri sessizce yuvarlanabiliyor.** API import/export
tek başına değeri korurken tarayıcıdan okuyup yeniden yazmak değeri değiştiriyor.
Local modda değişiklik import sırasında oluşuyor. Dolayısıyla mevcut regresyon
paketlerinin geçmesi, bütün olası GeoJSON değerlerinin kayıpsız olduğu anlamına
gelmiyor. Yeni hassasiyet testi başarısızdır; aşağıda ayrıca raporlandı.

Bu aşamada ürün kaynakları, test kaynakları, sözleşmeler, migration'lar veya
ayar dosyaları değiştirilmedi. Yalnız bu rapor depoya eklendi. Ek test harness'leri,
veriler ve günlükler `/private/tmp/geojson-stage9a-aaqvutgq/` altında oluşturuldu.
Hiçbir düzeltme, commit veya uzak Git işlemi yapılmadı.

## 2. Ortam, güvenlik ve ölçüm yöntemi

| Bileşen | Değer |
| --- | --- |
| Donanım | Apple M2, 8 çekirdek, 8 GiB RAM |
| Sistem | macOS 26.6.2, arm64 |
| Chrome | 157.0.8103.38; headless gerçek Chrome, 1400×1000 pencere |
| Node / Python | 24.11.0 / 3.13.5 |
| SQLite | 3.49.1; WAL, foreign key açık; busy timeout 5000 ms |
| Backend | FastAPI 0.162.0, SQLAlchemy 2.0.57, Alembic 1.20.1 |
| Veri işleme | Shapely 2.2.0, ijson 3.6.0, Pydantic 2.14.3 |
| Boş disk | Başlangıç yaklaşık 33 GiB; son kontrol 27,86 GiB |
| Son kontrolde kullanılabilir RAM | Yaklaşık 1328 MiB; bütün test boyunca minimum değildir |

Her API testi kendi geçici SQLite dosyasını, upload dizinini, portunu ve worker
sürecini kullandı. Chrome profilleri ve Vite optimizer önbellekleri de ayrıydı.
Mevcut geliştirme sunucusu ve worker dahil kullanıcı süreçlerine müdahale edilmedi.
Bu nedenle ölçümler boş/özel bir benchmark makinesine ait değildir.

- MB = 1.000.000 byte; MiB = 1.048.576 byte. Boyutlar aşağıda gerçek byte ile verilir.
- Büyük dosya matrisi sırayla çalıştırıldı. Upload 64 KiB parçalarla; worker
  varsayılan 500 Feature / en çok 4 MiB batch ayarıyla çalıştı.
- Liste/detay/arama/viewport süreleri localhost HTTP yanıtının JSON okunmasını
  içerir. Beş tekrarın medyanı ve ham sonuçlardaki maksimumu alındı. Genel
  süreler bir dosya/koşu ölçümüdür; üretim SLA'sı veya p95 değildir.
- API/worker süreç ağacı RSS ve CPU değerleri 50 ms aralıklarla örneklendi.
  Kısa zirveler ve çıkıştan hemen önceki CPU zamanı kaçabilir.
- SQLite yazma aşamasını ayırmak için yalnız geçici worker girişinde, bellekte
  `append_staging_batch` ve `SessionTransaction.commit` süreleri gözlemlendi.
  Bunlar saf disk süresi değildir: Python/ORM ve nested SAVEPOINT maliyetlerini
  de içerir. Commit hook sayısı fiziksel fsync/transaction sayısı olarak okunmamalı.
- Browser süreç ağacı RSS; Chrome, renderer, worker, Vite ve API varsa backend'i
  kapsar. Ortak sayfalar birden fazla sayılabilir; benzersiz fiziksel RAM değildir.
  CDP JS heap ölçümü ise yalnız bağlı sayfanın heap'idir; Web Worker belleği değildir.
- Browser/Node ek testlerinde 2,2 GiB süreç ağacı RSS, 384 MiB kullanılabilir RAM
  ve toplam süre gözetimi vardı; bu sınırlar hiçbir koşuyu kesmedi.

## 3. GeoJSON dosyaları ve sunucu performansı

Her dosyada Point, Polygon, MultiPolygon ve GeometryCollection yaklaşık eşit
adette bulunur. GeometryCollection Point + LineString içerir. Polygon'lar kapalı
beş koordinatlı halkalardır; MultiPolygon iki ayrı halkadan oluşur. Koordinatlar
WGS84 lon/lat/Z sırasındadır. Properties; Türkçe metin, boolean/null/sayı dizisi,
256 karakter payload, kategori/alt kategori içerir. Dış Feature ID'leri tekrar
eder; bilinmeyen Feature ve kök metadata alanları ile kullanılmayan kategori
tanımları da vardır.

| Hedef | Gerçek byte | MiB | Feature | Koordinat/vertex |
| --- | ---: | ---: | ---: | ---: |
| 10 MB | 10.000.010 | 9,54 | 16.320 | 81.600 |
| 50 MB | 50.000.105 | 47,68 | 81.502 | 407.506 |
| 100 MB | 100.000.089 | 95,37 | 162.909 | 814.541 |
| 200 MB | 200.000.459 | 190,74 | 325.153 | 1.625.761 |

| Dosya | Upload sn | Worker sn | SQLite batch metodu toplam sn | Commit hook toplam sn | Aktivasyon ms | Export sn |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 MB | 0,14 | 8,07 | 5,27 | 0,18 | 4,36 | 2,86 |
| 50 MB | 0,59 | 41,33 | 29,79 | 0,97 | 4,30 | 14,77 |
| 100 MB | 1,27 | 78,81 | 56,73 | 1,73 | 6,84 | 27,04 |
| 200 MB | 2,36 | 177,18 | 128,53 | 4,14 | 7,16 | 55,60 |

Aktivasyon değerleri kısa transaction'ı ölçer; dosya parse/validasyon/batch yazma
süresini içermez. Worker süresi başlatma, parse, mevcut yapısal/Shapely kontrolleri,
SQL yazma ve ilerleme raporlamasını birlikte içerir. Batch/commit sütunları
worker süresine dahildir; bağımsız süreler gibi toplanmamalıdır.

| Dosya | Liste 50 kayıt ms | Detay ms | Arama `Alan` ms | Dünya viewport ms | Boş viewport ms | Snapshot kaydet sn | Snapshot aç sn |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 MB | 3,03 | 1,49 | 41,24 | 199,01 | 2,03 | 0,27 | 0,24 |
| 50 MB | 5,32 | 1,57 | 209,23 | 625,59 | 1,85 | 1,14 | 1,15 |
| 100 MB | 8,89 | 1,61 | 428,79 | 1107,58 | 1,81 | 3,11 | 3,56 |
| 200 MB | 16,84 | 1,65 | 1093,75 | 2876,34 | 1,93 | 7,16 | 10,92 |

Viewport limiti 2500'dür; dünya sorgusunda `matched` tüm geometri sayısına
eşittir ve dönen kayıt sayısı 2500'dür. Limitin olması tam eşleşme sayımının
sabit maliyetli olmasını sağlamaz. İlk liste istekleri soğuk maliyeti de gösterdi:
100/200 MB koşullarında maksimum liste süreleri yaklaşık 299/581 ms idi.

| Dosya | API tepe RSS MiB | Worker ağacı tepe RSS MiB | Örneklenmiş API+worker CPU sn | Tek çekirdek ölçeğinde anlık CPU zirvesi | Koşu duvar süresi sn |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10 MB | 105,52 | 183,59 | 11,86 | %143,74 | 13,83 |
| 50 MB | 92,47 | 183,00 | 55,80 | %147,82 | 68,31 |
| 100 MB | 97,00 | 187,48 | 106,71 | %135,92 | 137,38 |
| 200 MB | 95,11 | 188,22 | 239,50 | %136,14 | 317,44 |

%100 bir mantıksal çekirdektir, bütün 8 çekirdek değildir. Anlık CPU zirvesi,
izlenen API veya worker ağaçlarından birinin en yüksek örneğidir; ikisinin
eşzamanlı CPU toplamı değildir. Worker sayısı
koordinatör + ayrı işleme çocuğunu kapsar. Fixture üretimi ve dışarıdan export
hash doğrulayan test sürücüsünün RAM/CPU'su bu API/worker tablosuna dahil değildir.

Tüm dört dosyada export edilen bütün Feature'ların sıralı semantik SHA-256
özeti kaynakla eşleşti; tekrar eden dış ID'ler, Z, properties ve bilinmeyen Feature
alanları korundu. Kök `custom` metadata ve kullanılmayan kategori de doğrulandı.
Bu, whitespace/JSON anahtar sırası bakımından byte-byte aynı dosya demek değildir.

## 4. SQLite, R-Tree ve eşzamanlılık

Her büyük dosyada snapshot oluşturma/açmadan sonra şu kontroller geçti:

- `PRAGMA integrity_check = ok`
- `PRAGMA foreign_key_check = []`
- `rtreecheck('feature_rtree') = ok`
- Canlı/bounds'lu Feature için eksik indeks satırı: 0; fazladan/silinmiş Feature
  indeksi: 0; yanlış dataset veya gerçek bounds'u kapsamayan R-Tree bounds'u: 0.
- Doğrudan Feature bounds JSON referans sayımı ile indeks sorgusu aynı sayıyı verdi.

Snapshot sonrası aktif dataset + snapshot + yeniden açılmış kopya indekslenir.
Boş eski dataset dahil dört dataset kaydı vardı; indeks satırları sırasıyla
48.960 / 244.506 / 488.727 / 975.459 idi. Aynı dolu küçük bbox'ta 606 kayıt için
salt SQL COUNT medyanı 1,41 / 1,56 / 1,56 / 2,19 ms oldu. Dünya kapsamındaki
salt COUNT medyanı 43,22 / 255,35 / 523,60 / **3427,39 ms** oldu. Bu ikinci
ölçüm snapshot sonrasıdır ve HTTP/DTO çözümleme içermez; önceki tabloyla aynı
ölçüm gibi karşılaştırılmamalıdır. Geniş alanın tam sayımı ve tutulan dataset
kopyaları, sonraki optimizasyon için önemli maliyetlerdir.

Ek dayanıklılık koşusu 16.320 Feature üzerinde gerçek API ile yapıldı:

| Test | Beklenen ve gerçek sonuç | Durum |
| --- | --- | --- |
| 100 ardışık Feature güncelleme | Revision tam 100 arttı; 3,64 sn. Bu bir bulk HTTP endpoint testi değildir | Geçti |
| Sil + aynı dahili ID ile geri yükle | ID korundu; toplam 0,061 sn | Geçti |
| Aynı revision ile 8 eşzamanlı mutation | 1×200, 7×409; sessiz üzerine yazma yok | Geçti |
| Aynı version ile 2 eşzamanlı Kaydet | 1×200, 1×409 | Geçti |
| 36 okuma, 12 eşzamanlı istemci | Tümü 200 | Geçti |
| WGS84 dışında koordinat | 422; dataset özeti/revision değişmedi | Geçti |
| Import iptali | Gerçek 500 Feature işlendiği gözlenip iptal edildi; cancelled; staging temiz; eski aktif dataset aynı | Geçti |
| Bozuk son Feature | 16.000 Feature sonrası failed; staging temiz; eski veri aynı | Geçti |
| Worker koordinatörü SIGKILL | 500 Feature sonrası kesildi; lease dolunca yeniden başlayan worker failed olarak temizledi; eski aktif veri aynı | Geçti |
| Import sırasında projeyi aynı workspace'e aç | Proje açıldı; import completed oldu; eski generation'a aktivasyon 409 aldı; açılan proje korundu | Geçti |
| Snapshot transaction'ında API SIGKILL | SQLite yazıcısının tutulduğu gözlenerek süreç kesildi; restart sonrası eski snapshot ID, project.version ve workspace korundu | Geçti |

Her iptal/hata/restart sonrasında bütünlük, foreign key ve R-Tree kontrolleri
yeniden geçti. SIGKILL senaryosu bir süreç çökmesidir; elektrik kesintisi,
diskin fiziksel arızası veya işletim sistemi çökmesinin yerine geçmez.

**Büyük snapshot yazma çekişmesi:** 200 MB projenin yeniden kaydı 17,86 sn
sürdü. Yazıcı kilidi gözlendikten sonra başka workspace'e gönderilen tek Point
ekleme isteği 5,25 sn sonra HTTP **409** aldı:
`Veritabanı başka bir işlem tarafından kullanılıyor. Güncel durumu okuyup tekrar deneyin.`
Uzun kayıt 200 ile tamamlandı; diğer workspace'in count'u 0 kaldı; kısmi kayıt
ve bütünlük bozulması olmadı. Bu veri kaybı değildir, fakat yoğun/büyük kayıtlarda
5000 ms timeout ve uzun SQLite yazma transaction'ı önemli bir kullanım sınırıdır.

## 5. Gerçek Chrome: Local / API

Her mod için aynı 10/50 MB dosyası, yeni Chrome profili, yeni Vite cache'i ve
API varsa ayrı geçici SQLite/worker kullanıldı. Dosya gerçek uygulamanın import
input'una CDP dosya seçimiyle verildi; ayrı bir yardımcı repository ile büyük
dosyayı yükleyip UI testi yapılmış gibi sunulmadı. Altlık UI'dan `none` seçildi;
tile sunucusu hızı ölçüme dahil edilmedi. Harita sınırı 2500 önizleme Feature'dır.

| Mod / dosya | UI import sn | 6 zoom'un medyan settle sn | Pan settle sn | Seçim + fit sn | Native köşe düzenleme sn | 20 satır tablo sn | UI Kaydet / Aç sn |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Local 10 MB | 1,79 | 0,42 | 0,62 | 0,51 | 0,24 | 0,072 | Uygulanmaz |
| API 10 MB | 8,60 | 0,41 | 0,61 | 0,47 | 0,28 | 0,055 | 0,27 / 0,83 |
| Local 50 MB | 7,13 | 0,41 | 0,91 | 0,48 | 0,26 | 0,060 | Uygulanmaz |
| API 50 MB | 76,18 | 1,23 | 1,25 | 0,52 | 0,39 | 0,061 | 1,31 / 1,88 |

Native mouse wheel/pan ve Polygon köşe sürükleme kullanıldı. Düzenleme XY'yi
değiştirdi; seçilen Feature'ın dış ID, properties ve Z dizisi bütün dört koşuda
eşit kaldı. API 10/50 MB'de düzenlenmiş Feature, SQLite snapshot'ındaki tam
Feature JSON'u ile karşılaştırılıp eşit bulundu. Proje açma da gerçek UI üzerinden
yapıldı. JSON paneli büyük dosyada sözleşmeye uygun olarak `feature` kapsamına
geçti; seçili geometri için yaklaşık 821 karakter gösterdi, 50 MB metni editöre
yüklemedi. Local modda kalıcı Project API ekranları yoktur; Kaydet/Aç ölçülmedi.

API 10 MB akışında ayrıca gerçek Excel dosya input'u üzerinden 10.000 satırlık
Excel içeri aktarıldı: 14,45 sn sonra 16.320 + 10.000 = **26.320 Feature**.
Önceden düzenlenmiş Polygon'un tam JSON'u append sonrası SQLite'ta korundu.

İlk API performans denemelerinde importlar başarılı olmasına rağmen native
sürükleme adımı tamamlanmadı; bu iki koşu tam akış başarısı sayılmadı. Ürün kodu
değiştirilmeden, sadece testte `renderSync` ve Modify vertex hit-test gözlemiyle
tekrar edildi; API 10/50 MB akışları geçti. İlk başarısız denemelerin kesin
mekanizması tek başına kanıtlanmış değildir; uygulama geometri hatası olarak
etiketlenmedi. Sonuçların ham başarısız denemeleri de saklandı.

Import süreleri değişkendir: ilk API denemelerinde 10 MB 13,09 sn, 50 MB 56,35 sn
ölçülmüştü; son tam akışta 8,60/76,18 sn oldu. OS yükü, disk cache ve GC kontrol
edilmediği için tek koşudan sabit bir Local/API hız oranı çıkarılmamalıdır.
API ayrıca sunucu yapısal/Shapely kontrolünü ve SQLite kalıcılığını yapar.

### Browser RAM, CPU ve kısa süreli bellek eğilimi

| Koşu | Bütün test süreç ağacı tepe RSS MiB | Örneklenmiş CPU sn | Sayfa heap import sonrası MiB | Son idle heap MiB |
| --- | ---: | ---: | ---: | ---: |
| Local 10 MB | 1387,13 | 25,25 | 33,4 | 107,2 |
| Local 50 MB | 1510,28 | 36,53 | 24,6 | 141,1 |
| API 10 MB | 1580,06 | 45,26 | 31,7 | 141,4 |
| API 50 MB | 1701,70 | 119,44 | 30,8 | 127,4 |

API 10 MB süreç toplamı ek sayısal ID probu ve Excel append adımlarını da içerir;
Local ile aynı işlem adedinde CPU kıyaslaması değildir. JS heap import → altı
zoom → düzenleme/panel → API varsa açma → 180 idle rAF boyunca örneklendi.
GC zorlanmadı ve heap büyümesi gözlendi. Bu kısa gözlem **bellek sızıntısını
kanıtlamaz veya dışlamaz**; worker heap'i ve uzun saatlik retention ölçülmedi.

Idle 180 rAF aralığının medyanı bütün koşularda yaklaşık 16,7 ms idi; en büyük
aralık API 10 MB'de 33,4 ms, diğerlerinde yaklaşık 16,8 ms oldu. Bunlar **idle**
ölçümleridir; zoom/pan için 60 FPS garantisi değildir. Buffered Long Task gözlemi
başlangıç dahil yaklaşık 51–157 ms ana thread görevleri kaydetti.

## 6. Excel

Aşağıdaki ölçümler gerçek XLSX dosyaları üretilip mevcut SheetJS yükleyici ve
`convertImportSheet` üzerinden Node/Vitest'te yapıldı; Chrome hız sonucu değildir.
UI'daki gerçek Excel akışı ayrıca yukarıda verildi.

| Veri satırı | XLSX byte | GeoJSON byte | XLSX decode sn | Dönüştürme sn | İşlem CPU sn | İşlem sonunda RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 40.031 | 19.765 | 0,011 | 0,005 | 0,044 | 91,27 |
| 10.000 | 2.593.291 | 2.010.043 | 0,182 | 0,089 | 0,767 | 305,55 |
| 75.000 | 19.995.091 | 15.219.343 | 1,448 | 0,491 | 4,183 | 448,05 |

Fixture üretme/yazma süreleri sırasıyla 0,010 / 0,224 / 1,818 sn'dir.
İşlem CPU sütunu üretme/yazma/doğrulamayı da kapsar. Tablo RSS anlık ölçümdür;
npx/Vitest/worker dahil bütün Excel test ağacının örneklenen zirvesi **1094,53 MiB**
ve CPU toplamı 6,12 sn idi. 75.000 satırdaki son RSS daha küçük diye tepe belleğin
küçük olduğu sonucuna varılamaz; GC ve süreç ağacı ölçümleri farklıdır.

Türkçe `İğdır Şişli`, `ıİşŞğĞüÜöÖçÇ`, sayısal alanlar ve boolean'lar korundu;
son satırın koordinat sırası/değeri doğrulandı. Ek iki test geçti. Mevcut frontend
paketi ayrıca XLS/biff8, WKT, MultiPolygon, GeoJSON hücresi, ek kolonlar, null
geometri ve kategori kataloğu gibi senaryoları test etti.

| Hatalı durum | Gerçek kullanıcı mesajı / sonuç |
| --- | --- |
| Eksik / metin / `NaN` enlem | `Enlem sayısal olmalı.`; blob yok |
| Enlem 91 veya boylam 181 | WGS84 −180…180 / −90…90 mesajı; blob yok |
| İki koordinat da boş | Geometri bulunamadı mesajı; blob yok |
| 100.001 veri satırı | `Excel’den en fazla 100.000 veri satırı alınabilir.` |
| Desteklenmeyen düz metin | `Geçerli bir .xls veya .xlsx dosyası seçin.` |

Mevcut sınırlar: giriş 25 MiB, 100.000 veri satırı, 250.000 dönüştürülmüş Feature,
200 MiB dönüştürülmüş çıktı. Boş GeoJSON hücreleri ile gerçekten bozuk JSON'un
ayrımı ve hatalı satırda atomik ret mevcut regresyon testlerinde geçti.
25 MiB dosya boyutu sınırı, açılmış workbook'un aynı miktarda RAM kullanacağı
anlamına gelmez. 75.000 satır gerçek Chrome'da ayrıca ölçülmedi.

## 7. Yeni başarısız test: büyük sayısal ID/property hassasiyeti — P1

Fixture: `unsafe-integer.geojson`; bir Point, Z=7:

```json
{"type":"Feature","id":9007199254740993,"properties":{"exact":9007199254740993,"name":"Original"},"geometry":{"type":"Point","coordinates":[29,41,7]}}
```

| Yol | Beklenen | Gerçek |
| --- | --- | --- |
| API import → streaming export, düzenleme yok | ID/property `9007199254740993` | Korundu |
| Chrome ApiGeoJsonRepository.get → sadece name değiştir → mutate → export | ID/property değişmemeli | İkisi de `9007199254740992` oldu |
| LocalEngine import → export | ID/property değişmemeli | İkisi de `9007199254740992` oldu |

API probu gerçek Chrome + FastAPI + SQLite/worker üzerinde, UI'dan bağımsız ayrı
repository/workspace ile yapıldı. Local probu Node/fake-indexeddb üzerinde yapıldı
ve `expect(export).toContain('9007199254740993')` assertion'ı açıkça **başarısız**
oldu. Bu keşif testi mevcut 128 testin içine dahil değildir; yeşil gösterilmedi.

Kök neden: sayı JavaScript Number'ın güvenli tamsayı aralığı dışında.
`ApiGeoJsonRepository.read()` standart `response.json()` ile okuyor; mutation
standart `JSON.stringify` ile bütün Feature'ı geri gönderiyor. Local stream
parser da sayıyı standart JavaScript number'a çeviriyor. `validateFeature`
sayısal ID'yi kabul ediyor; bu hassasiyet kaybını reddetmiyor. Dolayısıyla yalnız
`name` değiştirmek, dokunulmaması gereken başka bir alanı da bozabiliyor.
Backend'in aynı sayıyı ham import/export'ta koruması sorunu dışlamaz.

Bu, Aşama 8B'deki blur/Kaydet yarışı değildir; o yarışın deterministik
0/200/650 ms regresyonu bu aşamada da geçti. Yeni bulgu için kaynak düzeltmesi
yapılmadı. Öncelik: kayıplı düzenleme/aktarımın engellenmesi; raw/lossless sayı
stratejisi veya açık aralık doğrulaması tasarlanmalı. ID'yi string kullanmak
kontrollü yeni verilerde bir seçenek olabilir; mevcut kullanıcı sayılarını
habersiz string'e çevirmek veya atmak doğru değildir. Aynı konu bilinmeyen
sayısal properties alanları için de ele alınmalı.

## 8. Önceki disk I/O hatası

Gerçek DB bağlantısı açılmadı; yalnız dosya/dizin izinleri, boyutları ve DB/WAL
SHA-256 bilgileri okundu. DB/WAL/SHM geçici özel dizine kopyalandı. Kopya sırasında
DB ve WAL hash'leri sabit kaldı. `integrity_check`, foreign key ve R-Tree yalnız
bu kopyada çalıştırıldı: **ok / [] / ok**. Kaynak dosyalar silinmedi,
checkpoint uygulanmadı ve WAL/SHM temizliği yapılmadı.

Dosyalar ve dizin mevcut kullanıcı için okunabilir/yazılabilirdi. Geçici scratch
DB'de WAL açma, INSERT/commit/read ve bütünlük kontrolü geçti. Audit öncesi ve
bütün testler sonrasındaki kaynak DB/WAL hash'leri eşitti. Testler gerçek DB'ye
veri yazmadı; bu hash kontrolü audit anından sonraki aralığı kapsar.

Bu turda disk I/O hatası tekrarlanmadı; önceki olayın kesin kök nedeni
kanıtlanamadı. İzin, boş alan ve WAL kontrollerinin bugün geçmesi aralıklı
dosya sistemi/disk/sağlayıcı sorunlarını sonsuza kadar dışlamaz. Hata tekrarında
tam SQLite hata kodu, zaman, dosya yolu, boş alan, izinler ve çalışan süreçler
toplanmalı; veri/WAL silerek teşhis yapılmamalıdır.

## 9. Riskler ve önerilen geliştirme sırası

1. **P1 — Güvensiz büyük tamsayıların sessiz değişmesi:** doğrulanan veri kaybı.
   Önce kayıpsızlık/ret politikası ve iki mod için regresyon testleri tasarlansın.
2. **P2 — Büyük snapshot'ın uzun SQLite yazma kilidi:** diğer yazmalar 409
   alabiliyor. Meşgul DB ile revision/version çakışmasının UI'da ayırt edilmesi,
   işlem durumu ve kullanıcının kontrollü tekrar denemesi değerlendirilsin.
   Snapshot'ı parçalara bölme önerisi tutarlı kaynak snapshot'ı ve atomik yayın
   şartını kaybetmemeli; doğrudan naif batch kopyalama yapılmamalı.
3. **P2 — Geniş viewport ve metin arama:** 200 MB'de yaklaşık 2,88 sn HTTP
   viewport, snapshot sonrası 3,43 sn salt COUNT ve 1,09 sn arama medyanları.
   Query plan/COUNT/JSON decode bileşenleri ayrı profillensin; revision'a bağlı
   cache ve tam sayım maliyeti değerlendirilsin. Sadece limit'i düşürmek COUNT'u
   çözmez. Mevcut sözleşme değiştirilmeden başlanmalı.
4. **P2 — İstemci/Excel RAM payı:** gerçek Chrome test ağaçları 1,35–1,66 GiB,
   Excel test ağacı yaklaşık 1,07 GiB; düşük RAM'de worker/GC/quota davranışı
   ayrıca ölçülmeli. Excel giriş byte sınırı tek başına bellek bütçesi değildir.
5. **P3 — Uzun süreli bellek ve depolama ömrü:** kısa test heap büyümesini
   leak diye yorumlamadan GC/heap snapshot ile 30–60 dakika ve çok sayıda
   aç/kaydet/yenile döngüsü yapılmalı. Geçici workspace ve aktive edilmemiş job
   dataset'lerinin saklama/temizleme politikası, proje referansları korunarak
   tasarlansın; bu aşamada hiçbir kullanıcı verisi temizlenmedi.

## 10. Son test durumu ve tamamlanmayan kapsam

| Paket / deney | Sonuç |
| --- | --- |
| Standart frontend paketi | 127 geçti; PERF_FILE verilmediği için 1 koşullu test atlandı |
| Koşullu Node büyük dosya testi, ayrıca | 1 geçti; böylece önceki frontend kapsamı toplam 128 başarılı |
| Backend | 300 geçti; 21,59 sn |
| Mevcut gerçek entegrasyon paketi | 5 geçti; 36,73 sn |
| TypeScript + Vite build | Geçti; Vite build 3,92 sn |
| Ek Excel testleri | 2 geçti |
| 10/50/100/200 MB API matrisi | 4 koşu geçti; tam Feature hash ve metadata doğrulandı |
| Ek SQLite dayanıklılık dizisi | Geçti; 46,68 sn |
| Dört tam Chrome Local/API performans akışı | Tamamlandı; 2 ilk API denemesi sürükleme adımında tamamlanmamıştı, tekrarlar ayrı saklandı |
| Sayısal hassasiyet keşifleri | API Chrome probu koruma beklentisini karşılamadı; Local Vitest 1 başarısız |
| 200 MB eşzamanlı yazma gözlemi | Beklenen açık 409 ve eski verinin korunması; bütünlük geçti |

Önceki 101,4 MB karşılaştırma fixture'ı 101.396.107 byte = 96,70 MiB,
140.000 Polygon ve 3.500.000 koordinattır. Bu tur Node testinde import **8,40 sn**,
toplam **24,97 sn**, viewport 2500 ve export Feature hash eşitliği geçti.
Örneklenmiş bütün npx/Vitest süreç ağacı zirvesi **1823,11 MiB**, CPU 28,95 sn.
Önceki 8A ölçümü 7,69 / 24,16 sn idi. Örnekleme kapsamı/GC/OS yükü etkileri
nedeniyle bu fark tek başına regresyon kanıtı değildir. Bu ölçümler Node +
fake-indexeddb'dir, **gerçek tarayıcı performansı değildir**. Yeni karma dosyaların
vertex dağılımı da farklıdır; MB başına süreler doğrudan eşdeğer değildir.

Bu tur 100/200 MB'nin sunucu yolu test edildi; gerçek Chrome karşılaştırması
10/50 MB ile sınırlıdır. 100/200 MB Chrome, 75.000 satır Chrome Excel, saatler
süren soak, fiziksel mobil dokunma, normal görünür Chrome/GPU FPS, disk dolması,
elektrik kesintisi ve çok makineden ağ yük testi çalıştırılmadı. Bunlar başarısız
veya başarılı gösterilmedi. Kaynak gözetimi hiçbir testi kesmedi; çalıştırılmayan
senaryolar için RAM'in kesin yetmediği iddia edilmiyor.

## 11. Mac üzerinde manuel kontroller

Gerçek proje veritabanı yerine ayrı geçici DB ve port kullanın. Örnek:

```bash
# Terminal 1 — yalnız izole manuel test ortamı
cd /Users/apocrc/Desktop/GeoJSON-Polygon-Editor/backend
export GEOJSON_DATABASE_PATH="$(mktemp -d /private/tmp/geojson-9a-manual.XXXXXX)/projects.db"
export GEOJSON_CORS_ORIGINS='["http://127.0.0.1:5175"]'
echo "$GEOJSON_DATABASE_PATH"
.venv/bin/python -m alembic upgrade head
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8100
```

Terminal 2'de aynı backend dizininde **Terminal 1'in yazdırdığı tam DB yolunu**
`GEOJSON_DATABASE_PATH` olarak kullanıp
`.venv/bin/python -m app.workers.import_worker --poll-interval 0.25` çalıştırın.
Terminal 3, depo kökünde:

```bash
VITE_DATA_SOURCE=api VITE_PROJECT_MANAGEMENT=true VITE_API_BASE_URL=http://127.0.0.1:8100 npm run dev -- --port 5175
```

- `/private/tmp/geojson-stage9a-aaqvutgq/` altındaki `mixed-10MB.geojson` ve
  `mixed-50MB.geojson` dosyalarını yeni test projelerinde deneyin. Altlık kapalı
  ve açık durumları ayrı değerlendirin; zoom/pan, fiziksel köşe sürükleme,
  JSON feature kapsamı, tablo, Kaydet/yenile/Aç akışlarını karşılaştırın.
- `excel-10000.xlsx` ve `excel-75000.xlsx` ile gerçek dosya seçici/kolon eşlemesini,
  Türkçe metin ve boolean alanlarını doğrulayın. 75.000 satır için DevTools RAM
  izlemesini açık tutun; bu boyutun Chrome sonucu bu raporda yoktur.
- `unsafe-integer.geojson` dosyasını **yalnız test ortamında** import edin.
  API modunda düzenlemeden export ile, sonra yalnız `name` hücresini değiştirip
  export ile sayısal ID/property'yi karşılaştırın. Yeni P1 nedeniyle bu tür
  sayıları içeren gerçek kullanıcı dosyalarını düzenlemeyin.
- İki istemcide aynı test projesini açıp birinden kaydedin; eski version ile
  diğerinden kayıt 409 göstermeli. Büyük kayıt sürerken diğer test workspace'inde
  yazmayı deneyin; kilit hatasının açık olduğunu ve kısmi veri olmadığını kontrol edin.
- Ağ kesintisi ve HTTP request blocking'i yalnız test servisine uygulayın.
  Başarısız hücre kaydında başarı bildirimi olmamalı; taslak ve eski snapshot kalmalı.
- Worker/API kesinti denemesinde yalnız bu izole port ve test worker'ını durdurun.
  Gerçek 8000 portundaki geliştirme sunucusunu, gerçek DB'yi veya WAL'ı silmeyin.
- Daha uzun oturumda DevTools Memory heap snapshot/GC ile 30–60 dakika açma,
  düzenleme, panel ve zoom döngüsünü izleyin. Kısa heap büyümesini tek başına leak saymayın.

## 12. Kanıt dosyaları, tekrar çalıştırma ve Git

Ham sonuçlar ve geçici harness'ler:
`/private/tmp/geojson-stage9a-aaqvutgq/`.
Önemli dosyalar: `result-10/50/100/200.json`, `reference-results.json`,
`durability-results.json`, `large-contention-results.json`, `excel-results.json`,
`excel-errors.json`, `browser-results.json` (ilk denemeler),
`browser-retry-results.json` (tam API akışları + ID probu),
`browser-data-integrity.json`, `*-resources.json`, `local-numeric-results.json`,
`numeric.log`, `sqlite-audit.json`, `sqlite-source-after.json`, `environment.json`.
Bu geçici dosyalar Git'e eklenmedi; kopya kullanıcı DB'si de bu özel geçici dizindedir.

Mevcut regresyon komutları, depo kökünden:

```bash
npm test
RUN_BROWSER_INTEGRATION=1 npx vitest run --config tests/api.integration.config.ts
npm run build
cd backend
.venv/bin/python -m pytest -q
```

Keşif testi, geçici fixture'lar durduğu sürece:

```bash
cd /Users/apocrc/Desktop/GeoJSON-Polygon-Editor
npx vitest run --config /private/tmp/geojson-stage9a-aaqvutgq/numeric.config.ts
```

Bu son komut yeni P1 çözülmeden **başarısız olmalıdır**. Başarılı gibi gösterilmedi.

Başlangıç: `abdullah-backend`, upstream `origin/abdullah-backend`; temiz ve yerel
tracking ref'i ile senkron. HEAD aşama boyunca `b908ddd` kaldı. Son durumda yalnız
`?? docs/STAGE9A_REPORT.md` beklenir; kaynaklarda tracked diff veya staged dosya yok.
Commit/push/pull/fetch/merge/rebase yapılmadı; main/Gamze dallarına dokunulmadı.
Oluşturulan test servislerinin kapandığı doğrulandı. Sonraki aşamaya geçilmedi.
