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
- GeoJSON import/export, JSON editörü, sayfalı tablo ve Feature properties düzenleme.
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

## Kullanım örnekleri

1. Poligon çiz aracını seçin, köşeleri işaretleyip başlangıca tıklayın veya Enter
   ile tamamlayın. Seçili şeklin köşelerini sürükleyin. Undo/redo ile geri dönün.
2. İçe aktar ile .geojson/.json seçin. WGS84 / EPSG:4326 koordinat sırası
   [boylam, enlem, varsa Z] olmalıdır. Harita önizlemesi düzenleme verisi değildir.
3. Excel'de Enlem/Boylam sütunlarını eşleştirin; her satır Point olur. Polygon
   için GeoJSON veya WKT sütunu seçin. Diğer sütunlar properties olarak taşınır.
   Büyük ID'yi Excel'de **metin hücresi** olarak saklayın.
4. JSON veya Tablo sekmesinde değerleri değiştirin. Hatalı/uygulanmamış JSON'u
   uygulamadan proje kaydetme engellenir. Hücreden doğrudan Kaydet'e geçişte
   bekleyen tablo düzenlemesi tamamlanmadan snapshot kaydı başlamaz.
5. Kategoriler ve görünüm → Kategorileri yönet ile ana/alt kategori ekleyin.
   Özellikler panelinden seçili şekle atayın; katalog export'ta korunur.
6. API proje ekranları açıkken Kaydet ad ister. Farklı Kaydet bağımsız kayıt
   oluşturur. Projelerim'den Aç / Adını değiştir / Sil kullanılabilir.
   Silme açık onay ister; kaydedilmemiş çalışma için karar sorulur.
7. Dışa aktar, bütün Feature'ları GeoJSON olarak indirir. Ctrl/Cmd+S de dosya
   export'udur; API proje snapshot'ı kaydetmekle aynı işlem değildir.

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

## Geliştirme ve kaynak notu

Harita/arayüzün ilk sürümü gamze-harita-arayuz dalından gelir; backend ve sonraki
API/proje entegrasyonu abdullah-backend dalında geliştirilmiştir. Local adaptör
tarayıcıda çalışır; sunucu teslimatı backend/ ve API adaptörleridir.

Etkileşim yaklaşımı için [GeoJSON.io](https://geojson.io/), harita düzenlemede
OpenLayers ve yerel mekânsal indekste RBush kullanılmıştır. Referans Amplify
uygulamasının kaynak kodu bu depoya aktarılmamıştır; ayrıntılar
[referans uygulama notlarındadır](docs/REFERENCE_IMPLEMENTATION.md).

## Arayüzün ayrıntılı çalışma davranışları

Bu bölüm gamze-harita-arayuz dalındaki frontend kullanım notlarını güncel
Local/API kurulumuyla birlikte korur. Özgün README metninin tamamı
[tarihsel arşivde](docs/archive/FRONTEND_README_98509dc.md) bulunur; arşivdeki
“backend henüz yok” cümleleri güncel durum değildir. Üç dalın karşılaştırması
ve README adayının hazırlanma kararı: [birleştirme planı](docs/README_MERGE_PLAN.md).
Bu çalışma ağacındaki README, incelenecek birleştirilmiş adaydır; Git merge yapılmadı.

- Küçük dosyada JSON tüm FeatureCollection'ı gösterir. Geçerli taslak yaklaşık
  700 ms sonra otomatik uygulanabilir; otomatik uygulama kapatılabilir.
  Uygula / Ctrl+Enter ve ayrı Biçimlendir kullanılabilir. Harita değişince
  uygulanmamış taslak sessizce ezilmez; eski veriye bağlı uyarı gösterilir.
- Tablo 20 satırlık sayfalarda çalışır; Enter veya hücreden çıkma kaydeder.
  Sağ panelin kenarı sürüklenebilir, klavye oklarıyla boyutlandırılabilir;
  çift tıklama varsayılan genişliğe döner.
- Nokta, çizgi, poligon, dikdörtgen ve daire araçları vardır. Daire düzenlenebilir
  64 kenarlı Polygon olarak yazılır. Polygon/MultiPolygon köşeleri taşınabilir,
  kenara köşe eklenebilir; Alt+tıklama ile köşe silinebilir.
- Liste etiketi geometri/öznitelik alanına göre seçilebilir. Şeklin göz düğmesi
  yalnız görünümü değiştirir; gizli Feature export'tan silinmez. Yakalama görünür
  önizleme köşelerine uygulanır; tam ortak sınır/topoloji düzenleme değildir.
- Ana kategori değişince seçili alt kategori temizlenir. Atamalar
  ana_kategori / alt_kategori alanlarına, katalog category_catalog'a yazılır;
  eski kategori alanı varsa uyumlu güncellenir. UI kategori adı 80 karakterle
  sınırlıdır. Aynı alt kategori adı farklı ana kategorilerde kullanılabilir.
- Excel tek import penceresinde sayfa/veri türü/sütun seçimiyle çalışır.
  İlk 50 veri satırı geometri sütunu için örneklenebilir; ilk hücrenin boş
  olması engel değildir. GeoJSON içeren yeniden kodlanmış JSON metni desteklenir.
  Boş/null benzeri geometri hücreleri atlanabilir; gerçek sözdizimi hatasında
  satır/hücre bilgisi verilir ve kısmi veri uygulanmaz.
- Excel koordinatları satır başına Point üretir; satırlar kendiliğinden poligona
  bağlanmaz. WKT için WGS84/SRID 4326, encoded polyline için standart 1e5
  hassasiyet kullanılır. geometry:null içeren geçerli Feature silinmez.
- Sokak, uydu, topografya, sade ve boş altlık seçenekleri veriyi değiştirmez.
  Topografik altlık DEM/yükseklik analizi değildir; sağlayıcı bilgisi harita
  üstündeki kaynak panelinden ve MAP_SOURCES.md'den incelenebilir.
