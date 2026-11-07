# Gamze için proje entegrasyon planı — Aşama 7D-1

Bu aşama yalnız TypeScript servisidir. Harita, App ve diğer UI bileşenleri,
GeoJsonRepository sözleşmesi, local adaptör ve backend değiştirilmedi. Proje
ekranı/otomatik kaydetme eklenmedi. Backend'in mevcut DTO ve endpointleri kullanıldı.

## Bağlama noktası

API modundaki **aynı** ApiGeoJsonRepository örneğinin `.projects` servisi kullanılır.
İkinci bir API adaptörü oluşturmak farklı bir workspace doğurur; ekrandaki çalışma
bu ikinci adaptör üzerinden kaydedilmemelidir. Servisleri constructor içinde
bağlayan kod `src/adapters/api/ApiGeoJsonRepository.ts` içindedir.

```ts
// Sonraki UI aşaması için örnek; bu aşamada App'e eklenmedi.
if (repository instanceof ApiGeoJsonRepository) {
  const projects = repository.projects;
  const page = await projects.list('Park', 0, 20);
  let saved = await projects.create('Park projesi');
  saved = await projects.save(saved.id, saved.version);
  const opened = await projects.open(saved.id, saved.version);
  // UI: opened.workspace.dataset ile özeti yenile, eski seçim/undo'yu temizle.
  // opened.previousWorkspace sunucuda korunur; otomatik kaydedilmez veya silinmez.
}
```

Local modda proje servisi sunulmaz. API adaptörünü sırf proje butonu için gizlice
oluşturma veya local veriyi otomatik taşıma yapılmamalıdır. Local verinin API'ye
aktarımı daha sonra kullanıcı onaylı ayrı bir export/import akışı gerektirir.

## Metotlar ve gerçek backend sözleşmesi

Yeni DTO ve arayüz: `src/domain/projects.ts`.

| Servis | Mevcut HTTP endpointi | Not |
| --- | --- | --- |
| list(search?, offset?, limit?) | GET `/api/v1/projects` | `{items,total}`, varsayılan limit 50 |
| get(id) | GET `/api/v1/projects/{id}` | Snapshot özeti ve proje sürümü |
| create(name) | POST `/api/v1/projects` | Aktif workspace'in bağımsız snapshot'ı |
| save(id, expectedVersion) | PUT `/api/v1/projects/{id}/content` | Bağlı workspace'i tekrar kaydet |
| open(id, expectedProjectVersion) | POST `/api/v1/workspaces` | `{projectId,expectedProjectVersion}` ile yeni düzenlenebilir kopya |
| rename(id, name, expectedVersion) | PATCH `/api/v1/projects/{id}` | İsim ve proje sürümü güncellenir |
| remove(id, expectedVersion) | DELETE `/api/v1/projects/{id}?expectedVersion=…` | Başarı 204; JSON gövdesi beklenmez |

create/save isteklerine workspaceId, expectedDatasetId, expectedGenerationId ve
expectedRevision servis tarafından ortak bağlamdan eklenir. Proje sürümü istemciden
**açıkça** alınır; sessizce son sürümü okuyup eski yazma tekrarlanmaz. Dataset
revision geometri/kategori düzenlemelerini; project.version kayıt/isim değişikliğini
izler. rename sonrası gelen yeni version da UI'da saklanmalıdır.

## Açma ve veri güvenliği

Backend mevcut workspace içeriğini değiştiren `/open-project` ucu da sunar. Bu
servis veri kaybını önlemek için onu kullanmaz: mevcut POST /workspaces'in projeden
kopyalama desteğiyle **yeni bir workspace** oluşturur. Başarılı yanıta kadar
adaptör eski workspace'te kalır. Önceki workspace ve kaydedilmiş snapshot silinmez.
Sonuç `{workspace,previousWorkspace}` biçimindedir. Önceki workspace bilgisi yerel
bağlamın kopyasıdır; başka istemcilerin son değişiklikleri için güncellik garantisi
taşımaz, ancak eski workspace kimliğini korur. Geri dönme ekranı henüz yoktur.

Yeni kopyanın fiziksel dataset kimliği değişir; generation/ordinal, dış Feature ID,
properties, Z ve kategori kataloğu backend tarafından korunur. Generation aynı
kalabilse bile UI eski seçimi ve undo geçmişini taşımamalıdır. Adaptör eski get
revision bağlamlarını temizler. Proje açılırken kuyruğa girmiş eski çalışma
komutları, yeni workspace'e yanlışlıkla uygulanmaması için reddedilir. Yeni
komutlar ancak open() tamamlandıktan sonra gönderilmelidir.

Proje ve geometri işlemleri aynı FIFO kuyruğunu, fetch altyapısını, hata sınıfını ve
dispose sinyalini paylaşır. Listeleme/get/rename/remove workspace oluşturmaz.
dispose kaydedilmiş projeleri veya eski workspace'leri silmez. Silme yalnızca
remove çağrısı ile yapılır. Snapshot güncellemeleri yalnız create/save ile yapılır.

409'da UI kullanıcıya çatışmayı göstermeli; get/list ile son durumu okuyup karar
vermesini istemelidir. İstek sessizce yeniden gönderilmez. Ağ hatasında yazma
sonucu belirsiz olabilir; başarılı varsayma ve otomatik yeniden yazma yapma.
Proje açma yanıtı kaybolursa sunucuda kullanılmayan yeni bir workspace oluşmuş
olabilir; önceki workspace yine korunur. Bu sürümde otomatik orphan temizliği yoktur.

## Kararlaştırılacak kullanıcı akışları

1. API modunda proje listesi: arama/sayfalama ve açık proje adı/sürümü. Local mod
   için açıklayıcı durum; otomatik mod değiştirme yok.
2. İlk Kaydet/Farklı Kaydet: kullanıcı ad girer, create çağrılır. Mevcut projeyi
   kaydetmek için son bilinen id/version ile save çağrılır; başarı bildirimi yanıttan
   sonra verilir. Kayıt boyunca yeni kullanıcı düzenlemeleri kilitlenmelidir.
3. Aç: kaydedilmemiş değişiklik varsa önce Kaydet/İptal/Yeni kopyada devam et kararı.
   Başarıda dataset özeti, kategori, liste, harita, JSON paneli, seçim ve geçmiş
   ortak biçimde yenilenir. Başarısızlıkta mevcut görünüm/çalışma korunur.
4. Yeniden adlandır/sil: seçili kaydın version değeri kullanılır. Silme için UI'da
   açık kullanıcı onayı gerekir; listeden kaybolma başarıdan sonra uygulanır.
5. Yeni çalışma/ham dosya importu sonrası aktif proje bağlantısının UI'da
   sıfırlanması veya yeniden değerlendirilmesi. Otomatik save varsayılmaz.
6. Sayfa yenileme halen yeni boş workspace açar; proje seçme/son projeyi önerme
   davranışı ayrı tasarlanmalıdır. Kalıcı snapshot ile geçici workspace farklıdır.

Bu ekranlar bu aşamada uygulanmadı; Gamze ile kararlaştırıldıktan sonra bağlanır.

## Doğrulama ve Git teslimi

```bash
npm test
npm run build
RUN_BROWSER_INTEGRATION=1 ./node_modules/.bin/vitest run --config tests/api.integration.config.ts
cd backend
.venv/bin/python -m pytest -q
```

Proje testleri geçici SQLite'ta gerçek FastAPI kullanır: snapshot izolasyonu,
eski workspace'in korunması, tekrar kaydetme/açma, ID/properties/Z/katalog koruma,
arama/sayfalama, 409, isim değiştirme ve silme doğrulanır. Unit testler ortak
kuyruğu, gecikmiş eski yazmaları, HTTP/ağ hatalarını ve dispose davranışını kapsar.
Geliştirme DB'si test için kullanılmaz; yeni migration gerekmez.

2026-11-06 sonuçları: frontend **99 geçti**, PERF_FILE isteyen mevcut büyük dosya
testi atlandı. Yeni ProjectRepository unit kapsamı **19 test**. Mevcut gerçek
HTTP/tarayıcı testleriyle yeni proje testi birlikte **3 geçti**. Backend
**300 geçti** (17,57 sn). TypeScript kontrolü ve Vite build local/API modlarında
başarılı. Geçici SQLite'ta eski workspace, kayıtlı snapshot ve bağımsız proje
verileri üzerinde izolasyon ve silme sonrası koruma doğrulandı.

7C'nin beş dosyası incelenerek yalnız yerelde `b9a6398` commit'ine kaydedildi:
`Enable local and API repository modes with integration tests`. Commit sonrası
çalışma ağacı temizdi. Dal abdullah-backend, upstream origin/abdullah-backend
korundu. Bu aşamada push/pull/fetch/merge/rebase yapılmadı. 7D-1 kaynakları henüz
commit edilmedi; yalnız 7C checkpoint commit'i oluşturuldu.

7D-1 dosyaları: yeni `src/domain/projects.ts`,
`src/adapters/api/ApiProjectRepository.ts`, `tests/unit/projectRepository.test.ts`,
`tests/integration/projectRepository.test.ts` ve bu belge. Güncellenen tek mevcut
kaynak `src/adapters/api/ApiGeoJsonRepository.ts` (ortak kuyruk/bağlam bağlantısı).
