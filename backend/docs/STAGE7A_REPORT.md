# Aşama 7A sonuç raporu

2026-11-06. GeoJsonRepository için workspace kapsamlı HTTP katmanı ve SQLite
R-Tree tamamlandı. Mevcut DatasetService, kategori, ProjectService, job ve export
servisleri kullanıldı. Frontend TypeScript adaptörü bu aşamada eklenmedi.

## Dosyalar

Yeni dosyalar (bu rapor dahil):

```text
backend/app/api/routes/repository.py
backend/app/domain/preview.py
backend/app/schemas/repository.py
backend/app/services/repository.py
backend/app/services/spatial.py
backend/docs/REPOSITORY_API.md
backend/docs/STAGE7A_REPORT.md
backend/migrations/versions/0003_spatial_index.py
backend/scripts/benchmark_viewport.py
backend/tests/test_preview_limits.py
backend/tests/test_repository_api.py
backend/tests/test_repository_failures.py
backend/tests/test_stream_root_compatibility.py
```

Değiştirilen mevcut backend dosyaları:

```text
backend/.env.example
backend/README.md
backend/app/api/errors.py
backend/app/api/router.py
backend/app/api/routes/imports.py
backend/app/core/config.py
backend/app/domain/streaming_geojson.py
backend/app/main.py
backend/app/schemas/datasets.py
backend/app/services/jobs.py
backend/app/workers/import_worker.py
backend/migrations/env.py
backend/tests/test_health.py
backend/tests/test_migrations.py
```

## HTTP uçları

Önek `/api/v1`. Aşağıdaki sekiz HTTP metot/yol eşlemesi eklendi:

| Yöntem | Yol | İşlem |
| --- | --- | --- |
| POST | `/workspaces/{workspace_id}/empty` | Aynı workspace için yeni boş generation |
| GET | `/workspaces/{workspace_id}/viewport` | R-Tree, bounds/tolerance/limit sorgusu |
| GET | `/workspaces/{workspace_id}/features` | Özet listeleme, Türkçe arama, sayfalama |
| GET | `/workspaces/{workspace_id}/features/{feature_id}` | Özgün tam Feature |
| POST | `/workspaces/{workspace_id}/mutations` | Ekleme, güncelleme, silme, aynı kimlikle geri yükleme |
| DELETE | `/workspaces/{workspace_id}/features/{feature_id}` | Silme alternatif HTTP yöntemi |
| GET | `/workspaces/{workspace_id}/categories` | Kullanılmayanlar dahil kategori kataloğu |
| POST | `/workspaces/{workspace_id}/categories` | Ana/alt kategori ekleme |

İlk createEmpty için mevcut `POST /workspaces` kullanılır. Mevcut import,
job durum/iptal/aktivasyon ve akışlı export uçları yeniden kullanılır.
Import rezervasyonuna isteğe bağlı, birlikte gönderilen expected-state query
alanları eklendi. Sonraki adaptör bu alanları göndermelidir.

Yazmalarda `expectedDatasetId`, `expectedGenerationId`, `expectedRevision`
birlikte kontrol edilir. Revision değişikliği veya workspace'in fiziksel dataset
değişimi 409 üretir. Aynı generation/revision ile açılmış farklı proje kopyası da
bu kontrolden geçemez. Feature/dataset/index güncellemeleri aynı transaction'dadır.
Okuma yanıtları mevcut DTO alanlarını korur; durum bilgisi ayrıca CORS'a açılan
X-Dataset-Id, X-Generation-Id, X-Dataset-Revision ve ETag başlıklarıyla iletilir.

Tam istek/yanıt ve sonraki ApiGeoJsonRepository/ProjectRepository tasarımı:
[REPOSITORY_API.md](REPOSITORY_API.md).

## Mekânsal indeks ve veri koruma

`feature_rtree(id,min_x,max_x,min_y,max_y,+dataset_id)` kullanılır. `id`, SQLite
Feature satırının fiziksel iç anahtarıdır. Generation/ordinal tabanlı sözleşme
kimliği ve özgün GeoJSON feature.id ayrı kalır. Null/boş bounds ve silinmiş
kayıtlar indekslenmez; bu kayıtlar gerektiği yerde list/get/export'ta korunur.

INSERT/UPDATE/DELETE triggerları import, snapshot kopyalama, geometri değişikliği,
silme, geri yükleme ve fiziksel temizlikte indeksi aynı transaction'da tutar.
Migration mevcut satırları atomik olarak indeksler. Bakım için transaction içinde
`SpatialService.rebuild()` de mevcuttur. Alembic autogenerate, R-Tree ve üç SQLite
shadow tablosunu ORM tabloları gibi silmeye çalışmaz.

R-Tree adayları özgün double-precision bounds üzerinde tekrar süzülür; float32
yuvarlamadan kaynaklanan yanlış eşleşmeler engellenir. `matched` limit öncesindeki
kesin bbox eşleşme sayısıdır. Query display-only basitleştirme yapabilir; get ve
export tam koordinatları döndürür. Z, dış ID, properties, yabancı metadata ve
kullanılmayan kategoriler korunur. Mutasyonun bbox temizlemesi mevcut localEngine
davranışıyla aynıdır. Tek Feature ve bare geometry importu da desteklenir.

Viewport kaynak JSON bütçesi varsayılan 64 MiB, sonuç limiti en fazla 3000'dür.
JSON decode öncesi UTF-8 bayt hesabı yapılır. Douglas–Peucker işlemleri sorgu başına
1.000.000 uzaklık hesabıyla sınırlıdır; bütçe tükenirse mevcut geometrinin tamamı
ve kalan kayıtlar özgün koordinatlarla döner. Kısmen basitleştirilmiş koleksiyon
verilmez. Bu ayarlar `.env.example` içinde belgelenmiştir.

## Migration ve geliştirme sunucusu

`0002_import_jobs -> 0003_spatial_index` geliştirme veritabanına uygulandı.
0001 ve 0002 dosyalarının SHA-256 değerleri başlangıçla aynı kaldı.

Yedek: `backend/var/database/backups/projects-before-stage7a-20261106T084011Z.db`.
Yedek öncesi macOS dataless WAL/SHM erişimi disk I/O hatası verdi. Sunucu durduruldu;
açık bağlantı olmadığı ve WAL'ın boş olduğu doğrulandı. Ana dosya SQLite backup
API'siyle yedeklenip doğrulandı. Geçici dosyalar silinmeden backups altına taşındı;
SQLite bunları yeniden oluşturdu. Ana veritabanı silinmedi veya sıfırlanmadı.

- `PRAGMA integrity_check`: `ok`.
- `PRAGMA foreign_key_check`: ihlal yok.
- `rtreecheck('feature_rtree')`: `ok`.
- `alembic check`: yeni operasyon tespit edilmedi.
- Yedi iş tablosunun migration öncesi/sonrası satır sayısı ve SHA-256 özeti eşleşti.
  Geliştirme veritabanında başlangıçta bu tabloların tamamı boştu; dolu veri backfill
  ve veri koruma senaryoları izole testlerde ayrıca doğrulandı.

Ayrıntılı yerel denetim: `backend/var/benchmarks/stage7a-migration.json`.
Uvicorn aynı `127.0.0.1:8000` adresinde reload ayarıyla yeniden başlatıldı.
Gerçek HTTP kontrolünde health, `/docs`, `/openapi.json`: **200**.
Yeni sekiz endpointin tamamı OpenAPI içinde doğrulandı.

## Testler

```bash
cd backend
.venv/bin/python -m pytest -q
```

Sonuç: **300 passed in 14.21s**. Önceki 205 testin tamamı ve 95 yeni test geçti.
Yeni testler: repository API 40, streaming root uyumluluğu 40,
preview bütçesi 10, hata/rollback/transport 5.

Kapsam: CRUD/restore; revision ve fiziksel dataset çatışması; R-Tree trigger,
backfill, rollback ve bbox yuvarlaması; sayfalama/Türkçe arama; null geometry;
özgün ID/properties/Z; kategoriler; import sonrası sorgu; proje snapshot izolasyonu;
export; 404/409/413/422/500 ve CORS; bozuk/non-finite JSON; CPU/bellek bütçeleri.
Test veritabanları geçici ve izoledir; geliştirme veritabanı testte kullanılmadı.

## Viewport performansı

Son kodla `python scripts/benchmark_viewport.py --features 150000` çalıştırıldı.
Geçici DB'de 150.000 küçük Polygon/Z ve başka dataset'te 15.000 kayıt vardı.
Her viewport 15 kez ölçüldü. Servis süresine sayım, JSON decode ve DTO hazırlığı
dahil; HTTP ağ/tarayıcı süresi dahil değildir. Isınmış önbellek ölçümüdür.

| Viewport | Eşleşen / dönen | Medyan |
| --- | ---: | ---: |
| Küçük | 3 / 3 | 0,466 ms |
| Şehir | 12 / 12 | 0,695 ms |
| Bölge | 3.220 / 2.500 | 86,430 ms |
| Dünya | 150.000 / 2.500 | 1.066,848 ms |
| Boş | 0 / 0 | 0,305 ms |

Beş sonuç bağımsız tam bounds sorgusuyla birebir eşleşti. EXPLAIN planı R-Tree
virtual index taraması ve Feature integer primary key erişimini doğruladı.
165.000 satır backfill: 1,113 sn. Süreç RSS başlangıç 78,922 MiB, tepe 105,141 MiB
(fixture hazırlığı dahil). Tam dünya sorgusu doğru `matched` sayımı ve sıralama
maliyeti taşır; küçük viewport sonuçları tüm dünya veya çok karmaşık polygonlara
genellenmez. Makineye/sentetik veriye özgü ölçümlerdir.

Makine tarafından okunabilir yerel rapor: `backend/var/benchmarks/viewport.json`.

## Git doğrulaması

```text
## abdullah-backend...origin/gamze-harita-arayuz
 M .gitignore
?? backend/
```

HEAD `98509dc16582c4eff803a958713e7e5b40f748c5`; upstream değişmedi.
`.gitignore` aşama başında zaten değiştirilmişti; bu aşamada içeriği değişmedi.
Backend önceki aşamalardan beri Git'e eklenmemiş olduğu için bu görünüm normaldir.
Staging alanı boş; commit oluşturulmadı. Branch switch/fetch/pull/merge/rebase/push
yapılmadı. Başlangıçta izlenen dosyaların tamamı hash karşılaştırmasıyla değişmeden
kaldı; frontend, contracts.ts ve INTEGRATION.md aynıdır. Silinen kaynak dosya yok.
`.venv`, `.env`, SQLite/yedek/import/benchmark dosyaları ve `.DS_Store` ignore edilir.

Aşama 7A burada biter. Frontend adaptörü için sonraki onay beklenir.
