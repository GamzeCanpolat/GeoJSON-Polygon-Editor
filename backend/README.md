# GeoJSON Editor backend

Doğrulanan çalışma ortamı Python 3.13.18 ve SQLite 3.53.1 kullanır. FastAPI, SQLAlchemy ve SQLite altyapısı üzerine altı veri
tablosu, transaction kapsamlı veri servisleri ve kalıcı proje/workspace API'si
eklenmiştir. Shapely ile sınırlı, salt okunur geometri doğrulama servisi ve iki
doğrulama endpointi hazırdır. Kalıcı SQLite job kuyruğu, ayrı import worker'ı ve
akışlı import/export API'leri eklenmiştir. React API adaptörü ve kalıcı proje
ekranları artık bağlıdır; varsayılan local mod ve kapalı proje bayrağı korunur.

Güncel üç terminal kurulumu, test, yedekleme/geri yükleme ve hata giderme için
[işletim rehberini](../docs/RUNBOOK.md), teslim koşulları ve test sonuçları için
[Aşama 10C raporunu](../docs/STAGE10C_REPORT.md) kullanın. Özellikle Python'un
kullandığı SQLite sürümü teslim öncesi kontrol edilmelidir. Aşağıdaki aşama
bazlı test sayıları tarihsel doğrulama kayıtlarıdır. Güncel migration head'i
`0003_spatial_index`'tir; kullanıcı DB'sinde migration öncesi yedek alın.

## macOS kurulumu ve başlatma

Proje kökünden `bash scripts/run-backend.sh python-path` ile doğrulanmış
Python yolunu alın. Migration, FastAPI ve worker komutları için üç terminal
örneğini kullanın.
[Bağımsız runtime kurulumu](../docs/RUNBOOK.md#bağımsız-python-ortamı-kurulumu) ·
[Üç terminalle başlatma](../docs/RUNBOOK.md#üç-terminalle-başlatma)

- Health: http://127.0.0.1:8000/api/v1/health
- Swagger: http://127.0.0.1:8000/docs
- OpenAPI: http://127.0.0.1:8000/openapi.json

Sağlık cevabı `{"status":"ok","database":"ok"}` biçimindedir. `SELECT 1`
başarısızsa HTTP 503 döner. `GEOJSON_CORS_ORIGINS` üzerinden izin verilen
Vite adreslerini ayarlayın.

## SQLite ve yapılandırma

Varsayılan dosya `backend/var/database/projects.db` konumundadır. Dizin ve dosya ilk
uygulama başlangıcında veya çevrimiçi Alembic işleminde otomatik oluşturulur.
Yollar Terminal'in çalışma dizinine değil `backend/` dizinine göre çözülür.

| Değişken | Varsayılan |
| --- | --- |
| `GEOJSON_DATABASE_PATH` | `var/database/projects.db` |
| `GEOJSON_SQLITE_BUSY_TIMEOUT_MS` | `5000` (5 saniye) |
| `GEOJSON_CORS_ORIGINS` | İzin verilen iki frontend adresini içeren JSON dizisi |

Her bağlantıda foreign key kontrolü, WAL ve busy timeout etkinleştirilir.
SQLAlchemy transaction başlangıçlarını açıkça yönetir. Her isteğe ayrı session
verilir; session kapanırken tamamlanmamış işlemler geri alınır. İleride yazma
servisleri başarılı işlemleri açıkça commit etmelidir. WAL tek yazıcı sınırını
kaldırmaz. Uygulama başlangıcında `create_all()` veya otomatik migration çalışmaz.

## Alembic

Proje kökünden, işletim rehberindeki mutlak deneme DB yolu ayarlandıktan sonra
`bash scripts/run-backend.sh migrate` çalıştırın. `current`, `heads` ve
`check` komutlarını `backend/` dizininden doğrulanmış Python ile çalıştırın.
[Migration komutu](../docs/RUNBOOK.md#üç-terminalle-başlatma)

İlk revision `0001_data_models` altı uygulama tablosunu oluşturur. İkinci revision
`0002_import_jobs`, jobs tablosunu ve datasets.metadata_json alanını ekler. Metadata
`app.db.base.Base` üzerinden bağlıdır; `app.db.models` Alembic tarafından import
edilir. SQLite için `render_as_batch=True` ve açık BEGIN yönetimiyle eşleşen
`transactional_ddl=True` ayarlıdır. Şema yalnızca Alembic ile güncellenir.

`upgrade head` verileri silmez. `downgrade base` ise tabloları ve içlerindeki
verileri siler; otomatik testlerde bu işlem yalnızca geçici veritabanına uygulanır.

## Veri modeli

| Tablo | Görev / ilişkiler |
| --- | --- |
| `datasets` | Depolama UUID, mantıksal generation UUID, özet, revision, next_ordinal ve durum |
| `projects` | Proje UUID, ad, saved_dataset_id, version ve UTC tarihler |
| `workspaces` | Workspace UUID, isteğe bağlı project_id, zorunlu active_dataset_id, UTC tarihler |
| `features` | Tamsayı DB kimliği, dataset_id + ordinal, tam Feature JSON, özet ve silinme işareti |
| `categories` | Dataset kapsamındaki ana kategori adı ve normalize edilmiş anahtar |
| `subcategories` | Ana kategori kapsamındaki alt kategori adı ve normalize edilmiş anahtar |
| `jobs` | Workspace'e bağlı kalıcı import durumu, ilerleme, süreli sahiplik, geçici dataset ve aktivasyon bilgisi |

`projects.saved_dataset_id` ve `workspaces.active_dataset_id` referansları dataset
silinmesini engeller (`RESTRICT`). Proje silinirse workspace'in project_id alanı
boşaltılır (`SET NULL`). Referans verilmeyen dataset silinirse Feature ve kategori
kayıtları; ana kategori silinirse alt kategoriler `CASCADE` ile silinir.

Feature için `(dataset_id, ordinal)`, ana kategori için `(dataset_id,
normalized_name)`, alt kategori için `(category_id, normalized_name)` benzersizdir.
Foreign key sütunları ve canlı Feature'ların ordinal sıralaması indekslidir.
Sayaçlar ve revision negatif olamaz. Dataset durumları `draft`, `staging`,
`snapshot` ile sınırlıdır; servis yalnızca `draft` kayıtları düzenler. Tarihler
SQLite DATETIME alanlarında UTC olarak, timezone eki olmadan saklanır.

## Veri servisleri

`app.services.datasets.DatasetService`, kendisine verilen SQLAlchemy Session ile
çalışır. `create_dataset`, `get_dataset`, `summary`, `add_feature`, `get_feature`,
`update_feature`, `delete_feature`, `restore_feature`, `list_features`,
`add_category`, `categories`, `import_category_catalog`, `category_metadata`
işlemlerini sağlar. Proje/workspace iş akışı `app.services.projects.ProjectService`
ile, veritabanı içi kopyalama `app.services.snapshots` ile yürütülür.

Örnek (migration uygulanmış bir `Database` örneğiyle):

```python
from app.services.datasets import DatasetService

with database.sessions.begin() as session:
    service = DatasetService(session)
    dataset = service.create_dataset(name="Alanlar.geojson")
    result = service.add_feature(dataset.id, {
        "type": "Feature",
        "id": "kaynak-42",
        "properties": {"name": "Örnek", "custom": {"keep": True}},
        "geometry": {"type": "Point", "coordinates": [37, 39, 123]},
    })
    print(result.model_dump(by_alias=True))
```

Servisler kendileri commit etmez. Çağıran katman `sessions.begin()` veya açık
`session.commit()` ile dış transaction'ı tamamlar. Her yazma işlemi kendi
SAVEPOINT'i içinde Feature, katalog, next_ordinal, sayaçlar ve revision değerini
birlikte değiştirir. Hata halinde hepsi geri alınır. SAVEPOINT açılmadan önce
SQLAlchemy bekleyen değişiklikleri flush edebileceği için başarısız servis çağrısı
öncesindeki ilgisiz ORM değişiklikleri, çağıranın dış transaction'ına aittir.

`expected_revision` verilirse eski revision ile yapılan yazma reddedilir. İsteğe
bağlı bu kontrol tam çok kullanıcılı düzenleme protokolü değildir. Proje HTTP API'si
ayrıca aşağıdaki zorunlu workspace ve proje sürüm kontrollerini uygular. Kilit
hatalarında otomatik tekrar/iş kuyruğu eklenmemiştir.

## GeoJSON ve kimlik koruması

- Tam Feature, `features.feature_json` içinde JSON olarak saklanır; bilinmeyen
  Feature/geometri alanları, properties içindeki tipler, dış `feature.id` ve Z
  koordinatları korunur. Koruma JSON değerleri içindir; kaynak metnin boşlukları
  veya sayısal yazım biçimi için değildir.
- Dış kimlik için benzersizlik şartı yoktur. Frontend kimliği
  `generation_id:ordinal` şeklindedir; DB tamsayı PK'sinden ayrıdır.
- Silme `is_deleted=True` yapar. Satır ve ordinal tutulur, ordinal yeniden
  kullanılmaz; restore aynı DB satırını ve dahili kimliği etkinleştirir.
- `geometry: null` bir Feature kaydıdır; silme anlamına gelmez.
- Geometri değiştiğinde eski Feature/geometri bbox alanları temizlenir; diğer
  alanlar korunur. Özet bounds, boylam/enlem sırasıyla hesaplanır.
- Boş dataset revision 0 ile başlar. Başarılı ekleme, güncelleme, silme, geri
  yükleme, kategori ekleme ve katalog birleştirmede bir artar. Başarısız işlemde
  değişmez. Oluşturma sırasında verilen başlangıç kataloğu revision'ı artırmaz.
- DTO çıktısı `model_dump(by_alias=True)` ile `sourceBytes` ve `geometryType`
  dahil TypeScript alan adlarını kullanır.
- Liste yalnızca canlı kayıtların özetlerini döndürür, ordinal sırası kararlıdır;
  `offset >= 0`, `1 <= limit <= 100`. Arama Türkçe küçük harf dönüşümü kullanır.
- Veri kümesi özeti, JSON geometrileri yüklenmeden özet sütunlarında SQL
  aggregation ile yeniden hesaplanır. R-Tree veya büyük dosya sistemi eklenmemiştir.

Kategori anahtarı frontend'deki trim → NFC → Türkçe küçük harf dönüşümünü izler;
`I/ı`, `İ/i`, birleşik karakterler ve ECMAScript whitespace kuralları desteklenir.
Yeni kategori adları frontend gibi 1–80 UTF-16 birimiyle sınırlıdır. Mevcut
metadata'daki uzun adlara import sırasında bu sınır uygulanmaz. Katalog
normalizasyonla birleştirilir ve ilk yazım korunur; Feature properties değiştirilmez.
Katalog listeleme deterministik Türk alfabesi sırası kullanır; tüm Unicode için
tarayıcı ICU collation'ının birebir uygulaması değildir. Kullanılmayan tanımlar ve
alt kategoriler saklanır; `category_metadata()` `category_catalog` yapısını verir.

## Testler

```bash
python -m pytest
```

Testler migration ile hazırlanan geçici SQLite dosyaları kullanır; varsayılan
`projects.db` dosyasına dokunmaz. Lifespan/health/Swagger/CORS kontrollerine ek olarak
tüm geometri türleri, properties/Z/dış kimlikler, CRUD/restore, revision, Türkçe
kategoriler, unique/FK/CHECK kısıtları, hatada rollback, migration upgrade/downgrade
ve yeniden upgrade kontrol edilir. Revision üretme testi de geçici dizinde çalışır.

`var/`, `.venv/`, `.env`, Python cache dosyaları ve SQLite yan dosyaları Git'ten
dışlanır. Sunucu herkese açık dağıtım için kimlik doğrulama içermez; bu aşama yerel
geliştirme temelidir.

## Kalıcı proje / workspace HTTP API'si

Swagger: http://127.0.0.1:8000/docs. `Health` grubuna ek olarak `Projects` ve
`Workspaces` grupları vardır. Aşağıdaki yolların öneki `/api/v1`'dir. Kimlikler
UUID metinleridir. İsteklerde camelCase alanlar kullanılır; bilinmeyen alanlar
reddedilir. İsimler kırpılır ve 1–200 karakterle sınırlıdır.

| Metot / yol | İstek | Başarılı yanıt |
| --- | --- | --- |
| `POST /workspaces` | Gövde yok veya `{}`; projeden açmak için `projectId`, `expectedProjectVersion` birlikte | 201 WorkspaceResponse |
| `GET /workspaces/{id}` | Workspace UUID | 200 WorkspaceResponse |
| `GET /projects` | `search` (varsayılan boş), `offset` (0), `limit` (50; 1–100) | 200 ProjectPage |
| `POST /projects` | `workspaceId`, `name` ve workspace durum alanları | 201 ProjectResponse |
| `GET /projects/{id}` | Proje UUID | 200 ProjectResponse |
| `PATCH /projects/{id}` | `name`, `expectedVersion` | 200 ProjectResponse |
| `DELETE /projects/{id}` | Zorunlu query parametresi `expectedVersion` | 204, gövdesiz |
| `PUT /projects/{id}/content` | `workspaceId`, `expectedVersion` ve workspace durum alanları | 200 ProjectResponse |
| `POST /workspaces/{id}/open-project` | `projectId`, `expectedProjectVersion` ve workspace durum alanları | 200 WorkspaceResponse |

Her yazma endpointi dış transaction'ı cevap döndürülmeden önce commit eder. Proje
servisleri ayrıca SAVEPOINT kullanır. Sunucuda ortak bir aktif proje değişkeni yoktur.

### Workspace durum alanları

Kaydetme ve mevcut workspace'e proje açma isteklerinde üç alan birlikte zorunludur:

```json
{
  "expectedDatasetId": "GET workspace yanıtındaki activeDatasetId UUID değeri",
  "expectedGenerationId": "GET workspace yanıtındaki generationId UUID değeri",
  "expectedRevision": 0
}
```

Örneklerde açıklama metni bulunan UUID alanları gerçek UUID'lerle değiştirilmelidir.
`expectedRevision` son okunan `workspace.dataset.revision` değeridir. Aynı
generation ve revision ile yeniden açılan verilerde bile fiziksel dataset kimliği
değişeceğinden `expectedDatasetId` eski isteklerin tekrar uygulanmasını engeller.

### WorkspaceResponse

```json
{
  "id": "workspace UUID",
  "projectId": null,
  "activeDatasetId": "taslak dataset UUID",
  "generationId": "mantıksal generation UUID",
  "dataset": {
    "name": "Adsız çalışma.geojson",
    "count": 0,
    "vertices": 0,
    "bounds": null,
    "sourceBytes": 0,
    "revision": 0
  },
  "createdAt": "2026-11-05T12:00:00Z",
  "updatedAt": "2026-11-05T12:00:00Z"
}
```

Bağlı proje varsa `projectId` bir UUID'dir. Güncel proje sürümü `GET /projects/{id}`
ile okunur. Yeni boş workspace'in revision değeri 0'dır. `POST /workspaces` içine
proje ve beklenen proje sürümü verilirse kayıttan bağımsız bir taslak kopya açılır.

### Proje oluşturma, güncelleme ve açma istekleri

Yeni proje (`POST /projects`):

```json
{
  "workspaceId": "workspace UUID",
  "name": "Çizdiğim alanlar",
  "expectedDatasetId": "aktif dataset UUID",
  "expectedGenerationId": "generation UUID",
  "expectedRevision": 3
}
```

Mevcut proje içeriğini kaydetme (`PUT /projects/{id}/content`):

```json
{
  "workspaceId": "workspace UUID",
  "expectedVersion": 1,
  "expectedDatasetId": "aktif dataset UUID",
  "expectedGenerationId": "generation UUID",
  "expectedRevision": 4
}
```

Bu workspace'in ilgili projeye bağlı olması gerekir; farklı projeye bağlı bir
workspace ile yanlışlıkla içerik değiştirme reddedilir. Önce `open-project`
kullanın. `POST /projects` ise mevcut workspace'i yeni bir proje olarak kaydetmeye
(farklı kaydet) izin verir; yalnızca o workspace'in proje bağlantısı değişir.

Mevcut workspace'e kayıtlı proje açma (`POST /workspaces/{id}/open-project`):

```json
{
  "projectId": "açılacak proje UUID",
  "expectedProjectVersion": 2,
  "expectedDatasetId": "workspace'in mevcut aktif dataset UUID değeri",
  "expectedGenerationId": "workspace'in mevcut generation UUID değeri",
  "expectedRevision": 4
}
```

Proje adı güncelleme (`PATCH /projects/{id}`):

```json
{"name": "Yeni proje adı", "expectedVersion": 2}
```

Silme: `DELETE /projects/{id}?expectedVersion=3`. Eski sürümle silme de reddedilir.

### ProjectResponse ve ProjectPage

```json
{
  "id": "proje UUID",
  "name": "Çizdiğim alanlar",
  "savedDatasetId": "kayıtlı snapshot dataset UUID",
  "version": 1,
  "createdAt": "2026-11-05T12:00:00Z",
  "updatedAt": "2026-11-05T12:00:00Z",
  "generationId": "mantıksal generation UUID",
  "dataset": {
    "name": "Alanlar.geojson",
    "count": 1,
    "vertices": 5,
    "bounds": [37, 39, 38, 40],
    "sourceBytes": 1234,
    "revision": 3
  }
}
```

Proje adı ve dosya/dataset adı ayrı alanlardır. Proje adını değiştirmek dataset
adını değiştirmez. Liste yanıtı `{"items": [...], "total": N}` şeklindedir.
Listedeki her öğe yalnızca `id`, `name`, `savedDatasetId`, `version`, `createdAt`,
`updatedAt` alanlarını içerir. `total`, arama sonucunun sayfalama öncesi toplamıdır.
Sıralama `updated_at DESC, id ASC` ile kararlıdır. Arama Türkçe küçük harf dönüşümüyle
literal alt metin aramasıdır; `%` ve `_` joker karakter değildir.

### Snapshot ve sürüm davranışı

Kaydetme, aktif taslaktan farklı bir `status=snapshot` dataset oluşturur. Açma,
kayıtlı snapshot'tan farklı bir `status=draft` dataset oluşturur. `generation_id`,
revision, next_ordinal, özet, Feature JSON ve silinme işaretleri kopyalanır. Dahili
`generation_id:ordinal` kimlikleri korunurken DB satır kimlikleri değişir. Tüm ana
ve alt kategoriler, kullanılmayan tanımlar dahil kopyalanır. Tam GeoJSON nesneleri
SQL `INSERT ... SELECT` ile taşınır; yeniden geometri üretimi yapılmaz.

Kopyalama başlamadan önce SQLite yazıcı kilidi alınır; kaynak durum/sürüm kontrolleri
kilit altında yapılır. Yeni kopya tamamlanmadan proje veya workspace işaretçisi
değişmez. İşaretçi değiştirme, sürüm güncelleme ve sahipsiz kopyayı temizleme aynı
transaction içindedir. Kopyalama, işaretçi veya temizleme hatası eski durumu korur.

Yeni proje version 1 ile başlar. Her yeniden kayıt ve ad güncellemesi version'ı bir
artırır. Dataset revision kaydetme/açma/yeniden adlandırma sırasında artırılmaz.
Snapshot DatasetService üzerinden düzenlenemez. Aynı eski proje sürümünü kullanan
eşzamanlı kayıtlardan yalnızca biri başarılı olabilir.

Eski snapshot ve değiştirilen workspace taslağı yalnızca hiçbir proje veya workspace
tarafından referans verilmiyorsa temizlenir. Proje silinince workspace bağlantıları
`SET NULL` olur, bağımsız taslakları korunur. Bu API sürüm geçmişi arşivi sağlamaz.

Kopyalama bu aşamada senkrondur ve SQLite yazıcı kilidini transaction süresince
tutar. Büyük dosya işleyicisi, Feature CRUD HTTP uçları, import/export, frontend
adaptörü ve kullanıcı/izin sistemi bu aşamada eklenmemiştir.

### Hatalar ve şema durumu

- `404`: Geçerli UUID ile istenen kaynak bulunamadı.
- `409`: Eski proje sürümü, eski workspace durumu, yanlış proje bağlantısı veya
  SQLite busy/locked durumu. Güncel kaynaklar okunup kullanıcı kararıyla yeniden
  istek gönderilmelidir; sunucu sessizce yeni sürüme geçip tekrar denemez.
- `422`: UUID, ad, sayfalama veya zorunlu sürüm alanı doğrulama hatası. Gövde içindeki
  revision/version alanları booleansız gerçek tamsayı olmalıdır.
- `503`: Diğer veritabanı hataları; özel SQL/veri ayrıntıları yanıta eklenmez.

Başarılı yanıt commit tamamlandıktan sonra gönderilir. Hatalarda transaction geri
alınır. Yeni tablo veya sütun gerekmediği için Aşama 4 migration eklemez;
bu aşamada head `0001_data_models` idi; Aşama 6 ile güncel head `0002_import_jobs` oldu.

## Geometri doğrulama API'si — Aşama 5

Swagger `/docs` içinde `Geometry validation` grubundadır:

| Endpoint | İstek | Yanıt |
| --- | --- | --- |
| `POST /api/v1/geometry/validate` | Doğrudan GeoJSON Feature veya FeatureCollection | 200 GeometryValidationReport |
| `POST /api/v1/workspaces/{id}/validate` | Workspace UUID; gövde gerekmez | 200 GeometryValidationReport |

İlk uç `application/json` veya `application/geo+json` gövdesi alır; `geojson` gibi
bir sarmalayıcı alan kullanılmaz. Pydantic nesne şemaları ve mevcut
`app/domain/geojson.py` içindeki `prepare_feature`/koordinat kontrolleri birlikte
kullanılır. Kaynak nesne model çıktısıyla değiştirilmez. FeatureCollection'daki
`category_catalog`, varsa mevcut kategori doğrulamasıyla kontrol edilir.

Örnek istek:

```json
{
  "type": "Feature",
  "id": "dosyadaki-kimlik",
  "properties": {"name": "Örnek", "bilinmeyen": {"koru": true}},
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[0,0],[2,2],[2,0],[0,2],[0,0]]]
  }
}
```

Yanıtın ana alanları (tam yanıtta `results` içinde her Feature için aynı türde
ayrıntılı sonuç ve ayrıca workspace bağlam alanları bulunur):

```json
{
  "valid": false,
  "geometryType": "Polygon",
  "errors": [{
    "code": "SELF_INTERSECTION",
    "message": "Polygon kendi kendini kesiyor.",
    "path": "geometry",
    "location": [1,1],
    "reason": "Self-intersection[1 1]",
    "featureIndex": null,
    "featureId": null
  }],
  "warnings": [],
  "message": "Polygon kendi kendini kesiyor.",
  "featureIndex": null,
  "featureId": null,
  "location": [1,1],
  "featureCount": 1
}
```

Geçerli Polygon için ana alanlar:

```json
{
  "valid": true,
  "geometryType": "Polygon",
  "errors": [],
  "warnings": [],
  "message": "Doğrulama tamamlandı; geçersiz geometri bulunmadı.",
  "featureIndex": null,
  "featureId": null,
  "location": null,
  "featureCount": 1
}
```

Toplam raporda `errors` ve `warnings`, `results` içindeki bulguların birleştirilmiş
halidir; `valid` tüm Feature sonuçları geçerliyse true olur. FeatureCollection ve
workspace raporlarının üst `geometryType` değeri `FeatureCollection` olur.
`featureIndex`, koleksiyonun sıfır tabanlı sırasıdır; workspace'te silinmemiş
kayıtların ordinal sırasındaki konumudur. Tek Feature isteğinde null'dır.

Ham GeoJSON isteğindeki `feature.id` dış kimliktir ve rapordaki `featureId` alanına
kopyalanmaz. `featureId` yalnızca workspace'ten okunan `generation_id:ordinal`
dahili kimliğidir. Hata koordinatı belirlenemiyorsa `location` null olur.
`path`, iç içe geometrilerde örneğin `geometry.geometries[0]` olabilir.

Workspace yanıtında ayrıca `workspaceId`, `datasetId`, `generationId`, `revision`
yer alır; ham belge isteğinde bu bağlam alanları null'dır. Workspace verileri
mevcut DatasetService'in özet/sayfalama/get işlemleriyle okunur. Silinmiş kayıtlar
atlanır. Gerçek kayıtlı JSON boyutu, properties dahil `storage_metrics` ile
kontrol edilir; eski dosyanın `sourceBytes` değeri boyut sınırı için kullanılmaz.
Tüm sorgular aynı SQLite okuma transaction'ında tutarlı bir görünüm kullanır.

### Yapısal ve topolojik sonuç ayrımı

- Geçersiz JSON, NaN/Infinity/taşan sayılar, yanlış Feature/FeatureCollection yapısı,
  eksik veya WGS84 dışı koordinatlar ve açık/kısa Polygon halkası HTTP 422 döner.
  `detail` içinde `code`, `message`, `path`, `featureIndex`, `featureId` bulunur.
  Hatalı sayılar yanıt içine geri kopyalanmaz.
- Yapısal olarak kabul edilen topolojik hatalar HTTP 200, `valid=false` ile döner.
  Kendini kesme, dışarı taşan/kesişen/iç içe delikler, geçersiz MultiPolygon
  bileşenleri ve parçaların örtüşmesi raporlanır. GeometryCollection bileşenleri
  ayrı ayrı kontrol edilir.
- Boş geometriler uygulama politikası gereği `EMPTY_GEOMETRY` hatasıdır; Shapely
  bazı boş geometrilere valid dese bile bu sonuç korunur. Boş FeatureCollection
  veya boş workspace ise geçerli, sıfır kayıtlı bir rapordur.
- `geometry:null` geçerli kayıt olarak kalır; `NULL_GEOMETRY` uyarısıyla topolojik
  kontrol atlanır. Mevcut yapısal işleyiciyle uyumluluk için GeometryCollection
  içindeki null bileşenlerde de uyarı üretilir; yalnızca boş bileşenlerden oluşan
  koleksiyon boş geometri olarak raporlanabilir.
- Yeterli farklı nokta bırakmayan tekrarlar `DEGENERATE_GEOMETRY` olarak raporlanır;
  geçerli geometrideki zararsız tekrarlar otomatik hata sayılmaz.
- İki farklı Feature'ın örtüşmesi hata değildir; kayıtlar arası kapsamlı analiz
  yapılmaz. Shapely/GEOS `is_valid` ve `is_valid_reason` kullanılır.

### Veri koruması

Topolojik kontrol, kaynak koordinatlardan oluşturulan ayrı bir XY görünümünde
yapılır. Z ve ek koordinatlar korunur, topolojik hesaba katılmadıkları
`EXTRA_DIMENSIONS_IGNORED` uyarısıyla belirtilir. Analiz düzlemseldir; jeodezik
alan/mesafe veya antimeridyen düzeltmesi yapılmaz.

Özgün GeoJSON, properties, dış kimlik, bbox ve bilinmeyen alanlar değiştirilmez.
Koordinat sırası değiştirilmez; `make_valid` veya başka bir onarım çağrılmaz.
Geçersiz Polygon kaynak veride MultiPolygon'a dönüştürülmez. Dataset revision,
proje version ve kayıtlı snapshot'lar doğrulama sırasında değişmez.

### Senkron işlem sınırları

`.env.example` içindeki bütün ayarlar `GEOJSON_` öneki kullanır:

| Ayar | Varsayılan | Etkisi |
| --- | --- | --- |
| `VALIDATION_MAX_BYTES` | 5242880 | Ham HTTP gövdesi ve workspace kayıtlarının toplam JSON boyutu |
| `VALIDATION_MAX_FEATURES` | 500 | Bir istekteki canlı Feature sayısı |
| `VALIDATION_MAX_VERTICES` | 100000 | Toplam koordinat tuple sayısı |
| `VALIDATION_MAX_FEATURE_VERTICES` | 50000 | Tek Feature koordinat tuple sayısı |
| `VALIDATION_MAX_DEPTH` | 64 | JSON iç içelik sınırı |
| `VALIDATION_MAX_NODES` | 250000 | JSON işlem düğümü sayısı |
| `VALIDATION_TIMEOUT_SECONDS` | 5 | Gövde okuma bütçesi ve ayrı olarak hazırlık + topoloji bütçesi |
| `VALIDATION_MAX_ISSUES_PER_FEATURE` | 20 | Feature başına hata/uyarı sayısı; gerekirse ek kesilme uyarısı |
| `VALIDATION_MAX_CONCURRENT` | 2 | Uvicorn süreci başına eşzamanlı Shapely doğrulaması |

Gövde uzunluğu hem Content-Length üzerinden hem akış sırasında kontrol edilir;
Content-Length olmaması sınırı kaldırmaz. JSON boyutu/düğüm/derinlik/Feature ve
koordinat sınırları Shapely çalışmadan kontrol edilir. Tek bir GEOS çağrısını da
durdurabilmek için topoloji, macOS uyumlu `spawn` yöntemiyle kısa ömürlü bir
Python sürecinde yürütülür. Süre aşımında süreç sonlandırılır ve geçici rapor
dosyası temizlenir. Bu bir kalıcı arka plan kuyruğu değildir; HTTP isteği sonucu
bekler. Uvicorn birden çok worker ile başlatılırsa kapasite sınırı worker başınadır.

Boyut/işlem sınırı HTTP 413; süre aşımı 408; dolu doğrulama kapasitesi 429; işlemci
başlatılamaması veya beklenmeyen işlemci hatası 503 döner. Topolojik hata bunlarla
karıştırılmaz. Tamamlanmamış bir kontrolde başarılı/geçerli kısmi rapor verilmez.
Bu aşama sınırlı senkron kontrol içindir; büyük dataset'ler için arka plan sistemi
Aşama 6'nın aşağıda açıklanan ayrı worker sistemiyle yürütülür.

Aşama 5 geometri doğrulaması şema değiştirmez; güncel Aşama 6 migration head'i
`0002_import_jobs`'dur. Testler
orijinal JSON'un aynı kaldığını, doğrulamanın SQL yazma komutu üretmediğini,
workspace/proje/snapshot satırlarının değişmediğini ve süre aşımında başlamış
işlemcinin kapatıldığını kontrol eder.

Başvuru: [Shapely is_valid](https://shapely.readthedocs.io/en/stable/reference/shapely.is_valid.html),
[is_valid_reason](https://shapely.readthedocs.io/en/stable/reference/shapely.is_valid_reason.html),
[Python multiprocessing](https://docs.python.org/3/library/multiprocessing.html).

## Büyük GeoJSON import/export — Aşama 6

İki süreç çalıştırılır: FastAPI dosyayı alır ve durumu sunar; ayrı worker SQLite
kuyruğundan iş alıp dosyayı işler. Redis/Celery ve frontend bağlantısı yoktur.

```text
HTTP UploadFile → UUID adlı geçici dosya → SQLite jobs: queued
                                            ↓ ayrı worker
                       ijson → yapısal kontrol → Shapely raporu
                                            ↓ kısa transaction'lar
                                staging dataset: completed
                                            ↓ açık activate isteği + revision kontrolü
                                workspace: yeni draft dataset
```

### Başlatma ve durdurma

API ve worker için ortak mutlak `GEOJSON_DATABASE_PATH` seçin ve
işletim rehberindeki ayrı terminal komutlarını kullanın.
[Üç terminalle başlatma](../docs/RUNBOOK.md#üç-terminalle-başlatma)

Her süreci kendi terminalinde Ctrl+C ile durdurun. Worker SIGTERM'i destekler.
Kontrollü kapanış aktif alt süreci durdurur ve staging kayıtlarını temizler.
Kuyrukta bekleyen işler diskte kalır. Proje kökünden tek bakım ve iş alma turu
için `bash scripts/run-backend.sh worker --once` kullanılabilir. Süresi
dolmamış kayıp worker lease'ini beklemek için sürekli worker döngüsü gerekir.

### API ve yükleme sırasında iptal

Swagger'daki yeni grup **GeoJSON jobs**:

| Metot / yol | Davranış |
| --- | --- |
| `POST /api/v1/workspaces/{id}/imports` | Dosyasız 202 uploading rezervasyonu veya multipart dosya yükleme |
| `GET /api/v1/jobs/{id}` | Kalıcı durum, ilerleme, hata ve uyarı özeti |
| `POST /api/v1/jobs/{id}/cancel` | İptal talebi; worker/yükleyici güvenli noktada durur |
| `POST /api/v1/jobs/{id}/activate` | Hazır dataset'i başlangıç durumu değişmediyse etkinleştirir |
| `GET /api/v1/workspaces/{id}/export` | Tutarlı SQLite görünümünden akışlı FeatureCollection |

Önerilen iki adım, job ID'yi yükleme başlamadan verir:

```bash
curl -X POST http://127.0.0.1:8000/api/v1/workspaces/WORKSPACE_UUID/imports
curl -X POST 'http://127.0.0.1:8000/api/v1/workspaces/WORKSPACE_UUID/imports?jobId=JOB_UUID' \
  -F 'file=@/tam/yol/alanlar.geojson;type=application/geo+json'
```

`WORKSPACE_UUID` ve `JOB_UUID` gerçek kimliklerle değiştirilmelidir. Yükleme sürerken
başka bir Terminal'den `POST /jobs/JOB_UUID/cancel` gönderilebilir. Rezervasyon
yapmadan aynı imports endpointine doğrudan multipart `file` gönderilmesi de
desteklenir; bu durumda ID yanıtla öğrenilir, ağ bağlantısını kesme iptal sağlar.
Dosyasız rezervasyon gövdesi yok veya `{}` olabilir. Tek dosya alanının adı `file`
olmalıdır; ek form alanları, ikinci dosya ve desteklenmeyen uzantılar reddedilir.

UploadFile disk üzerinde spool edilebilir. Otomatik sınırsız body okuması yerine
kontrollü multipart okuma kullanılır: kota ve sahiplik **form okunmadan önce**
alınır, ağ parçaları okundukça boyut/iptal/lease kontrolü yapılır. Starlette'in
spool dosyası dosya boyutunda bir RAM tamponuna dönüştürülmez. Yönetilen kopya
64 KiB parçalarla, sunucu UUID'siyle, exclusive create ve 0600 izniyle yazılır.
Dosya adı disk yolu olarak kullanılmaz. Tam dosya fsync + rename sonrasında
queued yapılır. Yarım yükleme ve spool dosyaları hata/iptal halinde kapatılır.

### Job yanıtı

Yanıtın temel alanları:

```json
{
  "id": "job UUID",
  "workspaceId": "workspace UUID",
  "kind": "import",
  "status": "running",
  "filename": "alanlar.geojson",
  "totalBytes": 110100709,
  "receivedBytes": 110100900,
  "uploadedBytes": 110100709,
  "processedBytes": 52428800,
  "processedFeatures": 40000,
  "cancelRequested": false,
  "cleanupPending": false,
  "stagingDatasetId": "yeni dataset UUID",
  "initialDatasetId": "başlangıç dataset UUID",
  "initialGenerationId": "başlangıç generation UUID",
  "initialRevision": 3,
  "createdAt": "2026-11-06T10:00:00Z",
  "startedAt": "2026-11-06T10:00:02Z",
  "finishedAt": null,
  "activatedAt": null,
  "error": null,
  "warningCount": 10,
  "invalidFeatures": 1,
  "warningSamples": [],
  "peakRssBytes": 90000000
}
```

Durumlar `uploading → queued → running → completed`, hata halinde `failed`, iptal
halinde `cancelled` olur. `completed` **aktif edildi demek değildir**;
`activatedAt` ayrıca takip edilir. İptal ve temizleme tekrarlanabilir.

- `receivedBytes` ham multipart HTTP baytlarıdır; form sınırlarını da içerir.
- `totalBytes`, UploadFile boyutu öğrenilince gerçek dosya boyutudur; öncesinde 0.
- `uploadedBytes`, spool'dan yönetilen dosyaya gerçekten kopyalanan dosya baytıdır.
- `processedBytes`, ijson okuyucusunun gerçekten diskten aldığı bayttır. Okuyucu
  önden tamponlayabildiği için EOF/metadata denetimi bitmeden %100 olabilir;
  tamamlanma kararı için status kullanılmalıdır.
- `processedFeatures`, SQLite'a commit edilmiş partilerdeki kayıt sayısıdır.
- `cleanupPending`, staging/eski dataset'in küçük partilerle temizleneceğini
  belirtir. İş başarısız olsa bile işlenmiş bayt/kayıt sayaçları geçmiş bilgisi
  olarak korunur.

### Akışlı okuma ve kısa transaction'lar

ijson olayları, kök FeatureCollection'ın tamamını oluşturmadan tek Feature için
sınırlı ObjectBuilder'a aktarılır. Nokta içeren kullanıcı anahtarları prefix
karşılaştırmasıyla karıştırılmaz. Tekrarlanan kök alanları, bozuk son Feature,
eksik kapanış, yanlış kök türü ve hatalı category_catalog işi failed yapar.

Her import yeni generation ve staging dataset oluşturur. Sınırlı Feature/byte
partisi DatasetService üzerinden bulk insert ile yazılır; sayaçlar ve bounds
artan biçimde güncellenir, her partide tüm tablo tekrar taranmaz. Parti ilerlemesi
aynı transaction'da job'a yazılır. Dataset revision import boyunca 0 kalır.

Kökün type/features/category_catalog dışındaki ek alanları `datasets.metadata_json`
içinde korunur. Bütün Feature, properties, dış ID, Z ve ek alanlar JSON değerleri
olarak korunur. Bu, kaynak metnin whitespace veya sayı yazım biçiminin byte-byte
korunması değildir. Sayılar mevcut Python/JavaScript sözleşmesiyle uyumlu
int/float değerlerine çevrilir; büyük tamsayı kimlikleri ayrıca korunur.

Kategori kataloğu mevcut normalizasyon/merge kurallarını izler. Kullanılmayan
tanımlar korunur; root ek metadata ve katalog proje snapshot kopyalarında da
taşınır. `category_catalog` içindeki şema, mevcut name/subcategories sözleşmesidir.

### Topoloji politikası ve kaynak sınırları

Yapısal hata **importu reddeder**. Topolojik hata ise mevcut arayüz/DatasetService
davranışını korumak için kaydı reddetmez: veri değiştirilmeden saklanır ve job
uyarısına eklenir. `invalidFeatures`, topolojik olarak geçersiz kayıt sayısıdır.
`warningSamples` içinde `severity=topology_error` örnekleri genel Z/null
uyarılarından önce tutulur. `warningCount` bütün hata/uyarı bulgularının sayısıdır;
örnek listesi sınırlıdır. `make_valid` çağrılmaz, geometri türü değiştirilmez.
İstenen kaydı sonradan ayrı doğrulama API'siyle ayrıntılı incelemek mümkündür.

Shapely'nin Aşama 5 domain doğrulaması yeniden kullanılır. Büyük importun limitleri
5 MiB/500 Feature senkron API sınırlarından **ayrıdır**. Ayrı işleyen alt süreçte
bellek ve ilerleme süresi izlenir. GEOS takılırsa veya bütçe aşılırsa alt süreç
sonlandırılır; SQLite tamamlanmamış transaction'ı geri alır.

| `GEOJSON_` sonrası ayar | Varsayılan |
| --- | --- |
| `IMPORT_MAX_BYTES` | 512 MiB dosya |
| `IMPORT_DISK_QUOTA_BYTES` | 4 GiB; yönetilen dosyalar + DB/WAL/SHM ve rezervasyonlar |
| `IMPORT_CHUNK_BYTES` | 64 KiB |
| `IMPORT_BATCH_SIZE` / `IMPORT_BATCH_BYTES` | 500 Feature / 4 MiB |
| `IMPORT_MAX_FEATURE_BYTES` | 8 MiB; tek büyük Feature kendi partisinde olabilir |
| `IMPORT_MAX_METADATA_BYTES` | Kök metadata toplam 1 MiB |
| `IMPORT_MAX_FEATURE_VERTICES` / `IMPORT_MAX_VERTICES` | 100.000 / 50.000.000 |
| `IMPORT_MAX_FEATURES` | 2.000.000 |
| `IMPORT_MAX_DEPTH` / `IMPORT_MAX_FEATURE_NODES` | 64 / 500.000 |
| `IMPORT_MAX_CATEGORIES` | Ana ve alt kategori toplam 10.000 |
| `IMPORT_MAX_CATEGORY_CHARS` | Import kategori adı başına 1024 Unicode karakteri |
| `IMPORT_MAX_UPLOADS` / `IMPORT_MAX_RUNNING` | 2 / 2; SQLite üzerinden süreçler arasında paylaşılır |
| `IMPORT_MAX_PENDING` | uploading + queued + running toplam 10 |
| `IMPORT_UPLOAD_TIMEOUT_SECONDS` | 1800 |
| `IMPORT_UPLOAD_LEASE_SECONDS` / `IMPORT_LEASE_SECONDS` | 60 / 30 |
| `IMPORT_STALL_SECONDS` / `IMPORT_JOB_TIMEOUT_SECONDS` | 30 / 3600 |
| `IMPORT_WORKER_MEMORY_BYTES` | İşleyen alt süreç için 512 MiB RSS |
| `IMPORT_WARNING_SAMPLES` | 50 |

Disk kabulü konservatiftir: yükleme başında maksimum dosya boyutunun üç katı
spool/kopya/DB büyümesi için rezerve edilir; queued aşamasında gerçek boyuta göre
azaltılır. Dolayısıyla küçük kota kullanırken maksimum upload boyutu da
azaltılmalıdır. Dosya/parti aralarında gerçek disk kullanımı ve boş alan tekrar
kontrol edilir. Disk kotası/IO hatası 507, dosya boyutu 413, uzantı 415, kapasite
429, geçersiz iş durumu 409 döner. Asenkron JSON hatası HTTP upload yanıtında değil
job.status=failed ve job.error içinde görülür.

RSS yaklaşık 100 ms aralıkla örneklenir; bu bir işletim sistemi seviyesinde sert
adres alanı kotası değildir, anlık aşım olabilir. Parser tek string token'ını
oluştururken de işleyen alt sürecin RSS sınırı izlenir. Kaynak dosya büyüklüğü,
Feature/token/derinlik sınırları ve süreç sonlandırma birlikte kullanılır.

### Kalıcı sahiplik, yeniden başlatma ve temizleme

Job claim ve kapasite kontrolü SQLite'ta atomik UPDATE ile yapılır. Worker token'ı
her batch yazımında doğrulanır; eski/kaybolmuş bir worker sahipliğini kaybettikten
sonra yazamaz. Koordinatör lease'i yeniler; veri işleyen alt süreç ayrı progress
zamanını günceller. Uygulama yeniden başladığında süresi dolmuş işler failed veya
cancelled olarak işaretlenir. Worker her turda bu işleri ve yarım dataset'leri
küçük DELETE partileriyle temizler. Süresi dolmamış aktif lease'e dokunulmaz.

Worker SIGKILL veya makine kapanması sonrası en çok lease süresi beklendikten
sonra iş tespit edilir. Koordinatör SIGKILL ile durursa macOS'ta sahipsiz kalabilecek
işleyen alt süreç ebeveyn PID denetimiyle kendini kapatır. Kaynaktan otomatik tekrar
import yapılmaz. Yeniden yükleme
açık bir yeni job oluşturur. Metadata job geçmişi kalır; kaynak dosyalar ve sahipsiz
UUID dosyaları temizlenir. İptal edilen çalışan işte önce alt süreç durur, sonra
staging temizlenir. Kuyrukta veya tamamlanmış ama aktif edilmemiş iş de iptal
edilebilir. Aktif edilmiş job için cancel 409 döner.

### Aktivasyon ve export tutarlılığı

Aktivasyon başlangıç fiziksel dataset ID, generation ve revision'ı birlikte
karşılaştırır. Değişmiş workspace'e uygulama 409 döner; sessiz tekrar veya zorla
overwrite yoktur. Başarılı aktivasyon yalnızca staging durumunu draft'a ve
workspace bağlantısını yeni dataset'e çevirir. Kayıtlı proje snapshot'ı/version'ı
değişmez; workspace'in proje ilişkisi korunur, kullanıcı isterse daha sonra açık
proje kaydetme endpointini çağırır.

Eski dataset temizliği activation transaction'ında yapılmaz: retired_dataset_id
ile worker'a bırakılır. Başka proje/workspace referansı varsa silinmez. İçe
aktarmada dahili Feature kimlikleri yeni generation ile yenilenir; GeoJSON
feature.id değerleri değişmez. Aynı aktif job'a aktivasyon tekrarı veriyi sıfırlamaz.

Export tek SQLite read transaction'ı içinde metadata, katalog ve ordinal sıralı
Feature metinlerini okur. Tam dosya/Blob RAM'de kurulmaz; cursor bir kayıtla ilerler.
`ETag` generation/revision'ı, `X-Dataset-Id` fiziksel dataset'i belirtir. Export
sırasında edit/import olsa bile tek bir tutarlı görünüm döner. Uzun okuma SQLite
WAL sayfalarının temizlenmesini geciktirebilir; istemci bağlantısını bitirmelidir.
Kullanılmayan kategoriler dahil katalog ve yabancı kök metadata export edilir.

### Migration ve ölçüm

`0002_import_jobs`, `0001_data_models` dosyasını değiştirmez. Mevcut dataset'lere
boş metadata varsayılanı eklenir. Migration öncesi geliştirme DB'si SQLite backup
API'siyle yedeklenmelidir. Downgrade için SQLite 3.35+ native DROP COLUMN gerekir.
Güncel doğrulanmış çalışma ortamı SQLite 3.53.1 kullanır. Migration ayrı bir
işlemdir ve proje kökünden `bash scripts/run-backend.sh migrate` ile çalıştırılır.

Tamamen geçici DB/dosyalar üzerinde gerçek loopback HTTP ölçümü:

```bash
python scripts/benchmark_import.py --mib 105
```

Bu komut sentetik Point/Z verisi üretir, gerçek UploadFile endpointine akışla
gönderir, ayrı CLI worker'ı çalıştırır, aktive eder ve HTTP export'unu parça parça
okur. Her Feature için semantic SHA-256 ve kök metadata karşılaştırılır. API,
işleyen alt süreç ve worker süreç ağacının RSS'i ayrı raporlanır. Sonuç
`var/benchmarks/large-import.json` içine yazılır; test verileri temizlenir. Bu bir
gerçek kullanıcı polygonu, tarayıcı veya uzak ağ performans garantisi değildir.

Kaynaklar: [ijson](https://github.com/ICRAR/ijson),
[FastAPI UploadFile](https://fastapi.tiangolo.com/tutorial/request-files/),
[psutil](https://psutil.readthedocs.io/en/latest/).

### Aşama 7A: GeoJsonRepository HTTP sözleşmesi

Workspace kapsamlı viewport, Feature listeleme/okuma/mutasyon, boşaltma ve kategori
endpointleri `/api/v1/workspaces/{workspace_id}` altında sunulur. HTTP gövdeleri
TypeScript sözleşmesindeki alan adlarını korur; fiziksel dataset/generation/revision
bağlamı `X-Dataset-Id`, `X-Generation-Id`, `X-Dataset-Revision` başlıklarıyla da
döner. Yazmalarda üç beklenen değer birlikte zorunludur; çakışmalar HTTP 409'dur.
Mevcut import/job/aktivasyon ve akışlı export API'leri kullanılır.

`0003_spatial_index`, önceki migration dosyalarını değiştirmeden SQLite R-Tree
oluşturur ve mevcut kayıtları atomik olarak indeksler. INSERT/UPDATE/DELETE
triggerları import, snapshot, silme ve geri yükleme işlemlerinde indeksi aynı
transaction içinde güncel tutar. ORM autogenerate, türetilmiş R-Tree tablolarını
atlayacak şekilde yapılandırılmıştır.

Request/response örnekleri, limitler, gelecek ApiGeoJsonRepository ve ayrı
ProjectRepository tasarımı: [Repository API](docs/REPOSITORY_API.md).
Swagger: `http://127.0.0.1:8000/docs`.

Geçici SQLite üzerinde tekrar üretilebilir viewport ölçümü:

```bash
python scripts/benchmark_viewport.py --features 150000
```

Ölçüm raporu `var/benchmarks/viewport.json` içine yazılır. Geliştirme veritabanına
bağlanılmaz. Tam dünya sorgusunda doğru `matched` sayısını üretmek için eşleşen
kayıtlar sayılır; küçük viewport süreleri tüm dünya sorgusuna genellenmemelidir.
