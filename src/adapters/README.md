# Adaptör sınırı

`local/`, Gamze'nin arayüzünün sunucu beklemeden çalışması için tarayıcıda kullanılan geçici çalışma adaptörüdür. Dosya okuma, IndexedDB geçici alanı, görünür şekil sorguları ve dışa aktarma burada bulunur. Bunlar ikinci geliştiricinin sunucu teslimatı değildir.

İkinci geliştiricinin API, kalıcı veritabanı, proje kaydı, sunucuda büyük dosya işleme, sunucu mekânsal sorguları, yetkilendirme ve topolojik doğrulama kodu henüz yazılmadı. Yeni sunucu adaptörü `GeoJsonRepository` sözleşmesini uygulayıp `src/data/createRepository.ts` üzerinden bağlanacaktır. API adresi veya sunucu/veritabanı teknolojisi burada belirlenmemiştir.

Arayüzü sunucuya geçirmek için `local/` dosyalarını değiştirmek gerekmez. Bu klasörü kaldıracaksanız önce aynı sözleşmeyi sağlayan adaptörü fabrikaya bağlayın; aksi halde dosya açma, çizim kaydı, kategori ataması ve dışa aktarma çalışmaz.
