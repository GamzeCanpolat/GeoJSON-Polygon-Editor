# Aşama 10D-4B — Entegrasyon testi kararlılığı

7 Kasım 2026. Entegrasyon adayı mevcut merge durumunda sınandı. Uygulama
kaynakları aynı kaldı. Proje kaydetmeyi doğrulayan Chrome testi daha kesin
bir bekleme koşulu ve API/SQLite kontrolleriyle güncellendi.

## 1. Kök neden ve kalan belirsizlik

Önceki tam pakette (7/8) zaman aşımı, proje adı girilip **Onayla** tıklandıktan
sonra başarı bildirimi beklenirken meydana geldi. Eski logun yakaladığı
bölümde hücre mutasyonu HTTP 200 ve import worker sonucu 5 Feature idi.
Bu bölümde `POST /api/v1/projects` veya bir proje oluşturma yanıtı yok.
Eski test kapanışta kendi geçici DB'sini sildi. Bu nedenle o koşunun
proje ve snapshot satırları sonradan sorgulanamadı. Pencerenin açılmadığına
veya başarının sonradan başka bir bildirimle kapatıldığına dair kanıt yok.

Geçici bir kaynak kopyasındaki kontrollü Chrome deneyinde eski testin
etkinlik kontrolü ile tıklaması arasına hücre kaydını yerleştirdim.
Önce hücrenin GET isteği bekletildi ve Onayla etkin görüldü. GET serbest
bırakılıp hücre mutasyonu bekletilince uygulamanın `editorBusy` durumu
Onayla'yı devre dışı bıraktı. Eski `.click()` bu durumda 0 tıklama
olayı üretti. `POST /projects` sayısı 0, API liste yanıtı 200 ve toplam
proje sayısı 0, SQLite proje satırı 0, başarı bildirimi yoktu. Sayfanın
`performance.timeOrigin` değeri aynı kaldı. Hücre kaydı tamamlanınca
etkin düğmeye tıklamak kaydı ve sonraki senaryoyu tamamladı.

Bu deney testin ayrı kontrol ve tıklama çağrılarından kaynaklanan
yarışı doğruluyor. İlk zaman aşımı koşusunda düğme geçişi ve sayfa
navigasyonu kaydedilmediği için o koşunun kesin zamanlaması bilinmiyor.
Worker'ın importu tamamladığı logda görülüyor. Vite, geçici oturum
paylaşımı veya sayfa yenilemesinin bu zaman aşımını tetiklediğine dair
kanıt bulunmadı. Mevcut testler her vakada ayrı DB, Chrome profili,
portlar ve Vite önbelleği oluşturuyor.

## 2. Değiştirilen dosyalar

- `tests/integration/losslessNumbers.browser.test.ts`
- `docs/STAGE10D_TEST_STABILITY_REPORT.md`

## 3. Uygulanan düzeltme

Chrome testi hücre okumasını ve mutasyonunu protokolde kontrollü
olarak bekletiyor. Böylece Onayla'nın önce etkin, hücre kaydı sürerken
devre dışı olduğu doğrulanıyor. Mutasyon bırakıldıktan sonra formun
güncel submit düğmesi her sorguda yeniden bulunuyor. Etkinlik kontrolü
ve tıklama aynı tarayıcı çağrısında yapılıyor. Mevcut koşul sorgulaması
kullanılıyor. Yeni sabit bekleme, test tekrar ayarı veya atlama eklenmedi.

Kaydetme sırasında oluşturma ve güncelleme yanıtları tarayıcıya
ulaşmadan önce ayrı API ve SQLite kontrolleri yapılıyor. İlgili sürümün
başarı bildirimi yanıt bekletilirken görünmemeli. Yanıt bırakıldıktan
sonra bildirim görülmeli. Bu adımlarda sayfanın kendiliğinden yenilenmediği
de sınanıyor. Kayıt sonucu bildirim metninden bağımsız olarak doğrulanıyor.

## 4. Tekrarlı tarayıcı testleri

Her satır yeni Vitest çalıştırmasıdır. Aşağıdaki DB yolları kayıtların
bulunduğu test köküne göredir. DB sayısı, o koşuda denetim kancasının
gördüğü benzersiz SQLite dosya yollarıdır. HTTP sütunu önce oluşturma
ve güncelleme, ardından her kayıt için liste ve detay okumalarını
gösterir. Ayrıntılı manifest tüm DB yollarını, HTTP kodlarını, snapshot
izlerini, çıkış kodlarını ve log konumlarını içerir.

| Koşu | Sonuç | API Chrome vakasının geçici DB yolu | Ayrı DB | HTTP kayıt; liste; detay | Snapshot sürümleri |
| --- | --- | --- | ---: | --- | --- |
| `focused-01` | Geçti | `focused-01/geojson-browser-KY8om9/projects.db` | 1 | 201/200; 200/200; 200/200 | 1/2 |
| `focused-02` | Geçti | `focused-02/geojson-browser-yep6uQ/projects.db` | 1 | 201/200; 200/200; 200/200 | 1/2 |
| `focused-03` | Geçti | `focused-03/geojson-browser-pprwyB/projects.db` | 1 | 201/200; 200/200; 200/200 | 1/2 |
| `focused-04` | Geçti | `focused-04/geojson-browser-JQW2Go/projects.db` | 1 | 201/200; 200/200; 200/200 | 1/2 |
| `focused-05` | Geçti | `focused-05/geojson-browser-2VoSf8/projects.db` | 1 | 201/200; 200/200; 200/200 | 1/2 |
| `focused-06` | Geçti | `focused-06/geojson-browser-TNknhR/projects.db` | 1 | 201/200; 200/200; 200/200 | 1/2 |
| `focused-07` | Geçti | `focused-07/geojson-browser-Ey1d91/projects.db` | 1 | 201/200; 200/200; 200/200 | 1/2 |
| `focused-08` | Geçti | `focused-08/geojson-browser-l8jObi/projects.db` | 1 | 201/200; 200/200; 200/200 | 1/2 |
| `focused-09` | Geçti | `focused-09/geojson-browser-FvAg7g/projects.db` | 1 | 201/200; 200/200; 200/200 | 1/2 |
| `focused-10` | Geçti | `focused-10/geojson-browser-2CKAQP/projects.db` | 1 | 201/200; 200/200; 200/200 | 1/2 |
| `suite-01` | Geçti · 8/8 | `suite-01/geojson-browser-bnwGmF/projects.db` | 8 | 201/200; 200/200; 200/200 | 1/2 |
| `suite-02` | Geçti · 8/8 | `suite-02/geojson-browser-PoarQ0/projects.db` | 8 | 201/200; 200/200; 200/200 | 1/2 |
| `suite-03` | Geçti · 8/8 | `suite-03/geojson-browser-58OJh9/projects.db` | 8 | 201/200; 200/200; 200/200 | 1/2 |

Odaklı koşular yalnız API büyük ID vakasını seçti. Local vaka bu filtreye
dahil değildi. Üç tam pakette iki mod da çalıştı. Her tam pakette kaydetme
yarışı testi kontrollü 0/200/650 ms gecikmeleri, çift Kaydet, hata sonrası
yeniden deneme ve projeyi yeniden açma senaryolarını doğruladı.

## 5. SQLite snapshot doğrulamaları

Her API Chrome vakasında hücre ve JSON mutasyonları 200 döndü. Proje
oluşturma 201, güncelleme 200 döndü. Liste ve detay okumaları 200 döndü.
API'deki proje kimliği ve sürüm, SQLite'taki kayıt ve snapshot ile
eşleşti. Her iki sürümde de 5 Feature vardı. İncelenen Feature'ın
ID'si `9007199254740993` kaldı. `exact` alanı sürüm 1'de
`9007199254740995`, sürüm 2'de `-9007199254740993` olarak saklandı.
Projeyi yenileme sonrası yeniden açan test, son snapshot'ı ve sayısal
JSON gösterimini tekrar doğruladı. HTTP yanıtları bekletilirken başarı
bildirimi görülmedi, yanıtlar bırakıldığında görüldü.

## 6. Son regresyon sonuçları

| Kontrol | Sonuç |
| --- | --- |
| Frontend | 148/148, sentetik 140.000 poligonlu 96,7 MiB dosya dahil |
| Backend | 315/315, Python 3.13.18 ve SQLite 3.53.1 |
| HTTP/Chrome | 3 bağımsız tam paket, her biri 8/8 |
| TypeScript | `tsc --noEmit` geçti |
| Vite | Local ve API build geçti |
| Mobil tema | Local/API açık ve koyu tema, 320–1400 px Chrome emülasyonu geçti |

Test kayıtları `/private/tmp/geojson-10d4b.JVai3o` altında. `run-evidence.json` ayrıntılı
koşu manifestini, `diagnostic.log` kontrollü eski davranış deneyini,
`runtime-audit.jsonl` geçici SQLite bağlantı kapsamlarını içeriyor.
Denetlenen Python başlangıcı sayısı 610. İzin verilen geçici
kapsamın dışında engellenen SQLite denemesi sayısı 0.
Geçici HTTP/Chrome vaka DB'leri test kapanışında kaldırıldı. Kullanıcı DB'si ve
kurtarma yedekleri test kapsamına alınmadı.

## 7. Entegrasyon dalının Git durumu

- Dal `integration/geojson-release`, HEAD `9c4ed5c`.
- MERGE_HEAD `3fdc18f`, çözülmemiş index girdisi yok.
- Başlangıçtaki staged merge içeriği ve README çözümü aynı. Test
  değişikliği stage edilmemiş, bu rapor yeni ve stage edilmemiş.
- Ana çalışma ağacındaki `abdullah-backend` ucu ve stage edilmemiş
  10D merge prova raporu korundu. `main` ve Gamze referansı aynı.
- Commit, push veya PR oluşturulmadı. Test servisleri durdu.

## 8. Merge commit hazırlığı

Düzeltilen test için 10 bağımsız vaka ve ardından üç tam entegrasyon
paketi geçti. Test kapısı karşılandı. Mevcut staged merge adayına bu
test değişikliği henüz alınmadı. Sonraki onayda ilgili dosyalar gözden
geçirilip stage edildikten ve dal uçları doğrulandıktan sonra merge
commit'i oluşturulabilir. Geçmiş zaman aşımının kesin zamanlamasına
ilişkin belirsizlik bölüm 1'de kayıtlıdır.
