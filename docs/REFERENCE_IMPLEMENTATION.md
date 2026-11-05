# Geojson.io kaynak karşılaştırması

5 Kasım 2026'da kullanıcının paylaştığı [geojson.io görünümü](https://geojson.io/?map=19.08/40.98876/28.84585) ve açık kaynak depo incelendi. Referans commit: `e62e8cbaedd5c449980fde6e70fd8719486bd5b5`.

İncelenen başlıca kaynaklar:

- [Ortak içe aktarma penceresi](https://github.com/mapbox/geojson.io/blob/e62e8cbaedd5c449980fde6e70fd8719486bd5b5/app/components/dialogs/import.tsx).
- [Dosya biçimi grubu](https://github.com/mapbox/geojson.io/blob/e62e8cbaedd5c449980fde6e70fd8719486bd5b5/app/components/dialogs/import/import_file_group.tsx).
- [Koordinat/WKT/GeoJSON/polyline ve sütun eşleştirme formu](https://github.com/mapbox/geojson.io/blob/e62e8cbaedd5c449980fde6e70fd8719486bd5b5/app/components/csv_options_form.tsx).
- [Excel → GeoJSON dönüşümü](https://github.com/mapbox/geojson.io/blob/e62e8cbaedd5c449980fde6e70fd8719486bd5b5/app/lib/convert/local/xlsx_to_geojson.ts).
- [Satır/geometri dönüşüm davranışı](https://github.com/mapbox/geojson.io/blob/e62e8cbaedd5c449980fde6e70fd8719486bd5b5/app/lib/convert/local/csv_to_geojson.ts).

Bu depodaki uygulama OpenLayers/React ile kendi kodunu kullanır. Kaynak dosyalar kopyalanmadı; referansın etkileşim modeli izlendi.

## Uyarlanan akış

- Üstte seçim ve nokta/çizgi/poligon/dikdörtgen/daire araçları; sağda İçe aktar ve Dışa aktar.
- Solda geometri/öznitelik etiketi seçilebilen sade liste ve her şeklin göz düğmesi.
- Ortada harita, sağda aynı veri üzerinde çalışan JSON ve Tablo. Seçim olduğunda Özellikler sekmesi açılır.
- Excel de yalnızca ortak İçe aktar penceresinde: dosya biçimi, veri türü, sayfa ve sütun seçimi.
- Koordinat satırı nokta üretir; poligon için WKT veya GeoJSON hücresi kullanılır. Diğer sütunlar properties olur.
- Mevcut şekillere ekleme varsayılandır; kullanıcı tüm çalışmayı değiştirmeyi seçebilir.

## Bizim sürümdeki kapsam

Polygon/MultiPolygon seçilince köşe düzenleme otomatik açılır. Köşe sürükleme, kenara köşe ekleme ve Alt+tıklama ile köşe silme desteklenir; JSON koordinatları aynı veriden güncellenir. Dışarıdan açılan Feature'ın özgün id, properties, delikler ve desteklenen Z değerleri korunur.

Ana/alt kategoriler elle oluşturulur. Excel bir kategori şablonu değildir. Koyu/aydınlık mod ve anahtarsız Sokak/Uydu/Topografya altlıkları korunur. Referans bağlantısının konumu örnek veri veya başlangıç konumu olarak sabitlenmez; ilk açılış boş Türkiye haritasıdır.

Referanstaki tüm dönüştürücüler bu sürümün kapsamına alınmadı. Dosya biçimleri JSON/GeoJSON ve XLS/XLSX'tir. Excel'de 25 MiB/100 sütun/100.000 satır sınırı vardır; 100–500 MB akışlı okuma hedefi GeoJSON içindir. Tüm dosya JSON görünümü büyük veri için seçili Feature kapsamına geçer. Sunucu, kalıcı kayıt ve topolojik doğrulama ikinci geliştiricinin işi olarak kalır.

Geometri etkileşimleri için [OpenLayers Modify](https://openlayers.org/en/latest/apidoc/module-ol_interaction_Modify-Modify.html), WKT/polyline için OpenLayers biçim okuyucuları kullanılır. Excel okuyucusu resmi SheetJS 0.20.3 dağıtımıdır.
