# Arayüz ve veri servisinin entegrasyonu

## Tek bağlama noktası

`src/domain/contracts.ts` içindeki `GeoJsonRepository` arayüzü ortak sınırdır. React ve OpenLayers, doğrudan IndexedDB/HTTP kullanmaz. `src/data/createRepository.ts` içindeki fabrika şu anda `src/adapters/local/WorkerGeoJsonRepository.ts` içindeki tarayıcı adaptörünü döndürür. İkinci geliştirici aynı arayüzü uygulayan bir servis adaptörü ekleyip bu fabrikayı değiştirir. `local/` sunucu kodu veya ikinci kişinin tamamlanmış teslimatı değildir; yalnızca arayüzün dosya açıp düzenleyebilmesi için geçici çalışma sağlar.

İlk açılış `createEmpty()` çağırır. Örnek GeoJSON yüklenmez; şekil ve kategori sayıları sıfırdır. Başlangıçta Türkiye genel haritası görünür, dosya açıldığında gerçek geometrinin sınırlarına yakınlaşılır.


## Harita / JSON / Tablo ortak çalışma alanı

`DataPanel` aynı repository üzerinde JSON, Tablo ve Özellikler sekmelerini gösterir. Yeni bir servis sözleşmesi eklenmedi.

- Küçük dosyanın JSON görünümü `export()` ile okunur. Geçerli kod taslağı yapısal doğrulamadan geçip `open()` ile atomik olarak aynı çalışma alanına uygulanır; kamera her harf değişiminde sıfırlanmaz. İlk veri eklendiğinde alanına yakınlaşılır.
- Harita ve tablo mutasyonları güncel dataset özeti döndürmelidir; JSON görünümü bu değişimle yenilenir. Kullanıcı taslağı varsa değişiklik üzerine yazılmaz, çakışma bildirilir.
- Tablo `list()` ile 20 özet, `get()` ile öznitelikler okur; geometrileri tabloda tutmaz. Hücre değişiminde güncel Feature yeniden `get()` ile okunur ve yalnızca properties değiştirilerek `mutate()` edilir.
- Büyük dosyalar için tam metin görünümü sınırlıdır: kaynak 2 MB, 30.000 köşe veya 5.000 şekli aşarsa seçili Feature JSON'u kullanılır. İçe aktarma/export performans hedefi farklıdır. Ayrıntılı tek şekil kod editöründe 50.000 köşe / 2 MB metinle sınırlıdır.
- Tam dosya kod değişikliği yeni dahili kayıt kimlikleri oluşturur. Arayüz, bu sınırdan önceki Feature geçmişini ve sınır geçilirken eski kimliklere bağlı ileri işlemleri temizler; dosya anlık görüntüsünü kendi undo/redo girdisi olarak saklar. Sunucu entegrasyonunda bu davranış, revision çatışmaları ve kalıcı kimliklerle birlikte yeniden ele alınmalıdır.

```ts
import type { GeoJsonRepository } from '../domain/contracts';
import { ApiGeoJsonRepository } from './ApiGeoJsonRepository';

export const createRepository = (): GeoJsonRepository =>
  new ApiGeoJsonRepository(/* API yapılandırması */);
```

Yeni sınıf henüz yoktur; bu yalnızca entegrasyon örneğidir.

## Metotların davranışı

Ortak `ImportDialog`, GeoJSON'u doğrudan, Excel'i `src/data/import.worker.ts` üzerinden GeoJSON'a dönüştürerek mevcut `open()` metoduna verir. Yeni bir sunucu veya kategori import metodu eklenmedi. Excel koordinat satırları Point, WKT/GeoJSON hücreleri kendi geometrisini üretir; diğer sütunlar properties olur. Kategoriler elle yönetilir.

**Çalışmaya ekle** için mevcut `export()` ve gelen dosya ikinci Worker'da akışlı birleştirilir; kataloglar korunur, sonuç ancak başarılı `open()` sonrasında etkinleşir. İptal veya geçersiz gelen dosya eski çalışmayı değiştirmez. Birleştirme yeni veri kümesi açtığı için dahili kayıt kimlikleri ve şekil geçmişi yenilenir; özgün GeoJSON Feature id alanları korunur. Bu istemci akışı ileride sunucuda atomik append operasyonuyla değiştirilebilir. Uygulanmamış kod taslağı varken ekleme engellenir. Sunucu adaptöründe export/import revision tutarlılığı ayrıca sağlanmalıdır.

Liste etiketi ve şekil başına göz kontrolü yalnızca görünüm durumudur; gizli şekiller repository'den silinmez ve export içinde kalır.

| Metot | Beklenen davranış |
| --- | --- |
| `open(file, progress?, signal?)` | Yeni veriyi geçici alanda hazırlar. Başarılıysa aktif veri kümesini değiştirir. İptal/hata mevcut kümeyi değiştirmez. |
| `createEmpty()` | Boş, yeni bir çalışma açar; başlangıç revision değeri 0. |
| `query({bounds,tolerance,limit})` | WGS84 sınır kutusuna göre sorgular. Önizleme geometrisi döndürebilir; `matched` toplam eşleşme, `limited` görünürlük sınırı bilgisidir. |
| `list(search,offset,limit)` | Geometri taşımayan özetlerin sayfası; `total` arama sonucunun tamamıdır. |
| `get(id)` | Tek kaydın özgün/tam ayrıntılı geometrisi. |
| `mutate({id?,feature})` | id yoksa ekler; id + feature günceller/geri yükler; id + null siler. Başarıdan sonra artan revision ve güncel dataset özeti döner. |
| `categories()` | Etkin çalışmanın tüm ana/alt kategori ağacını `CategoryGroup[]` olarak döndürür; görünür alan veya sayfa sınırından bağımsızdır. |
| `addCategory(name,parent?)` | parent yoksa ana kategori, varsa belirtilen ana kategoriye alt kategori ekler. Yeni katalog ve dataset özeti döner. |
| `export(progress?)` | Görünürlük sınırına bakmadan tüm kayıtları dışa aktarır. |
| `dispose()` | Oturuma ait geçici kaynakları kapatır. |

## Korunması gereken kurallar

1. **İki ayrı kimlik:** `FeatureSummary.id` dahili, oturumda kararlı kayıt kimliğidir. GeoJSON `feature.id` dış dosyanın kimliğidir. Dış kimlikler tekrar edebilir; birbirine karıştırılmamalıdır.
2. **Koordinatlar:** sözleşmenin tüm geometrileri ve bounds alanları EPSG:4326, `[boylam,enlem]`. EPSG:3857 dönüşümü yalnızca harita modülünde yapılır. Z koordinatları korunur.
3. **Önizleme:** query sonucu basitleştirilmiş olabilir; asla mutate girdisi olarak kullanılmaz. Düzenlemeden önce mutlaka get çağrılır.
4. **Hatalar:** başarısız işlem Promise rejection ile kullanıcıya gösterilebilir bir `Error.message` döndürür. Geçerli mevcut veriyi kısmen değiştirmemelidir.
5. **Geri alma:** silinen dahili id ile `mutate({id,feature})` kaydı geri yükleyebilmelidir. Başka veri kümesine ait kimlikler reddedilir.
6. **Sıralama:** görünürlük sorgusunun sırası serbesttir; liste sayfalaması ve dışa aktarma kararlı olmalıdır.
7. **İlerleme:** ImportProgress alanları dosya açarken bayt sayısını, export sırasında tamamlanan kayıt sayısını temsil eder; arayüz oranını kullanır.
8. **Yarışlar:** yerel adaptör işlemleri sıraya alır. Sunucu adaptörü export/mutation tutarlılığı, atomik import ve revision çatışmalarını sağlamalıdır.

## İkinci geliştiricinin teslimatı

- Kalıcı proje aç/kaydet akışı için mevcut sözleşmeye eklenmesi gereken metotları Gamze ile kararlaştırın; arayüze boşta/çalışmayan buton eklemeyin.
- Tam GeoJSON ve topolojik doğrulama servisi: kendini kesme, deliklerin dışarı taşması, ortak sınır sorunları.
- Büyük dosya için sunucuda akışlı import, mekânsal indeks, kota ve iptal yönetimi. Çok büyük veriler için döşeme/LOD veya sayfalı geometri aktarımı değerlendirilebilir.
- Gerekliyse kullanıcı/izin yönetimi ve kalıcı veritabanı. İlk sürümde bu özellikler uygulanmamıştır.
- Aynı sözleşme testlerini yeni adaptöre karşı çalıştırın: iptal sonrası eski veri, tam ayrıntı/kimlik koruma, ekleme-silme-geri alma, görünürlük sınırından bağımsız export.

Önerilen HTTP uçları tasarım kararı olarak ayrıca kararlaştırılmalıdır; mevcut kodda çalışan bir backend veya sabitlenmiş REST şeması yoktur.

## Kategori verisi

`CategoryGroup` yapısı `{ name: string, subcategories: string[] }`. Katalog etkin çalışma kapsamındadır. Yeni/başka dosya açıldığında dosyanın kataloğu ve Feature atamaları kullanılır; önceki çalışmanın boş tanımları aktarılmaz. Adlar Türkçe büyük/küçük harf duyarsız karşılaştırılır; boşluklar kırpılır. Yeni adlar 1–80 karakterdir; alt kategorinin ana kategorisi önceden var olmalıdır.

Feature atamaları `properties.ana_kategori` ve `properties.alt_kategori` alanlarındadır. Önceki `properties.kategori` alanı ana kategori için geriye uyumlu okunur; kategori atama kontrolüyle yapılan düzenlemelerde varsa eşzamanlı güncellenir. Özgün diğer öznitelikler korunur.

Dışa aktarılan FeatureCollection içinde `category_catalog` isimli bir GeoJSON ek üyesi bulunur:

```json
{
  "type": "FeatureCollection",
  "category_catalog": [{ "name": "Arazi kullanımı", "subcategories": ["Park", "Konut"] }],
  "features": []
}
```

Boş/henüz kullanılmayan kategori tanımları da dışa aktarılmalı ve tekrar açıldığında geri gelmelidir. Hatalı kategori metadata'sı importu atomik olarak reddeder; mevcut çalışma korunur. Ana kategori değiştirildiğinde önceki alt kategori arayüz tarafından temizlenir. Katalog eklemeleri için geri alma yoktur; şekil kategori atamaları mevcut `mutate` geçmişini kullanır. Sunucu adaptörü kategori metotlarını ve export/import metadata davranışını da sağlamalıdır.
