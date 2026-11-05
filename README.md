# GeoJSON Polygon Editor

GeoJSON.io kullanım mantığını temel alan, poligon düzenlemeye odaklı yerel web uygulaması. Bu depo Gamze'nin harita/arayüz bölümünü ve ikinci geliştiricinin veri servisini bağlayabileceği ortak sözleşmeleri içerir.

## Başlatma

Node.js 22.12+ veya 24 LTS kullanın.

```powershell
npm install
npm run dev
```

Tarayıcı: http://127.0.0.1:5173

```powershell
npm run build
npm test
```

Derleme çıktısı `dist/` dizinine yazılır. Derleyici için resmi Rollup WebAssembly sürümü kullanılır; Windows'ta yerel `.node` eklentisi gerektirmez.

## Hazır olanlar

Ana çalışma düzeni solda şekil listesi, ortada harita, sağda **JSON / Tablo / Özellikler** panelidir. Referans [geojson.io](https://geojson.io/) sayfasındaki harita ve kodun aynı veriyi düzenlemesi yaklaşımıdır.

- **İçe aktar:** `.geojson`, `.json`, `.xls` ve `.xlsx` aynı pencereden açılır; sürükle/bırak da bu pencereye yönlenir. JSON/GeoJSON seçilince doğrudan eklenir; ikinci ve sonraki dosyalar mevcut şekilleri korur. Excel sütun eşleştirmesinden sonra İçe aktar ile onaylanır. Çalışmayı tamamen değiştirme ayrıca onaylanır.
- **JSON:** Başlangıçtan itibaren tüm FeatureCollection görünür. GeoJSON yazılabilir/yapıştırılabilir. Geçerli kod yaklaşık 700 ms sonra otomatik uygulanır; otomatik uygulama kapatılabilir veya **Uygula / Ctrl+Enter** kullanılabilir. Hatalı taslak haritayı değiştirmez. Kendi yazdığınız geçerli kod her uygulamada yeniden biçimlendirilmez; yazma konumu korunur. Biçimlendirme ayrı düğmedir.
- **Harita:** Poligon seçildiğinde köşe düzenleme açılır. Nokta, çizgi, poligon, dikdörtgen ve daire araçları vardır. Daire GeoJSON'a düzenlenebilir 64 kenarlı Polygon olarak yazılır. Çizim, taşıma ve köşe değişiklikleri JSON'a yansır.
- **Tablo:** Öznitelikler 20 satırlık sayfalarda düzenlenir. Hücreden çıkma veya Enter kaydeder; sayı ve boolean türleri doğrulanır. Sütun eklenebilir.
- **Özellikler:** Seçili şeklin kategorileri, alanı ve ayrıntıları burada düzenlenir.
- Sağ panelin sol kenarı sürüklenebilir; klavyeyle ok tuşlarıyla boyutlandırılabilir. Çift tıklama varsayılan genişliğe döner.

Kod editörü en fazla **2 MB UTF-8 metin** düzenler. 30.000 köşe, 5.000 şekil veya 2 MB kaynak sınırı aşıldığında otomatik olarak **Seçili şekil** kapsamına geçilir; böylece büyük dosyanın tamamı textarea'ya aktarılmaz. Çok ayrıntılı tek şeklin kod görünümü de sınırlıdır. Bu sınırlar dosyayı açma, sayfalı tablo ve tüm veriyi dışa aktarmanın sınırı değildir.

Kod taslağı varken harita değişirse taslak sessizce ezilmez; güncel veriyi yüklemek için bildirim gösterilir. Geçersiz/uygulanmamış taslak varken dışa aktarma ve veri panelini kapatma engellenir. Tam dosya kod düzenlemesi bir dosya anlık görüntüsü olarak geri alınabilir; bu sınırdan önceki şekil bazlı geçmiş ve dosya sınırından sonraki eski kayıt kimliklerine bağlı yinelemeler temizlenir. Geçmiş yine en fazla 30 işlem / yaklaşık 32 MB'dir.

- İlk açılışta boş çalışma, sıfır şekil ve sıfır kategori; Türkiye genel haritası. Örnek veri otomatik yüklenmez.
- GeoJSON FeatureCollection, tek Feature veya geometri açma; dosya seçme ve sürükle/bırak.
- Poligon çizme, köşe taşıma, kenara köşe ekleme, Alt+tıklama ile köşe silme.
- Polygon/MultiPolygon dahil mevcut geometrileri seçme ve taşıma.
- Şekil silme, geri alma ve yineleme; geçmiş en çok 30 işlem / yaklaşık 32 MB.
- Seçili şeklin özniteliklerini veya tam GeoJSON verisini düzenleme.
- Ana kategori ve buna bağlı alt kategoriler oluşturma; seçili şekle atama. Kategori ağacı dışa aktarmada korunur.
- Sade şekil listesi, geometri/öznitelik etiketi seçimi, şekil başına göz düğmesi, arama, sayfalama ve seçime/tümüne yakınlaşma. Göz düğmesi yalnızca görünümü değiştirir; JSON ve dışa aktarılan kayıtları silmez.
- Sokak (OpenStreetMap), uydu (Esri World Imagery), topografya (OpenTopoMap-R), sade harita ve boş altlık. Sağ üstte kaynak/güncellik bilgisi.
- Görsele uygun koyu lacivert/mavi tema ve aydınlık mod; sağ üstteki güneş/ay düğmesiyle geçiş, tema tercihinin tarayıcıda hatırlanması.
- Dosya işlemlerini Web Worker'da yürütme, parça parça okuma, IndexedDB geçici depolama, R-tree görünür alan sorguları.
- Tüm kayıtlarda özgün ayrıntıyı koruyan dışa aktarma. Görüntüleme için basitleştirilmiş şekiller kaydedilmez.
- Hatalı/iptal edilmiş dosya açıldığında mevcut çalışma korunur.

## Büyük dosyalar

Hedef aralık **100–500 MB**. Dosya boyutu tek başına yeterli bir performans ölçütü değildir: şekil/köşe sayısı, tek bir geometrinin büyüklüğü, cihaz belleği ve tarayıcı kotası belirleyicidir. 500 MB her cihazda garanti edilmez.

- Dosya 256 KB parçalar halinde okunur; geometri kayıtları IndexedDB'ye yazılır.
- Ana iş parçacığına tüm dosya verilmez. Worker'da özetler ve mekânsal indeks tutulur.
- Haritada en çok 2.500 görünür şekil çizilir. Sınır aşılırsa açık bir bildirim gösterilir; kullanıcı yakınlaşabilir veya sayfalı listeden istediği kaydı seçebilir.
- Seçilen şekil özgün koordinatlarıyla yüklenir. Köşe yakalama görünür önizleme geometrilerine uygulanır; tam topolojik ortak sınır düzenlemesi değildir.
- Bir Feature içindeki çok büyük geometri veya çok büyük tek bir metin alanı yine belleğe sığmalıdır.
- Dışa aktarma parça Blob'larından hazırlanır; tarayıcı depolama/bellek sınırlarına tabidir.

Sentetik büyük dosya üretmek için:

```powershell
npm run generate:large -- 150000
# Yaklaşık 100 MB; dosya fixtures/generated/ altında oluşturulur ve Git'e eklenmez.
```

Veri katmanının büyük dosya testi:

```powershell
$env:PERF_FILE = (Resolve-Path 'fixtures/generated/polygons-150000.geojson').Path
npm test -- tests/unit/large-file.test.ts
Remove-Item Env:PERF_FILE
```

## Çalışma oturumu

Bu sürüm bir **yerel çalışma oturumudur**. Dosya sunucuya yüklenmez; altlık sağlayıcılarına harita döşemesi istekleri gider. Sayfayı kapatmadan önce dışa aktarın. IndexedDB burada geçici çalışma alanıdır; kalıcı proje kaydı/oturum geri yükleme özelliği sunulmaz. Beklenmedik kapanıştan sonra tarayıcıda geçici veri kalabilir; site verilerini temizleyerek kaldırılabilir.

Girdi WGS84 / EPSG:4326 olmalıdır. Temel yapısal doğrulama vardır; kendini kesen poligon/topolojik geçerlilik kontrolü henüz yoktur. Dışa aktarma bir FeatureCollection üretir. Feature kimlikleri, properties, geometri ve Feature üzerindeki ek alanlar korunur; uygulamanın `category_catalog` alanı haricinde koleksiyon seviyesindeki ek metadata/CRS alanları taşınmaz. Geometri düzenlemesinden sonra eski bbox alanları kaldırılır.

## Ana ve alt kategoriler

1. Sol panelin altındaki **Kategoriler ve görünüm → Kategorileri yönet** düğmesine tıklayın; şekil seçmek gerekmez.
2. Ana kategori ekleyin, ardından o ana kategoriye bağlı alt kategoriler oluşturun. Aynı alt kategori adı farklı ana kategorilerde kullanılabilir.
3. Bir şekil seçin. Sağ panelde **Özellikler** sekmesinde **Ana kategori** ve **Alt kategori** alanlarını doldurup **Kategori seçimini uygula** düğmesine tıklayın.
4. Ana kategori değiştiğinde eski alt kategori temizlenir. Atamalar geri alma/yineleme ile değiştirilebilir.
5. Dışa aktarılan dosya, atamaları `properties.ana_kategori` / `properties.alt_kategori`, kategori ağacını `category_catalog` içinde taşır. Kullanılmamış kategori tanımları da korunur. Eski `kategori` alanı varsa eşzamanlı güncellenir.

Kategori adları en çok 80 karakterdir; boş veya aynı üst kategoride tekrar eden adlar kabul edilmez. Bu sürümde kategori yeniden adlandırma/silme arayüzü yoktur.

## Dışarıdan açılan poligonu düzenleme

### GeoJSON dosyasını açma

**İçe aktar → .json/.geojson dosyanızı seçin → listeden/haritadan poligonu seçin → köşeyi sürükleyin → Dışa aktar.** JSON/GeoJSON dosyası seçildiğinde otomatik eklenir; aynı adımla ikinci ve sonraki dosyalar da eklenebilir. “Çalışmaya ekle” kapatılırsa mevcut veri değiştirilmeden önce İçe aktar ile onay gerekir. Uygulanmamış JSON taslağı varken otomatik ekleme yapılmaz; taslak uygulanmalı veya bırakılmalıdır. Dosya GeoJSON yapısında bir FeatureCollection, Feature veya geometri içermelidir; sıradan bir JSON tablosu desteklenmez. Poligon seçimi köşe düzenleme modunu otomatik açar. Polygon ve MultiPolygon köşeleri taşınabilir, kenardan eklenebilir ve Alt+tıklama ile silinebilir.

Harita düzenleme köprüsü, tam ayrıntılı WGS84 geometrisini harita koordinatlarına çevirir; düzenleme bittiğinde aynı Feature'ın geometrisini günceller. Harita seçimi için kullanılan dahili kimlik dosyanın özgün `id` alanının yerine yazılmaz. Öznitelikler, kategoriler, delikler ve desteklenen Z koordinatları korunur. Bu akış Polygon/MultiPolygon dosya açma–harita düzenleme–dışa aktarma entegrasyon testleriyle doğrulanır.

### Ortak pencereden Excel açma

**İçe aktar → .xls/.xlsx seç → veri türü → sayfa ve sütunlar → İçe aktar.** Excel için ayrı menü, kategori şablonu veya toplu kategori yükleme ekranı yoktur.

Ayrı bir sütundaki JSON kodları desteklenir. Okuyucu sayfalarda veri arar; sütunun ilk 50 veri satırını örnekleyerek GeoJSON'u içeriğinden tanır. İlk hücrenin boş olması veya sütun başlığının farklı olması engel değildir. Açıklama sayfası yerine veri içeren sayfa seçilir; tür ve sütun otomatik doldurulur. Gerekirse sayfa/sütun elle değiştirilebilir. GeoJSON içeren, JSON olarak yeniden kodlanmış metin hücreleri de açılır. Yalnızca sıradan JSON öznitelikleri içeren bir hücre harita geometrisi sayılmaz.

| Veri türü | Eşleştirme ve sonuç |
| --- | --- |
| Koordinatlar | Enlem ve boylam sütunları; her satır bir Point olur. Satırlar kendiliğinden bir poligona bağlanmaz. |
| WKT sütunu | `POLYGON`, `MULTIPOLYGON` ve diğer WKT geometrileri; WGS84 / SRID 4326. |
| GeoJSON sütunu | Hücrede FeatureCollection, Feature, geometri veya bunların dizisi; poligonlar doğrudan düzenlenebilir. |
| Kodlanmış polyline | Standart 1e5 hassasiyetli encoded polyline; LineString üretir. |

Diğer sütunlar özniteliklere eklenir; hücredeki GeoJSON ile aynı alan adı varsa Excel sütunu geçerlidir. Formüller çalıştırılmaz; kaydedilmiş hesap sonucu okunur. Hatalı satır varsa hiçbir kayıt eklenmez ve satır numarası gösterilir. Dönüştürme ayrı Web Worker'dadır.

JSON sütununda boş/yalnızca görünmez boşluk içeren hücreler, boş JSON metni (`""`) ve `null`, `NaN`, `None`, `undefined`, `N/A`, `#N/A` metinleri geometri bulunmayan satır sayılır. Bunlar atlanır; başarı bildiriminde atlanan satır sayısı gösterilir. Bu kural yalnızca geometri hücresine uygulanır; diğer öznitelikleri değiştirmez. `geometry: null` içeren geçerli Feature korunur. Gerçek JSON sözdizimi hataları sessizce atlanmaz: satır ve hücre adresi, varsa karakter konumu ile bildirilir; mevcut çalışma korunur.

Excel sınırları: 25 MiB kaynak, 100 sütun, 100.000 veri satırı, 250.000 şekil, 200 MiB dönüştürülmüş çıktı. 100–500 MB hedefi doğrudan JSON/GeoJSON içindir. Kaynak karşılaştırması ve farklar: [referans uygulama notları](docs/REFERENCE_IMPLEMENTATION.md).

## Harita ve topografya

Sağ üstteki **Harita altlığı** alanından Sokak / Uydu / Topografya seçilir. Yanındaki bilgi düğmesi veri sağlayıcısını ve güncellik açıklamasını gösterir. Google Maps anahtarı gerekmez. Topografik görüntü, yükseklik ölçümü veya DEM analizi değildir; altlık değiştirildiğinde poligon verisi aynı kalır.

En güncel görüntü bölgeye göre değişir; bir sağlayıcıya dünya genelinde güncellik/doğruluk garantisi verilmez. [Harita kaynakları ve kullanım kapsamı](docs/MAP_SOURCES.md) belgesini inceleyin. Anahtarsız OpenMaps.fr servisi makul hacimli ticari olmayan kullanım içindir; ticari/yüksek hacimli yayında sağlayıcı koşulları ayrıca karşılanmalıdır.

Akışlı ayrıştırıcının özel nesne anahtarı davranışı nedeniyle `__proto__` anahtarı içeren dosyalar, sessiz veri kaybı yerine açık hata ile reddedilir.

## İki kişilik geliştirme

| Sorumlu | Alan | Dosyalar |
| --- | --- | --- |
| Gamze | Harita, çizim/düzenleme etkileşimleri, paneller, görünür alan performansı | `src/App.tsx`, `src/components/`, `src/map/`, `src/styles.css` |
| Arayüzü çalıştıran yerel adaptör | Tarayıcıda geçici dosya açma, çalışma verisi ve dışa aktarma | `src/adapters/local/` — sunucu teslimatı değildir |
| İkinci geliştirici | Sunucu/veri servisi, kalıcı proje kaydı, tam geometri doğrulama, veri işleme | Yeni servis/adaptör; `src/data/createRepository.ts` üzerinden bağlanır |
| Ortak | Veri sözleşmeleri, hata biçimi, performans kabul ölçütleri, entegrasyon | `src/domain/contracts.ts`, `docs/INTEGRATION.md` |

Arayüzün çalışması için hazırlanmış yerel veri adaptörü ayrı olarak `src/adapters/local/` içindedir.



