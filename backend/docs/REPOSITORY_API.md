# GeoJsonRepository HTTP eşlemesi — Aşama 7A

Bu belge mevcut `src/domain/contracts.ts` ve `docs/INTEGRATION.md` sözleşmelerini backend API'sine eşler. TypeScript adaptörü bu aşamada eklenmez. Tüm adreslerin öneki `/api/v1` olur; geliştirme adresi `http://127.0.0.1:8000` ve Swagger adresi `/docs` şeklindedir.

## Çalışma alanı ve beklenen durum

Her adaptör örneği kendi `workspaceId` değerini saklar. Sunucuda ortak bir aktif dataset yoktur. Workspace yanıtı şu kapsayıcıyı kullanır:

```json
{
  "id": "<workspace UUID>",
  "projectId": null,
  "activeDatasetId": "<dataset UUID>",
  "generationId": "<generation UUID>",
  "dataset": {
    "name": "Adsız çalışma.geojson",
    "count": 0,
    "vertices": 0,
    "bounds": null,
    "sourceBytes": 0,
    "revision": 0
  },
  "createdAt": "<ISO 8601>",
  "updatedAt": "<ISO 8601>"
}
```

`GET /workspaces/{workspaceId}` bu bilgiyi yeniden okur. `activeDatasetId` fiziksel SQLite dataset kaydını, `generationId` dahili Feature kimliklerinin neslini, `dataset.revision` o nesildeki veri değişikliklerini belirtir. Kaydedilmiş proje sürümü olan `project.version` ayrı bir değerdir.

Repository okuma/değişiklik yanıtlarında `X-Dataset-Id`, `X-Generation-Id`, `X-Dataset-Revision` ve `ETag` durum başlıkları bulunur. `ETag` opak kabul edilir; sürüm bilgisini çıkarmak için parçalanmaz. `WorkspaceResponse` döndüren mevcut proje/import uçlarında aynı bilgi JSON gövdesinden alınabilir. CORS bu başlıkları 5173 portundaki istemciye açmalıdır.

Mutasyon, kategori ekleme ve mevcut workspace'i boşaltma isteklerinde aşağıdaki üç alan **zorunludur**:

```json
{
  "expectedDatasetId": "<son okunan activeDatasetId>",
  "expectedGenerationId": "<son okunan generationId>",
  "expectedRevision": 3
}
```

Bu alanlar yalnızca `ETag` veya `If-Match` gönderilerek atlanamaz. Sunucu workspace kilidi altında üçünü birlikte denetler; başka bir dataset'e geçilmişse veya revision artmışsa işlem `409` ile reddedilir. Alanların eksik/geçersiz olması `422` üretir. Gövde modelleri bilinmeyen istek alanlarını reddeder. DELETE isteğinde aynı üç alan query parametresi olur.

## Metotlar ve uçlar

| Sözleşme metodu | HTTP isteği | Sözleşmeye döndürülecek değer |
| --- | --- | --- |
| İlk `createEmpty()` | `POST /workspaces`, boş gövde veya `{}` | `WorkspaceResponse.dataset`; kimlikler adaptörde tutulur |
| Sonraki `createEmpty()` | `POST /workspaces/{w}/empty`, beklenen durum gövdesi | `WorkspaceResponse.dataset` |
| `query(request)` | `GET /workspaces/{w}/viewport` | `{records, matched, limited}` |
| `list(search,offset,limit)` | `GET /workspaces/{w}/features` | `{items, total}` |
| `get(id)` | `GET /workspaces/{w}/features/{id}` | `{summary, feature}` |
| `mutate(request)` | `POST /workspaces/{w}/mutations` | `{id, record, dataset}` |
| `mutate({id,feature:null})` alternatifi | `DELETE /workspaces/{w}/features/{id}` | `{id, record:null, dataset}` |
| `categories()` | `GET /workspaces/{w}/categories` | `CategoryGroup[]` |
| `addCategory(name,parent?)` | `POST /workspaces/{w}/categories` | `{catalog, dataset}` |
| `open(file,progress?,signal?)` | Mevcut import/job/aktivasyon akışı | Aktivasyon yanıtının `dataset` alanı |
| `export(progress?)` | `GET /workspaces/{w}/export` | `application/geo+json` yanıtından Blob |

`createEmpty()` yeni bir generation ve revision `0` üretir. Mevcut workspace'i boşaltmak aynı workspace kimliğini korur, `projectId` bağlantısını kaldırır ve önceki dataset'i anında silmez. Böylece büyük verinin silinmesi kısa reset transaction'ına yüklenmez; kayıtlı proje snapshot'ları korunur.

## Viewport, liste ve tam Feature okuma

Bounds tek JSON/string parametresi değildir; dört kez tekrarlanan query parametresidir:

```text
GET /api/v1/workspaces/{w}/viewport?bounds=28&bounds=40&bounds=30&bounds=42&tolerance=0.0001&limit=2500
GET /api/v1/workspaces/{w}/features?search=park&offset=0&limit=20
```

Bounds sırası `[minLon,minLat,maxLon,maxLat]`, koordinat sistemi WGS84/EPSG:4326'dır. Dört sonlu sayı, sıralı minimum/maksimum ve boylam/enlem sınırları gerekir. Antimeridyen üzerinden ters bounds desteklenmez; istemci görünür alanı uygun kutulara ayırmalıdır. `tolerance` negatif olmayan sonlu bir sayıdır ve **derece** cinsindendir. Varsayılanı `0`, viewport `limit` varsayılanı `2500` olur; tamsayı limit `1..3000` aralığına sıkıştırılır.

R-Tree önce sınır kutusu adaylarını bulur; özgün bounds üzerinde tekrar kontrol float32 indeks yuvarlamalarının yanlış eşleşme üretmesini engeller. `matched` limit uygulanmadan önceki eşleşme sayısıdır, `limited` bu sayının etkin limiti geçip geçmediğidir. Sorgu geometriyle kesin kesişim testi değildir. `geometry:null` ve bounds üretmeyen boş geometriler viewport'ta görünmez; liste/get/export içinde kalır.

Query geometrileri yalnızca görüntüleme önizlemesidir. Pozitif tolerance çizgi/halkaları basitleştirebilir; depolanmış geometriyi değiştirmez. Özetin `vertices` ve `bounds` değerleri özgün kaydı anlatır. Düzenlemeden önce mutlaka `get(id)` çağrılır; query geometrisi mutate girdisi yapılmaz. `get()` ve export özgün tam koordinatları ve Z değerlerini döndürür.

Basitleştirme, bir viewport isteği boyunca toplam 1.000.000 nokta/segment uzaklığı
hesabıyla sınırlıdır (`GEOJSON_REPOSITORY_MAX_SIMPLIFICATION_STEPS`). Bütçe biterse
işlenmekte olan geometrinin tamamı ve kalan kayıtlar özgün koordinatlarıyla döner;
kısmen değiştirilmiş bir GeometryCollection üretilmez. Böylece yoğun zikzak
çizgilerin kötü durumdaki karesel CPU maliyeti sınırlandırılır.

Liste `search` varsayılanı boş, `offset` varsayılanı `0`, `limit` varsayılanı `50` olur. Offset negatif olamaz. Pozitif limit en fazla `100` olur; `0` ve negatif değerler `422` üretir. Arama etiket ve geometri türüne Türkçe büyük/küçük harf kurallarıyla uygulanır. Sayfa ve export ordinal sırasında kararlıdır; `total` tüm arama sonucunun sayısıdır.

FeatureRecord tam olarak şu şekildedir:

```json
{
  "summary": {
    "id": "<generation UUID>:17",
    "label": "Park",
    "geometryType": "Point",
    "vertices": 1,
    "bounds": [29, 41, 29, 41]
  },
  "feature": {
    "type": "Feature",
    "id": "dosyadaki-özgün-id",
    "properties": {"name": "Park", "bilinmeyen": true},
    "geometry": {"type": "Point", "coordinates": [29, 41, 120]}
  }
}
```

`summary.id` dahili generation/ordinal kimliğidir. `feature.id` dış dosyanın değeridir; yinelenebilir. Başka generation'a ait dahili kimlik kabul edilmez. Kimlik path segmenti olarak URL-encode edilir. Mevcut sözleşmedeki `FeatureSummary.id` alanı `featureId` olarak yeniden adlandırılmaz; `featureId` doğrulama raporları gibi kendi sözleşmesinde bu adı kullanan yerlerde kalır.

## Mutasyon ve kategori istekleri

Ekleme:

```json
{
  "feature": {
    "type": "Feature",
    "properties": {"name": "Yeni nokta"},
    "geometry": {"type": "Point", "coordinates": [29, 41, 120]}
  },
  "expectedDatasetId": "<dataset UUID>",
  "expectedGenerationId": "<generation UUID>",
  "expectedRevision": 0
}
```

Güncelleme aynı gövdeye dahili `id` ekler. Silme `id` ve `feature:null` gönderir; DELETE alternatifi beklenen durumu query parametrelerinde taşır. Silinmiş kaydı geri yüklemek aynı `id` ve tam Feature ile POST mutasyonu yapar. Rastgele yeni bir `id` ile kayıt oluşturulmaz; ekleme için `id` gönderilmez. Silinen ordinal başka kayıt için kullanılmaz. Başarıda özet/revision, Feature değişikliğiyle aynı transaction içinde güncellenir.

Feature dış kimliği, foreign üyeler, bilinmeyen properties ve koordinat sırası korunur. Yerel `mutate()` davranışına uygun olarak Feature ve iç geometrilerindeki türetilmiş `bbox` alanları mutasyon girdisinden temizlenir; bounds yeniden hesaplanır. Bu işlem otomatik topolojik düzeltme yapmaz. Yapısal olarak geçersiz Feature reddedilir; topolojik kontrol/düzeltme ayrı doğrulama sisteminin konusudur. Hata eski veriyi veya revision'ı kısmen değiştirmez.

Kategori eklemek için:

```json
{
  "name": "Park",
  "parent": "Arazi kullanımı",
  "expectedDatasetId": "<dataset UUID>",
  "expectedGenerationId": "<generation UUID>",
  "expectedRevision": 1
}
```

Ana kategori eklenirken `parent` atlanır. Adlar kırpılır ve Türkçe büyük/küçük harf duyarsız karşılaştırılır; yeni adlar 1–80 karakterdir. Alt kategorinin ana kategorisi var olmalıdır. Yanıt `{catalog:[{name,subcategories}],dataset}` şeklindedir. Kullanılmayan kategoriler de listelenir ve `category_catalog` ile export/import sırasında korunur. Feature üzerindeki `ana_kategori`, `alt_kategori`, eski `kategori` ve diğer properties alanları korunur.

## open(), ilerleme ve iptal

Adaptör aşağıdaki mevcut Aşama 6 uçlarını kullanmalıdır:

1. `POST /workspaces/{w}/imports?expectedDatasetId={datasetId}&expectedGenerationId={generationId}&expectedRevision={revision}` ile dosyasız bir iş ayır; dönen job ID'yi hemen sakla. Gelecek API adaptörü bu üç query parametresini birlikte göndermelidir. Sunucu writer kilidi altında beklenen bağlamı denetler ve başlangıç dataset/generation/revision değerlerini job'a yazar. Eski Aşama 6 istemcileri için üçünün birlikte atlanması desteklenir; yalnızca bir kısmının gönderilmesi `422` üretir.
2. Job'ın `initialDatasetId`, `initialGenerationId`, `initialRevision` değerlerinin beklenen bağlamı yansıttığını denetle. Başarısız rezervasyon veya çakışma mevcut workspace'i değiştirmez.
3. `POST /workspaces/{w}/imports?jobId={jobId}` adresine `multipart/form-data` içindeki `file` alanını gönder. Bu yüklemede beklenen durum tripleti tekrar gönderilmez; rezervasyonun yakaladığı değerler kullanılır. Tarayıcı `Content-Type` boundary bilgisini kendisi üretmelidir.
4. `GET /jobs/{jobId}` ile durumu izle. `uploading → queued → running → completed` akışında workspace henüz değişmez. `failed` ve `cancelled` durumları Promise rejection olur.
5. Abort durumunu tekrar denetledikten sonra `POST /jobs/{jobId}/activate` çağır. Sunucu başlangıç dataset/generation/revision değerlerini yeniden kontrol eder. Çakışma `409` olur; sessiz tekrar import/aktivasyon yapılmaz.
6. Yalnızca başarılı aktivasyonun WorkspaceResponse bilgisini adaptöre uygula ve `.dataset` değerini döndür. Yeni generation önceki Feature kimliklerine bağlı seçim/geçmiş bilgisini geçersiz kılar.

FeatureCollection akışlı okunur; root `type` alanının ilk sırada olması gerekmez. Tek Feature ve desteklenen çıplak GeoJSON geometrisi de açılabilir. Çıplak geometri `{type:"Feature",properties:{},geometry:root}` ile sarılır. Feature yabancı üyeleri kendi üzerinde kalır; Feature üzerindeki bir `category_catalog` alanı koleksiyon kataloğu sayılmaz. FeatureCollection kök metadata'sı ve katalogları ayrı saklanır. Yapısal hata tüm geçici importu reddeder; topolojik hatalar raporlanır ve düzeltilmeden uyarı politikasıyla korunur.

`features` alanı yalnızca kök türü FeatureCollection olduğunda koleksiyon listesi olarak yorumlanır; Feature/geometri üzerindeki aynı adlı yabancı alan, dizi veya skaler olsa da korunur. `features`, `type` alanından önce gelirse yüklenmiş geçici dosyada nesne oluşturmayan bir tür taraması yapılıp ilk okuyucu konumuna dönülür. Bu durumda dosyanın bir bölümü ikinci kez okunabilir; toplam koleksiyon belleğe alınmaz. Normal `type`-önce FeatureCollection tek geçişlidir. Key sırası belirsiz bu durum için yeniden okunabilir kaynak gerekir; worker'ın geçici dosyaları bu koşulu sağlar. Ham, seek desteklemeyen akışta `type` önce gelmelidir.

`ImportProgress` alanları open sırasında dosya baytlarıdır: `bytesRead=job.processedBytes`, `totalBytes=job.totalBytes`, `featuresRead=job.processedFeatures`. ijson ileride işleyeceği veriyi önceden okuyabilir; `processedBytes` okunan en ileri dosya konumunu, Feature sayısı commit edilmiş kayıtları anlatır. Tür taraması için yeniden okunan baytlar ikinci kez sayılmaz ve ilerleme gerilemez. Baytların toplam değere ulaşması işin tamamlandığını göstermez; son durum ve aktivasyon beklenir. `receivedBytes` multipart taşıma baytları, `uploadedBytes` geçici dosyaya kopyalanan baytlardır; bu aşamalar aynı yüzde içinde toplanmaz ve işlenen Feature sayısı gibi gösterilmez.

`AbortSignal` yalnızca HTTP isteğini keserse kalıcı job sunucuda devam edebilir. Adaptör sinyali yükleme ve polling isteklerine bağlar; ayrıca bağımsız, iptal edilmemiş bir istekle `POST /jobs/{jobId}/cancel` gönderir. Job ayırmak yükleme sırasında bile bu kimliğin bilinmesini sağlar. İptal talebi iş kuyruğunun arkasında bekletilmez; worker güvenli sınırda durur ve staging veriyi temizler.

Aktivasyon transaction'ı iptal yarışının karar noktasıdır: iptal önce kilidi alırsa aktivasyon gerçekleşmez; aktivasyon önce commit olursa sonraki cancel `409` döner. Commit olmuş aktivasyonu adaptör “iptal edildi ve eski veri korundu” diye raporlamamalıdır. Aktivasyon cevabı ağ kesintisinde belirsiz kalırsa job'ın `activatedAt` ve güncel workspace durumu okunarak sonuç kesinleştirilir. Yazma isteği körlemesine tekrar gönderilmez. Sonucun kesinleştirilemediği bağlantı hatası kullanıcıya belirsiz sonuç olarak bildirilir ve yeniden mutasyondan önce bağlam yenilenir.

## export(), kuyruk ve hata eşlemesi

Export bütün silinmemiş kayıtları, unused kategoriler dahil kataloğu ve koleksiyon metadata'sını kararlı sırayla döndürür. Tek bir SQLite okuma snapshot'ı boyunca tutarlıdır. Görünürlük limiti, gizlenen şekiller veya preview tolerance export içeriğini kısıtlamaz. HTTP sunucusu veriyi parça parça aktarır; mevcut `Promise<Blob>` sözleşmesi ise sonunda tüm çıktıyı tarayıcıda bir Blob olarak tutar. Bu sözleşme sınırsız boyutta tarayıcı belleği tasarrufu garantilemez.

Mevcut sözleşmede export için `ImportProgress.bytesRead` ve `totalBytes` **tamamlanan kayıt sayısı/toplam kayıt sayısı** anlamındadır. Ağdan gelen ham baytlar bu alanlara doğrudan yazılmaz. Adaptör Feature tamamlanmalarını akışlı olarak sayabilir; bunu yapmıyorsa tutarlı snapshot'ın sayısını kullanarak yalnızca başlangıç/başarı sonu bildirimi vermelidir. Content-Length veya indirme bayt yüzdesi kayıt ilerlemesi gibi sunulmaz. Başka istemcinin export sırasında veri değiştirebileceği durumda toplam sayı eski bir workspace yanıtından varsayılmaz; export snapshot'ıyla tutarlılığı doğrulanmalıdır.

Yerel Worker adaptörü gibi API adaptörü de her örnekte tek FIFO operasyon kuyruğu kullanmalıdır. Başarılı yazma/aktivasyon durum bilgisi kuyruğun sonraki işleminden önce güncellenir. Export tamamlanana kadar aynı adaptörün mutasyonları bekler. İptal ve dispose bu kuyruğu durdurabilmelidir. Eski generation/workspace için gecikmiş yanıt yeni bağlama uygulanmaz. Düzenlenecek tam Feature `get()` ile okunur; bu okumanın revizyonu saklanır. Daha sonra gelen bir okumanın yeni revision'ı eski Feature girdisini güncelmiş gibi yetkilendirmek için kullanılmaz. `409` yanıtında istemci otomatik olarak son revision'ı alıp aynı mutasyonu tekrar etmez; kullanıcı veriyi yeniden okuyup karar verir.

`dispose()` istemci taleplerini, polling ve kendine ait etkin job'ları sonlandırır; kayıtlı projeleri silmez. TypeScript sözleşmesinde ayrı dispose endpointi yoktur.

| HTTP durumu | Anlam ve istemci davranışı |
| --- | --- |
| `404` | Workspace, Feature, proje veya job yok; silinmiş Feature da normal get/list içinde görünmez. Yanlış generation/bozuk Feature ID'si `422` üretir. |
| `409` | Dataset/generation/revision, proje sürümü veya job durumu çakıştı. Sessiz tekrar/üzerine yazma yapma. |
| `413` | İstek, Feature, koordinat veya yapılandırılmış kaynak sınırı aşıldı. Sınırı kullanıcıya bildir. |
| `422` | JSON/parametre/GeoJSON yapısı veya gerekli beklenen durum alanları geçersiz. Pydantic detail listesinden okunabilir mesaj üret. |
| `500` | Beklenmeyen sunucu hatası. İşlem başarılı varsayılmaz; kullanıcıya genel bir hata gösterilir. |
| `503` | Veritabanı işlemi tamamlanamadı; önceki altyapının depolama hatası yanıtıdır. |

Import uçlarında ayrıca dolu kapasite için `429`, disk kotası için `507` bulunur. Hatalar genellikle `{detail:...}` biçimindedir; `detail` metin, nesne veya doğrulama listesi olabilir. Başarısız mutation/import mevcut workspace ve kayıtlı snapshot'ları değiştirmez. Cevabı kaybolan commit için yukarıdaki belirsiz sonuç kuralı geçerlidir.

Tek Feature mutasyonunun varsayılan sınırları 2 MiB JSON, 100.000 köşe, 64 iç içelik ve 250.000 düğümdür; ayarlar `GEOJSON_REPOSITORY_MAX_*` değişkenleriyle yapılandırılır. Ham POST gövdesi Feature bayt bütçesi ve 8192 bayt istek alanı payıyla sınırlanır. Viewport seçilen kayıtların UTF-8 JSON kaynak toplamına ayrıca varsayılan 64 MiB bütçe uygular; kayıt sayısının 3000 altında olması tek başına küçük yanıt garantilemez. Aşım `413` döndürür. Büyük import bu mutasyon limitlerinden ayrı `GEOJSON_IMPORT_*` sınırlarını kullanır.

## Kalıcı projeler için ayrı ProjectRepository önerisi

`GeoJsonRepository` sözleşmesine rastgele proje metotları eklenmez. Sonraki frontend aşamasında workspace bağlamını paylaşan ayrı bir `ProjectRepository` şu mevcut uçları sarmalayabilir:

| Önerilen metot | Mevcut HTTP ucu |
| --- | --- |
| `list(search,offset,limit)` | `GET /projects` |
| `get(id)` | `GET /projects/{id}` |
| `create(name,workspaceState)` | `POST /projects` |
| `save(id,expectedVersion,workspaceState)` | `PUT /projects/{id}/content` |
| `rename(id,name,expectedVersion)` | `PATCH /projects/{id}` |
| `remove(id,expectedVersion)` | `DELETE /projects/{id}` |
| `open(id,expectedProjectVersion,workspaceState)` | `POST /workspaces/{w}/open-project` |

Proje kaydetme aktif dataset'ten bağımsız bir snapshot oluşturur. Proje açma bu kayıtlı snapshot'tan düzenlenebilir başka bir dataset oluşturur. Generation/ordinal ve dataset revision korunabilirken fiziksel dataset ID değişir; bu nedenle üç parçalı durum token'ı gerekir. `project.version` her başarılı proje güncellemesinde değişir ve dataset revision ile karıştırılmaz. Proje işlemleri ve GeoJsonRepository işlemleri aynı istemci kuyruğunu/durum bağlamını paylaşmalı; başarılı proje açmadan sonra eski fiziksel dataset'e ait gecikmiş yanıtlar atılmalıdır.
