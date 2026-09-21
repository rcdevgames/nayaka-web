# API Contract

Kontrak API untuk sistem CCTV dengan backend fullstack Next.js, web admin, dan mobile customer.

## Keputusan arsitektur

| Area | Keputusan |
|---|---|
| Backend | Next.js fullstack, Route Handlers di `/app/api` |
| API style | REST |
| API prefix | `/api/v1` |
| Admin authentication | JWT dalam cookie HttpOnly, Secure pada production |
| Customer authentication | JWT access token melalui Bearer + refresh token |
| Password | Argon2id, bcrypt bila Argon2id tidak tersedia |
| Payment provider | Pakasir mode API, QR string dan nomor VA ditampilkan sendiri oleh aplikasi |
| Device provisioning | Admin mendaftarkan device ke inventory melalui web admin |
| Device claim | Customer claim lewat scan QR atau input serial number |
| Device integration | Belum ada di v1, masuk fase terpisah |
| Upgrade plan | Aktif setelah pembayaran, membayar selisih prorata, hanya sesama interval |
| Downgrade | Tidak tersedia selama subscription aktif; beli plan baru setelah expired |
| Ganti email atau WhatsApp | Boleh, wajib verifikasi ulang |
| Verifikasi email saat register | Tidak dipakai di v1 |
| Database | PostgreSQL Supabase, direct connection dari server Next.js saja |

## Lingkup v1

Yang dikerjakan sekarang:

- Autentikasi customer dan admin.
- Profil customer dan metode login.
- Inventory device oleh admin dan claim device oleh customer.
- Subscription, invoice, dan pembayaran melalui Pakasir.

Yang **belum** ada di v1 dan ditandai eksplisit:

- Koneksi ke perangkat CCTV. Tidak ada stream, tidak ada kredensial perangkat, tidak ada heartbeat.
- Device yang sudah diklaim hanya berupa data baris di database. Backend tidak tahu apakah unit fisiknya hidup, terpasang, atau online.
- Tabel `device_credentials` dan `device_events` sengaja belum dipakai. Detailnya ada di bagian Fase 2.

Default yang dipakai sementara dan masih bisa diubah:

| Hal | Default v1 |
|---|---|
| Access token customer | 15 menit, refresh 30 hari sliding |
| Access token admin | 15 menit, refresh 8 jam, batas absolut 12 jam |
| Masa berlaku claim code | Tidak kedaluwarsa |
| Pembulatan nominal | Half-up ke rupiah utuh |
| Subscription plan free | Dibuat otomatis saat register |
| Reset password via email | Tersedia |
| Billing interval | Bulanan dan tahunan tersedia, upgrade antar interval dilarang |

## Arsitektur request

```text
Admin Browser ── cookie JWT ──┐
                              ├── Next.js server ── PostgreSQL Supabase
Customer Mobile ── Bearer JWT ┘                  └── Pakasir API
Pakasir ── webhook ──> Next.js server
```

`DATABASE_URL`, JWT secret, credential Pakasir, webhook secret, dan encryption key hanya boleh tersedia di server.

## Konvensi umum

Semua endpoint memakai prefix `/api/v1`.

Request JSON:

```http
Content-Type: application/json
```

Request mutasi, checkout, claim, dan payment memakai:

```http
Idempotency-Key: <unique-request-key>
```

Customer mobile memakai:

```http
Authorization: Bearer <access-token>
```

Admin web tidak mengirim JWT melalui JavaScript. Browser mengirim cookie secara otomatis.

Setiap response memuat header `X-Request-Id`. Response `429` memuat header `Retry-After` dalam detik.

### Response sukses

```json
{
  "data": {},
  "meta": {
    "request_id": "uuid"
  }
}
```

Response list memakai cursor pagination:

```json
{
  "data": [],
  "meta": {
    "request_id": "uuid",
    "pagination": {
      "next_cursor": "cursor-value",
      "has_more": true,
      "limit": 20
    }
  }
}
```

### Parameter list

| Parameter | Arti |
|---|---|
| `limit` | Jumlah item, default `20`, maksimum `100` |
| `cursor` | Cursor opaque dari `next_cursor` sebelumnya |
| `sort` | Nama field, prefix `-` untuk descending, contoh `-created_at` |

Field `sort` memakai allowlist per endpoint. Field di luar allowlist menghasilkan `400 VALIDATION_ERROR`. Urutan default selalu memakai `created_at` descending ditambah `id` sebagai tie-breaker supaya cursor stabil.

### Response error

```json
{
  "error": {
    "code": "DEVICE_LIMIT_REACHED",
    "message": "Batas perangkat pada paket aktif sudah tercapai.",
    "details": {
      "device_limit": 3,
      "active_device_count": 3
    },
    "request_id": "uuid"
  }
}
```

Jangan mengirim stack trace, SQL query, password, token, raw credential, atau error provider mentah.

### Status HTTP

```text
200 OK
201 Created
204 No Content
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
429 Too Many Requests
500 Internal Server Error
502 Bad Gateway
```

`400` untuk request yang tidak valid secara bentuk. `409` untuk konflik data. `422` untuk aturan bisnis. `429` untuk rate limit, selalu disertai `Retry-After`.

Seluruh error code beserta status HTTP-nya ada di tabel pemetaan error di bagian akhir dokumen.

### Format data

- ID memakai UUID string.
- Timestamp memakai ISO 8601 UTC.
- Uang dikirim sebagai integer. `99000` berarti Rp99.000.
- Uang disimpan PostgreSQL sebagai `numeric(14,2)`.
- Email lowercase.
- Nomor WhatsApp format E.164, misalnya `+628123456789`.

### Aturan pembulatan

Perhitungan prorata menghasilkan pecahan. Aturannya:

1. Hitung nilai prorata dengan presisi penuh.
2. Bulatkan ke rupiah utuh memakai half-up, yaitu `0.5` ke atas dibulatkan naik.
3. Simpan hasil pembulatan sebagai `invoice_items.unit_amount`.
4. Client tidak pernah menghitung nominal final. Nominal final selalu dari backend.

Jika `amount_due` hasil pembulatan berada di bawah `PAKASIR_MIN_AMOUNT`, plan baru langsung diaktifkan tanpa invoice dan tanpa pembayaran. `subscription_events.metadata` mencatat `charged_amount: 0` dengan alasan `below_minimum`. Ambang default adalah `1000`.

Aturan ini berlaku untuk upgrade, bukan untuk checkout plan pertama, karena checkout selalu memakai harga penuh dari `plan_prices`.

---

## Customer Mobile API

### Auth customer

#### Register email

```http
POST /api/v1/customer/auth/register
```

Request:

```json
{
  "full_name": "Budi Santoso",
  "email": "budi@example.com",
  "password": "user-password"
}
```

Backend menormalisasi email, menyimpan Argon2id hash, dan langsung mengaktifkan akun. Verifikasi email tidak dipakai di v1, sehingga `customer_auth_accounts.is_verified` diisi `true` saat register.

Response `201`:

```json
{
  "data": {
    "customer": {
      "id": "customer-uuid",
      "full_name": "Budi Santoso",
      "status": "active"
    },
    "access_token": "access-jwt",
    "refresh_token": "refresh-token",
    "token_type": "Bearer",
    "expires_in": 900
  },
  "meta": {"request_id": "request-uuid"}
}
```

Error: `EMAIL_ALREADY_REGISTERED`, `WEAK_PASSWORD`, `VALIDATION_ERROR`.

Konsekuensi yang perlu disadari: email tidak diverifikasi, sehingga email palsu dapat dipakai. Fitur ganti email tetap mewajibkan verifikasi.

#### Login email

```http
POST /api/v1/customer/auth/login/email
```

Request:

```json
{
  "email": "budi@example.com",
  "password": "user-password"
}
```

Response:

```json
{
  "data": {
    "access_token": "access-jwt",
    "refresh_token": "refresh-token",
    "token_type": "Bearer",
    "expires_in": 900,
    "customer": {
      "id": "customer-uuid",
      "full_name": "Budi Santoso",
      "status": "active"
    }
  },
  "meta": {"request_id": "request-uuid"}
}
```

Access JWT berumur pendek. Refresh token dirotasi setiap dipakai.

#### Request OTP WhatsApp

```http
POST /api/v1/customer/auth/whatsapp/request
```

Request:

```json
{
  "phone": "+628123456789"
}
```

Response:

```json
{
  "data": {
    "verification_id": "verification-uuid",
    "expires_in": 300,
    "retry_after": 60
  },
  "meta": {"request_id": "request-uuid"}
}
```

Backend menyimpan `code_hash`, bukan OTP plaintext, serta menerapkan rate limit nomor dan IP.

Response selalu sama baik nomor terdaftar maupun tidak, supaya nomor tidak dapat dienumerasi.

#### Verifikasi OTP WhatsApp

```http
POST /api/v1/customer/auth/whatsapp/verify
```

Request:

```json
{
  "verification_id": "verification-uuid",
  "code": "123456"
}
```

Jika nomor belum terhubung, backend membuat customer baru dengan `full_name` kosong dan mengembalikan `onboarding_required: true`. Customer wajib mengisi nama sebelum dapat memakai endpoint lain yang membutuhkan profil lengkap.

Response:

```json
{
  "data": {
    "access_token": "access-jwt",
    "refresh_token": "refresh-token",
    "token_type": "Bearer",
    "expires_in": 900,
    "onboarding_required": true,
    "customer": {
      "id": "customer-uuid",
      "full_name": null,
      "status": "active"
    }
  },
  "meta": {"request_id": "request-uuid"}
}
```

Error: `VERIFICATION_NOT_FOUND`, `VERIFICATION_EXPIRED`, `VERIFICATION_ATTEMPTS_EXCEEDED`, `INVALID_VERIFICATION_CODE`, `PHONE_ALREADY_LINKED`.

#### Login Google

```http
POST /api/v1/customer/auth/google
```

Request:

```json
{"id_token": "google-id-token"}
```

Backend memvalidasi issuer, audience, expiry, lalu mengambil `sub`. Client tidak mengirim `provider_subject` manual.

Aturan linking:

- Jika `sub` sudah terhubung, langsung login.
- Jika `sub` belum terhubung tetapi email Google sudah dipakai akun lain yang sudah login dengan provider lain, backend **tidak** melakukan auto-link. Response `409 GOOGLE_ACCOUNT_LINK_REQUIRED`.
- Linking hanya dapat dilakukan oleh customer yang sudah login melalui `POST /api/v1/customer/me/auth-accounts/google`.

#### Lupa dan reset password

```http
POST /api/v1/customer/auth/password/forgot
POST /api/v1/customer/auth/password/reset
```

Request forgot:

```json
{"email": "budi@example.com"}
```

Response selalu `200` dengan body yang sama, terlepas dari email terdaftar atau tidak.

Request reset:

```json
{
  "verification_id": "verification-uuid",
  "code": "123456",
  "new_password": "new-password"
}
```

Reset password mencabut seluruh session customer tersebut.

#### Refresh token

```http
POST /api/v1/customer/auth/refresh
```

Request:

```json
{"refresh_token": "refresh-token"}
```

Response mengembalikan access JWT dan refresh token baru. Token lama dicabut. Jika reuse terdeteksi, session terkait dicabut.

#### Logout

```http
POST /api/v1/customer/auth/logout
POST /api/v1/customer/auth/logout-all
```

Response `204 No Content`.

### Profil dan metode login

```http
GET    /api/v1/customer/me
PATCH  /api/v1/customer/me
GET    /api/v1/customer/me/auth-accounts
POST   /api/v1/customer/me/auth-accounts/google
DELETE /api/v1/customer/me/auth-accounts/{auth_account_id}
```

Request PATCH:

```json
{
  "full_name": "Budi Santoso Baru",
  "avatar_url": "https://example.com/avatar.jpg"
}
```

Customer tidak dapat mengubah `id` atau `status`. Metode login tidak boleh dihapus jika menjadi satu-satunya metode login.

Ganti email:

```http
POST /api/v1/customer/me/email/change
POST /api/v1/customer/me/email/verify
```

Request change:

```json
{
  "new_email": "new@example.com",
  "current_password": "current-password"
}
```

Response change:

```json
{
  "data": {
    "verification_id": "verification-uuid",
    "expires_in": 900,
    "pending_email": "new@example.com"
  },
  "meta": {"request_id": "request-uuid"}
}
```

Request verify:

```json
{
  "verification_id": "verification-uuid",
  "code": "123456"
}
```

Email lama tetap aktif sampai email baru terverifikasi.

Ganti WhatsApp:

```http
POST /api/v1/customer/me/phone/change
POST /api/v1/customer/me/phone/verify
```

Request change:

```json
{"new_phone": "+628123456780"}
```

Request verify:

```json
{
  "verification_id": "verification-uuid",
  "code": "123456"
}
```

Nomor baru menggantikan nomor lama setelah OTP berhasil diverifikasi. Selama belum terverifikasi, nomor lama tetap menjadi metode login.

### Akun

```http
POST /api/v1/customer/me/delete
```

Request:

```json
{
  "current_password": "current-password",
  "reason": "optional-reason"
}
```

Akun tidak dihapus permanen. `customers.status` menjadi `deleted`, seluruh session dicabut, dan histori invoice tetap tersimpan.

---

## Device API customer

Device masuk ke sistem melalui admin, bukan melalui aplikasi customer. Customer hanya mengklaim device yang sudah terdaftar.

### List dan detail

```http
GET /api/v1/customer/devices
GET /api/v1/customer/devices/{device_id}
```

Backend selalu memfilter berdasarkan customer dari JWT. Device milik customer lain menghasilkan `404 RESOURCE_NOT_FOUND`, bukan `403`.

Filter `status` yang tersedia: `claimed`, `suspended`.

Response memuat catatan keterbatasan:

```json
{
  "data": [
    {
      "id": "device-uuid",
      "device_uid": "NYK-000001",
      "serial_number": "SN-2026-000123",
      "name": "Kamera Depan",
      "model": "NYK-C200",
      "status": "claimed",
      "claim_method": "qr",
      "claimed_at": "2026-01-01T10:00:00Z",
      "integration_ready": false,
      "connection_status": null
    }
  ],
  "meta": {"request_id": "request-uuid"}
}
```

`integration_ready` bernilai `false` selama integrasi CCTV belum tersedia. `connection_status` bernilai `null` karena backend belum menerima data apa pun dari perangkat. Client tidak boleh menampilkan status online atau offline pada v1.

### Claim device

```http
POST /api/v1/customer/devices/claim
```

Request memakai tepat salah satu dari dua bentuk berikut.

Scan QR:

```json
{
  "claim_token": "token-dari-qr-pada-label",
  "name": "Kamera Depan"
}
```

Input serial number:

```json
{
  "serial_number": "SN-2026-000123",
  "name": "Kamera Depan"
}
```

Backend dalam satu transaction memvalidasi bukti claim, mengunci baris device, memeriksa subscription aktif dan `device_limit`, mengaitkan device ke customer, lalu menandai claim code terpakai.

Response `201`:

```json
{
  "data": {
    "device": {
      "id": "device-uuid",
      "device_uid": "NYK-000001",
      "serial_number": "SN-2026-000123",
      "name": "Kamera Depan",
      "model": "NYK-C200",
      "status": "claimed",
      "claim_method": "serial",
      "claimed_at": "2026-01-01T10:00:00Z",
      "integration_ready": false
    }
  },
  "meta": {"request_id": "request-uuid"}
}
```

Error: `CLAIM_TOKEN_INVALID`, `SERIAL_NUMBER_NOT_FOUND`, `DEVICE_ALREADY_CLAIMED`, `DEVICE_LIMIT_REACHED`, `ACTIVE_SUBSCRIPTION_REQUIRED`, `DEVICE_SUSPENDED`, `DEVICE_CLAIM_RATE_LIMITED`.

Aturan yang harus diimplementasikan:

- Serial number hanya valid jika device sudah terdaftar di inventory. Serial acak selalu gagal.
- Rate limit claim: maksimal 5 percobaan gagal per customer per jam dan 10 percobaan gagal per IP per jam. Melebihi batas menghasilkan `429 DEVICE_CLAIM_RATE_LIMITED`.
- Setiap percobaan claim, berhasil maupun gagal, dicatat di `device_claim_attempts`. Nilai yang dikirim disimpan dalam bentuk tersamarkan, bukan plaintext.
- Tidak ada endpoint preview atau pengecekan serial. Endpoint preview hanya menambah permukaan enumerasi tanpa manfaat, karena hasil akhirnya sama dengan percobaan claim.

**Risiko yang diterima:** serial number CCTV umumnya tercetak di bodi dan sering berurutan, sehingga dapat ditebak. Jalur serial karena itu diperlakukan sebagai jalur lemah. Mitigasinya adalah rate limit ketat, pencatatan seluruh percobaan, dan kemampuan admin membatalkan claim yang terbukti salah. Kalau risiko ini tidak dapat diterima, jalur serial harus diubah menjadi antrian persetujuan admin.

### Ubah nama dan nonaktifkan

```http
PATCH  /api/v1/customer/devices/{device_id}
POST   /api/v1/customer/devices/{device_id}/deactivate
```

Request rename:

```json
{"name": "Kamera Garasi"}
```

Device tidak dihapus permanen. Device yang di-deactivate berstatus `suspended`, tidak lagi dihitung dalam `device_limit`, tetapi tetap terikat pada customer tersebut selamanya dan tidak dapat diklaim ulang oleh siapa pun melalui endpoint claim.

---

## Subscription dan billing customer

### Paket aktif

```http
GET /api/v1/subscription-plans
```

Response hanya memuat plan dan price yang aktif:

```json
{
  "data": [
    {
      "id": "plan-uuid",
      "code": "pro",
      "name": "Pro",
      "device_limit": 10,
      "sort_order": 3,
      "prices": [
        {
          "id": "price-uuid",
          "billing_interval": "monthly",
          "amount": 99000,
          "currency": "IDR"
        }
      ]
    }
  ],
  "meta": {"request_id": "request-uuid"}
}
```

### Metode pembayaran

```http
GET /api/v1/payment-methods
```

Mengembalikan metode Pakasir yang aktif beserta label tampilannya, supaya client tidak perlu menghafal kode metode.

```json
{
  "data": [
    {"code": "qris", "label": "QRIS", "group": "qris", "is_active": true},
    {"code": "bri_va", "label": "BRI Virtual Account", "group": "va", "is_active": true}
  ],
  "meta": {"request_id": "request-uuid"}
}
```

`group` bernilai `qris` atau `va`. Nilai `code` adalah yang dikirim kembali sebagai `payment_method` saat membuat payment attempt.

### Subscription aktif dan histori

```http
GET /api/v1/customer/subscription
GET /api/v1/customer/subscriptions
```

Jika belum ada subscription aktif, endpoint mengembalikan `data: null`.

Subscription plan free dibuat otomatis saat customer register, dengan status `active` dan `current_period_end` bernilai `null` yang berarti tidak kedaluwarsa. Karena itu customer baru sudah dapat mengklaim device sesuai batas paket free.

### Checkout plan pertama atau setelah expired

```http
POST /api/v1/customer/subscription/checkout
```

Request:

```json
{
  "plan_price_id": "price-uuid",
  "payment_method": "qris"
}
```

Backend mengambil harga dari `plan_prices`. Client tidak boleh mengirim amount, currency, atau customer ID.

Checkout hanya berlaku jika customer tidak memiliki subscription aktif. Jika masih ada subscription aktif, response `409 SUBSCRIPTION_ALREADY_ACTIVE` dan client diarahkan ke endpoint upgrade.

### Upgrade plan aktif

```http
POST /api/v1/customer/subscription/upgrade/preview
POST /api/v1/customer/subscription/upgrade
```

Request:

```json
{
  "plan_price_id": "new-price-uuid",
  "payment_method": "qris"
}
```

Aturan:

- Upgrade hanya ke plan dengan `sort_order` lebih tinggi.
- `plan_price` tujuan wajib memiliki `billing_interval` yang sama dengan subscription berjalan. Beda interval menghasilkan `422 UPGRADE_INTERVAL_MISMATCH`.
- Upgrade aktif setelah webhook pembayaran sukses. `current_period_end` tetap mengikuti periode lama.
- Selama masih ada invoice upgrade yang belum selesai, request upgrade baru menghasilkan `409 UPGRADE_ALREADY_PENDING`.

Formula:

```text
remaining_value_current = current_plan_period_price
                          × remaining_seconds
                          ÷ period_seconds

remaining_value_new = new_plan_period_price
                     × remaining_seconds
                     ÷ period_seconds

amount_due = max(0, remaining_value_new - remaining_value_current)
```

`period_seconds` diambil dari `billing_interval` subscription berjalan. Karena upgrade antar interval dilarang, nilai ini selalu sama untuk plan lama dan plan baru.

Jika `amount_due` berada di bawah `PAKASIR_MIN_AMOUNT`, plan baru langsung aktif tanpa invoice dan tanpa pembayaran, lalu dicatat pada `subscription_events` dengan alasan `below_minimum`.

Nominal final dihitung dan dibulatkan backend sesuai aturan pembulatan. Preview hanya membantu tampilan di client dan tidak mengikat.

Downgrade tidak memiliki endpoint. Saat subscription aktif, response `422 DOWNGRADE_NOT_ALLOWED`. Setelah expired, customer memakai checkout biasa.

### Invoice dan payment

```http
GET  /api/v1/customer/invoices
GET  /api/v1/customer/invoices/{invoice_id}
POST /api/v1/customer/invoices/{invoice_id}/payments
POST /api/v1/customer/invoices/{invoice_id}/payments/{payment_id}/cancel
GET  /api/v1/customer/payments/{payment_id}
```

Payment attempt baru hanya boleh dibuat jika invoice `open` dan attempt sebelumnya `expired`, `failed`, atau `canceled`. Backend menolak attempt baru jika masih ada attempt `pending` dengan `409 PAYMENT_ALREADY_PENDING`.

Customer boleh berpindah metode pembayaran tanpa menunggu attempt sebelumnya kedaluwarsa. Caranya: batalkan attempt `pending` lewat endpoint cancel, lalu buat attempt baru. Endpoint cancel memanggil API pembatalan transaksi Pakasir dan mengubah status attempt menjadi `canceled`.

Membatalkan attempt yang sudah `paid` menghasilkan `409 PAYMENT_ALREADY_PAID`. Membatalkan attempt yang sudah `expired` atau `canceled` bersifat idempotent dan mengembalikan `204`.

Request:

```json
{"payment_method": "qris"}
```

Nilai `payment_method` memakai kode metode Pakasir secara langsung. Daftar lengkapnya ada di bagian Integrasi Pakasir.

Response `201`:

```json
{
  "data": {
    "id": "payment-uuid",
    "invoice_id": "invoice-uuid",
    "provider": "pakasir",
    "payment_method": "qris",
    "status": "pending",
    "amount": 99000,
    "fee": 1003,
    "total_payment": 100003,
    "currency": "IDR",
    "qr_string": "00020101021226610016ID.CO.SHOPEE.WWW...",
    "va_number": null,
    "expires_at": "2026-01-01T10:15:00Z"
  },
  "meta": {"request_id": "request-uuid"}
}
```

Raw provider response tidak dikirim ke client.

Pembayaran sebagian tidak didukung di v1. Invoice hanya lunas jika `amount_paid` sama dengan `total_amount`.

Perhatikan selisih `amount` dan `total_payment`: Pakasir menambahkan biaya layanan di atas nominal tagihan, dan biaya itu dibayar customer. Karena itu:

- `amount` adalah nominal tagihan dan harus sama dengan `invoices.total_amount`.
- `total_payment` adalah yang benar-benar dibayar customer.
- `invoices.amount_paid` diisi sebesar `amount`, bukan `total_payment`.
- Biaya layanan tidak masuk ke `invoices` dan tidak dihitung sebagai pendapatan subscription.

Aplikasi menampilkan ketiganya sebagai baris terpisah:

```text
Tagihan           Rp99.000
Biaya layanan     Rp1.003
Total pembayaran  Rp100.003
```

Nominal yang ditampilkan di samping QR code atau nomor VA adalah `total_payment`, karena itu angka yang harus dibayar customer.

### Sinkronisasi status

```http
POST /api/v1/customer/invoices/{invoice_id}/sync
```

Memaksa backend memverifikasi status terakhir ke Pakasir melalui `transactiondetail`. Dipakai ketika customer sudah membayar tetapi webhook belum diterima.

Aturan:

- Backend mengambil `amount` dari `payment_attempts`, karena `transactiondetail` mewajibkan nominal dikirim sebagai query parameter.
- Endpoint ini hanya membaca. Aktivasi subscription hanya terjadi jika Pakasir mengembalikan `status: completed` dengan `amount` dan `order_id` yang cocok.
- Response mengembalikan status attempt terbaru setelah verifikasi.
- Rate limit: maksimal 5 kali per invoice per menit, untuk mencegah endpoint ini dipakai membanjiri Pakasir.

---

## Admin Web API

Semua endpoint admin memakai JWT dari cookie dan permission terbaru dari server. Jika tidak punya permission, response `403 PERMISSION_DENIED`.

### Diskon: voucher dan flash sale

```http
GET   /api/v1/admin/vouchers
POST  /api/v1/admin/vouchers
GET   /api/v1/admin/vouchers/{voucher_id}
PATCH /api/v1/admin/vouchers/{voucher_id}
DELETE /api/v1/admin/vouchers/{voucher_id}
POST  /api/v1/admin/vouchers/check
GET   /api/v1/admin/flash-sales
POST  /api/v1/admin/flash-sales
GET   /api/v1/admin/flash-sales/{flash_sale_id}
PATCH /api/v1/admin/flash-sales/{flash_sale_id}
DELETE /api/v1/admin/flash-sales/{flash_sale_id}
GET   /api/v1/admin/discount-options
```

Endpoint baca memerlukan `discount.read`. Pembuatan, perubahan, dan penonaktifan memerlukan
`discount.manage`; `POST /api/v1/admin/vouchers/check` tetap memakai `discount.read`. Semua mutasi,
termasuk pemeriksaan voucher yang memakai POST, mengirim `X-CSRF-Token`. `DELETE` hanya menonaktifkan
aturan, bukan menghapus riwayat pemakaian.

Voucher memakai `code`, `discount_type` (`percent` atau `fixed`), `scope` (`all_prices` atau
`selected_prices`), jendela waktu opsional, kuota total opsional, dan batas minimal transaksi opsional.
Kode dinormalisasi menjadi huruf besar dan tidak dapat diubah setelah dibuat. Voucher berlaku sekali
per pelanggan.

Flash sale memakai jendela waktu wajib dan satu atau beberapa paket. Memilih beberapa paket membuat
satu baris per paket dalam satu transaksi. Baris yang sudah dibuat tidak dapat dipindahkan ke paket
lain. Harga yang ditentukan lewat `selected_prices` harus berasal dari paket barisnya.

Voucher dan flash sale tidak ditumpuk. Resolver harga bersama memilih potongan terbesar untuk setiap
harga. `POST /api/v1/admin/vouchers/check` hanya memeriksa dan menghitung, tidak mencatat pemakaian.
Pencatatan redemption dilakukan saat alur pembuatan invoice/checkout tersedia.

Response list tetap memakai cursor pagination dan envelope list di atas. `discount-options` mengirim
pilihan paket dan harga untuk formulir admin beserta ringkasan voucher dan flash sale.

---

### Auth admin

```http
POST /api/v1/admin/auth/login
POST /api/v1/admin/auth/refresh
POST /api/v1/admin/auth/logout
GET  /api/v1/admin/me
GET  /api/v1/admin/auth/csrf
```

Login request:

```json
{"email": "admin@example.com", "password": "admin-password"}
```

Response login tidak mengirim token di body. Server menulis cookie:

```text
admin_access_token: HttpOnly; Secure; SameSite=Lax; Path=/
admin_refresh_token: HttpOnly; Secure; SameSite=Lax; Path=/api/v1/admin/auth
```

`GET /api/v1/admin/auth/csrf` mengembalikan token CSRF. Setiap mutasi berbasis cookie wajib mengirim token tersebut melalui header `X-CSRF-Token`. Token tidak boleh disimpan di localStorage.

Master user pertama dibuat melalui seed atau CLI, bukan register publik.

### Customer

```http
GET   /api/v1/admin/customers
POST  /api/v1/admin/customers
GET   /api/v1/admin/customers/{customer_id}
PATCH /api/v1/admin/customers/{customer_id}
POST  /api/v1/admin/customers/{customer_id}/suspend
POST  /api/v1/admin/customers/{customer_id}/activate
```

Filter list: `status`, `q` (nama atau email), `created_from`, `created_to`.

`POST` membuat akun pelanggan manual dari konsol (izin `customer.create`). Body: `full_name` wajib, minimal satu dari `email` + `password` atau `phone_e164`. Akun langsung aktif dan cara masuknya langsung terverifikasi; kata sandi tidak dikembalikan dalam response. Duplikat email → `EMAIL_ALREADY_REGISTERED` (409), duplikat nomor WhatsApp → `PHONE_ALREADY_LINKED` (409).

### Device

Inventory device dikelola admin. Device didaftarkan sebelum dapat diklaim customer.

```http
GET   /api/v1/admin/devices
POST  /api/v1/admin/devices
GET   /api/v1/admin/devices/{device_id}
PATCH /api/v1/admin/devices/{device_id}
POST  /api/v1/admin/devices/{device_id}/assign
POST  /api/v1/admin/devices/{device_id}/unassign
POST  /api/v1/admin/devices/{device_id}/claim-code/rotate
GET   /api/v1/admin/device-claims
```

Filter list device: `status`, `model`, `batch_number`, `customer_id`, `q` (serial atau device_uid).

#### Daftarkan device

```http
POST /api/v1/admin/devices
```

Request:

```json
{
  "serial_number": "SN-2026-000123",
  "model": "NYK-C200",
  "hardware_revision": "rev-b",
  "batch_number": "BATCH-2026-01",
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "imei": null,
  "warranty_start_at": "2026-01-01T00:00:00Z"
}
```

`serial_number` wajib dan unik. `device_uid` digenerate server, tidak pernah dikirim client.

Response `201`:

```json
{
  "data": {
    "device": {
      "id": "device-uuid",
      "device_uid": "NYK-000001",
      "serial_number": "SN-2026-000123",
      "model": "NYK-C200",
      "status": "in_stock",
      "created_at": "2026-01-01T09:00:00Z"
    },
    "claim_label": {
      "claim_token": "token-plaintext-ditampilkan-sekali",
      "qr_payload": "nayaka://claim?t=token-plaintext-ditampilkan-sekali"
    }
  },
  "meta": {"request_id": "request-uuid"}
}
```

`claim_label.claim_token` hanya dikembalikan sekali, yaitu saat pembuatan atau saat rotasi. Server menyimpan hash-nya. Token ini dicetak pada label atau dus perangkat.

`POST /api/v1/admin/devices/{device_id}/claim-code/rotate` mencabut claim code lama dan membuat yang baru. Dipakai jika label rusak atau device perlu diterbitkan ulang setelah unassign.

#### Assign dan unassign oleh admin

Request assign:

```json
{
  "customer_id": "customer-uuid",
  "reason": "Manual assignment by support"
}
```

Request unassign:

```json
{"reason": "Claim dilakukan dengan serial yang salah"}
```

Aturan:

- Claim code bersifat sekali pakai dan tidak pernah diterbitkan ulang otomatis. Karena itu satu device hanya memiliki satu pemilik melalui jalur customer.
- Unassign adalah tindakan korektif, bukan cara memindahkan kepemilikan secara rutin. Wajib memakai `reason` dan selalu menulis `audit_logs`.
- Setelah unassign, device kembali berstatus `in_stock` dan claim code lamanya tetap dianggap terpakai. Device hanya dapat diklaim lagi jika admin merotasi claim code baru.
- Backend tetap memeriksa batas device pada assign.
- Perangkat yang ditugaskan lewat jalur ini memiliki `claim_method` bernilai `null`, karena kolom
  itu mencatat cara customer mengklaim dan bukan cara admin menugaskan. Fakta penugasannya
  tercatat di `audit_logs` dengan aksi `device.assign`.

#### Log claim

```http
GET /api/v1/admin/device-claims
```

Menampilkan riwayat percobaan claim dari `device_claim_attempts`, termasuk yang gagal. Filter: `success`, `submitted_kind`, `customer_id`, `created_from`, `created_to`. Endpoint ini menjadi alat utama untuk menelusuri penyalahgunaan jalur serial.

### Paket dan harga

```http
GET   /api/v1/admin/subscription-plans
POST  /api/v1/admin/subscription-plans
PATCH /api/v1/admin/subscription-plans/{plan_id}
GET   /api/v1/admin/plan-prices
POST  /api/v1/admin/plan-prices
PATCH /api/v1/admin/plan-prices/{price_id}
```

Harga lama tidak diubah untuk histori invoice. Buat record price baru dan nonaktifkan price lama.

### Subscription, invoice, payment

```http
GET  /api/v1/admin/subscriptions
GET  /api/v1/admin/subscriptions/{subscription_id}
POST /api/v1/admin/subscriptions/{subscription_id}/cancel
GET  /api/v1/admin/invoices
GET  /api/v1/admin/invoices/{invoice_id}
POST /api/v1/admin/invoices/{invoice_id}/void
GET  /api/v1/admin/payments
GET  /api/v1/admin/payments/{payment_id}
POST /api/v1/admin/payments/{payment_id}/refund
PATCH /api/v1/admin/payments/{payment_id}/refund/{refund_id}
```

Refund memerlukan alasan dan audit log. Endpoint ini **mencatat** refund, bukan memprosesnya:
dokumentasi Pakasir yang tersedia tidak memuat API refund, sehingga pengembalian dana dilakukan
manual dari dasbor Pakasir. Karena itu `provider_refund_id` wajib diisi, supaya catatan kita dapat
dicocokkan dengan mutasi di dasbor penyedia saat diperiksa.

Batas yang ditegakkan: hanya pembayaran berstatus `paid` yang dapat dikembalikan; total refund
tidak boleh melebihi `payment_attempts.amount` (bukan `provider_total_payment`, karena biaya
layanan penyedia bukan pendapatan kita); dan satu pembayaran hanya boleh memiliki satu catatan
refund yang tidak berstatus `failed`.

Refund dapat dicatat sebagai `pending` bila penyedia belum menyelesaikan prosesnya, lalu
statusnya diperbarui lewat `PATCH /api/v1/admin/payments/{payment_id}/refund/{refund_id}`.
Perubahan status ke `completed` mengisi `completed_at`; laporan pengembalian dana memakai dasar
kas pada `completed_at`, sehingga refund yang tidak pernah ditandai selesai tidak akan muncul di
laporan mana pun.

### Admin, role, dan permission

```http
GET   /api/v1/admin/admin-users
POST  /api/v1/admin/admin-users
PATCH /api/v1/admin/admin-users/{admin_user_id}
POST  /api/v1/admin/admin-users/{admin_user_id}/deactivate
POST  /api/v1/admin/admin-users/{admin_user_id}/activate
DELETE /api/v1/admin/admin-users/{admin_user_id}
GET   /api/v1/admin/roles
POST  /api/v1/admin/roles
PATCH /api/v1/admin/roles/{role_id}
GET   /api/v1/admin/permissions
```

Memerlukan permission `admin.manage`. Admin tidak dapat menonaktifkan dirinya sendiri atau mencabut role terakhir yang memiliki `admin.manage`.

### Audit

```http
GET /api/v1/admin/audit-logs
GET /api/v1/admin/login-attempts
GET /api/v1/admin/admin-sessions
POST /api/v1/admin/admin-sessions/{session_id}/revoke
GET /api/v1/admin/session-events
```

`session-events` adalah siklus hidup sesi: masuk, token diperbarui, keluar sendiri, dicabut,
kedaluwarsa, dan kata sandi diubah. Tabelnya disyaratkan pada poin 13 catatan kontrak, dan
alamatnya mengikuti pola jalur datar yang sama dengan tiga endpoint audit di atas. Perbedaannya
dengan `admin-sessions`: yang itu menjawab sesi mana yang masih hidup sekarang, yang ini
menjawab apa yang terjadi pada sesi-sesi itu, termasuk sesi yang sudah tidak ada.

Audit log tidak boleh diedit melalui API biasa.

`audit-logs` memuat tindakan admin dan tindakan sistem pada satu garis waktu. Kolom
`actor_type` membedakan keduanya, dan `admin_user_id` bernilai null untuk tindakan sistem.
Tindakan sistem yang masuk ke sini misalnya job rekonsiliasi menandai pembayaran terverifikasi,
dan subscription yang kedaluwarsa oleh scheduler.

`login-attempts` hanya mencatat percobaan masuk yang gagal dan berhasil, termasuk yang ditolak
karena rate limit. Ini sumber data untuk mendeteksi percobaan masuk berulang.

`admin-sessions` menampilkan siklus hidup sesi: sesi aktif, sesi yang sudah dicabut, dan
ip serta user agent yang dipakai. Endpoint revoke mencabut sesi milik admin lain dan wajib
memiliki permission `admin.manage`. Admin tidak dapat mencabut sesinya sendiri melalui
endpoint ini.

### Ringkasan operasional

```http
GET /api/v1/admin/dashboard/business
GET /api/v1/admin/dashboard/finance
GET /api/v1/admin/dashboard/operations
GET /api/v1/admin/action-queue
```

Ketiga endpoint dashboard dipisah karena isinya berbeda dan tidak selalu dibuka bersamaan.
Menggabungkannya menjadi satu response berarti tab Bisnis selalu membayar biaya query tab
Operasional, padahal tab Operasional membaca tabel log yang jauh lebih besar.

`dashboard/business` memuat:

```json
{
  "data": {
    "customers": {
      "total": 0,
      "active": 0,
      "suspended": 0,
      "new_in_period": 0
    },
    "subscriptions": {
      "active": 0,
      "expired": 0,
      "canceled": 0,
      "by_plan": [
        { "plan_id": "uuid", "plan_name": "Basic", "active_count": 0 }
      ]
    },
    "devices": {
      "in_stock": 0,
      "claimed": 0,
      "suspended": 0,
      "claim_rate_percent": 0
    },
    "mrr": {
      "amount": 0,
      "currency": "IDR",
      "as_of": "2026-09-12T00:00:00.000Z"
    },
    "period": { "from": "2026-09-01", "to": "2026-09-30", "granularity": "day" },
    "series": [
      { "bucket": "2026-09-01", "new_customers": 0, "new_subscriptions": 0, "revenue": 0 }
    ]
  }
}
```

`series` mengikuti `granularity` yang diminta, yaitu `day`, `week`, atau `month`.
Rentang maksimum satu tahun per permintaan.

`dashboard/finance` memuat:

```json
{
  "data": {
    "revenue": {
      "in_period": 0,
      "previous_period": 0,
      "change_percent": 0
    },
    "receivables": {
      "open_count": 0,
      "open_amount": 0,
      "past_due_count": 0,
      "past_due_amount": 0
    },
    "refunds": {
      "count": 0,
      "amount": 0
    },
    "payments": {
      "settled_count": 0,
      "pending_count": 0,
      "failed_count": 0,
      "unverified_count": 0
    },
    "period": { "from": "2026-09-01", "to": "2026-09-30" }
  }
}
```

`unverified_count` adalah jumlah payment attempt yang sudah mencapai provider tetapi belum
lolos verifikasi, baik karena webhook belum tiba maupun karena verifikasi gagal. Angka ini
yang menjadi ukuran seberapa besar ketergantungan pada job rekonsiliasi masih tersisa.

`dashboard/operations` memuat:

```json
{
  "data": {
    "provider": {
      "inbound_webhook_count": 0,
      "inbound_verified_count": 0,
      "inbound_rejected_count": 0,
      "inbound_unknown_order_count": 0,
      "outbound_call_count": 0,
      "outbound_failed_count": 0,
      "outbound_p95_duration_ms": 0
    },
    "jobs": [
      {
        "job_name": "reconcile_payments",
        "last_started_at": "2026-09-12T00:00:00.000Z",
        "last_finished_at": "2026-09-12T00:00:04.000Z",
        "last_outcome": "success",
        "expected_interval_minutes": 5,
        "is_stale": false
      }
    ],
    "claim_anomalies": {
      "flagged_customers": 0,
      "flagged_ips": 0,
      "failed_attempts": 0
    },
    "admin_sessions": {
      "active": 0
    },
    "period": { "from": "2026-09-12T00:00:00.000Z", "to": "2026-09-12T23:59:59.999Z" }
  }
}
```

`is_stale` bernilai true jika `last_finished_at` sudah melewati
`expected_interval_minutes` dikali dua. Kolom ini ada karena job rekonsiliasi adalah pengaman
utama pembayaran. Job yang berhenti berjalan tidak akan terlihat dari halaman mana pun kecuali
dinyatakan di sini.

`dashboard/operations` selalu memakai jendela waktu berjalan sejak tengah malam waktu server,
bukan rentang yang dikirim klien, karena tujuannya memantau keadaan sekarang.

`action-queue` mengembalikan daftar hal yang menunggu tindakan manusia:

```json
{
  "data": {
    "items": [
      {
        "kind": "unverified_payment",
        "severity": "high",
        "reference_id": "uuid",
        "reference_label": "INV-2026-000123",
        "summary": "Pembayaran belum lolos verifikasi selama 32 menit",
        "occurred_at": "2026-09-12T09:00:00.000Z",
        "action_label": "Periksa pembayaran",
        "action_href": "/payments/uuid"
      }
    ],
    "counts_by_kind": {
      "unverified_payment": 0,
      "claim_anomaly": 0,
      "past_due_invoice": 0,
      "expiring_subscription": 0
    }
  }
}
```

Jenis item pada v1:

| `kind` | Muncul saat | Severity |
|---|---|---|
| `unverified_payment` | Payment attempt mencapai provider, belum lolos verifikasi lebih dari 15 menit | `high` |
| `unknown_order_webhook` | Webhook tiba dengan `order_id` yang tidak dikenal | `high` |
| `claim_anomaly` | Customer atau IP mencapai batas rate limit claim | `medium` |
| `past_due_invoice` | Invoice melewati `due_at` dan belum dibayar | `medium` |
| `expiring_subscription` | Subscription aktif dengan `current_period_end` dalam 3 hari | `low` |

`action-href` selalu menuju halaman detail objek terkait, sehingga setiap item dapat
ditindaklanjuti tanpa pencarian tambahan.

### Laporan

```http
GET /api/v1/admin/reports/{type}
GET /api/v1/admin/reports/{type}/export.csv
```

Nilai `type` pada v1:

| `type` | Isi |
|---|---|
| `revenue` | Pendapatan per periode, dari invoice lunas |
| `growth` | Pelanggan baru dan langganan baru per periode |
| `receivables` | Invoice belum dibayar dan yang lewat jatuh tempo |
| `subscriptions` | Langganan per paket, upgrade, dan churn |
| `devices` | Inventory, tingkat klaim, per model |
| `anomalies` | Percobaan klaim gagal dan webhook yang tidak lolos verifikasi |
| `refunds` | Refund per periode beserta alasan |

Seluruh tipe menerima parameter berikut:

| Parameter | Nilai | Keterangan |
|---|---|---|
| `from` | tanggal | Wajib |
| `to` | tanggal | Wajib, maksimum 366 hari dari `from` |
| `granularity` | `day`, `week`, `month` | Hanya untuk `revenue`, `growth`, dan `refunds` |

`growth` memakai deret yang sama dengan `dashboard/business`, sehingga angka pelanggan baru pada
dashboard dan laporan selalu sama. Kolom `conversion_percent` bernilai `null` pada periode tanpa
pelanggan baru, karena tidak ada yang bisa dibagi.

Response berbentuk:

```json
{
  "data": {
    "type": "revenue",
    "definition": "Pendapatan diakui pada invoices.paid_at. Biaya layanan Pakasir tidak termasuk.",
    "period": { "from": "2026-09-01", "to": "2026-09-30" },
    "summary": [
      { "label": "Total pendapatan", "value": 0, "format": "currency" },
      { "label": "Jumlah invoice", "value": 0, "format": "number" }
    ],
    "columns": [
      { "key": "bucket", "label": "Periode" },
      { "key": "invoice_count", "label": "Jumlah invoice", "format": "number" },
      { "key": "amount", "label": "Pendapatan", "format": "currency" }
    ],
    "rows": [
      { "bucket": "2026-09-01", "invoice_count": 0, "amount": 0 }
    ],
    "totals": { "invoice_count": 0, "amount": 0 }
  }
}
```

`definition` wajib diisi setiap tipe dan berisi kalimat yang menyatakan bagaimana angka itu
dihitung. Halaman laporan menampilkan kalimat ini di bawah judul, karena angka pendapatan
tanpa keterangan dasar perhitungan mudah disalahartikan.

`columns` menentukan urutan dan label kolom, sehingga halaman laporan tidak perlu mengetahui
bentuk tiap jenis laporan. Tipe `receivables`, `subscriptions`, `devices`, dan `anomalies` hanya
menerima `from` dan `to` tanpa `granularity`, dan barisnya berupa daftar objek, bukan agregat per
periode.

Endpoint export mengembalikan berkas CSV dengan kolom yang sama seperti `columns`, ditambah
baris `summary` sebagai komentar di bagian atas. CSV memakai pemisah koma dan encoding UTF-8
dengan BOM, karena Excel di Windows menampilkan karakter Indonesia sebagai mojibake tanpa BOM.

Export dibatasi 50.000 baris per permintaan. Jika melebihi, response berstatus `422` dan
meminta rentang yang lebih pendek. Isi CSV dan isi `rows` selalu dihitung dari query yang sama,
supaya angka di layar dan angka di berkas tidak pernah berbeda.

### Log provider pembayaran

```http
GET /api/v1/admin/provider-logs
GET /api/v1/admin/provider-logs/{log_id}
```

Satu halaman untuk dua arah komunikasi dengan Pakasir:

| Parameter | Nilai | Keterangan |
|---|---|---|
| `direction` | `inbound`, `outbound` | Kosong berarti keduanya |
| `outcome` | `verified`, `rejected`, `unknown_order`, `success`, `failed` | Kosong berarti semua |
| `order_id` | teks | Pencarian langsung |
| `from`, `to` | waktu | Rentang |

Baris `inbound` berasal dari `payment_webhook_events`, baris `outbound` dari
`payment_provider_calls`. Response menyatukan keduanya dalam satu bentuk:

```json
{
  "data": [
    {
      "id": "uuid",
      "direction": "inbound",
      "operation": "webhook",
      "order_id": "NAY-2026-000123-1",
      "provider_status": "completed",
      "outcome": "verified",
      "http_status": 200,
      "duration_ms": null,
      "ip_address": "203.0.113.1",
      "error_message": null,
      "occurred_at": "2026-09-12T09:00:00.000Z"
    }
  ],
  "meta": { "total": 0, "page": 1, "per_page": 50 }
}
```

Detail endpoint mengembalikan `request_body` dan `response_body` apa adanya.

Karena webhook Pakasir tidak bertanda tangan, `outcome` adalah kolom terpenting pada halaman
ini, bukan payload. Nilai yang mungkin:

| `outcome` | Arti |
|---|---|
| `verified` | Webhook tiba dan cocok dengan payment attempt setelah dicek ke `transactiondetail` |
| `rejected` | Webhook tiba tetapi tidak lolos pemeriksaan nominal, status, atau `order_id` |
| `unknown_order` | Webhook tiba dengan `order_id` yang tidak ada di database |
| `success` | Panggilan keluar kita berhasil |
| `failed` | Panggilan keluar kita gagal, karena HTTP error, jaringan, atau timeout |

`rejected` dan `unknown_order` adalah indikasi upaya pemalsuan, dan keduanya wajib muncul di
antrian tindakan.

Isi `request_body` disaring sebelum disimpan dan sebelum ditampilkan. Field yang memuat
kredensial atau data pribadi ditulis ulang menjadi `"[disaring]"`. Penyaringan dilakukan saat
penulisan, bukan saat pembacaan, supaya data sensitif tidak pernah tersimpan.

### Definisi metrik

Seluruh angka pada dashboard dan laporan dihitung dari definisi berikut. Definisi ini mengikat,
dan setiap perubahan harus disertai perubahan `definition` pada response laporan.

**Zona waktu.** Semua pengelompokan per hari, per minggu, dan per bulan memakai WIB, yaitu
UTC+7. Bukan UTC.

Ini bukan detail sepele. Pembayaran pukul 06.00 WIB tanggal 1 jatuh pada pukul 23.00 UTC
tanggal terakhir bulan sebelumnya. Jika pengelompokan memakai UTC, pembayaran itu masuk ke
bulan yang salah, dan laporan pendapatan bulanan akan berbeda dari yang diharapkan pemilik
usaha. Batas periode `from` berarti pukul 00.00.00.000 WIB pada tanggal itu, dan `to` berarti
pukul 23.59.59.999 WIB pada tanggal itu, keduanya inklusif.

**Pendapatan.** Dasar kas. Pendapatan diakui pada `invoices.paid_at`, bukan pada `created_at`
dan bukan pada `issued_at`. Nilainya adalah `invoices.amount_paid`, yaitu jumlah tagihan tanpa
biaya layanan Pakasir.

Biaya layanan Pakasir adalah biaya perantara, bukan pendapatan. `provider_total_payment`
adalah yang dibayar customer, dan nilainya selalu lebih besar dari `amount_paid`. Memakai
`provider_total_payment` sebagai pendapatan akan melebihkan angka dan tidak akan pernah cocok
dengan mutasi rekening setelah dipotong biaya.

Konsekuensi dasar kas: refund diakui pada tanggal refund itu sendiri
(`payment_refunds.completed_at`), bukan mundur ke periode invoice asalnya. Karena itu laporan
periode lampau tidak pernah berubah angkanya setelah dilaporkan.

Invoice lunas yang kemudian di-void diperlakukan sebagai refund pada tanggal void, bukan
sebagai penghapusan pendapatan periode lama, dengan alasan yang sama.

**Perubahan pendapatan antar periode.** `change_percent` dihitung dari
`(in_period - previous_period) / previous_period * 100`. Jika `previous_period` bernilai nol,
field ini bernilai `null`, bukan angka tak hingga. Halaman menampilkan tanda pisah, bukan
persentase yang tidak bermakna.

**Piutang.** Invoice berstatus `open` dihitung sebagai piutang, dan yang `due_at`-nya sudah
lewat dihitung sebagai jatuh tempo. Invoice berstatus `paid` dan `void` tidak pernah masuk
piutang. Invoice dengan `amount_paid` sebagian belum ada di v1, jadi tidak ada perhitungan
parsial.

**Pendapatan berulang bulanan.** Jumlahkan harga periode setiap subscription berbayar aktif,
lalu bagi jumlah bulan dalam periode itu. `monthly` dibagi 1, `yearly` dibagi 12. Subscription
dengan paket gratis dikecualikan, karena harganya nol dan memasukkannya hanya menambah baris
tanpa menambah angka.

Yang dihitung adalah paket yang sedang aktif, bukan yang pernah aktif. Upgrade berlaku serta
merta pada saat perpindahan, tanpa diprorata pada bulan berjalan.

**Churn.** Subscription berbayar yang berpindah ke `expired` dan masih `expired` setelah tujuh
hari. Tujuh hari itu masa tenggang, karena customer yang membayar terlambat sehari belum tentu
berhenti berlangganan.

Subscription gratis tidak pernah dihitung churn, karena `current_period_end`-nya kosong dan
statusnya tidak pernah menjadi `expired`. Subscription yang di-`cancel` oleh admin juga tidak
dihitung churn, karena itu keputusan kita, bukan customer yang berhenti.

**Tingkat klaim perangkat.** `claimed / (in_stock + claimed + suspended) * 100`, dihitung dari
`devices.status`. Device yang `suspended` tetap dihitung penyebut karena perangkat itu sudah
keluar dari stok, meski sedang tidak dapat dipakai.

**Anomali klaim.** Bukan ambang baru. Anomali adalah customer atau alamat IP yang mencapai
batas rate limit klaim yang sudah ditetapkan pada bagian `Claim device`, yaitu lima percobaan
gagal per customer per jam, atau sepuluh percobaan gagal per IP per jam.

Definisi ini sengaja memakai angka yang sama dengan yang dipakai server untuk menolak
permintaan. Kalau laporan memakai ambang sendiri, akan ada dua sumber kebenaran, dan suatu
saat keduanya berbeda tanpa ada yang tahu mana yang benar.

**Pembayaran belum terverifikasi.** Payment attempt yang `provider_order_id`-nya sudah terisi,
`verified_at`-nya masih kosong, dan `created_at`-nya lebih dari lima belas menit lalu.

Batas lima belas menit dipilih karena job rekonsiliasi berjalan setiap lima menit. Pembayaran
yang belum terverifikasi setelah tiga kali putaran job berarti ada yang benar-benar salah,
bukan sekadar webhook yang belum tiba.

**Pembulatan.** Seluruh nilai uang adalah bilangan bulat rupiah. Tidak ada sen, dan tidak ada
pembulatan pada perhitungan agregat. Persentase dibulatkan ke satu angka di belakang koma, dan
hanya pada saat ditampilkan.

**Nilai kosong.** Rata-rata dan persentase yang penyebutnya nol bernilai `null`, bukan nol.
Nol berarti hasil pengukuran, sedangkan `null` berarti tidak ada yang diukur. Menampilkan nol
untuk keduanya membuat pengguna menyimpulkan hal yang salah.

---

## Integrasi Pakasir

### Mode integrasi

Pakasir menyediakan dua cara:

| Mode | Cara kerja | Status |
|---|---|---|
| API | Server memanggil `transactioncreate`, menerima QR string atau nomor VA, lalu menampilkannya sendiri | **Dipakai** |
| URL | Customer diarahkan ke halaman pembayaran Pakasir | **Tidak dipakai** |

Keputusan: seluruh pembayaran memakai mode API. Halaman pembayaran, tampilan QR code, dan tampilan nomor Virtual Account dibuat sendiri oleh aplikasi. Customer tidak pernah diarahkan ke `app.pakasir.com`.

Konsekuensinya, parameter URL seperti `redirect` dan `qris_only` tidak relevan dan tidak dipakai. Aplikasi bertanggung jawab mengubah `qr_string` menjadi gambar QR, dan menampilkan nomor VA beserta nominalnya.

### Konfigurasi

```text
PAKASIR_BASE_URL              default https://app.pakasir.com
PAKASIR_PROJECT_SLUG          slug proyek, contoh depodomain
PAKASIR_API_KEY               API key proyek
PAKASIR_MODE                  sandbox atau production
PAKASIR_WEBHOOK_PATH_SECRET   segmen rahasia pada path webhook
PAKASIR_MIN_AMOUNT            ambang nominal terkecil yang layak ditagihkan, default 1000
```

Seluruh nilai ini hanya boleh tersedia di server. `PAKASIR_API_KEY` tidak pernah dikirim ke client.

`PAKASIR_MIN_AMOUNT` adalah kebijakan internal, bukan batas dari Pakasir. Pakasir tidak mendokumentasikan nominal minimum.

Webhook URL yang didaftarkan pada form Edit Proyek:

```text
https://{domain}/api/v1/webhooks/payments/pakasir/{PAKASIR_WEBHOOK_PATH_SECRET}
```

### Membuat transaksi

```http
POST {PAKASIR_BASE_URL}/api/transactioncreate/{method}
Content-Type: application/json

{
  "project": "depodomain",
  "order_id": "INV-2026-0001-1",
  "amount": 99000,
  "api_key": "xxx123"
}
```

`amount` dikirim sebagai integer tanpa titik dan spasi. Ini sejalan dengan aturan pembulatan half-up ke rupiah utuh, sehingga tidak ada nilai desimal yang perlu dikirim.

Respons Pakasir:

```json
{
  "payment": {
    "project": "depodomain",
    "order_id": "INV123123",
    "amount": 99000,
    "fee": 1003,
    "total_payment": 100003,
    "payment_method": "qris",
    "payment_number": "00020101021226610016ID.CO.SHOPEE.WWW...",
    "expired_at": "2025-09-19T01:18:49.678622564Z"
  }
}
```

Pemetaan ke `payment_attempts`:

| Field Pakasir | Kolom |
|---|---|
| `order_id` | `provider_order_id` |
| `amount` | `amount` |
| `fee` | `provider_fee` |
| `total_payment` | `provider_total_payment` |
| `payment_method` | `payment_method` |
| `payment_number` | `qr_string` bila QRIS, `va_number` bila VA |
| `expired_at` | `expires_at` |

Pakasir tidak mengembalikan ID transaksi internal. Karena itu `provider_payment_id` tidak diisi, dan seluruh penelusuran memakai `order_id`.

### Aturan `order_id`

`order_id` adalah kunci transaksi di sisi Pakasir, sehingga tidak boleh dipakai dua kali. Karena satu invoice dapat memiliki beberapa payment attempt, `order_id` **tidak boleh** memakai `invoice_number` saja.

Format yang dipakai:

```text
order_id = {invoice_number}-{attempt_sequence}

contoh: INV-2026-0001-1
        INV-2026-0001-2
```

`provider_order_id` disimpan unik di `payment_attempts`. Webhook yang datang dengan `order_id` tertentu langsung dapat dipetakan ke satu payment attempt, tanpa menebak attempt mana yang dibayar.

### Metode pembayaran

`payment_method` memakai kode Pakasir apa adanya:

```text
qris
cimb_niaga_va
bni_va
sampoerna_va
bnc_va
maybank_va
permata_va
atm_bersama_va
artha_graha_va
bri_va
```

`qris` menghasilkan QR string. Sisanya menghasilkan nomor Virtual Account. Client tidak perlu menghafal daftar ini, karena backend menyediakan `GET /api/v1/payment-methods` yang mengembalikan metode beserta label tampilannya.

### Membatalkan transaksi

```http
POST {PAKASIR_BASE_URL}/api/transactioncancel
Content-Type: application/json

{
  "project": "depodomain",
  "order_id": "INV-2026-0001-1",
  "amount": 99000,
  "api_key": "xxx123"
}
```

Body-nya sama dengan `transactioncreate`, termasuk `amount` wajib dikirim. Karena itu `amount` harus disimpan di `payment_attempts` dan tidak boleh dihitung ulang saat pembatalan.

Backend memakai endpoint ini ketika:

- Customer berpindah metode pembayaran sebelum attempt sebelumnya kedaluwarsa, melalui `POST /api/v1/customer/invoices/{invoice_id}/payments/{payment_id}/cancel`.
- Admin membatalkan invoice yang masih `open`.

Setelah pembatalan berhasil, `payment_attempts.status` menjadi `canceled` dan `canceled_at` diisi.

Bentuk response API pembatalan tidak didokumentasikan. Backend memperlakukan pembatalan sebagai berhasil jika response HTTP sukses, lalu tetap memverifikasi lewat `transactiondetail`. Jika status di Pakasir ternyata masih `completed`, pembatalan dibatalkan dan status lokal dikembalikan.

### Detail transaksi

```http
GET {PAKASIR_BASE_URL}/api/transactiondetail?project={slug}&amount={amount}&order_id={order_id}&api_key={api_key}
```

Response:

```json
{
  "transaction": {
    "amount": 22000,
    "order_id": "240910HDE7C9",
    "project": "depodomain",
    "status": "completed",
    "payment_method": "qris",
    "completed_at": "2024-09-10T08:07:02.819+07:00"
  }
}
```

Perhatikan bahwa `amount` wajib dikirim sebagai query parameter. Artinya Pakasir memerlukan nominal untuk menemukan transaksi, sehingga backend harus membaca `amount` dari `payment_attempts` lebih dulu, bukan menebaknya.

Endpoint ini adalah **satu-satunya sumber kebenaran status pembayaran**. Webhook hanya berfungsi sebagai pemicu. Detailnya ada di bagian Webhook.

Status yang didokumentasikan baru `completed`. Nilai status lain belum diketahui, sehingga backend memperlakukan status apa pun selain `completed` sebagai belum lunas dan tidak mengaktifkan subscription.

### Sandbox dan simulasi

Saat `PAKASIR_MODE=sandbox`, backend boleh memanggil:

```http
POST {PAKASIR_BASE_URL}/api/paymentsimulation
```

untuk memicu pembayaran palsu dan menguji jalur webhook. Endpoint simulasi tidak pernah dipanggil ketika `PAKASIR_MODE=production`. Backend wajib menolak permintaan simulasi dari client dalam kondisi apa pun.

### Webhook

```http
POST /api/v1/webhooks/payments/pakasir/{PAKASIR_WEBHOOK_PATH_SECRET}
```

Endpoint tidak memakai auth customer atau admin.

Payload yang dikirim Pakasir:

```json
{
  "amount": 22000,
  "order_id": "240910HDE7C9",
  "project": "depodomain",
  "status": "completed",
  "payment_method": "qris",
  "completed_at": "2024-09-10T08:07:02.819+07:00"
}
```

#### Webhook tidak dapat dipercaya

Payload webhook **tidak memuat signature, tidak memuat secret, dan tidak memuat event ID**. Pakasir mengirimnya sebagai POST biasa tanpa mekanisme autentikasi apa pun. Artinya siapa pun yang mengetahui URL webhook dapat mengirim payload palsu yang menyatakan sebuah invoice sudah lunas.

Dokumentasi Pakasir sendiri menyarankan hal yang sama:

> Penting: Saat menerima webhook pastikan amount dan order_id sesuai dengan transaksi di sistem Anda. Kami sarankan untuk tetap menggunakan API dibawah ini untuk pengecekan status yang lebih valid.

Karena itu aturan yang mengikat:

- **Webhook adalah pemicu, bukan sumber kebenaran.** Webhook tidak pernah mengubah status apa pun secara langsung.
- Setiap webhook yang masuk wajib diverifikasi lewat `GET /api/transactiondetail` sebelum ada perubahan status.
- Status pembayaran hanya berubah jika `transactiondetail` mengembalikan `status: completed` dengan `order_id` dan `amount` yang cocok.
- Payload webhook tidak dipercaya untuk `amount`, `status`, maupun `payment_method`. Nilai yang dipakai selalu berasal dari `transactiondetail`.
- Karena verifikasi memanggil Pakasir, webhook palsu tidak dapat mengaktifkan subscription: Pakasir tidak akan mengenali `order_id` yang tidak pernah dibuat.

Dengan pola ini, hilangnya signature bukan lagi lubang keamanan. Yang tersisa hanyalah penyalahgunaan resource, yaitu request palsu yang memaksa server memanggil Pakasir. Itu ditangani dengan rate limit pada endpoint webhook.

`PAKASIR_WEBHOOK_PATH_SECRET` tetap dipakai sebagai lapisan tambahan agar URL tidak mudah ditemukan, dibandingkan memakai perbandingan waktu konstan. Ini bukan batas keamanan, jadi jangan diandalkan sebagai satu-satunya proteksi.

#### Kunci idempotensi

Tidak ada event ID, jadi kunci disusun dari data yang tersedia:

```text
provider_event_id = {order_id}:{status}
```

Satu `order_id` hanya mewakili satu transaksi, sehingga kombinasi ini cukup mencegah pemrosesan ganda. Header `Idempotency-Key` tidak dipakai karena Pakasir tidak mengirim header tersebut.

#### Flow server

1. Validasi `PAKASIR_WEBHOOK_PATH_SECRET`.
2. Parse payload, wajib memuat `order_id`, `amount`, `status`, dan `project`.
3. Tolak jika `project` tidak sama dengan `PAKASIR_PROJECT_SLUG`.
4. Cari `payment_attempt` berdasarkan `provider_order_id`.
5. Simpan payload ke `payment_webhook_events` dengan kunci idempotensi. Jika sudah ada, return `200` tanpa memproses ulang.
6. Verifikasi ke Pakasir lewat `transactiondetail` memakai `amount` dari `payment_attempts`.
7. Jika status `completed` dan `amount` cocok, jalankan satu transaction: update `payment_attempts`, `invoices`, `subscriptions`, dan `subscription_events`.
8. Tandai `processed_at`.
9. Return `200`.

Langkah 6 sampai 8 dijalankan sebagai pekerjaan terpisah setelah response dikirim, supaya handler webhook tidak bergantung pada latensi Pakasir. Jika verifikasi gagal karena gangguan jaringan, event dibiarkan dengan `processed_at` NULL dan diambil oleh job rekonsiliasi.

#### Response

| Kondisi | Status | Catatan |
|---|---|---|
| Path secret tidak valid | `404` | Tidak diproses, dicatat sebagai percobaan gagal |
| Payload tidak lengkap | `200` | Dicatat dengan `processing_error` |
| `project` tidak cocok | `200` | Dicatat dengan `processing_error` |
| `order_id` tidak dikenal | `200` | Dicatat dengan `processing_error`, tidak memanggil Pakasir |
| Event duplikat | `200` | Body `{"status":"ignored_duplicate"}` |
| Verifikasi Pakasir gagal sementara | `200` | `processed_at` dibiarkan NULL, diambil job rekonsiliasi |
| Berhasil diproses | `200` | Setelah verifikasi `completed` |
| Gagal database | `500` | Provider diharapkan mengulang |

Path secret yang salah dibalas `404`, bukan `401`, supaya keberadaan endpoint tidak terkonfirmasi.

Kebijakan retry Pakasir tidak didokumentasikan. Karena itu backend tidak boleh menggantungkan diri pada retry dari Pakasir, dan wajib memiliki job rekonsiliasi yang memverifikasi sendiri seluruh attempt yang masih `pending`.

#### Rate limit webhook

- Maksimal 60 request per menit per IP.
- Maksimal 300 request per menit secara global.
- Setiap request dicatat beserta `ip_address` dan `user_agent` pada `payment_webhook_events`.

#### Format waktu

`completed_at` dari Pakasir memakai offset waktu lokal, contohnya `2024-09-10T08:07:02.819+07:00`. Nilai ini dikonversi ke UTC sebelum disimpan, sesuai aturan bahwa seluruh timestamp di database memakai ISO 8601 UTC.

#### Daftar status

Yang didokumentasikan baru `completed`. Backend hanya mengaktifkan subscription pada nilai itu. Nilai lain dicatat apa adanya pada `payment_webhook_events.event_type` dan tidak mengubah status apa pun. Ketika daftar status lengkap tersedia, pemetaannya ditambahkan tanpa mengubah arsitektur.

---

## JWT, cookie, authorization, dan security

Customer access JWT minimal:

```json
{
  "sub": "customer-uuid",
  "typ": "customer_access",
  "sid": "session-uuid",
  "iat": 0,
  "exp": 0
}
```

Admin access JWT minimal:

```json
{
  "sub": "admin-uuid",
  "typ": "admin_access",
  "sid": "session-uuid",
  "iat": 0,
  "exp": 0
}
```

Permission di JWT tidak menjadi satu-satunya sumber authorization. Server tetap memeriksa status dan permission terbaru.

Aturan cookie admin:

- `HttpOnly`.
- `Secure` pada production.
- `SameSite=Lax` jika satu site.
- Access cookie berumur pendek.
- Refresh cookie dirotasi dan dicabut saat logout.
- Mutasi berbasis cookie memakai `X-CSRF-Token`.

Token duration:

| Token | Umur | Rotasi |
|---|---|---|
| Customer access | 15 menit | Tidak dirotasi |
| Customer refresh | 30 hari sliding | Setiap dipakai |
| Admin access | 15 menit | Tidak dirotasi |
| Admin refresh | 8 jam | Setiap dipakai, batas absolut 12 jam |

Aturan otorisasi:

- Customer tidak mengirim `customer_id` untuk resource miliknya. Backend mengambil owner dari `sub` JWT.
- Resource milik customer lain menghasilkan `404 RESOURCE_NOT_FOUND`, bukan `403`, untuk mencegah enumerasi keberadaan data.
- Admin web dan API berada pada site yang sama, dengan admin web di path `/admin`. Jika suatu saat dipisah ke subdomain, `SameSite` harus diubah menjadi `None` dan CORS harus dibatasi ke origin admin saja.

Rate limit:

- Login dan OTP: per IP dan per akun.
- Claim device: per customer dan per IP.
- Semua response `429` menyertakan `Retry-After`.

Idempotensi wajib untuk register, claim, checkout, payment attempt, upgrade, dan refund. Simpan idempotency key berdasarkan actor dan endpoint, dan tolak pemakaian ulang key yang sama dengan payload berbeda melalui `409 IDEMPOTENCY_KEY_REUSED`. Untuk request anonymous seperti register, actor disimpan sebagai identifier khusus, misalnya `anon:<hash-ip>`, supaya unique index tetap bekerja meski tidak ada `actor_id`.

### Pekerjaan terjadwal

Status berikut tidak boleh bergantung pada request customer. Dibutuhkan scheduled job:

| Job | Frekuensi | Tugas |
|---|---|---|
| Rekonsiliasi pembayaran | 5 menit | Verifikasi attempt `pending` lewat `transactiondetail`, aktifkan yang benar-benar `completed` |
| Proses ulang webhook | 5 menit | Ambil `payment_webhook_events` dengan `processed_at` NULL dan proses kembali |
| Expire payment attempts | 5 menit | Tandai `pending` yang melewati `expires_at` menjadi `expired` |
| Expire invoices | 1 jam | Tandai invoice `open` yang melewati `due_at` menjadi `past_due` |
| Expire subscriptions | 1 jam | Tandai subscription yang melewati `current_period_end` menjadi `expired`, tulis `subscription_events` |
| Bersihkan idempotency keys | 1 hari | Hapus record yang sudah melewati `expires_at` |
| Bersihkan verification codes | 1 hari | Hapus kode yang sudah kedaluwarsa |

Job rekonsiliasi pembayaran adalah pengaman utama, karena webhook Pakasir tidak bertanda tangan dan kebijakan retry-nya tidak didokumentasikan. Job ini memastikan pembayaran yang benar-benar masuk tetap terdeteksi meski webhook hilang atau gagal diverifikasi.

Setiap job mencatat jalannya ke `scheduled_job_runs`: kapan mulai, kapan selesai, hasilnya, berapa
baris yang disentuh, dan pesan kesalahan jika gagal. Tanpa catatan ini, job yang berhenti
berjalan tidak akan terlihat dari mana pun, dan kegagalannya baru ketahuan setelah ada customer
yang mengeluh pembayarannya tidak masuk.

Kolom `last_outcome` dan `is_stale` pada `dashboard/operations` membaca tabel itu. Job yang
belum pernah jalan sama sekali juga dilaporkan, dengan `last_finished_at` bernilai null.

---

## Fase 2: integrasi perangkat

Belum dikerjakan. Dicatat di sini supaya bentuknya tidak mengejutkan saat dikerjakan.

Yang akan ditambahkan:

- Endpoint auth perangkat dan rotasi kredensial perangkat.
- Heartbeat dan pelaporan status online atau offline.
- Push event perangkat, misalnya `online`, `offline`, `firmware_updated`, `credential_rotated`.
- Kolom `firmware_version`, `last_seen_at`, dan detail konektivitas pada `devices`.
- Pemakaian tabel `device_credentials` dan `device_events`.

Ketika fase ini aktif, `integration_ready` pada response device berubah menjadi `true` dan `connection_status` mulai berisi nilai nyata.

---

## Pemetaan error ke HTTP status

| Error code | Status | Arti |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Bentuk request tidak valid |
| `INVALID_CREDENTIALS` | 401 | Email atau password salah |
| `TOKEN_EXPIRED` | 401 | Access token kedaluwarsa |
| `TOKEN_REVOKED` | 401 | Session sudah dicabut |
| `INVALID_GOOGLE_TOKEN` | 401 | Token Google tidak valid |
| `PAYMENT_WEBHOOK_INVALID` | 401 | Secret webhook tidak valid |
| `PERMISSION_DENIED` | 403 | Permission tidak mencukupi |
| `CSRF_TOKEN_INVALID` | 403 | Token CSRF salah atau hilang |
| `CUSTOMER_SUSPENDED` | 403 | Akun customer sedang disuspend |
| `RESOURCE_NOT_FOUND` | 404 | Resource tidak ada atau bukan milik actor |
| `VERIFICATION_NOT_FOUND` | 404 | Kode verifikasi tidak ditemukan |
| `SERIAL_NUMBER_NOT_FOUND` | 404 | Serial tidak terdaftar di inventory |
| `EMAIL_ALREADY_REGISTERED` | 409 | Email sudah dipakai |
| `PHONE_ALREADY_LINKED` | 409 | Nomor sudah terhubung ke customer lain |
| `GOOGLE_ACCOUNT_LINK_REQUIRED` | 409 | Perlu linking akun Google secara eksplisit |
| `DEVICE_ALREADY_CLAIMED` | 409 | Device sudah dimiliki customer lain |
| `SERIAL_NUMBER_ALREADY_REGISTERED` | 409 | Nomor seri sudah ada di inventory |
| `ADMIN_USERNAME_TAKEN` | 409 | Nama pengguna admin sudah dipakai akun lain |
| `ADMIN_EMAIL_TAKEN` | 409 | Alamat email admin sudah dipakai akun lain |
| `SUBSCRIPTION_ALREADY_ACTIVE` | 409 | Sudah ada subscription aktif, gunakan upgrade |
| `UPGRADE_ALREADY_PENDING` | 409 | Masih ada invoice upgrade yang belum selesai |
| `INVOICE_NOT_PAYABLE` | 409 | Invoice tidak dalam status yang bisa dibayar |
| `PAYMENT_ALREADY_PENDING` | 409 | Masih ada payment attempt yang pending |
| `PAYMENT_ALREADY_PAID` | 409 | Payment attempt sudah lunas, tidak dapat dibatalkan |
| `IDEMPOTENCY_KEY_REUSED` | 409 | Key sama dipakai dengan payload berbeda |
| `WEAK_PASSWORD` | 422 | Password tidak memenuhi syarat |
| `VERIFICATION_EXPIRED` | 422 | Kode verifikasi kedaluwarsa |
| `INVALID_VERIFICATION_CODE` | 422 | Kode verifikasi salah |
| `CLAIM_TOKEN_INVALID` | 422 | Token claim tidak cocok |
| `DEVICE_SUSPENDED` | 422 | Device sedang tidak aktif |
| `DEVICE_LIMIT_REACHED` | 422 | Batas perangkat paket sudah tercapai |
| `ACTIVE_SUBSCRIPTION_REQUIRED` | 422 | Butuh subscription aktif |
| `PLAN_PRICE_INVALID` | 422 | Harga plan tidak valid atau tidak aktif |
| `PAYMENT_METHOD_INVALID` | 422 | Kode metode pembayaran tidak dikenal atau tidak aktif |
| `DOWNGRADE_NOT_ALLOWED` | 422 | Downgrade tidak tersedia |
| `UPGRADE_INTERVAL_MISMATCH` | 422 | Interval billing plan tujuan berbeda |
| `SIMULTANEOUS_CONFLICT` | 409 | Operasi bentrok dengan perubahan lain, ulangi |
| `RATE_LIMITED` | 429 | Terlalu banyak request |
| `AUTH_RATE_LIMITED` | 429 | Terlalu banyak percobaan login |
| `VERIFICATION_ATTEMPTS_EXCEEDED` | 429 | Percobaan verifikasi habis |
| `DEVICE_CLAIM_RATE_LIMITED` | 429 | Percobaan claim habis |
| `INTERNAL_ERROR` | 500 | Kesalahan server |
| `PAYMENT_PROVIDER_ERROR` | 502 | Pakasir gagal merespons |

---

## Perubahan database

Seluruh penyesuaian berikut sudah dimasukkan ke `DB_Plan.md`:

1. `devices.customer_id` menjadi nullable karena device hidup sebagai inventory sebelum diklaim.
2. `device_pairing_codes` berganti menjadi `device_claim_codes` dan dibuat oleh admin, bukan customer.
3. `device_claim_attempts` untuk mencatat setiap percobaan claim.
4. `device_credentials` dan `device_events` ditandai sebagai fase 2.
5. `subscription_events` untuk histori aktivasi, upgrade prorata, expiry, dan cancel.
6. `refresh_token_hash` dan `replaced_by_session_id` pada `admin_sessions` dan `customer_sessions`.
7. Metadata proration pada `invoice_items`.
8. `idempotency_keys` memakai `actor_key` bertipe teks, bukan `actor_id` nullable.
9. `payment_attempts` memakai `provider_order_id` unik per attempt, serta menyimpan `provider_fee`, `provider_total_payment`, `verified_at`, dan `verified_via`.
10. `payment_webhook_events` menyimpan `provider_order_id`, `provider_status`, `ip_address`, dan `user_agent`.
11. `payment_refunds` untuk refund melalui Pakasir.
12. `payment_provider_calls` untuk mencatat panggilan keluar kita ke Pakasir.
13. `admin_session_events` untuk siklus hidup sesi admin: login, refresh, logout, dicabut, kedaluwarsa.
14. `scheduled_job_runs` untuk mencatat jalannya setiap job terjadwal.
15. `audit_logs.actor_type` supaya tindakan sistem dapat muncul di garis waktu yang sama dengan tindakan admin.

Tiga penambahan terakhir muncul dari kebutuhan halaman yang dibahas setelah kontrak awal
selesai: log aktivitas admin yang lengkap sampai siklus sesi, log komunikasi dua arah dengan
Pakasir, dan tab Operasional yang harus dapat membuktikan job rekonsiliasi benar-benar berjalan.

Catatan implementasi yang perlu diperhatikan saat migration:

- Nilai `device_limit` harus dibaca dari plan aktif, bukan dari konfigurasi di aplikasi mobile.
- `subscription_plans.sort_order` menentukan plan mana yang dianggap upgrade.
- `subscription_events.actor_type` membedakan perubahan dari customer, admin, atau sistem.
- Access JWT tidak disimpan di database. Hanya refresh token yang disimpan sebagai hash.
- `devices.status` pada v1 hanya menggambarkan siklus hidup pendaftaran, bukan status koneksi.
- `payment_attempts.amount` harus sama dengan `invoices.total_amount`. Biaya layanan Pakasir tidak pernah masuk ke `invoices`.
- `payment_attempts.amount` wajib disimpan karena dibutuhkan sebagai query parameter pada `transactiondetail` dan body `transactioncancel`.
- Seluruh pengelompokan tanggal untuk laporan memakai WIB, bukan UTC. Query agregasi wajib memakai `AT TIME ZONE 'Asia/Jakarta'`.
- `payment_provider_calls.request_body` dan `response_body` disaring saat penulisan, bukan saat pembacaan.
- Indeks pada `payment_webhook_events` dan `payment_provider_calls` harus mendukung penyaringan berdasarkan `occurred_at` dan `outcome`, karena halaman log provider menyaring keduanya.

---

## Hal yang belum dikunci

1. Daftar lengkap nilai `status` pada webhook dan pada `transactiondetail`. Yang terdokumentasi baru `completed`.
2. Bentuk response API `transactioncancel`, termasuk cara memastikan pembatalan benar-benar berhasil.
3. Kebijakan retry webhook Pakasir, sehingga ketergantungan pada job rekonsiliasi belum dapat dikurangi.
4. Apakah Pakasir menyediakan rentang IP tetap untuk webhook, yang memungkinkan IP allowlist.
5. Ambang `PAKASIR_MIN_AMOUNT`, saat ini dipakai `1000` sebagai kebijakan internal.
6. Apakah jalur claim memakai serial number dipertahankan, atau diubah menjadi antrian persetujuan admin.
7. Apakah billing tahunan dibuka sejak awal, mengingat upgrade antar interval dilarang.
8. Apakah refund melalui Pakasir diaktifkan sejak awal. Dokumentasi yang tersedia tidak memuat API refund, sehingga refund kemungkinan hanya dapat dilakukan manual dari dashboard Pakasir.
9. Batas perangkat paket Ultra dan apakah ada paket unlimited.
10. Apakah satu nomor WhatsApp atau email boleh terhubung ke lebih dari satu customer. Rekomendasi: tidak boleh.
11. Perilaku pinjaman akun atau berbagi device antar anggota keluarga, belum ada di v1.
12. Berapa lama `payment_webhook_events` dan `payment_provider_calls` disimpan sebelum dihapus. Rekomendasi: dua belas bulan, dengan pengarsipan sebelum penghapusan. Tanpa kebijakan ini kedua tabel akan tumbuh tanpa batas, karena setiap webhook yang masuk dicatat termasuk yang palsu.
13. Apakah laporan yang sudah diekspor perlu ditandai pernah diunduh dan oleh siapa. Belum ada di v1, tetapi relevan untuk audit keuangan.
14. Apakah periode akuntansi perlu dapat ditutup, sehingga transaksi setelahnya tidak boleh menyentuh periode itu. Dengan dasar kas, laporan periode lampau sudah tidak berubah angkanya, jadi ini belum dibutuhkan. Perlu ditinjau ulang jika laporan dipakai untuk pembukuan resmi.

Seluruh endpoint sudah cukup jelas untuk ditulis menjadi `openapi.yaml`. Tidak ada lagi bagian yang menunggu spesifikasi provider.
