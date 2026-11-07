# Aşama 10B — Teslim engellerini güvenli ele alma

Tarih: 6 Kasım 2026. Ürün tabanı: bbf17d2, abdullah-backend.
**Asıl .venv'e otomatik geçiş yapılmadı. Kullanıcı onayı bekleniyor.**

| Konu | Son durum |
| --- | --- |
| P1 SQLite | Düzeltmeli Python/SQLite çözümü izole ortamda uygulandı ve test edildi. Mevcut geliştirme .venv'i hâlâ 3.49.1; asıl ortam geçişi tamamlanmadı. |
| P2 mobil proje UI | CSS düzeltildi; iki tema, 320–1400 px, metin kontrastı/sığma ve mobil proje işlemleri geçti. |
| README | Kök README birleştirilmiş aday olarak hazır; özgün frontend metni arşivlendi. Gerçek Git merge/conflict çözümü yapılmadı. |

## 1. SQLite güncellemesinin mevcut durumu

Mevcut .venv'e paket kurulmadı, klasör taşınmadı/yeniden oluşturulmadı, macOS
Python'u değiştirilmedi. Ayrı tooling venv'ine uv 0.13.7 kuruldu; özel geçici
dizine CPython 3.13.18 indirildi. --no-bin ve özel install/cache dizinleri
kullanıldı; PATH veya varsayılan Python bağlantısı değiştirilmedi.

Yeni venv, proje kaynaklarının **Git çalışma ağacı olmayan geçici kopyasında**
kuruldu. Bu kopya mevcut dalın çalışma dosyalarını ve son CSS'yi içerir; .git,
kullanıcı DB'si, .env, yüklemeler ve gerçek .venv kopyalanmadı. Test kopyasının
backend/.venv yolu yeni izole venv'e bağlandı. Böylece mevcut E2E testlerinin
Python yolu değiştirilmeden yeni runtime ile gerçekten çalışması sağlandı.

**P1 için izole çözüm başarılıdır; mevcut geliştirme ortamının güvenlik
geçişi tamamlandı denmiyor.** Geçici runtime kalıcı kurulum kabul edilmemeli;
onay sonrası kalıcı yerde yeni ortam taze oluşturulmalıdır.

## 2. Python'un kullandığı gerçek SQLite sürümü

| Ölçüm | Mevcut | İzole aday |
| --- | --- | --- |
| Python | 3.13.5 | 3.13.18 |
| Çalıştırılan yol | Proje köküne göre backend/.venv/bin/python | Test dizinindeki runtime-venv/bin/python |
| Base Python | /Library/Frameworks/Python.framework/Versions/3.13/bin/python3.13 | cpython-3.13.18-macos-aarch64-none/bin/python3.13 |
| sqlite3.sqlite_version | **3.49.1** | **3.53.1** |
| SELECT sqlite_version() | 3.49.1 | 3.53.1 |
| _sqlite3 konumu | Framework lib/python3.13/lib-dynload/_sqlite3.cpython-313-darwin.so | built-in modül; ayrı _sqlite3.so dosyası yok |
| SQLAlchemy DBAPI | sqlite3.dbapi2 | sqlite3.dbapi2, SQLite 3.53.1 |
| SQLAlchemy sürümü | 2.0.57 | 2.0.57 |
| DB URL | sqlite+pysqlite | Aynı |

Mevcut uzantıda otool -L ve uzantının kendi sqlite3_libversion sembolü/dladdr
incelendi: SQLite 3.49.1 kodu uzantı imajının içindedir; yalnız sistem CLI'sını
değiştirmek bu modülü değiştirmez.

Aday SQLite source ID:
~~~text
2026-05-05 10:34:17 c88b22011a54b4f6fbd149e9f8e4de77658ce58143a1af0e3785e4e6475127e9
~~~

CLI ayrıca ölçüldü: /opt/anaconda3/bin/sqlite3 **3.51.0**. Bu değer Python
sqlite3 sürümü olarak kullanılmadı. Yeni süreçte genel C sembol araması da
ayrı bir 3.51.0 sembolü görebildi; built-in modülün kullandığı SQLite'a karar
vermek için bu genel sembol yerine standart DBAPI ve gerçek SQL sorgusu esas
alındı. İkisi de 3.53.1 döndü; bağlantı uyumluluk ölçümü kaydedildi.

## 3. Önerilen ve test edilen güvenli yöntem

CPython **3.13.18**, Astral python-build-standalone **20261026**, macOS arm64
dağıtımı uv 0.13.7 ile indirildi. Bu, Python patch sürümü ve dağıtım sağlayıcısı
değişikliğidir. Aynı 3.13 hattı korunarak mevcut proje bağımlılıkları yeni venv'e
kuruldu. [uv Python yönetimi](https://docs.astral.sh/uv/guides/install-python/).

SQLite'ın resmi notlarında WAL-reset düzeltmesi 3.51.3 ve sonraki sürümlerdedir;
bazı eski dallara da backport sağlanmıştır. Adaydaki 3.53.1 bu koşulu karşılar.
[SQLite 3.51.3](https://sqlite.org/releaselog/3_51_3.html),
[WAL açıklaması](https://sqlite.org/wal.html).

- Backend URL, session/transaction, WAL, FK ve busy timeout kodu değiştirilmedi.
- SQLAlchemy bağlantısında journal_mode=wal, foreign_keys=1,
  busy_timeout=5000 ve Alembic head=0003_spatial_index doğrulandı.
- Yeni venv'de çözümlenen 33 Python paket sürümü
  backend/constraints/sqlite-runtime-10b.txt dosyasına kaydedildi.
  Dosya SQLite'ı değiştiren bir pip paketi değildir; seçilmiş Python ile
  kullanılacak bağımlılık kısıtlarıdır.
- Paket kurulumu eski ortam sürümleriyle sınırlandırıldı; yeni ortam taze
  pyproject + dev kurulumu olduğundan eski venv'in birebir klasör kopyası değildir.
  uv pip check uyumlu 34 paket gördü (proje dahil).
- Geçici gözlem modülü, test Python süreçlerinin standart sqlite3 sürümünü
  kaydetti ve eski sürüm seçilirse test sürecini durduracak kontrol içerdi.
  Gözlenen süreç kayıtları 3.13.18 / 3.53.1 idi. Bu gözlem ürün koduna eklenmedi.

Detaylı, yeniden üretilebilir komutlar ve onaylı geçiş/geri dönüş sırası:
[SQLITE_RUNTIME_UPGRADE.md](SQLITE_RUNTIME_UPGRADE.md).

### Asıl ortam için henüz yapılmayan adım

Kalıcı Python kurulumundan sonra mevcut .venv'in **tam yedeği korunarak**
özgün yolda yeni venv oluşturulması öneriliyor. Venv'i kopyalayıp taşımak,
mutlak interpreter/shebang yolları nedeniyle yöntem olarak kullanılmamalı.
Kullanıcı servisleri güvenli durdurulmalı, gerçek DB yedeği ayrı restore
kopyasında doğrulanmalı; sonra onaylı geçiş yapılmalı.

Geri dönüş: servisler durmuşken başarısız yeni venv'i tanılama için korumak,
eski venv'i özgün backend/.venv yoluna geri koymak. Kullanıcı DB'sinin üstüne
otomatik yedek yazılmaz ve WAL/SHM elle silinmez. Eski runtime'a dönmek eski
SQLite riskini de geri getirir; kalıcı çözüm değildir.

Bu aşamada gerçek .venv'in tam yedeği alınmadı; çünkü kendisi değiştirilmedi.
Gerçek kullanıcı DB'si için de backup/restore uygulanmadı. Bunlar asıl geçişin
onay sonrası adımlarıdır.

## 4. Kullanıcı verilerinin korunması ve SQLite kontrolleri

Gerçek kullanıcı DB'si test amacıyla açılmadı, yeni runtime'a bağlanmadı,
silinmedi veya resetlenmedi. WAL/SHM ve kayıtlı projeler üzerinde işlem yapılmadı.
Kullanıcının açık API/worker süreçleri durdurulmadı. journal_mode değiştirilmedi.

Bütün migration/API/worker senaryoları geçici DB'lerdeydi. Yeni ortamda 35,07 sn
süren dayanıklılık koşusu şunları doğruladı:

- 10 MB / 16.320 Feature importu, 100 güncelleme, silme ve aynı kimlikle restore.
- Aynı revision ile sekiz eşzamanlı mutation: 1×200, 7×409.
- Aynı project.version ile iki kayıt: 1×200, 1×409.
- 36 eşzamanlı okuma: tamamı 200.
- 422'de eski dataset'in korunması.
- 50 MB importun 500 Feature sonrası iptali; staging temizliği ve eski dataset.
- Sonu bozuk dosyanın reddi; tamamlanmamış verinin etkinleşmemesi.
- Worker SIGKILL / lease sonrası yeniden başlatma ve güvenli temizlik.
- Import sürerken proje değişiminden sonra eski job aktivasyonunun 409 olması.
- Snapshot transaction'ı sırasında geçici API SIGKILL; yeniden açmada önceki
  version/snapshot/workspace'in korunması.

İptal/bozuk dosya/yeniden başlatmalar sonrası:
integrity_check=ok, foreign_key_check=[], rtreecheck=ok;
eksik/fazla R-Tree satırı=0.

Yeni SQLite ile backup API'si kullanılarak ayrı kopya ve restore üretildi.
48.960 Feature, üç dataset, proje/job/kategori ve R-Tree gölge tabloları dahil
bütün tablo hash'leri eşleşti. SQLAlchemy uyumluluk ve backup raporu kaydedildi.
Yeni SQLite'ın ürettiği kapalı test kopyası eski SQLite 3.49.1 ile salt okunur
da açıldı; integrity/FK/R-Tree geçti. Bu sınırlı geri okuma kontrolü her gelecekteki
şema/veri değişikliğine geriye uyum garantisi vermez.

Özel WAL-reset yarışını SQLite kaynaklarına test hook'u ekleyerek tetiklemedik.
Düzeltmeli sürüm kullanımı ile normal WAL/eşzamanlılık/kesinti testleri birlikte
değerlendirildi; fiziksel güç kesintisi testi yapılmadı.

## 5. Mobil tema düzeltmesi

Değişen tek frontend kaynağı:
src/components/projects/projects.css.

Kök neden, sabit koyu başlık içindeki proje bileşeninin aydınlık --ink rengini
miras almasıydı. Ayrıca başlığın secondary düğme rengi ve dar ekran 30 px düğme
genişliği açılır menü/diyaloglara da sızıyordu.

Küçük, proje bileşenine özel CSS kurallarıyla:
- Projeler summary rengi başlığın mevcut #dbe9ec metin paletiyle eşleştirildi.
- Popup/diyalog secondary düğmeleri kendi panelinin --ink / --line rengini kullanır.
- Popup düğmeleri tam genişlikte okunur satırlara yerleşir; diyalog düğmeleri
  içeriğine göre genişler. Başlığın asıl masaüstü butonları değiştirilmedi.
- 680 px altında popup sola hizalanarak 320 px'te ölçülen -6,98 px sol taşma giderildi.

İlk ek testte 320 px taşma bulundu; sonradan görsel kontrolde popup düğmelerinin
üst üste gelen metinleri de görüldü. Düzeltme sonrası yalnız renk değil,
metnin kesilmeden sığması ve menü sınırları da tekrar doğrulandı.

### Ölçülen son sonuçlar

| Kontrol | Sonuç |
| --- | --- |
| Temalar | Koyu + aydınlık |
| Genişlikler | 320, 390, 680, 768, 1024, 1200, 1400 px |
| Projeler etiketi | İki temada yaklaşık **13,11:1** |
| Açık popup düğmeleri | En düşük **4,57:1**; 36 görünür düğme kontrolü |
| Etiket görünürlüğü | 1200 ve altında menü; 1400'de mevcut masaüstü araçları |
| Menü sınırları / metin sığması | Başarılı; yatay taşma ve kesilen düğme metni yok |
| Proje işlemleri | Mobil Kaydet ve Projelerim iki temada başarılı; tam kayıt/açma/silme regresyonu mevcut E2E paketinde geçti |
| Local | Proje ekranları görünmedi; mevcut davranış korundu |

Normal metinde AA hedefi 4,5:1 olarak alındı.
[W3C Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
Bu sonuç proje menüsü kapsamındadır; uygulamanın tamamı için WCAG uygunluk
sertifikası veya fiziksel mobil cihaz testi değildir. Gerçek Chrome emülasyonu
ve ekran görüntüleri kullanıldı; sabit bekleme ile renk geçişi gizlenmedi,
CSS animasyonlarının tamamlanması beklendi.

## 6. README birleştirme hazırlığı

Mevcut ref'ler incelendi; bu aşamada fetch yapılmadı:

| Ref | Commit |
| --- | --- |
| origin/main | 9c4ed5cb59f79134d906e90fd8737fbf17f2bd28 |
| origin/abdullah-backend | bbf17d2405b10fdcda898224af703fc997bf6fe3 |
| origin/gamze-harita-arayuz | 98509dc16582c4eff803a958713e7e5b40f748c5 |

Anlık GitHub güncelliği bu aşamada doğrulanmadı. Ref'ler 10A fetch'inden kalır;
yeni remote commit olmadığı garanti edilmez.

Çalışma ağacındaki **README.md, birleştirilmiş adaydır**. 10A'nın güncel backend,
Local/API, Mac üç terminal, test, yedekleme ve doküman bağlantıları korundu.
Gamze'nin ayrıntılı frontend kullanım notları eklendi; özgün README gövdesi
docs/archive/FRONTEND_README_98509dc.md içinde Git blob/SHA-256 bilgisiyle eksiksiz
arşivlendi. Arşivdeki “backend yok” ifadeleri tarihsel kod bloğundadır.

[README_MERGE_PLAN.md](README_MERGE_PLAN.md) hangi içeriğin korunduğunu açıklar.
10A'daki README conflict önizlemesi gerçek merge ile çözülmedi; aday hazırlığı
tamamlandı diye Git conflict'in otomatik kalktığı söylenmez. main veya Gamze
dalı değiştirilmedi; WORK_PLAN.md geri getirilmedi.

## 7. Güncel test sonuçları

Tüm ürün testleri bu aşamada izole kaynak kopyasında, son CSS ile çalıştırıldı.
Yeni backend runtime kullanımı ayrıca standart DBAPI/SQL ölçümüyle doğrulandı.

| Paket | Sonuç |
| --- | --- |
| Backend pytest | **315 geçti**, 14,17 sn; yeni Python/SQLite |
| Standart frontend | **147 geçti**, 1 koşullu perf testi bu komutta atlandı; son koşu 4,29 sn |
| Koşullu büyük dosya testi | 10.000.053 byte / 13.235 Feature / 66.176 vertex büyük ID fixture'ında başarılı |
| Frontend toplam benzersiz test | **148 geçti** (147 + ayrı koşullu test); tekrar koşular sayıyı artırmaz |
| Gerçek HTTP/Chrome | **8 geçti**, son koşu 43,55 sn; 3 HTTP + 5 Chrome vakası |
| Ek tema kabulü | Local/API iki senaryo başarılı; iki tema ve yedi genişlik |
| TypeScript + Local build | Başarılı; Vite 3,08 sn |
| TypeScript + API/proje bayrağı açık build | Başarılı; Vite 4,86 sn |
| Yeni ortam dependency check | Başarılı |
| SQLite migration / WAL / FK / R-Tree / backup/restore | Başarılı; yalnız geçici DB'ler |

- Proje kaydetme/yeniden açma, bağımsız snapshot ve 409 testleri yeni runtime'da geçti.
- 9007199254740993 ve diğer hedef sayılar Local/API get/mutate/export,
  JSON/tablo, snapshot ve yenileme/açmada kayıpsız kaldı. Kontrol JS Number
  karşılaştırmasına indirgenmedi; özgün token, bigint ve SQLite/Python sayısı kullanıldı.
- Bekleyen tablo düzenlemesi testinde 0/200/650 ms deterministik kapı,
  çift Kaydet, HTTP hücre hatası, korunmuş taslak/tekrar dene ve proje değiştirme geçti.
- Yeni framework bağımsız olduğu için macOS sistem Python'u test sırasında değişmedi.

Koşullu 10 MB testi Node + fake-indexeddb'dir; gerçek Chrome hız testi değildir.
Bu aşamada 100/200 MB performans matrisi, başka işletim sistemi veya fiziksel
mobil cihaz kabulü yeniden yapılmadı. 10A/9A sonuçları yeni SQLite sürümüyle
yeniden ölçülmüş gibi sunulmuyor. Başlangıçta bulunan görsel/320 px başarısız
kontroller düzeltilip yeniden geçti; son zorunlu paketlerde açık test hatası yok.

Kanıtlar 10B denemesine ayrılan geçici dizinde tutuldu.
Başlıca dosyalar: original-sqlite.json, candidate-sqlite.json,
candidate-linkage.json, python-download-manifest.json, runtime-processes.jsonl,
runtime-audit.json, backend.log, frontend-release.log, integration-release.log,
large-integers.log, build-local-release.log, build-api-release.log,
theme-release-results.json, durability-results.json, compatibility-backup.json,
rollback-read-check.json. Görsel test ekran görüntüleri de bu dizindedir.
Geçici çıktılar, indirilen Python/venv ve DB'ler Git'e eklenmedi.

## 8. Değiştirilen dosyalar

10A'dan kalan beş belge korundu:
README.md, backend/README.md, docs/API_MODE.md, docs/RUNBOOK.md,
docs/STAGE10A_REPORT.md. Kök README mevcut içerik korunarak genişletildi;
diğer dört belgenin 10A içeriği değiştirilmedi.

10B kapsamında:
- README.md — güncel runtime notu ve frontend ayrıntıları; merge adayı.
- src/components/projects/projects.css — scoped tema, metin sığması ve dar ekran hizası.
- backend/constraints/sqlite-runtime-10b.txt — 33 test edilmiş paket sürümü.
- docs/SQLITE_RUNTIME_UPGRADE.md — yeniden üretme, onaylı geçiş ve geri dönüş.
- docs/README_MERGE_PLAN.md — ref karşılaştırması ve koruma kararları.
- docs/archive/FRONTEND_README_98509dc.md — özgün README'nin tarihsel arşivi.
- docs/STAGE10B_REPORT.md — bu rapor.

Toplam bekleyen dosya sayısı **11** (README iki aşamada ortak).
Backend uygulama/model/servis, migration, pyproject, React bileşeni, harita,
contracts.ts, INTEGRATION.md ve test kaynakları değiştirilmedi.

## 9. Git durumu

Aktif dal abdullah-backend, upstream origin/abdullah-backend, HEAD bbf17d2.
Stage alanı boş. Commit/push/fetch/merge/rebase veya checkout yapılmadı.
main ve gamze-harita-arayuz değiştirilmedi. Yeni kaynak ve belgeler henüz
commit edilmedi; runtime, DB, WAL/SHM, .env, node_modules ve geçici çıktılar
izlemeye alınmadı.

## 10. Mac üzerinde yapılacaklar ve onay noktası

1. Önce yeni [SQLite geçiş rehberini](SQLITE_RUNTIME_UPGRADE.md) ve README adayını okuyun.
2. İsterseniz rehberdeki ayrı /private/tmp ortamıyla çözümü yeniden deneyin;
   mevcut kullanıcı DB yolunu kullanmayın. Geçici ortamı kalıcı saymayın.
3. Asıl geçiş için kalıcı yeni Python, tam eski .venv yedeği, kullanıcı DB
   yedeği/restore kontrolü, taze venv kurulumu ve geri dönüş sırasını onaylayın.
4. Onay sonrası yeni .venv ile testleri tekrar geçici DB'de doğrulayıp kullanıcı
   servislerini kontrollü başlatın. Worker ve Vite'ı yeniden başlatıp tarayıcıyı
   tam yenileyin; yalnız pip güncellemesine veya sqlite3 CLI sürümüne güvenmeyin.
5. Açık/koyu mobil menü, proje kaydet/aç, büyük ID export'u ve Enter'sız tablo
   Kaydet akışını Mac'te son kez doğrulayın.
6. Gerçek README merge'i ve commit/push ayrı onaylı iş olarak ele alınmalı.

**Son durum:** İzole SQLite çözümü ve CSS düzeltmesi test edildi; README adayı
hazır. Mevcut geliştirme .venv'inin 3.49.1'den geçirilmesi kullanıcı talimatının
2. bölümü uyarınca **onay bekliyor**. Bu adım uygulanmadan bütün teslim
engellerinin kalktığı iddia edilmiyor.
