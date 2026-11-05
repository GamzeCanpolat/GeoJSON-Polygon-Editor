# Harita kaynakları

Kaynak belgeleri 4 Kasım 2026 tarihinde kontrol edildi. Google Maps anahtarı olmadığı ve kullanıcı anahtarsız devam etmeyi seçtiği için uygulama Google'a bağlanmaz.

## Çalışan altlıklar

| Arayüz | Kaynak | Servis |
| --- | --- | --- |
| Sokak | OpenStreetMap Standard | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` |
| Uydu | Esri World Imagery | `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` |
| Topografya | OpenTopoMap-R, OpenMaps.fr | `https://tile.openmaps.fr/opentopomap/{z}/{x}/{y}.png` |
| Sade harita | OpenStreetMap Standard | Aynı OSM kaynağına görüntü filtresi uygulanır. |
| Altlık yok | Yerel GeoJSON | Dış görüntü istekleri kapatılır. |

Sağ üstteki altlık seçicinin yanındaki bilgi düğmesi aktif kaynağı, güncellik açıklamasını ve sağlayıcı bağlantılarını gösterir. Geçici yükleme hatasında **Yeniden dene** kullanılabilir. Kaynaklar sessizce birbirinin yerine geçirilmez; kullanıcı seçtiği sağlayıcıyı ve hata bildirimini görür.

## Güncellik ve doğruluk

- Tek bir sağlayıcı için bütün dünyada en güncel/en doğru olma garantisi verilemez. Yol/bina verisi güncellemesi, döşeme önbelleği, uydu çekim tarihi ve yükseklik modelinin tarihi ayrı kavramlardır.
- [OpenMaps.fr açıklaması](https://openmaps.fr/about-openmaps.fr.html), 28 Haziran 2026'dan itibaren OSM verisinin otomatik güncel tutulduğunu ve bir güne kadar gecikme olabileceğini belirtiyor. Bu, bütün yükseklik verisinin o gün ölçüldüğü anlamına gelmez.
- [Esri açıklaması](https://support.esri.com/en-us/knowledge-base/how-frequently-is-the-world-imagery-basemap-updated-146-000012222), World Imagery'nin tek seferde tüm dünya için güncellenmediğini açıklar. Arayüz bir görüntü için doğrulanmamış çekim tarihi göstermez.
- [OSMF teknik açıklaması](https://community.openstreetmap.org/t/technical-updates-to-the-tile-openstreetmap-org-service-openstreetmap-org-standard-layer/133421), üçüncü taraf uygulamalara önbellekteki döşemelerin sunulabileceğini belirtir. Önbellek kurallarını atlamak için URL'ye rastgele tarih/parametre eklenmez.
- Topografya, eşyükselti eğrileri ve arazi gölgelendirmesi gösteren görsel altlıktır; noktasal yükseklik ölçümü, eğim hesabı veya bir DEM analiz servisi değildir.
- Altlık değiştirmek GeoJSON koordinatlarını, Feature kimliklerini, kategorilerini veya geometrilerini değiştirmez. Düzenleme işlemleri EPSG:4326 verisi üzerinde, OpenLayers görüntülemesi EPSG:3857 ile çalışır.
- Yüksek yakınlaştırma altlık görüntüsünün büyütülmesi olabilir. Her bölgede aynı yer çözünürlüğü varmış gibi gösterilmez.

## Kullanım ve atıf

- [OpenMaps.fr politikası](https://openmaps.fr/tile-usage-policy.html): anahtar gerektirmeyen servis, makul hacimdeki ticari olmayan projeler içindir. Sağlayıcı 500.000 döşeme/ay ve IP başına 5.000 döşeme/saat sınırı bildiriyor. Ticari/yüksek hacimli yayından önce sağlayıcıyla düzenleme yapılmalı veya uygun bir servis seçilmeli.
- Topografya için OpenTopoMap-R, OpenStreetMap ve sağlayıcının istediği bağış bağlantısı harita üzerinde sürekli görünürdür.
- Uydu için [servisin copyrightText alanında](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=pjson) belirtilen Esri, Vantor, Earthstar Geographics ve GIS User Community adları gösterilir; servis sayfasına bağlantı verilir.
- [OSM döşeme politikası](https://operations.osmfoundation.org/policies/tiles/) gereğince sağlayıcının önbellek başlıkları korunur. Çevrimdışı döşeme indirme, toplu tarama veya görünmeyen bölgeleri önceden indirme özelliği yoktur. Katmanda preload 0'dır; yalnızca görünür alan yüklenir.

## Teknik bağlama noktası

`src/map/basemaps.ts` sağlayıcı adreslerini, görüntü türlerini, kaynak açıklamalarını ve doğal döşeme sınırlarını merkezi olarak tutar. `createBasemapSource` OpenLayers kaynaklarını üretir. `MapController` bu kaynakları oturum içinde tekrar kullanır, görünmez/önceki kaynaktan gelen hataları bastırır ve veri katmanlarını değiştirmeden altlığı değiştirir.

Google Maps daha sonra eklenirse [resmi Map Tiles API](https://developers.google.com/maps/documentation/tile/get-api-key) kullanılmalıdır: etkin proje/faturalandırma ve uygun anahtar gerekir. Belgelenmemiş Google döşeme adresleri veya başka sitelerin anahtarları kullanılmadı.
