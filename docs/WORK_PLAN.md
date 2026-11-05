# İki kişilik çalışma planı

Takvim belirtilmediğinden işler aşama ve bağımlılık sırasıyla düzenlenmiştir.

## Kapsam ayrımı — 5 Kasım 2026

Bu depo Gamze'nin çalışan arayüzünü içerir. Başlangıçtaki Sivas örnek dosyası, otomatik örnek yükleme ve örnek dosyayı yeniden açma düğmesi kaldırıldı. Uygulama boş çalışmayla açılır.

`src/adapters/local/` yalnızca bu arayüzü sunucu olmadan çalıştıran tarayıcı adaptörüdür; ikinci kişinin sunucu kodu değildir. `src/data/` altında adaptör seçen fabrika ve ortak içe aktarma penceresinin istemci dosya dönüştürücüsü bulunur. Ortak `src/domain/contracts.ts` entegrasyon sınırı olarak kalır.

İkinci geliştiricinin aşağıdaki sunucu görevlerinden hiçbiri bu depoda tamamlanmış sayılmaz. Tarayıcıda dosya okuyabilmek, sunucuda büyük dosya işleme veya kalıcı veritabanının yapıldığı anlamına gelmez.

## Gamze — Harita ve arayüz

- [x] Yerel uygulama iskeleti ve duyarlı paneller.
- [x] Harita altlıkları, katman görünürlüğü, zoom ve şekil seçimi.
- [x] Poligon çizme, köşe ekleme/taşıma/silme, tüm şekli taşıma.
- [x] Referans üst araç çubuğu: nokta, çizgi, poligon, dikdörtgen, daire; sade Etiket listesi ve şekil başına görünürlük.
- [x] Tek ortak İçe aktar penceresi: GeoJSON ve Excel; koordinat/WKT/GeoJSON/polyline eşleştirmesi. Kategori Excel yükleme kapsam dışıdır.
- [x] Şekil silme ve sınırlı geri alma/yineleme.
- [x] Şekil listesi, arama ve sayfalama.
- [x] Seçili Feature/öznitelik JSON editörü.
- [x] Geojson.io düzeninde sürekli açık tüm dosya JSON paneli, harita/kod arasında iki yönlü güncelleme, düzenlenebilir sayfalı öznitelik tablosu ve boyutlandırılabilir veri paneli.
- [x] Görünür alan sorgusu ve ayrı tam ayrıntılı düzenleme katmanı.
- [x] Dosya açma ilerlemesi/iptali, hata gösterimi, dışa aktarma arayüzü.
- [x] Ana/alt kategorileri elle oluşturma ve şekle kategori atama arayüzü.
- [x] Koyu/aydınlık tema.
- [ ] Gerçek kullanıcı dosyalarıyla 100/250/500 MB tarayıcı kabul testi ve iyileştirmeler.
- [ ] İkinci geliştiricinin veri adaptörüne geçiş ve kalıcı proje ekranları.

## İkinci geliştirici — Veri ve sunucu

- [ ] Sözleşmeyi incele; servis/veritabanı teknolojisini ekipçe belirle.
- [ ] Kalıcı proje ve geometri kayıt modeli.
- [ ] Atomik, iptal edilebilir büyük dosya import servisi.
- [ ] Sunucuda mekânsal sorgu + sayfalama + kararlı dahili kimlikler.
- [ ] Topolojik geometri doğrulaması ve anlaşılır hata çıktıları.
- [ ] Sunucudan tam ayrıntıyı koruyan export; veri kaybı testleri.
- [ ] `GeoJsonRepository` adaptörü ve sunucu hata/revision yönetimi.
- [ ] Gerekirse kimlik doğrulama ve proje erişim yetkileri.

## Ortak entegrasyon sırası

1. `contracts.ts` türlerini ve örnek dosyaları sabitleyin.
2. İkinci geliştirici get/list/query/mutate için adaptörü bağlasın; Gamze mevcut panellerle denesin.
3. Import/export/iptal akışlarını bağlayın ve hatalı importun eski çalışmayı koruduğunu doğrulayın.
4. Bir Polygon, delikli Polygon, MultiPolygon, null geometri ve tekrarlanan dış kimliklerle veri kaybı kontrolü yapın.
5. Gerçek 100/250/500 MB dosyalarda tarayıcı, cihaz RAM'i, dosya boyutu, şekil/köşe sayısı, açılış süresi ve düzenleme tepkisini raporlayın.
6. Yayın yapılandırmasını birlikte ekleyin. GitHub'a kaynak yükleme ve canlı site yayınlama ayrı adımlardır; canlı yayın yapılandırması henüz eklenmedi.

## Çalışma düzeni

Her görev için issue; kısa ömürlü feature dalı; diğer kişinin incelemesiyle PR. Gamze'nin çalışma dalı `gamze-harita-arayuz`. Ortak başlangıç dalı `main`; çalışan harita/arayüz bu geliştirme dalındadır. Ortak sözleşmeler değişirse iki kişi birlikte gözden geçirmeli.
