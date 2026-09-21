# Checkpoint

Catatan keadaan proyek Nayaka. Tujuannya supaya pekerjaan bisa dilanjutkan tanpa membaca ulang
seluruh riwayat percakapan, dan supaya keputusan yang belum selesai tidak hilang.

Terakhir diperbarui: 21 September 2026. Konsol berjalan di pm2 sebagai proses `nayaka`, port 3101.

---

## 1. Apa yang sudah jadi

Konsol admin Nayaka: Next.js 16 App Router, satu proyek berisi backend dan antarmuka.

| Bagian | Jumlah | Keterangan |
|---|---|---|
| Halaman | 25 | Termasuk halaman masuk dan dua halaman diskon |
| Endpoint API | 57 rute admin + health | Termasuk POST /customers untuk tambah manual |
| Tabel database | 35 | 17 migrasi terpasang di Supabase |
| Komponen | 14 ui + 11 atom + 17 molekul + 26 organisme | Metode atom dan molekul |
| Skema zod | 11 | Dipakai bersama klien dan server |

Perintah:

| Perintah | Gunanya |
|---|---|
| `npm run dev` | Jalankan pengembangan |
| `npm run build` | Build produksi |
| `npm run db:migrate` | Terapkan migrasi |
| `npm run db:verify` | Periksa skema dan batasan |
| `npm run db:create-admin` | Buat admin pertama, wajib terminal sungguhan |
| `npm run db:sql -- <berkas>` | Jalankan berkas SQL |
| `npm run verify:admin` | 49 uji akun admin dan peran |
| `npm run verify:audit` | 29 uji audit |
| `npm run verify:session` | 13 uji cabut sesi |
| `npm run verify:guard` | 5 uji penjagaan pemegang izin terakhir |
| `npm run verify:guard-helper` | 5 uji penghitung penjagaan |
| `npm run verify:clean` | Bersihkan sisa data uji |

## 2. Keadaan yang terakhir terverifikasi

- `npm run build` keluar 0, 73 rute, tanpa peringatan
- `npx tsc --noEmit` dan `npx eslint` bersih
- `npm run db:verify` 47 lulus, 0 gagal
- Uji perilaku 101 lulus, 0 gagal
- Database: 1 admin (`admin@mail.com`), 4 peran bawaan, 20 izin, 1 pelanggan, 2 perangkat,
  1 langganan, 1 tagihan, 1 percobaan pembayaran, 1 paket `free`, 1 harga

## 3. Cara menjalankan

Konsol ini berjalan di bawah pm2 dengan nama proses `nayaka`.

```
pm2 start ecosystem.config.cjs     # jalankan
pm2 logs nayaka                    # lihat log
pm2 restart nayaka                 # muat ulang setelah build baru
pm2 stop nayaka                    # hentikan
pm2 save                           # simpan daftar supaya ikut hidup saat reboot
```

**Alamat: http://127.0.0.1:3101**

Port 3101 dipilih karena 3000, 3080, 3099, dan 3100 sudah dipakai aplikasi lain di mesin ini.
Proses sengaja diikat ke `127.0.0.1` saja, jadi tidak bisa dibuka dari alamat jaringan. Konsol
ini memegang data pelanggan dan pembayaran, dan belum ada TLS maupun otentikasi perangkat di
depannya. Kalau nanti perlu diakses dari luar, pasang proxy terbalik ber-TLS, jangan membuka
host pengikatnya.

Pengikatan host harus lewat argumen `-H 127.0.0.1`, bukan variabel `HOSTNAME` di `env`, karena
`next start` tidak menghormati variabel itu dan akan diam-diam mendengarkan di seluruh antarmuka.

Setelah mengubah kode, jalankan build lebih dulu. `pm2 restart` saja tidak membangun ulang:

```
npm run build && pm2 restart nayaka
```

### Menjalankan tanpa pm2

```
export npm_config_cache="$PWD/.cache/npm" XDG_CONFIG_HOME="$PWD/.config" XDG_CACHE_HOME="$PWD/.cache"
npm run db:create-admin     # hanya bila database belum punya admin
npm run dev                 # mode pengembangan di http://localhost:3000
```

`npm run db:create-admin` meminta email, nama lengkap, nama pengguna, dan kata sandi dua kali.
Akun dibuat sebagai super admin dengan peran `super_admin`.

### Berkas env

`.env` berisi `DATABASE_URL`, `JWT_ADMIN_ACCESS_SECRET`, `CSRF_SECRET`, dan `APP_ENV`.
Nilai rahasianya dibuat acak dan tidak ditulis di berkas mana pun. `APP_ENV=development`
dipilih karena konsol dibuka lewat `http`; di `production`, cookie sesi memakai atribut
`Secure` dan browser tidak akan mengirimnya lewat `http`, sehingga login akan tampak berhasil
padahal sesinya selalu kosong.

## 4. Aturan penting yang mudah dilupakan

**Versi Next.js.** Next 16 mengubah banyak hal dari yang umum diketahui: `params`,
`searchParams`, dan `cookies()` adalah Promise; `next lint` dihapus dan diganti `eslint`;
`middleware` berganti nama menjadi `proxy` dan berkasnya ada di `src/`.

**Batas modul klien dan server.** Komponen server tidak bisa membaca nilai biasa dari modul
`"use client"`; nilainya tiba sebagai undefined. Konstanta bersama harus diletakkan di modul
netral, dan modul netral tidak boleh mengimpor apa pun yang menarik kode database, karena `pg`
akan masuk ke bundel peramban dan gagal dengan pesan `Can't resolve 'util/types'`. Contoh yang
sudah benar: `src/lib/report-labels.ts` dan `src/lib/password-rules.ts`.

**SQL dengan `bounds`.** Pakai `FROM <tabel> CROSS JOIN bounds`, jangan `FROM t, bounds`, bila
`bounds` dirujuk di `WHERE` setelah `LEFT JOIN`. Bentuk kedua memicu
`invalid reference to FROM-clause entry` di Postgres.

**Aturan kata sandi ada di satu tempat.** `src/lib/password-rules.ts`. Jangan menulis ulang
panjang minimum atau pesannya di berkas lain. Sebelumnya aturan ini disalin ke empat berkas dan
salah satunya tertinggal di angka 12.

**Jejak audit menahan penghapusan.** `audit_logs.admin_user_id` memakai `ON DELETE RESTRICT`
(migrasi 0007). Menghapus admin yang pernah bertindak harus menghapus jejaknya lebih dulu, dan
itu hanya boleh untuk akun uji. Admin sungguhan dinonaktifkan, bukan dihapus.

**`requireUuid()` mengembalikan 404**, bukan 400, untuk id yang bentuknya salah. Ini disengaja
dan berlaku di seluruh aplikasi.

**Pembulatan dan waktu.** Semua laporan memakai WIB lewat `AT TIME ZONE 'Asia/Jakarta'`.
Tanggal di layar memakai `jakartaToday()`, bukan `toISOString()`, karena `toISOString()` memberi
tanggal UTC dan pada pukul 07.00 WIB tanggalnya masih kemarin.

## 5. Halaman yang siap

**Masuk**

- `/login`: form email dan kata sandi, ambil token CSRF lebih dulu, ingat sesi, pesan galat per kolom

**Beranda**

- `/`: dashboard tiga tab dengan pemilih periode. Bisnis: pelanggan, langganan per paket,
  perangkat terpasang, MRR, grafik deret. Keuangan: pendapatan berbanding periode lalu, piutang,
  refund, pembayaran belum terverifikasi. Operasional: sesi aktif, notifikasi masuk dan
  mencurigakan, panggilan keluar gagal, klaim gagal, pekerjaan terjadwal termasuk penanda basi.
  Tab Bisnis dan Keuangan wajib menerima `from` dan `to`, dan menolak permintaan tanpa keduanya

**Perlu tindakan**

- `/tindakan`: antrian lintas modul: pembayaran belum dikonfirmasi, notifikasi mencurigakan,
  tagihan lewat jatuh tempo, langganan akan berakhir

**Pelanggan**

- `/customers`: ringkasan, pencarian, filter status, tombol tambah pelanggan manual (izin
  `customer.create`). Kolom: Nama, Kontak, Cara masuk, Status akun, Paket, Perangkat, Terdaftar,
  Aksi (tangguhkan, hapus — keduanya wajib alasan; hapus = soft delete, sesi dicabut,
  perangkat dilepas ke gudang)
- `/customers/[id]`: profil, perangkat, riwayat langganan dan tagihan, tangguhkan dengan alasan

**Perangkat**

- `/devices`: ringkasan dan filter status. Kolom: Nomor perangkat, Nomor seri, Nama, Model,
  Status, Pelanggan, Cara masuk, Terpasang sejak
- `/devices/baru`: form pendaftaran, lalu menampilkan kode claim
- `/devices/[id]`: identitas, garansi, penugasan, percobaan klaim, dan preview CCTV MJPEG melalui
  tombol konfirmasi privasi. Aksi: tugaskan, lepas, rotasi kode claim, nonaktifkan

**Paket dan harga**

- `/plans`: kolom Paket, Batas perangkat, Harga, Langganan, Status, Tindakan

**Langganan**

- `/subscriptions` dan `/subscriptions/[id]`: paket, harga, kuota, periode berjalan,
  riwayat perubahan, batalkan dengan alasan

**Tagihan**

- `/invoices` dan `/invoices/[id]`: rincian tagihan, sisa, periode, percobaan pembayaran,
  pembatalan dengan alasan

**Pembayaran**

- `/payments`: kolom Nomor pesanan, Pelanggan, Status, Nominal tagihan, Dibayar pelanggan,
  Cara bayar, Dikonfirmasi penyedia, Dibayar pada
- `/payments/[id]`: rincian biaya, nomor rujukan penyedia, riwayat refund. Aksi: catat refund
  manual, tidak memanggil API refund Pakasir
- `/provider-logs`: dua arah komunikasi Pakasir dalam satu daftar, plus ringkasan kesehatan

**Laporan**

- `/laporan` mengalihkan ke `/laporan/revenue`
- `/laporan/[jenis]`: tujuh jenis laporan, yaitu `revenue`, `growth`, `receivables`,
  `subscriptions`, `devices`, `anomalies`, `refunds`. Pemilih periode tetap saat pindah jenis.
  Ada ekspor CSV

**Audit**

- `/audit`: empat tab: jejak perubahan, percobaan masuk, sesi aktif, peristiwa sesi.
  Satu-satunya aksi tulis adalah mencabut sesi

**Admin dan izin**

- `/admin-users`: ringkasan, filter status dan peran, buat akun, nonaktifkan dengan alasan
- `/admin-users/[id]`: peran, izin efektif beserta peran asalnya, daftar sesi. Akun sendiri
  tidak bisa menonaktifkan diri atau mengubah perannya sendiri
- `/roles` dan `/roles/[id]`: daftar peran, katalog 20 izin, kotak centang izin per modul,
  panel pemegang, simpan dengan alasan

**Setiap tabel daftar punya kontrol halaman.** Kontrolnya seragam: rentang baris, tombol mundur
dan maju, dan pemilih 20/50/100 baris per halaman. Tombol mundur dan maju tetap dirender tetapi
dinonaktifkan saat tidak ada halaman tujuan, dan ringkasannya selalu tampil termasuk ketika
hasilnya nol atau hanya satu halaman. Keduanya disengaja: kontrol yang muncul-hilang membuat
tinggi halaman melompat setiap kali filter diganti. Ini berlaku di daftar pelanggan, perangkat,
paket, langganan, tagihan, pembayaran, akun admin, peran (beserta katalog izinnya), empat tab
audit, log provider, keterangan tabel tiap laporan, dan tabel sesi di halaman detail admin.

**Tabel pekerjaan terjadwal di dashboard dikecualikan** karena himpunan tetap: isinya satu baris
per pekerjaan terjadwal, bukan daftar yang bertambah seiring waktu. Tabel kesehatan di
`/provider-logs` juga dikecualikan dan di sana satu tabel memang punya kontrol sendiri, yaitu
daftar lognya; tabel kedua hanya satu baris per jenis operasi penyedia.

## 6. Keputusan yang belum diambil

1. **Batas perangkat paket Ultra.** Paket gratis memakai `device_limit = 1` sebagai penjaga
   sementara terhadap penyalahgunaan. Angka ini belum final, dan Ultra belum ditentukan
   apakah tanpa batas atau berangka.
2. **Harga paket berbayar.** Belum ada.
3. **`UNIQUE (plan_id, billing_interval)` pada `plan_prices`.** Batasan ini bertabrakan dengan
   aturan di kontrak yang menyuruh membuat baris harga baru lalu menonaktifkan yang lama,
   karena interval yang sama hanya boleh ada satu baris per paket. Dua pilihan sudah dicatat di
   `DB_Plan.md`, belum dipilih.
4. **Jalur klaim nomor seri.** Sekarang masuk langsung; belum diputuskan apakah tetap begitu
   atau berubah menjadi antrian persetujuan admin.
5. **`openapi.yaml`** belum dibuat dari `API_Contract.md`.

## 7. Yang belum pernah diuji

**Uji browser modul diskon belum menghasilkan click-through valid.** Route halaman mengembalikan `307`
ketika sesi tidak tersedia. Smoke test endpoint tanpa cookie menghasilkan `401`, sesuai guard. Login
uji dengan kredensial sementara menghasilkan `401 INVALID_CREDENTIALS`, sehingga endpoint dengan sesi
admin nyata belum terbukti.

Bagian berikut tetap belum diverifikasi dan perlu dibuka sendiri di peramban:

- Klik, perpindahan tab, dan pengiriman formulir
- Tampilan visual, tata letak, dan ganti tema
- Hidrasi dan `SessionBootstrap`
- Fokus papan ketik dan pembacaan layar

**Catatan historis:** daftar di bawah berlaku untuk halaman lama sebelum modul diskon ditambahkan.

**Halaman detail mengambil data di klien.** HTML dari server hanya memuat kerangka
"Memuat ...", bukan isinya. Pemeriksaan HTTP 200 pada halaman-halaman itu tidak membuktikan
apa pun tentang isinya.

**Paginasi tabel sudah diuji di peramban sungguhan**, bukan dari kode status HTTP. Yang
diperiksa: ringkasan baris tiap daftar, maju dan mundur halaman sampai batas akhir, penggantian
ukuran halaman 20/50/100, dan filter yang tetap bekerja sesudah paginasi terpasang. Skripnya
memakai CDP dan berada di luar repo, di `/tmp/nayaka-uji/`. Karena itu bagian di atas tetap
berlaku untuk sisa halaman yang belum pernah disapu.

## 8. Catatan pengujian

Skrip uji ada di `scripts/verify`, dijalankan dengan `bun`. Setiap skrip menyimpan sendiri
koleksi cookie-nya, tidak memakai jar bersama, karena perubahan peran dan penonaktifan akun
mencabut sesi dan akan mengacaukan uji lain.

Uji yang mengubah peran atau izin mencabut sesi pemegangnya. Karena itu uji penjagaan
memakai peran uji dan akun biasa, bukan peran `super_admin`, supaya tidak memutus sesi
pengujinya sendiri di tengah jalan.

Sisa data uji dibersihkan dengan `npm run verify:clean` sebelum menjalankan ulang. Uji tidak
membersihkan sendiri lewat API, karena konsol sengaja tidak menyediakan penghapusan admin
maupun peran.

## 9. Berkas yang sering dipakai

| Berkas | Isinya |
|---|---|
| `API_Contract.md` | Kontrak REST, sumber kebenaran bentuk request dan response |
| `DB_Plan.md` | Rencana 31 tabel dan alasan di balik keputusannya |
| `DESIGN.md` | Arah desain yang mengikat untuk urusan tampilan |
| `src/lib/password-rules.ts` | Satu-satunya tempat aturan kata sandi |
| `src/lib/report-labels.ts` | Jenis laporan, dipakai klien dan server |
| `src/lib/nav.ts` | Daftar modul dan menu sidebar beserta izin serta keterangannya |
| `src/lib/server/guard.ts` | Pemeriksaan sesi dan izin |
| `src/lib/server/errors.ts` | Daftar kode galat dan status HTTP-nya |
| `db/migrations/` | 7 migrasi yang sudah terpasang |
| `ecosystem.config.cjs` | Konfigurasi pm2, termasuk port dan host pengikat |
