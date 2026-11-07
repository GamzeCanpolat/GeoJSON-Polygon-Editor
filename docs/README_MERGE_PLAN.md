# README birleştirme hazırlığı — Aşama 10B

Bu bir Git merge sonucu değildir. İnceleme mevcut remote-tracking ref'leri ve
çalışma ağacındaki 10A README üzerinden yapıldı. Bu aşamada fetch/checkout,
commit, main değişikliği veya merge yapılmadı.

## İncelenen içerikler

| Ref | Commit | README durumu |
| --- | --- | --- |
| origin/main | 9c4ed5cb59f79134d906e90fd8737fbf17f2bd28 | İlk frontend açıklamaları; sonda geliştirme/kaynak bölümü sadeleştirilmiş |
| origin/abdullah-backend | bbf17d2405b10fdcda898224af703fc997bf6fe3 | Gamze README'sinin kullanım ayrıntılarını taşıyor; kurulum backend sonrası güncel değil |
| origin/gamze-harita-arayuz | 98509dc16582c4eff803a958713e7e5b40f748c5 | Frontend kullanım notları ve o aşamadaki geliştirici sınırı |
| Çalışma ağacı README.md | Henüz commit edilmedi | 10A güncel kurulum + 10B frontend ayrıntıları; birleştirilmiş aday |

Ref'ler 10A fetch'inden kalmıştır. GitHub'ın bu aşamadaki anlık durumu yeniden
doğrulanmadı; yeni remote commit olmadığını garanti etmiyoruz.

## Korunan içerik

1. 10A'nın beş dokümantasyon değişikliği korundu. Kök README'nin 10A metni
   çıkarılmadı; frontend ayrıntı bölümü eklendi.
2. Gamze'nin özgün README gövdesi değiştirilmeden
   [tarihsel arşive](archive/FRONTEND_README_98509dc.md) alındı. Kaynak ref/blob
   ve SHA-256 arşivde bulunur; güncel kurulum için arşiv kullanılmaz.
3. JSON/Tablo, çizim araçları, köşe düzenleme, kategori, Excel sayfa/sütun
   davranışları, harita kaynakları ve veri koruma notları güncel adaya taşındı.
4. Backend, SQLite/Alembic/worker, Local/API, proje bayrağı, Mac üç terminal
   komutları, test ve güvenli backup/restore bağlantıları korundu.
5. “Backend uygulanmadı” veya “kalıcı proje yok” gibi tarihsel ifadeler güncel
   kullanım talimatı olarak tekrarlanmadı. Local adaptörün sunucu olmadığı
   ayrımı korunur. WORK_PLAN.md geri getirilmedi.
6. Harita kaynağı ve referans uygulama atıfları korundu.

## Adayın uygulanması

Birleştirilmiş aday, [kök README.md](../README.md) dosyasının mevcut çalışma ağacı
içeriğidir. Ayrı bir sahte merge commit'i veya main çalışma kopyası oluşturulmadı.
10A'da readonly merge-tree, README'de conflict marker'ı üretmişti.
Güncel adayın varlığı, gelecekte gerçek Git merge'in otomatik temiz olacağını
göstermez; bu aşamada “README conflict çözüldü” denmiyor.

Daha sonra onaylı PR/aday dalda:
- Ref'leri yeniden doğrulayın.
- README çakışma bölgesini güncel aday ve arşivle karşılaştırarak çözün.
- Çalışan Local/API ve üç terminal açıklamalarını koruyun.
- Görevlendirme/tarihsel açıklamayı uygulamanın güncel özellikleriyle karıştırmayın.
- Birleşik kodun regresyonlarını tekrar çalıştırın.

Bu belge veya README, commit/push/merge için otomatik izin vermez.
