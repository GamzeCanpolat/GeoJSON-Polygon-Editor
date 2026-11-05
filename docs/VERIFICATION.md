# Doğrulama kaydı

Tarih: 5 Kasım 2026.

## Güncel kapsam

Geojson.io kaynak kodu ve kullanıcının referans ekranları incelenerek üst çizim çubuğu, sade Etiket listesi/göz düğmesi, harita ve sağ JSON/Tablo düzeni uygulandı. Polygon/MultiPolygon seçimi köşe düzenlemesini otomatik açar. Başlangıç boş çalışma ve Türkiye genel haritasıdır; Sivas örneği veya otomatik örnek dosya yoktur.

Son kullanıcı tercihiyle Excel yalnızca ortak **İçe aktar** penceresine eklendi. Ayrı Excel ekranı, kategori şablonu, kategori toplu yükleme metodu yoktur. Kategoriler elle yönetilir. Sunucu, kalıcı kayıt, kullanıcı hesapları ve topolojik doğrulama ikinci geliştiricinin işi olarak kalır. Kaynak inceleme ayrıntıları: [referans notları](REFERENCE_IMPLEMENTATION.md).

## Otomatik testler

`npm test`: **49 test başarılı**, 1 isteğe bağlı büyük dosya testi atlandı. `npm run build` başarılı.

`node scripts/verify-import-worker.mjs`: üretim derlemesindeki gerçek import Worker paketi Node worker_threads köprüsünde çalıştırıldı. XLS/XLSX okuma, sayfa/sütun eşleştirmesi, WKT/Point/GeoJSON, özgün kimlik/öznitelik, hatalı satırı reddetme, akışlı ekleme/ilerleme ve hatalı giriş kontrolleri başarılı. Bu, native tarayıcı dosya seçicisinin testi değildir.

- 11 akışlı GeoJSON/veri motoru testi: UTF-8/parça sınırları, FeatureCollection/Feature/geometri, iptal ve hata sonrası eski veri, sayfalama, görünürlük sınırından bağımsız export, silme/geri yükleme, özgün kimlik/öznitelik/Z koruması.
- 4 kategori testi: ana/alt kategori kuralları, eski kategori alanı, kullanılmayan tanımların export/reimport ile korunması, hatalı metadata atomik reddi.
- 6 JSON/Tablo sözleşmesi testi: yapısal doğrulama, UTF-8 sınırı, büyük dosya görünüm politikası, tipli hücreler, tam dosya düzenleme ve geri yükleme, okunaklı koordinat biçimi.
- 2 dışarıdan açılan Polygon/MultiPolygon → OpenLayers geometri düzenleme → export testi; delikler, diğer parçalar, properties ve desteklenen Z değerleri korunur.
- 1 harita kaynağı testi: döşeme adresleri, atıflar ve topografya doğal zoom sınırı.
- 20 ortak içe aktarma testi: gerçek XLS/BIFF8 ve XLSX kodlama-okuma, GeoJSON poligonu açma/düzenleme/export, koordinat satırlarının Point olması, WKT delikleri/MultiPolygon/SRID, encoded polyline, sayfa/sütun eşleştirmesi, diğer sütunların tipleri, kaydedilmiş formül sonuçları, satır hatalarında atomik ret, sınırlar ve mevcut/gelen dosyayı akışlı birleştirme. Ayrı JSON sütununu ilk hücre boşken bulma; açıklama sayfasını atlama; centroid koordinatları yerine poligonu seçme; farklı başlıklar, çift JSON kodlaması ve sıradan JSON metadata'sını geometriyle karıştırmama. Boş/görünmez hücreler, boş metin/null/NaN/None işaretleri XLS ve XLSX'te atlanır; gerçek bozuk JSON için B75 gibi hücre adresi bildirilir ve import atomik reddedilir. Geçerli null geometrili Feature ve öznitelik içindeki görünmez karakterler korunur.
- 5 React/DOM içe aktarma regresyon testi: seçimden sonra ilk/ikinci/üçüncü JSON'un otomatik eklenmesi; doğrudan dosya girişinde aynı dosyanın tekrar seçilebilmesi; hatalı dosyadan sonra önceki veri korunarak yeni dosya seçilmesi; çalışma değiştirmede açık onay beklenmesi; XLSX içindeki ayrı JSON sütununu otomatik seçip mevcut poligonlara ekleme. JSDOM testleri gerçek App/ImportDialog, yerel veri motoru ve akışlı birleştiriciyi çalıştırır; harita canvas'ı ve Worker taşıma katmanı taklit edilir. Native tarayıcı dosya seçicisi testi değildir.

## Tarayıcıda doğrulanan güncel etkileşimler

Test verisi gerçek JSON kod alanına yazıldı; dosya seçici iznini aşan alternatif yükleme kullanılmadı.

- Geçerli JSON poligonu haritada/listede oluşur; hatalı taslak mevcut geometriyi bozmaz. Otomatik uygulama ve manuel Uygula çalışır; taslak/harita çakışması kullanıcı taslağını korur.
- Kullanıcının referans konumu yakınında poligon seçimi köşe düzenleme açtı. Köşe sürükleme JSON koordinatlarını değiştirdi; özgün id ve properties aynı kaldı.
- Nokta, çizgi, dikdörtgen ve daire araçları fareyle kullanıldı; her biri doğru GeoJSON geometri türünü üretti. Daire 64 kenarlı Polygon'dur. Her çizim Geri al ile kaldırıldı.
- Etiket alanı `isim` seçilince satır etiketi güncellendi. Göz düğmesi şekli gizleyip gösterdi; JSON metni değişmedi.
- Ortak İçe aktar penceresinde GeoJSON/Excel biçimi ve dört tür/sütun alanları görüntülendi; dosya seçilmeden gönderim engellendi. İptal çalıştı.
- JSON/Tablo/koşullu Özellikler sekmeleri, kategori atama alanları ve koyu/aydınlık geçişi doğrulandı.
- 390 px mobil görünümde scrollWidth 390; altı çizim aracı, içe/dışa aktar ve veri paneli düğmeleri ekran içinde kaldı. Panel kapatılınca harita kullanılabilir.
- Kaynak yenilenmesinde aynı canlı çalışma korunur. Harita JSON alanını kendi değişimiyle güncellediğinde yazma konumu korunur.

Güncel görüntüler:

- `screenshots/reference-polygon-edit-light.jpg`
- `screenshots/reference-polygon-edit-dark.jpg`
- `screenshots/shared-import-dialog.jpg` (Excel eşleştirme alanları; dosya seçilmediği için alanlar devre dışıdır)

Tarayıcı dosya yükleme/indirme eylemleri önceki araç otomatik onay incelemesinde reddedildi; aynı eylemler dolaylı yoldan tekrar denenmedi. Native dosya seçici → içe aktar → indir uçtan uca kabul testi kullanıcı tarayıcısında hâlâ gereklidir. Veri katmanı ve üretim Worker testleri bu sınırlamayı ortadan kaldırmaz.

## Önceki büyük dosya ölçümü

4 Kasım'da Node.js 24 ve fake-indexeddb ile sentetik 150.000 Feature / 3.750.000 koordinat içeren 103,62 MiB (yaklaşık 108,7 MB) GeoJSON test edildi. Import 16,62 saniye; import/sorgu/export ve iki akışın SHA-256 karşılaştırması 52,61 saniye sürdü. Export edilen tüm kayıtların karmaları eşleşti; haritaya en çok 2.500 kayıt gönderildi.

Bu ölçüm tarayıcı IndexedDB/harita performans testi değildir. Gerçek 100/250/500 MB kullanıcı dosyaları ve farklı cihazlarla kabul testi gereklidir; 500 MB garantisi verilmez. Excel için ayrı 25 MiB, 100 sütun, 100.000 satır, 250.000 şekil ve 200 MiB dönüştürülmüş çıktı sınırları vardır.

## Diğer kapsam sınırları

- Uygulamanın category_catalog alanı dışında koleksiyon seviyesindeki ek metadata dışa aktarılmaz; Feature seviyesindeki alanlar korunur.
- Geometri değişince eski bbox kaldırılır; tam topolojik geçerlilik kontrolü yapılmaz.
- Tek bir çok ayrıntılı geometri cihaz belleğiyle sınırlıdır. Büyük dosya tümüyle kod editörüne aktarılmaz.
- Göz düğmesi gizleme durumunu oturumda tutar; export gizli kayıtları da içerir.
- Yerel IndexedDB geçici çalışma alanıdır; kalıcı proje kaydı/oturum geri yükleme yoktur.
