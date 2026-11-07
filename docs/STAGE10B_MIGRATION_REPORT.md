# Aşama 10B — Onaylı SQLite geçiş denemesi ve güvenli geri dönüş

Tarih: 7 Kasım 2026 (Europe/Istanbul).

## Son karar

**Geçiş tamamlanmadı; yeni ortam kullanıma hazır değildir.** Yeni ortamda tüm
istenen testler geçtikten sonra son dosya yolu denetiminde `backend/.venv`
bulunamadı ve taşınmış eski ortamın dosya manifesti değişmişti. Kullanıcının
başarısızlık koşulu uygulanarak bağımsız, doğrulanmış yedekten eski ortam özgün
yoluna geri kuruldu. Gerçek veriyle FastAPI veya import worker başlatılmadı.
SQLite 3.49.1 WAL-reset teslim engeli sürüyor.

## Sürümler ve kurulum yöntemi

| Durum | Python | Python sqlite3 | Konum |
| --- | --- | --- | --- |
| Başlangıç | 3.13.5 | 3.49.1 | backend/.venv |
| Testleri geçen aday | 3.13.18 | 3.53.1 | Deneme sırasında backend/.venv |
| Geri dönüş sonrası etkin ortam | 3.13.5 | 3.49.1 | backend/.venv |

Aday CPython, uv 0.13.7 ile kalıcı `backend/var/runtime/` altına kuruldu;
macOS sistem Python'u ve PATH değiştirilmedi. Yeni venv gerçek proje yolunda
oluşturuldu; taşınmış bir venv aday olarak kullanılmadı. Editable backend gerçek
proje dizinine bağlıydı. Eski ortamdaki 38 benzersiz paketin sürümleri korundu
(39 distribution metadata kaydı; projeye ait bir yinelenen kayıt vardı).
SQLAlchemy 2.0.57 / sqlite+pysqlite kullanıldı. Pip güncellemesi SQLite
güncellemesi olarak değerlendirilmedi.

## Yedekler ve geri yükleme doğrulaması

Bu makinedeki bağımsız kurtarma dizini:

`~/Library/Application Support/GeoJSONEditor/Recovery/<geçiş-yedeği>/`

- `venv-copy/`: eski .venv'in tam kopyası. 6.235 dosya/dizin/sembolik bağ girdisi;
  içerik SHA-256, dosya boyutu, izin ve bağ hedefi kontrolleri özgün manifestle
  eşleşti. Desktop dışına ikinci kez kopyalandı ve yeniden doğrulandı.
- `database/projects.db`: SQLite Connection.backup API ile alınmış tutarlı yedek.
  Kaynak bağlantısı salt okunurdu; canlı DB dosyasını yalın kopyalama yöntemi
  kullanılmadı. İlgili import dosyaları da `database/imports/` içinde korundu.
- `venv-manifest.json`, `database-manifest.json`, `backup-verification.json`,
  `pre-migration-environment.json`: doğrulama ve başlangıç kayıtları.
- `test-evidence/`: yeni ortamın test logları ve geçici DB dayanıklılık sonuçları.
- `recovery-state.json`: geri dönüş sonucu.

İlk yedek ayrıca Git tarafından dışlanan
`backend/var/runtime-backups/<geçiş-yedeği>/` altında korundu.
Bu dizindeki `retired-original-venv/` manifesti bozulduğu için kurtarma kaynağı
olarak kullanılmadı. Buradaki eski `migrate-control.py` yeniden çalıştırılmamalı;
kontrol betiğinin varsaydığı dizin durumu artık geçerli değildir.

Geçişten önce hem yedek Python'un çalışması hem SQLite yedeğinin geçici bir
kopyadan açılması doğrulandı. Tüm tablo/satır içerik özetleri kaynakla eşleşti;
`integrity_check=ok`, foreign_key_check boş, rtreecheck sonucu `ok` idi.
Geri dönüşte kullanıcı DB'sine restore yapılmadı; yalnız Python ortamı geri kuruldu.
Geri dönüş sonrası `test_health.py`, `test_database.py`, `test_migrations.py`
çalıştırıldı: **18 başarılı, 0,43 saniye**. Bunlar eski ortamı doğrulayan
ek testlerdir; SQLite sürüm güvenliği engelini ortadan kaldırmaz.
Bu testlerde de gerçek kullanıcı DB'sini açmayı engelleyen audit kancası kullanıldı.

## Yeni ortamda gerçekten çalıştırılan testler

| Kontrol | Sonuç |
| --- | --- |
| Backend Pytest | 315 başarılı, 16,61 saniye |
| Gerçek HTTP ve Chrome entegrasyon paketi | 8 başarılı, 47,58 saniye |
| Ek API/worker dayanıklılık matrisi | Başarılı, 36,41 saniye |
| Alembic upgrade head, geçici DB | 0003_spatial_index |
| SQLAlchemy DBAPI | sqlite3.dbapi2 / SQLite 3.53.1 |
| WAL / foreign_keys / busy_timeout | wal / 1 / 5000 ms |
| Integrity / foreign key / R-Tree | ok / ihlal yok / ok |
| Yedek DB'nin geçici kopyada okunması | Bütünlük kontrolleri başarılı |
| Gerçek backend yolunda Python/paket kontrolü | Başlangıçta başarılı; final yol kontrolü başarısız |

Entegrasyon paketi proje oluşturma, kaydetme, yeni repository ile yeniden açma,
yeniden kaydetme, snapshot izolasyonu, büyük sayısal ID/property koruması ve
bekleyen tablo değişikliği sırasında doğrudan Kaydet senaryolarını kapsadı.
Kaydetme yarışı 0/200/650 ms kontrollü gecikmelerle sınandı.

Ek matris: 100 ardışık güncelleme 2,49 saniye; 8 eşzamanlı mutation için 1 adet
200 ve 7 adet 409; iki eşzamanlı proje kaydı için 200/409; 36 eşzamanlı okuma
başarılı. 50 MB import 500 Feature sonrasında iptal edildi; bozuk son kayıt
16.000 Feature sonrasında reddedildi. Worker SIGKILL/yeniden başlatma ve snapshot
sırasında API SIGKILL durumlarında önceki veri/snapshot korundu. Her kontrol
sonrasında integrity, FK ve R-Tree tutarlılığı doğrulandı.

Yeni ortamın 205 gözlenen Python alt süreç başlangıcı 3.13.18 / 3.53.1 idi.
Test audit kancası gerçek kullanıcı DB'sine erişimi engelledi; gerçek DB açma
denemesi görülmedi. Sahte koruma dosyasıyla engelleme ayrıca sınandı.

Frontend birim testleri ve build bu geçiş denemesinde tekrar çalıştırılmadı;
önceki 10B sonuçları bu denemenin yeni testi olarak sayılmaz. Gerçek Chrome
senaryoları yukarıdaki 8 entegrasyon testine dahildir.

## Son kontrol hatası ve geri dönüş

İlk kurulum/sürüm/paket kontrolleri ile testler geçtikten sonra:

- `backend/.venv` yolu artık yoktu.
- Taşınmış eski dizinde manifestin 1.696 girdisi eksik, 6.277 ek girdi vardı;
  ortak girdilerin 1.809'unda fark görüldü. `bin 2` adlı ek klasör de vardı.
- Bağımsız `venv-copy` ise 6.235 girdinin tamamında özgün manifestle eşleşiyordu.

**Kök neden kanıtlanmadı.** Sistemde iCloud/FileProvider işlemlerinin görülmesi
tek başına dosya değişikliğinin nedenini kanıtlamaz. Sorun uygulamanın işlevsel
bir test başarısızlığı olarak veya kesin bir bulut senkronizasyon hatası olarak
sunulamaz. Son yerleşim ve geri dönüş denetimi başarısız olduğu için geçiş kabul
edilmedi.

Doğrulanmış bağımsız kopya önce Desktop dışında güvenli dizine kopyalandı,
yeniden karşılaştırıldı; ardından eski ortam `backend/.venv` yoluna doğrudan
kopyalandı. Aynı 6.235 girdilik manifest tekrar eşleşti. Python 3.13.5 /
SQLite 3.49.1 ve özgün executable/prefix doğrulandı. Yeniden adlandırma yoluyla
tekrar geçiş denenmedi. Başarısız taşınmış dizin inceleme için korundu.

## Kullanıcı verilerinin korunması

Backup API yedeğinin tablo özetleri kaynakla eşleşti. Son kontrolde gerçek `projects.db` ve `projects.db-wal`
dosyalarının SHA-256 ve boyutları başlangıçla birebir eşleşti. Kullanıcı
veritabanında test verisi oluşturulmadı, migration/test çalıştırılmadı, veri
silinmedi veya yedekten DB üzerine yazılmadı.

SQLite'ın salt okunur WAL bağlantısı SHM eşgüdüm alanını güncelledi; bu nedenle
SHM dosyasının byte düzeyinde değişmediği iddia edilmez. WAL/SHM dosyaları elle
silinmedi. Yedekler Git'e eklenmedi. Başlangıçta ve geri dönüş öncesinde proje
API/worker işlemleri ve kullanıcı DB'si açık dosya tanıtıcıları kontrol edildi;
bulunmadı. Bazı korumalı macOS servislerinin dosya listesi işletim sistemi
izinleri nedeniyle okunamadı.

## Mac üzerinde şimdi yapılacaklar

Gerçek kullanıcı verisiyle API/worker'ı yeniden başlatmayın: güvenli SQLite
ortamına kalıcı geçiş halen açıktır. Etkin eski ortamı yalnız doğrulamak için
proje kökünde:

~~~bash
backend/.venv/bin/python -c 'import sys,sqlite3; print(sys.executable); print(sys.version); print(sqlite3.sqlite_version)'
git status -sb
~~~

Beklenen sürümler şimdilik 3.13.5 / 3.49.1'dir; bu sürümler teslim onayı değildir.
Yeni geçiş için mevcut dizinin beklenmedik değişme nedeni ve kalıcı runtime
konumu önce değerlendirilmelidir. Çalışan sistem Python'u değiştirilmemelidir.

Eski ortam geri yüklenmiş olduğu için ek geri dönüş komutu gerekmez. Gelecekte
tekrar kurtarma gerekirse önce tüm API/worker işlemleri durdurulmalı, mevcut
ortam ayrı bir konumda korunmalı, Desktop dışındaki `venv-copy` manifesti
doğrulanmalı ve kopya özgün `backend/.venv` yoluna geri konmalıdır. Başka yoldaki
venv'in console script ve editable kurulumlarının taşınabilir olduğu varsayılmaz.
Kullanıcı DB'si bu ortam geri dönüşünün parçası olarak değiştirilmemelidir.

## Git ve belgeler

Dal `abdullah-backend`, upstream `origin/abdullah-backend`, HEAD `bbf17d2`.
Commit, push, fetch, pull, merge, rebase ve dal değişikliği yapılmadı.
Aşama 10A/10B öncesi 11 bekleyen dosya korundu; tarihsel STAGE10A_REPORT ve
STAGE10B_REPORT içerikleri değiştirilmedi. Bu ek rapor eklendi; README ve SQLite
geçiş rehberindeki güncel durum notları düzeltildi. Uygulama kaynak kodunda
bu geçiş sırasında değişiklik yapılmadı. .venv, backend/var, SQLite, yüklemeler
ve yedekler Git'e eklenmedi.

Son bağımsız doğrulama: eski ortamın ve Desktop dışındaki yedeğin 6.235 girdisi
özgün manifestle eşleşiyor; tüm eski paket sürümleri geri gelmiş durumda.
`git diff --check` başarılı, staging alanı boş, HEAD bbf17d2 değişmedi.
Geçiş öncesindeki 11 dosyaya yalnız yeni geçiş raporu eklendi (12 ilgili dosya).
Kaynak DB/WAL hashleri tekrar eşleşti; proje API/worker işlemleri kapalı.
