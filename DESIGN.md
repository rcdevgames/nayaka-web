# DESIGN.md

Arah desain Nayaka Admin Console.

Ditulis dari jawaban pemilik produk. Bagian "Keputusan pemilik" berisi hal yang ditentukan manusia. Bagian "Turunan teknis" berisi konsekuensi yang dihitung dari keputusan itu, termasuk nilai kontras yang sudah diverifikasi.

## Design Read

> Reading this as: internal admin console untuk operasional subscription CCTV, untuk staf support, finance, dan device operator, dengan bahasa visual industrial yang tegas, dial ENERGY 2 / RHYTHM 2 / MOTION 1.

## Keputusan pemilik

| Field | Nilai |
|---|---|
| Kepribadian | Tegas dan industrial |
| Palet | Netral terang, aksen oranye |
| Tipografi | Sans humanis, mudah dibaca |
| Dial | ENERGY 2 / RHYTHM 2 / MOTION 1 |
| Tema | Terang dan gelap, dua-duanya wajib jalan |

### Kenapa tegas dan industrial

Panel ini dipakai untuk memantau perangkat fisik dan uang masuk. Bahasa visualnya harus terasa seperti peralatan kerja, bukan halaman pemasaran. Konsekuensinya: hierarki kuat, sudut tegas, kontras tinggi, tanpa hiasan yang tidak membawa informasi.

### Kenapa netral terang dengan aksen oranye

Basis netral terang dipakai karena panel ini dibuka berjam-jam dan berisi tabel padat. Aksen oranye dipilih karena oranye adalah warna yang lazim pada peralatan industri dan status peringatan, sehingga terbaca sebagai sinyal, bukan dekorasi. Oranye dipakai hanya pada aksi utama dan status yang butuh perhatian.

### Kenapa sans humanis

Huruf dengan bentuk terbuka lebih mudah dibaca pada ukuran kecil di dalam tabel, dan lebih tahan pada layar murah. Public Sans dipilih karena dirancang untuk antarmuka institusional yang padat data, dengan angka yang rapi. Ini bukan pilihan default, dan alasannya keterbacaan pada kepadatan tinggi.

## Dial

| Dial | Nilai | Artinya di panel ini |
|---|---|---|
| ENERGY | 2 | Hierarki tegas, kontras tinggi, tapi tidak berteriak. Tidak ada dekorasi yang tidak berfungsi. |
| RHYTHM | 2 | Sebagian besar halaman memakai pola yang konsisten, dengan beberapa bagian sengaja dibuat berbeda untuk menandai kepentingan. |
| MOTION | 1 | Hanya transisi hover, focus, dan buka tutup. Tidak ada animasi yang berjalan sendiri. Tidak ada scroll reveal. |

Konsekuensi yang mengikat: karena MOTION 1, animasi masuk halaman, elemen mengambang, dan pulsa tanpa henti dilarang. Karena RHYTHM 2, konsistensi adalah pilihan sadar, bukan kebetulan, dan penyimpangan hanya boleh terjadi kalau ada alasan hierarki.

## Palet

Maksimum 2 warna inti plus 1 aksen, sesuai batas yang dipakai.

| Peran | Terang | Gelap | Alasan |
|---|---|---|---|
| Inti netral (teks dan permukaan) | `#18181B` | `#FAFAFA` | Dasar netral, tanpa bias warna supaya oranye tetap jadi satu-satunya sinyal |
| Permukaan terangkat | `#FFFFFF` | `#18181B` | Memisahkan isi dari latar halaman |
| Latar halaman | `#F4F4F5` | `#09090B` | Sedikit berbeda dari permukaan supaya kartu terbaca tanpa perlu bayangan |
| Aksen | `#C2410C` | `#F97316` | Aksi utama dan status yang butuh perhatian |

### Kontras yang sudah diverifikasi

Seluruh nilai di bawah dihitung, bukan dikira-kira. Ambang WCAG AA adalah 4.5:1 untuk teks normal dan 3:1 untuk teks besar serta batas komponen.

Tema terang:

| Pasangan | Rasio | Hasil |
|---|---|---|
| Teks `#18181B` di latar `#FFFFFF` | 17.72:1 | Lolos |
| Teks sekunder `#52525B` di latar `#FFFFFF` | 7.73:1 | Lolos |
| Teks sekunder `#52525B` di permukaan `#F4F4F5` | 7.03:1 | Lolos |
| Putih di atas aksen `#C2410C` | 5.18:1 | Lolos |
| Aksen `#C2410C` sebagai teks di `#FFFFFF` | 5.18:1 | Lolos |
| Batas input `#71717A` di `#FFFFFF` | 4.83:1 | Lolos ambang 3:1 |
| Batas dekoratif `#E4E4E7` di `#FFFFFF` | 1.27:1 | Hanya dekoratif, dilarang untuk batas input |

Tema gelap:

| Pasangan | Rasio | Hasil |
|---|---|---|
| Teks `#FAFAFA` di latar `#18181B` | 16.97:1 | Lolos |
| Teks sekunder `#A1A1AA` di latar `#18181B` | 6.91:1 | Lolos |
| Teks sekunder `#A1A1AA` di permukaan `#27272A` | 5.81:1 | Lolos |
| Aksen `#F97316` di latar `#18181B` | 6.32:1 | Lolos |
| Teks gelap `#18181B` di atas aksen `#F97316` | 6.32:1 | Lolos |
| Batas input `#71717A` di `#18181B` | 3.67:1 | Lolos ambang 3:1 |
| Batas dekoratif `#3F3F46` di `#18181B` | 1.70:1 | Hanya dekoratif, dilarang untuk batas input |

Temuan yang mengubah rencana awal: putih di atas oranye terang hanya mencapai 3.56:1 dan gagal untuk teks normal. Karena itu tombol utama memakai teks putih di atas oranye gelap pada tema terang, dan teks gelap di atas oranye terang pada tema gelap. Tombol tidak pernah memakai pasangan yang gagal.

### Warna status

Status tidak pernah disampaikan hanya lewat warna. Setiap status selalu disertai teks.

| Status | Terang | Gelap | Rasio terang | Rasio gelap |
|---|---|---|---|---|
| Berhasil | `#15803D` | `#4ADE80` | 5.02:1 | 10.17:1 |
| Menunggu | `#B45309` | `#FBBF24` | 5.02:1 | 10.61:1 |
| Gagal | `#B91C1C` | `#F87171` | 6.47:1 | 6.40:1 |
| Informasi | `#1D4ED8` | `#60A5FA` | 6.70:1 | 6.97:1 |

## Tipografi

Public Sans untuk seluruh antarmuka.

| Peran | Ukuran | Berat | Pemakaian |
|---|---|---|---|
| Judul halaman | 24px | 600 | Satu per halaman |
| Judul bagian | 16px | 600 | Kepala kartu dan panel |
| Isi | 14px | 400 | Teks umum dan isi tabel |
| Label | 13px | 500 | Label form dan kepala kolom |
| Bantuan | 13px | 400 | Teks bantuan dan pesan galat |
| Angka tabel | 14px | 400, tabular | Nominal uang dan tanggal |

Angka memakai `font-variant-numeric: tabular-nums` supaya kolom nominal sejajar dan mudah dibandingkan.

## Sudut dan bayangan

| Elemen | Radius | Alasan |
|---|---|---|
| Tombol dan input | 6px | Cukup tegas untuk kesan peralatan, tidak tajam |
| Kartu dan panel | 10px | Memisahkan wadah dari kontrol di dalamnya |
| Lencana status | 4px | Kecil, jadi radius kecil supaya tidak terlihat seperti pil |
| Modal | 12px | Wadah terbesar, radius terbesar |

Radius tidak pernah seragam pada semua elemen, karena keseragaman menghapus bahasa visual antara wadah dan kontrol.

Bayangan hanya dipakai pada elemen yang benar-benar mengambang di atas halaman: modal, dropdown, dan popover. Kartu di dalam halaman memakai perbedaan warna permukaan, bukan bayangan.

## Ikon

Ikon fitur memakai Phosphor Icons dengan bobot `regular`, bukan Lucide.

Alasannya: Phosphor menyediakan bobot yang bisa disetel, sehingga ikon bisa dibuat lebih tegas pada ukuran kecil tanpa berubah menjadi blok penuh. Ini cocok dengan karakter industrial yang dipilih, dan membedakan panel ini dari tampilan default yang memakai ikon garis tipis seragam.

Lucide tetap terpasang, tetapi hanya dipakai oleh komponen internal shadcn untuk penanda kecil seperti centang dan panah dropdown. Ikon itu bukan ikon fitur dan tidak muncul sebagai penanda bagian.

Setiap ikon fitur harus relevan dengan isinya. Kalau tidak ada ikon yang tepat, tidak dipakai ikon sama sekali, dan label teks yang bekerja.

## Aturan yang mengikat

1. Oranye hanya untuk aksi utama dan status yang butuh perhatian. Kalau oranye muncul di mana-mana, ia berhenti menjadi sinyal.
2. Tidak ada gradien sebagai warna utama. Gradien hanya boleh memisahkan tingkat hierarki, dan alasannya ditulis.
3. Tidak ada animasi yang berjalan sendiri. Gerak hanya sebagai tanggapan atas tindakan pengguna.
4. Status selalu disertai teks, tidak pernah hanya warna.
5. Setiap angka yang tampil harus berasal dari data nyata. Kalau belum ada, tampilkan penanda bahwa datanya belum ada.
6. Setiap kontrol harus benar-benar bekerja. Kontrol yang belum siap tidak ditampilkan.
7. Setiap tampilan data punya tiga keadaan: kosong, memuat, dan gagal. Ketiganya menjelaskan sebab dan langkah berikutnya.
8. Setiap keputusan visual harus bisa dijelaskan dalam satu baris.
