# GeoJSON Polygon Editor

Harita üzerinde nokta, çizgi ve poligon verisi hazırlamak, GeoJSON/Excel dosyalarını
düzenlemek ve API modunda projeleri SQLite'a kalıcı kaydetmek için web uygulaması.

API ve import worker için doğrulanan bağımsız ortam Python 3.13.18 ve
SQLite 3.53.1 kullanır. Kurulum ve başlatma adımları işletim rehberinde,
test sonuçları ve teslim durumu Aşama 10C raporundadır.
[RUNBOOK](docs/RUNBOOK.md) · [Aşama 10C](docs/STAGE10C_REPORT.md)

## Özellikler ve mimari

- React + TypeScript arayüzü ve OpenLayers haritası.
- Point, LineString ve Polygon çizimi; Polygon/MultiPolygon köşe düzenleme,
  seçim, taşıma, silme ve undo/redo. MultiPolygon dosya veya JSON üzerinden açılır;
  ayrı bir MultiPolygon çizim aracı yoktur.
- GeoJSON içe aktarma, GeoJSON/Excel/CSV dışa aktarma, JSON editörü ve sayfalı tablo.
- Seçili Polygon/MultiPolygon için alan ve çevre, LineString/MultiLineString için uzunluk.
- Excel (.xls/.xlsx) koordinat, GeoJSON, WKT ve encoded polyline sütunu dönüşümü.
- Ana/alt kategori kataloğu, kullanılmayan kategori tanımları, koyu/aydınlık tema.
- İki veri modu: tarayıcı Worker + IndexedDB (**local**, varsayılan) veya
  FastAPI + SQLAlchemy + SQLite (**api**).
- API modunda kalıcı proje kaydı, Farklı Kaydet, listeleme, açma, yeniden
  adlandırma ve onaylı silme; bağımsız snapshot ve sürüm çakışması kontrolü.
- Alembic migration'ları, SQLite R-Tree, Shapely doğrulama API'si ve ayrı Python
  import worker'ı. Büyük GeoJSON sunucuda ijson ile akışlı işlenir.
- Büyük sayısal Feature ID/property değerleri kayıpsız JSON sayısı olarak korunur.
  Temsil edilemeyen kesir/koordinatlar sessiz yuvarlama yerine hata verir.

Harita ve paneller aynı GeoJsonRepository sözleşmesini kullanır. Proje yönetimi
ayrı ProjectRepository servisine bağlıdır. Dahili Feature kimliği ile dosyanın
GeoJSON feature.id alanı farklıdır.

## Mac üzerinde ilk kurulum

Node.js 22.12+ veya 24 LTS ile proje kökünde `npm ci` çalıştırın.
Local mod için bu kurulum yeterlidir. API modu için bağımsız Python
ortamını kurun ve `bash scripts/run-backend.sh python-path` ile doğrulayın.
[Bağımsız runtime kurulumu](docs/RUNBOOK.md#bağımsız-python-ortamı-kurulumu)

### Mac’te Finder’dan başlatma

Projeyi iCloud Desktop/Documents dışında, örneğin `~/Developer` altında tutun.
İlk kurulumda proje kökünde `npm ci` çalıştırın. Geliştirme bağımlılıkları da gereklidir.
Ardından Finder’da **GeoJSON Editor.command** dosyasına çift tıklayın.

İlk açılışta TypeScript kontrolü ve Local production derlemesi yapılır. Sonraki
açılışlarda dosyaların hash değerleri doğrulanır ve sağlamsa hazır derleme kullanılır.
Eksik veya değiştirilmiş çıktılar yeniden oluşturulur. Başlatıcı
[127.0.0.1:5173](http://127.0.0.1:5173) adresini açar. Port doluysa uyarı gösterir.
Kapatmak için açılan Terminal penceresinde **Ctrl+C** kullanın.

Masaüstü kısayolu için başlatıcıya sağ tıklayıp **Arma Yap / Takma Ad Yarat**
seçin ve oluşan oklu simgeyi masaüstüne taşıyın. Kurulum, güvenlik uyarıları ve
hata giderme adımları [macOS başlatıcı rehberinde](LOCAL_LAUNCHER.md) açıklanır.

Günlük Local başlatıcı derlenmiş dosyaları sunar. Kod geliştirme için
`npm run dev`, API modu için [RUNBOOK](docs/RUNBOOK.md#üç-terminalle-başlatma)
komutlarını kullanın. Local derleme `node_modules/.cache/geojson-local/dist`
altında, normal Local/API build çıktısı proje kökündeki `dist` altında tutulur.

## API ve proje ekranları

FastAPI, import worker ve Vite için üç ayrı terminal kullanılır.
Başlatıcı Python/SQLite sürümünü kontrol eder. API ve worker'a aynı açık
`GEOJSON_DATABASE_PATH` değeri verilir. Deneme komutları gerçek kullanıcı
verisinden ayrı bir SQLite dosyası kullanır.
[Üç terminalle başlatma](docs/RUNBOOK.md#üç-terminalle-başlatma)

API workspace'leri ve kayıtlı proje snapshot'ları farklıdır. Worker dosya
importlarını işler. Projeleri kaydetmek ve açmak ayrı HTTP işlemleridir.
Her süreci kendi terminalinde Ctrl+C ile durdurabilirsiniz.

## Local / API seçimi

| Ayar | Varsayılan ve davranış |
| --- | --- |
| VITE_DATA_SOURCE | local; local veya api |
| VITE_API_BASE_URL | http://127.0.0.1:8000; yalnız API modunda |
| VITE_PROJECT_MANAGEMENT | false; yalnız api + true birlikteyken proje ekranları görünür |

Local mod için yalnız Vite gerekir:

~~~bash
VITE_DATA_SOURCE=local npm run dev -- --port 5173 --strictPort
~~~

API modu bağlantı hatasında local moda geçmez. Vite değişkenleri tarayıcıya
açıktır; gizli bilgi içeremez. İsterseniz .env.example dosyasını .env.local
olarak kopyalayın; ayar değişince Vite'ı yeniden başlatın. Production build'inde
de aynı değişkenleri **build sırasında** verin.

Local depolama geçici çalışma alanıdır. API'de sayfa yenileme de yeni boş
workspace oluşturur. **Yalnız açıkça Kaydet/Farklı Kaydet ile oluşturulan proje
snapshot'ları kalıcı proje olarak listelenir.** Yenilemeden sonra Projelerim →
Aç kullanın; otomatik açma/kaydetme veya workspace devam ettirme yoktur.

## Arayüz ve kullanım

Solda şekil listesi, ortada OpenLayers haritası, sağda JSON, Tablo ve
Özellikler paneli yer alır. İlk çalışma boş açılır. Koyu ve açık tema
arasında geçiş yapılabilir. Tarayıcı tema tercihini hatırlar.

### Haritada çizim ve düzenleme

Nokta, çizgi, poligon, dikdörtgen ve daire araçları vardır. Poligonu
başlangıç köşesine tıklayarak veya Enter ile tamamlayın. Daire 64 kenarlı,
düzenlenebilir Polygon olarak yazılır. Mevcut Polygon/MultiPolygon'u seçip
köşelerini sürükleyebilir, kenardan köşe ekleyebilir veya Alt+tıklama ile
köşe silebilirsiniz. Düzenleme özgün Feature kimliğini, öznitelikleri,
kategorileri, delikleri ve desteklenen Z koordinatlarını korur.

Listede arama, sayfalama, geometri/öznitelik etiketi, görünürlük ve yakınlaşma
kontrolleri vardır. Göz düğmesi haritadaki görünümü değiştirir. Export tüm
kayıtları tam ayrıntıyla içerir. Köşe yakalama görünür önizlemeye uygulanır.
Sokak, uydu, topografya, sade ve boş altlık seçenekleri geometriyi değiştirmez.
Topografik altlık DEM veya yükseklik analizi sağlamaz. Kaynak ve güncellik
bilgileri harita üzerindeki sağlayıcı panelindedir.

### Ölçüm ve dışa aktarma

Bir şekil seçip **Özellikler** sekmesini açın. Polygon/MultiPolygon için
alanı m² ve km², çevreyi m ve km cinsinden görürsünüz. Alan hesabı iç boşlukları
çıkarır ve çevre hesabı onların sınırlarını da içerir. LineString/MultiLineString
için parça uzunlukları m ve km olarak toplanır. Ölçümler yaklaşık küresel
jeodezik değerlerdir, WGS84 boylam/enlem üzerinden hesaplanır ve yüksekliği içermez.

**Dışa aktar** menüsünde GeoJSON, Excel veya CSV seçin. Tablolarda her nesne bir
satırdır. Sütunlar özgün GeoJSON ID’sini, türü, etiketi, kategorileri, WGS84
geometri JSON’unu ve öznitelikleri içerir. Öznitelikler ayrı sütunlarda ve
türleri koruyan bir JSON sütununda bulunur. XLSX hücreleri metin olarak yazılır.
CSV, UTF-8 BOM ve virgül ayırıcı kullanır. Excel’e CSV aktarırken uzun ID’ler
ve başında sıfır bulunan değerler için ilgili sütunları **Metin** olarak seçin.
Formül gibi yorumlanabilecek CSV metinlerine tırnak içinde koruyucu sekme
eklenir. Kategori kataloğu gibi koleksiyon düzeyindeki meta veriler için
GeoJSON kullanın.

Tarayıcıdaki dönüşümde XLSX için 32 MiB ve 1.000.000 hücre, CSV için 128 MiB
ve 5.000.000 hücre sınırı vardır. Her iki tabloda en çok 256 öznitelik
sütunu açılır. Excel’in hücre başına 32.767 karakter sınırı aşılırsa dosya
kesilmeden işlem durur. Bu durumda CSV veya GeoJSON seçin.

### JSON, tablo ve kategoriler

Küçük dosyada JSON editörü tüm FeatureCollection'ı gösterir. Geçerli taslak
yaklaşık 700 ms sonra otomatik uygulanabilir. Otomatik uygulama kapatılabilir.
Uygula / Ctrl+Enter ve Biçimlendir ayrı işlemlerdir. Harita değiştiğinde
uygulanmamış taslak korunur ve güncel veri için uyarı gösterilir. Geçersiz
veya uygulanmamış taslak export'u ve proje kaydını engeller.

Tablo 20 satırlık sayfalarda öznitelik ve sütun düzenlemeyi destekler.
Enter veya hücreden çıkma değişikliği kaydeder. Doğrudan Kaydet'e
tıklanırsa proje snapshot'ı bekleyen hücre işlemini bekler. Sağ panel
sürükleyerek veya ok tuşlarıyla boyutlandırılır. Çift tıklama varsayılan
genişliği geri getirir.

Kategoriler ve görünüm → Kategorileri yönet ile ana ve alt kategorileri
oluşturun. Seçili şekle Özellikler panelinden atayın. Ana kategori değişince
alt kategori seçimi temizlenir. Atamalar `ana_kategori` ve `alt_kategori`
alanlarına, kullanılmayanları da içeren katalog `category_catalog` alanına
yazılır. Var olan `kategori` alanı uyumlu güncellenir. Adlar en çok 80
karakterdir. Aynı alt kategori adı farklı ana kategorilerde kullanılabilir.

### GeoJSON ve Excel

İçe aktar penceresi dosya seçme ve sürükle/bırak ile `.geojson`, `.json`,
`.xls` ve `.xlsx` kabul eder. GeoJSON, WGS84 / EPSG:4326 ve
[boylam, enlem, varsa Z] sırasını kullanır. FeatureCollection, tek Feature
veya geometri açılabilir. Çalışmaya ekle mevcut şekilleri korur.
Çalışmayı değiştirme onay gerektirir. Hatalı veya iptal edilen importta
mevcut çalışma korunur. Local akışlı ayrıştırıcı `__proto__` anahtarını
açık hata ile reddeder.

Excel'de sayfa, veri türü ve sütunları aynı pencereden seçin. Enlem ve boylam
her satır için Point üretir. Polygon için GeoJSON veya WKT (SRID 4326), çizgi
için standart 1e5 hassasiyetli encoded polyline kullanılabilir. İlk 50 satır
geometri sütununu tanımak için örneklenebilir. Boş ilk hücre ve yeniden
kodlanmış GeoJSON metni desteklenir. Diğer sütunlar properties'e eklenir
ve aynı adlı GeoJSON alanını geçersiz kılar. Dönüşüm ayrı Web Worker'da
çalışır. Boş geometri hücreleri atlanabilir. Sözdizimi hatasında satır/hücre
bildirilir ve kısmi veri uygulanmaz. Geçerli `geometry: null` korunur.
Büyük Excel kimliklerini metin hücresi olarak saklayın.

### Projeler ve dışa aktarma

Kaydet ad ister ve bağımsız snapshot oluşturur. Farklı Kaydet ayrı kayıt açar.
Projelerim'de Aç, Adını değiştir ve Sil bulunur. Silme onay ister.
Kaydedilmemiş değişikliklerle proje değiştirirken kullanıcıya karar sorulur.
Dışa aktar ve Ctrl/Cmd+S bütün Feature'ları GeoJSON dosyasına yazar.

## Test komutları

~~~bash
npm test
npm run build
RUN_BROWSER_INTEGRATION=1 ./node_modules/.bin/vitest run --config tests/api.integration.config.ts
runtime_python="$(bash scripts/run-backend.sh python-path)" &&
  (cd backend && "$runtime_python" -m pytest -q)
~~~

Tarayıcı testleri macOS Google Chrome, doğrulanmış bağımsız Python, geçici
DB, loopback portları ve ayrı Chrome profili kullanır. Büyük dosya testi,
API build ve yedekleme adımları işletim rehberindedir.
[Test ve doğrulama](docs/RUNBOOK.md#test-ve-doğrulama) ·
[Yedekleme ve geri yükleme](docs/RUNBOOK.md#yedekleme-ve-geri-yükleme)

## Bilinen sınırlar

- İlk sürüm tek kullanıcının yerel/loopback kullanımı içindir. Kullanıcı girişi,
  yetkilendirme ve genel internete güvenli yayın altyapısı yoktur.
- Haritada en çok 2500 görünür Feature; tablo sayfalı. Büyük veride yakınlaşın.
  Export görünürlük sınırına göre kayıt elemez.
- JSON editörü 2 MiB; 5000 Feature / 30.000 vertex / kaynak sınırında seçili
  Feature kapsamına geçer. Undo geçmişi en çok 30 işlem / yaklaşık 32 MiB.
- Excel: 25 MiB kaynak, 100 sütun, 100.000 satır, 250.000 Feature ve 200 MiB
  dönüştürülmüş çıktı. Formüller çalıştırılmaz. 16+ basamaklı sayısal tamsayı
  hücreleri engellenir; önceden yuvarlanmış veriler geri getirilemez.
- API varsayılan dosya sınırı 512 MiB, yönetilen disk kotası 4 GiB'dir; bunlar
  her dosya/cihaz için performans garantisi değildir. Tek Feature/token da
  belleğe sığmalıdır. Local modda tarayıcı kotası ve RAM ayrıca belirleyicidir.
- Shapely topolojisi XY kullanır; Z korunur. Topolojik hatalı import geometriyi
  değiştirmeden uyarıyla saklanabilir; yapısal hata importu reddeder.
  make_valid veya sessiz otomatik düzeltme yoktur.
- Normal kesirler desteklenir; kayıpsız temsil edilemeyen kesir/koordinat hata
  verir. Büyük tamsayı JSON number kalır, string yapılmaz.
- Local ve istemcide Çalışmaya ekle birleştirmesi category_catalog dışındaki
  kök metadata'yı taşımaz. API'nin doğrudan import/export'u metadata'yı korur.
  Feature içindeki ek alanlar ayrı olarak korunur.
- Harita altlıkları dış sağlayıcıya/internete bağlıdır. Lisans ve güncellik
  kapsamı: [harita kaynakları](docs/MAP_SOURCES.md).

## Belgeler

- [Kurulum, işletim, yedekleme ve hata giderme](docs/RUNBOOK.md)
- [Runtime ve son regresyon sonuçları](docs/STAGE10C_REPORT.md)
- [İlk kabul ve dal/merge değerlendirmesi](docs/STAGE10A_REPORT.md)
- [API veri sözleşmesi](backend/docs/REPOSITORY_API.md)
- [Backend endpointleri ve ayarlar](backend/README.md)
- [Proje ekranları ve state akışı](docs/PROJECT_UI_INTEGRATION.md)
- [Ortak entegrasyon kuralları](docs/INTEGRATION.md) — ilk tasarım belgesi;
  adaptörün varlığı/mod seçimi için güncel README ve API_MODE.md esas alınır.
- [9A kapasite ölçümleri](docs/STAGE9A_REPORT.md) / [9B sayı koruması](docs/STAGE9B_REPORT.md)

## Geliştirme ve kaynaklar

Gamze'nin harita ve arayüz çalışması `gamze-harita-arayuz` dalından gelir.
Yerel veri adaptörü `src/adapters/local/` içindedir. Backend ve API/proje
entegrasyonu `abdullah-backend` dalında geliştirilmiştir.
[Gamze'nin özgün frontend açıklamaları](docs/archive/FRONTEND_README_98509dc.md) ·
[Entegrasyon sözleşmesi](docs/INTEGRATION.md)

Etkileşim yaklaşımı [GeoJSON.io](https://geojson.io/) örneğinden gelir.
Harita düzenleme OpenLayers, yerel mekânsal indeks RBush ve akışlı
ayrıştırma Streamparser JSON kullanır.
[Referans uygulama notları](docs/REFERENCE_IMPLEMENTATION.md)
