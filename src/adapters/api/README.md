# Bağımsız HTTP adaptörü — Aşama 7B

`ApiGeoJsonRepository`, mevcut GeoJsonRepository sözleşmesini uygular. Fabrika ve
arayüz değiştirilmedi; çalışan uygulama WorkerGeoJsonRepository kullanmaya devam
eder. Bu sınıfı eklemek mevcut uygulamayı FastAPI'ye geçirmez.

Bağımsız kullanım:

```ts
const repository = new ApiGeoJsonRepository({
  baseUrl: 'http://127.0.0.1:8000/api/v1',
  pollIntervalMs: 250,
});
await repository.createEmpty();
```

Constructor ağ isteği göndermez. İlk işlem `POST /workspaces` ile bu örneğe özel
workspace oluşturur. Sonraki createEmpty, aynı workspace'in `/empty` endpointini
beklenen fiziksel dataset/generation/revision ile çağırır ve revision 0 döndürür.
`fetch` bağımlılığı test veya farklı taşıma altyapısı için constructor'a verilebilir.

## Endpoint eşlemesi

Önek `/api/v1`; `w` bu örneğin workspace UUID'sidir.

| Metot | HTTP |
| --- | --- |
| İlk workspace | POST `/workspaces` |
| createEmpty | POST `/workspaces/{w}/empty` |
| query | GET `/workspaces/{w}/viewport` — dört tekrarlı bounds, tolerance, limit |
| list | GET `/workspaces/{w}/features` — search, offset, limit |
| get | GET `/workspaces/{w}/features/{id}` |
| mutate | POST `/workspaces/{w}/mutations` |
| categories | GET `/workspaces/{w}/categories` |
| addCategory | POST `/workspaces/{w}/categories` |
| open | POST `/workspaces/{w}/imports`, multipart upload, GET `/jobs/{id}`, POST `/jobs/{id}/activate` |
| İptal | POST `/jobs/{id}/cancel` |
| export | GET `/workspaces/{w}/export` |
| dispose | Yerel abort; aktif import için job iptali; proje/dataset DELETE çağrısı yok |

Mutasyonlar ve kategori ekleme güncel expectedDatasetId, expectedGenerationId ve
expectedRevision gönderir. get() ile okunan kaydın revision bağlamı ayrıca tutulur;
sonraki viewport/list okumaları bu kaydın eski düzenleme girdisini yetkilendirmez.
409 açık hata olur; otomatik revision yenileyip aynı yazmayı tekrar etme yoktur.
Yeni generation oluşturma ve başarılı mutasyonlar ilgili eski okuma bağlamını
temizler. Düzenleme için get() kullanılmalıdır; query() önizlemesi mutate girdisi
yapılmamalıdır. Adaptör GeoJSON ID/properties/koordinatları dönüştürmez.

Tüm işlemler FIFO sıralıdır; başarısız işlem kuyruğu kilitlemez. dispose yeni ve
bekleyen işlemleri reddeder, devam eden taşıma isteklerini abort eder. Gecikmiş
yanıtlar kapatılmış adaptörün durumunu güncellemez. Kayıtlı projeler silinmez.

## Import, iptal ve belirsiz yazma sonucu

Rezervasyona üç expected-state query alanı gönderilir; yakalanan başlangıç durumu
doğrulanır. Job kimliği bilindikten sonra multipart upload yapılır. Dosyanın tümü
JavaScript stringine çevrilmez. Polling, gerçek processedBytes/totalBytes ve
processedFeatures üzerinden ImportProgress verir. Tamamlanmış staging dataset
ancak açık aktivasyon isteğiyle etkinleşir. Hata/iptalde job cancel gönderilir;
başarısız import aktif veriye uygulanmaz.

open() AbortSignal'i upload/polling'e bağlanır. Rezervasyon yanıtı iptalle yarışırsa
job kimliğini kaybetmemek için yanıt beklenir ve ardından ayrı bir cancel isteği
gönderilir. Rezervasyon/aktivasyon en fazla 30 saniye, cleanup/reconciliation
istekleri en fazla 5 saniye bekler. Rezervasyonun cevabı tamamen kaybolursa job
kimliği bilinemez; backend'in lease/timeout temizliği gereklidir.

Aktivasyon başladıktan sonra sonucu beklenir: geç gelen abort commit olmuş veriyi
geri almaz. Aktivasyonun cevabı ağ hatasıyla kaybolursa job activatedAt ve güncel
workspace okunarak sonuç doğrulanır; aktivasyon tekrar gönderilmez. Sonuç
kesinleştirilemezse açık hata verilir. Ağ hatasından sonra UI başarı varsaymamalı
ve aynı yazmayı körlemesine tekrar etmemelidir. dispose aktivasyon sırasında
gelirse yerel örnek kapanır; sunucuda daha önce commit olmuş aktivasyon korunur.

Export yanıtı parça parça Blob parçalarına alınır. Mevcut JSON stream parser yalnız
Feature tamamlanmalarını sayar. Başlangıçta 0/0 ve başarı sonunda gerçek kayıt
sayısı/toplam kayıt sayısı ilerlemesi verilir; bayt sayısı kayıt ilerlemesi gibi
gösterilmez. Blob sözleşmesi nedeniyle nihai çıktı tarayıcı belleğinde tutulur.
Progress callback hataları sunucuda tamamlanmış bir işlemi başarısız göstermez.

## Doğrulama

```bash
npm test
npm run build
./node_modules/.bin/vitest run --config tests/api.integration.config.ts
cd backend
.venv/bin/python -m pytest -q
```

Sonuç: frontend 71 test başarılı, PERF_FILE gerektiren mevcut büyük dosya testi
atlanmış; API adaptörü için 22 yeni unit test başarılı. Ayrı gerçek HTTP entegrasyon
testi başarılı; backend'in mevcut 300 testi başarılı. TypeScript ve Vite build
başarılı. Entegrasyon testi backend/.venv kurulmuş olmasını gerektirir; kendi
geçici SQLite DB'sini migrate eder, rastgele loopback portu ve worker açar, sonunda
alt süreçleri ve geçici verilerini temizler. Geliştirme DB'sine bağlanmaz.

## Gamze ile kararlaştırılacak sonraki adımlar

- createRepository fabrikasının API adaptörünü seçmesi ve API adresinin frontend
  yapılandırmasından verilmesi; yerel Worker seçeneğinin korunması.
- Backend/worker kullanılamadığında gösterilecek bağlantı, import/job ve iptal
  durumları; 409 sonrası kullanıcıya yeniden okuma/çakışma çözümü akışı.
- Proje kaydet/aç/listele/yeniden adlandır/sil ekranları için ayrı ProjectRepository
  ve ortak workspace bağlamı; GeoJsonRepository sözleşmesini bu aşamada değiştirme yok.
- Proje/import sonrası seçim, undo geçmişi, kategori ve harita durumunun yeni
  generation'a göre yenilenmesi; iş kapanışı sonrası kullanıcıya sonuç bildirme.
- Çok büyük export için mevcut Blob tabanlı akışın kullanıcı deneyimi ve bellek
  sınırları; ilerleme ekranında başlangıç 0/0 durumunun sunumu.

## Git teslimi

Önceki backend kaynakları ve .gitignore güvenlik kontrolünden sonra yalnız yerelde
`0af1602` (`Complete GeoJSON backend API and data services`) commit'ine alındı.
Commit sonrası çalışma ağacı temizdi. Dal abdullah-backend, upstream
origin/gamze-harita-arayuz; push/fetch/pull/merge/rebase yapılmadı. SQLite, .env,
.venv, upload/benchmark/yedekler ve .DS_Store ignore edildi.

7B dosyaları ayrı ve henüz commit edilmemiştir: bu belge, ApiGeoJsonRepository.ts,
tests/unit/apiRepository.test.ts, tests/api.integration.config.ts ve
tests/integration/apiRepository.test.ts. Önceden var olan frontend/backend kaynak
dosyaları değiştirilmedi. contracts.ts, INTEGRATION.md, Worker adaptörü ve
createRepository fabrikası aynı kaldı. Aktif FastAPI geçişi sonraki onaya bağlıdır.
