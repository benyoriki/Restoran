# QR Menu & Order — Ayam Kampung Sambal Merintih

> Halaman utama (`index.html`) adalah website rumah makan: menu favorit, promo, cara pesan (scan QR → menu → QRIS → diantar), dan lokasi. Role dibatasi **Owner** dan **Kasir** (Admin & Staf Dapur dihapus). Data menu/harga masih **contoh** — ganti lewat dashboard Owner.

Sistem pemesanan restoran digital: pelanggan scan QR di meja → pilih menu → pesanan masuk ke dapur → kasir mencatat pembayaran → pemilik memantau penjualan, keuangan, dan laporan.

Dibuat dengan **HTML + CSS + JavaScript murni** (tanpa framework, tanpa build). Data disimpan di **LocalStorage** (prototipe), dengan lapisan penyimpanan yang disiapkan untuk diganti ke Firebase.

> Data restoran "Ayam Kampung Sambal Merintih" (Jl. Sabilillah, Citeureup, Bogor) hanyalah **data contoh**. Tidak ada klaim persetujuan dari pemilik restoran. Ganti lewat **Pengaturan → Informasi Restoran** atau **Backup & Data → Mulai dari kosong**.

Dikembangkan oleh **@benyoriki** — https://benyoriki.com

## Struktur file

```
qr-menu-order/
├─ index.html      Landing page / beranda
├─ menu.html       Menu digital pelanggan (hasil scan QR)
├─ order.html      Pelacak status pesanan pelanggan
├─ kitchen.html    Papan Pesanan Masuk untuk Kasir/Owner (kartu berwarna per status)
├─ admin.html      Dashboard admin / kasir / owner (router #/...)
├─ login.html      Login demo
├─ style.css       Sistem desain, komponen, menu pelanggan, landing, dapur
├─ landing.css     Tampilan beranda (ringan, mode hemat otomatis)
├─ dashboard.css   Layout admin, sidebar, tabel, POS
├─ responsive.css  Tampilan HP / tablet / desktop + cetak
├─ storage.js      Store (LocalStorage), data contoh, backup/restore, ImageStore
├─ app.js          Utilitas: toast, modal, form, tabel, tema, auth demo, grafik
├─ menu.js         Menu, promo, harga, menu pelanggan, view admin menu/kategori/stok/promo
├─ cart.js         Keranjang & checkout pelanggan
├─ orders.js       Mesin pesanan, pembayaran, dapur, pesanan manual (kasir)
├─ dashboard.js    Shell admin + dashboard
├─ finance.js      Kas masuk/keluar, transaksi
├─ reports.js      Laporan penjualan, keuangan, pelanggan
├─ qr.js           QR code meja (unduh PNG, cetak)
├─ qris.js         Pembayaran QRIS (QRIS dinamis + nominal otomatis)
├─ settings.js     Pengaturan, langganan demo, backup
├─ vendor/         qrcode.js, lucide.min.js (disalin lokal)
├─ splash.css      Layar pemuatan 3 detik (logo + progress bar)
├─ manifest.webmanifest, sw.js, pwa.js   PWA (instal di HP & Windows, cadangan offline)
├─ og-image.jpg    Gambar preview link WhatsApp/sosial media (1200×630)
└─ assets/         Logo, ikon PWA (192/512/maskable), favicon, foto hero
```

## Menjalankan lokal

Cukup buka `index.html` di browser, atau (disarankan) jalankan server statis agar semua fitur berjalan:

```bash
cd qr-menu-order
python3 -m http.server 8000
# buka http://localhost:8000
```

Font Inter dimuat dari Google Fonts; jika offline, font sistem dipakai.

## Akun demo (PIN 1234)

| Peran | Username | Akses |
|---|---|---|
| Owner | `owner` | Semua fitur: laporan, keuangan, menu, promo, meja & QR, pengaturan |
| Kasir | `kasir` | Pesanan masuk (QR & manual), pembayaran QRIS/tunai, papan pesanan, struk |

Cara cepat: buka `login.html` lalu klik salah satu akun demo.

> ⚠️ **Login ini hanya simulasi di browser dan TIDAK AMAN untuk produksi.** Siapa pun yang membuka DevTools dapat mengubah sesi dan data. Gunakan Firebase Authentication + Security Rules untuk produksi.

## Cara mengetes alur utama

1. Buka `menu.html?table=MEJA-01` (atau scan QR dari **Admin → Meja & QR → QR Code**). Tambahkan menu, buka keranjang, kirim pesanan.
2. Di tab lain buka `kitchen.html` (Papan Pesanan, login `kasir`). Pesanan muncul di kolom *Pesanan Baru* → **Terima** → **Mulai Memasak** → **Tandai Siap** → **Antar** → **Selesai**.
3. Di `admin.html#/orders` (login `kasir`), klik ikon pembayaran, pilih metode, catat. Pesanan belum dibayar **tidak** dihitung sebagai kas masuk.
4. Coba **Batalkan** (alasan wajib; stok dikembalikan, refund otomatis tercatat bila sudah dibayar).
5. Lihat **Dashboard**, **Keuangan**, dan **Laporan** (ekspor CSV / cetak).
6. **Backup & Data** → ekspor JSON, ubah data, lalu impor kembali untuk memulihkan.

Sinkronisasi antar tab di browser yang sama berjalan otomatis (BroadcastChannel / storage event).

## Pembayaran QRIS

QRIS statis merchant disimpan di **Pengaturan → Pembayaran** (payload teks, divalidasi CRC). Untuk tiap pesanan, `qris.js` membuat **QRIS dinamis** (nominal otomatis terisi, CRC dihitung ulang). Pelanggan menekan **Bayar dengan QRIS** setelah memesan; kasir melihat tombol QRIS di daftar pesanan.

⚠️ Tidak ada deteksi pembayaran otomatis (butuh backend + notifikasi penyedia pembayaran). Kasir **wajib memastikan dana masuk** di aplikasi merchant, lalu menekan *Catat Pembayaran*. Jika aplikasi pembayaran menolak QR bernominal, matikan opsi "QRIS dinamis" agar pelanggan mengetik nominal sendiri.

## QR code & Base URL

QR berisi alamat lengkap `…/menu.html?table=KODE-MEJA`. Agar bisa dipindai dari HP pelanggan, **atur Base URL** di **Admin → Meja & QR → QR Code** ke alamat publik situs Anda, misalnya `https://username.github.io/qr-menu-order/`. Selama Base URL masih `localhost`/lokal, QR hanya terbuka dari perangkat yang sama (aplikasi menampilkan peringatan).

## Deploy ke GitHub Pages

1. Buat repo GitHub, unggah isi folder `qr-menu-order/` ke root repo.
2. **Settings → Pages → Deploy from a branch → `main` / root**.
3. Buka `https://USERNAME.github.io/REPO/`, lalu isi Base URL di menu QR Code dan cetak ulang QR.

## Fitur utama

- **Pelanggan**: menu berfoto, kategori, pencarian, populer/promo, catatan & alergi, keranjang, pesan dibungkus, riwayat & pelacak status.
- **Dapur**: 4 kolom berwarna, tombol aksi jelas, peringatan terlambat, bunyi notifikasi, layar penuh.
- **Admin/Kasir**: dashboard, pesanan (QR & manual/POS), menu, kategori, stok, promo (persen/nominal/harga spesial, min. belanja, masa berlaku), meja & QR, kas masuk/keluar, transaksi, laporan harian–tahunan, pelanggan, pengaturan (pajak, service, struk, metode bayar), langganan demo, backup/restore.
- Status pesanan **terpisah** dari status pembayaran; stok tidak pernah negatif; pembayaran ganda dicegah; refund & pembatalan tercatat.
- Tema terang/gelap, responsif HP–PC (tabel jadi kartu, navigasi bawah, bottom sheet).

## Migrasi ke Firebase (persiapan)

Seluruh UI hanya memakai `Store` (`storage.js`), tidak menyentuh LocalStorage langsung. Untuk Firebase:

1. Buat project Firebase, aktifkan Firestore + Authentication.
2. Implementasikan adapter dengan antarmuka yang sama dengan adapter LocalStorage, lalu panggil `Store.use(adapter)` sebelum `Store.init()`.
3. Ganti `App.Auth` (login demo) dengan Firebase Auth dan peran lewat custom claims.
4. Tulis Security Rules: pelanggan hanya boleh membuat pesanan & membaca pesanannya; staf sesuai peran. Hitung total pesanan di server (Cloud Functions), jangan percaya total dari klien.
5. Gunakan transaksi Firestore untuk pengurangan stok dan nomor pesanan.

Daftar kesiapan juga tersedia di **Admin → Pengaturan Sistem**.

## Keterbatasan (jujur)

- **LocalStorage tidak sinkron antar perangkat.** Pesanan dari HP pelanggan tidak akan muncul di dapur pada perangkat lain. Demo lintas-perangkat memerlukan backend (Firebase). Antar-tab di satu browser berfungsi.
- Login/peran hanyalah simulasi, bukan keamanan.
- **Konfirmasi QRIS tidak otomatis**; pembayaran dicatat manual oleh kasir setelah dana masuk.
- Langganan/paket harga hanyalah demo tampilan, tanpa penagihan.
- Kapasitas LocalStorage terbatas (~5 MB); foto menu dikompres otomatis (maks. 800 px).
- Laba hanya perkiraan dan ditandai tidak lengkap bila data biaya belum diisi.
- Mengosongkan data browser menghapus semua data; lakukan backup JSON secara berkala.

## Tampilan, PWA & preview link (pembaruan)

- **Palet merah** mengikuti logo; warna hijau hanya dipakai untuk status sukses (lunas/selesai).
- **Logo** (`assets/icon-192.png`) dipakai di navigasi, login, dashboard, papan pesanan, dan header menu pelanggan.
- **Loading screen 3 detik** di `index.html` dan `menu.html` (murni CSS, tetap hilang walau JavaScript gagal). Ubah durasi di `splash.css` (`3s`).
- **PWA**: `manifest.webmanifest` + `sw.js` + `pwa.js`. Butuh HTTPS (GitHub Pages sudah cukup). Chrome/Edge (HP & Windows) menampilkan tombol **Instal Aplikasi**; di iPhone pakai Bagikan → Tambah ke Layar Utama. Setelah mengubah file, naikkan `VERSION` di `sw.js`.
- **Preview WhatsApp**: tag Open Graph di `index.html` & `menu.html` memakai `https://benyoriki.github.io/Restoran/og-image.jpg`. WhatsApp menyimpan cache preview; jika belum berubah, kirim link dengan tambahan `?v=2`.
