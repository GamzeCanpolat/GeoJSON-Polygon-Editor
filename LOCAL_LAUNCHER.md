# macOS Local başlatıcı

## İlk kurulum

Node.js 22.12 veya üzeri ve npm gerekir. Projeyi iCloud Desktop/Documents dışında, örneğin
~/Developer altında tutabilirsiniz. Yeni bir kurulum için hedef klasörün boş olduğunu kontrol edin.

~~~bash
mkdir -p "$HOME/Developer"
git clone https://github.com/GamzeCanpolat/GeoJSON-Polygon-Editor.git "$HOME/Developer/GeoJSON-Polygon-Editor"
cd "$HOME/Developer/GeoJSON-Polygon-Editor"
npm ci
"./GeoJSON Editor.command"
~~~

npm ci, package-lock.json dosyasındaki sürümleri kurar. Başlatıcı Vite ve TypeScript kullandığı
için geliştirme bağımlılıkları da kurulmalıdır. npm ci --omit=dev bu kullanım için yeterli değildir.
Başlatıcı her açılışta paket kurmaz.

## Günlük kullanım ve Finder arması

Finder’da proje klasöründeki GeoJSON Editor.command dosyasına çift tıklayın.
İlk açılışta TypeScript kontrolü ve Local derlemesi yapılır. Hazır mesajından sonra
varsayılan tarayıcı http://127.0.0.1:5173 adresinde açılır. Terminal penceresi açık kalır.
Kapatmak için bu pencerede Ctrl+C kullanın.

Masaüstü kısayolu oluşturmak için başlatıcıya sağ tıklayıp Arma Yap veya Takma Ad Yarat
seçeneğini kullanın. Oluşan oklu simgeyi masaüstüne sürükleyin. Armanın adını
istediğiniz gibi değiştirebilirsiniz. Proje klasörünü taşıyacağınız zaman önce
sunucuyu kapatın. Taşıma sonrasında arma hedefini Finder’daki Bilgi Ver ekranından
kontrol edin, gerekirse yeni konumdan yeniden arma oluşturun.

Başlatıcı kendi dosya konumundan proje kökünü bulur. Klasör adlarında boşluk olabilir.
Çalıştırma izni aktarım sırasında kaybolduysa, kaynağını doğruladığınız başlatıcı için
proje klasöründe şu komutu kullanabilirsiniz.

~~~bash
chmod +x "GeoJSON Editor.command"
~~~

macOS “hasarlı” veya güvenlik uyarısı gösterirse uyarının metnini ve dosyanın kaynağını
inceleyin. Güvenilir kaynaktan temiz clone ve npm ci ile yeniden kurulum yapın.
Bir güvenlik istisnası gerekiyorsa güvenilirlik kontrolünden sonra ayrıca değerlendirin.
Toplu quarantine kaldırma, Gatekeeper’ı kapatma veya sahte imza bu kurulumun parçası değildir.

## Derleme ve önbellek

Başlatıcı VITE_DATA_SOURCE=local ve VITE_PROJECT_MANAGEMENT=false değerleriyle çalışır.
Derleme, node_modules/.cache/geojson-local/dist altında saklanır. Giriş dosyalarının
parmak izi ve üretilen bütün dosyaların SHA-256 değerleri kontrol edilir.

Kaynaklar aynı ve çıktı dosyaları sağlamsa mevcut derleme kullanılır. Eksik/değiştirilmiş
çıktı, bozuk manifest veya kaynak değişikliği yeniden derleme başlatır. Başarısız derleme
sonrasında uygulama açılmaz. Yeni derleme başarılı olunca manifest atomik olarak yazılır.

Bu alan başlatıcının ürettiği dosyalara ayrılmıştır. Kullanıcı dosyalarını burada saklamayın.
Normal npm run build çıktısı proje kökündeki dist klasöründedir. Local başlatıcının çıktısı
ile API derlemesinin çıktısı ayrı konumlarda tutulur. Tarayıcıya Cache-Control no-store
başlığı gönderilir. Derlenmiş Local uygulama Vite’ın geliştirme amaçlı .vite/deps
önbelleğini kullanmaz.

Sunucu yalnızca 127.0.0.1 üzerinde çalışır. Port 5173 başlatma ve derleme boyunca
rezerve edilir. Port doluysa açıklayıcı hata verilir. Portu kullanan uygulamayı kendi
penceresinden kapattıktan sonra yeniden deneyin. Ctrl+C, başlatıcıyı ve varsa
TypeScript alt sürecini kapatır.

## Geliştirme ve API modu

Kod geliştirirken Vite geliştirme sunucusunu kullanın.

~~~bash
VITE_DATA_SOURCE=local npm run dev -- --port 5173 --strictPort
~~~

API ve proje yönetimi için [RUNBOOK](docs/RUNBOOK.md#üç-terminalle-başlatma)
komutlarını kullanın. Local başlatıcı açılınca API ekranlarının gelmesi beklenmez.

Geliştirme sunucusunda “.vite/deps dosyası bulunamadı” hatası görülürse önce sunucuyu
kapatın. Kaynakların ve bağımlılık kurulumunun aynı proje klasörüne ait olduğunu kontrol
edin. Gerekiyorsa npm ci çalıştırın ve optimizer’ı yeniden üretin.

~~~bash
VITE_DATA_SOURCE=local npm run dev -- --force --port 5173 --strictPort
~~~

Tarayıcıdaki eski geliştirme sekmesini yenileyin. IndexedDB, site verileri ve kullanıcı
GeoJSON/Excel dosyalarını temizlemeyin. npm audit fix --force başlatıcı hatası giderme
adımı değildir.

## Testler

~~~bash
npm test
RUN_BROWSER_INTEGRATION=1 node node_modules/vitest/vitest.mjs run --config tests/api.integration.config.ts
~~~

tests/unit/macosLauncher.test.ts, Vite ve derleyici sınırlarında küçük test modülleri
kullanarak gerçek ayrı Node süreçlerini çalıştırır. İlk/tekrar açılış, çıktı bozulması,
dolu port, SIGINT, derleme sırasında iptal, taşıma, API çıktı ayrımı, eksik bağımlılık ve
başarısız derlemeden sonra yeniden deneme kontrol edilir.

tests/integration/localLauncher.browser.test.ts, gerçek Vite production derlemesini
geçici Chrome profiliyle üç kez açıp kapatır. Testte rastgele loopback portları
kullanılır. Uygulamanın CLI başlatıcısı 5173 kullanır.
RUN_BROWSER_INTEGRATION seçeneği ve macOS Google Chrome kurulumu bu test için gereklidir.

Finder’da çift tıklama ve varsayılan tarayıcının açılması yeni Mac kurulumunda ayrıca
manuel olarak kontrol edilmelidir. Testler kullanıcının tarayıcı profilini kullanmaz.
