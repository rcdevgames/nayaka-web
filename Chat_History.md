# Chat History

- Session: `session-08d10714-e947-4ef8-82bc-bb7684e15ebf`
- Workspace: `/home/unity008/Projekan/Nayaka`
- Title: halo bro, kita rancang database
- Rentang waktu: 2026-09-12 13:40:47 sampai 2026-09-12 18:38:24
- Total pesan user: 10

## 1. User (2026-09-12 13:40:47)

halo bro, kita rancang database yuk

## 2. User (2026-09-12 13:42:30)

dbnya pake postgresql
tolong lu simpen dlu ini di file akses dbnya
postgresql://postgres:2GpssFZwZcY4xQCG@db.adhhyblzvhiskoulohwb.supabase.co:5432/postgres

Tool yang dipanggil:

- `skill`: {"name": "antislop"}
- `bash`: pwd
- `glob`: {"path": ".", "pattern": "{.env,.env.*,AGENTS.md,CLAUDE.md,GEMINI.md,package.json,README.md}"}
- `glob`: {"path": ".", "pattern": "*"}
- `write`: .env
- `write`: .gitignore
- `write`: .env.example
- `write`: .env
- `write`: .gitignore
- `write`: .env.example

### Assistant

Sudah disimpan di:

- `.env` → berisi `DATABASE_URL` PostgreSQL yang kamu kirim
- `.gitignore` → mencegah `.env` ikut ter-commit
- `.env.example` → template aman untuk konfigurasi

Koneksi database belum dites. Karena password tadi sudah muncul di chat, sebaiknya nanti di-rotate setelah setup awal selesai.

Sekarang kita bisa lanjut rancang schema. Aplikasinya untuk apa?

## 3. User (2026-09-12 13:49:42)

oke, terus gua butuh tabel berikut
- customers : ini data pelanggan, dan bisa juga untuk data login menggunakan email, di aplikasi bisa login pakai whatsapp, email dan password, dan juga pakai google login.
- devices : isinya data perangkat cctv, 1 cctv hanya 1 pelanggan, 1 pelanggan bisa punya banyak cctv
- package : isinya paket subs berbayar, ada yang gratis, basic, pro, ultra, fokus ke keterbatasan penambahan perangkat pada aplikasi mobile nantinya.
- invoice/transaction : ini yang gua agak bingung, ada tagihan karna berlangganan tapi pembayaran via qris dan va, kira2 gimana ya tablenya?
kalo dari lu ada masukan boleh tulis disini

### Assistant

Struktur yang paling aman bukan hanya `invoice` dan `transaction`. Untuk kasus subscription, sebaiknya dipisah menjadi:

```text
customers
devices
subscription_plans
plan_prices
subscriptions
invoices
invoice_items
payment_attempts
payment_webhook_events
```

## 1. `customers`

Karena koneksinya Supabase, sebaiknya password dan proses login ditangani oleh **Supabase Auth**, bukan disimpan sendiri di tabel `customers`.

```text
customers
- id uuid PK, sama dengan auth.users.id
- full_name text
- phone_e164 text nullable, unique
- avatar_url text nullable
- is_active boolean
- created_at timestamptz
- updated_at timestamptz
```

Metode login tidak perlu dibuat sebagai satu kolom `login_method`, karena satu pelanggan bisa punya lebih dari satu metode login:

- email + password
- WhatsApp atau nomor telepon
- Google login

Supabase Auth menyimpan identitas login tersebut di `auth.users` dan `auth.identities`.

Catatan penting:

- Password jangan disimpan di `customers`.
- Nomor WhatsApp sebaiknya disimpan dalam format internasional, misalnya `+628123456789`.
- Nomor WhatsApp harus diverifikasi OTP sebelum dianggap sebagai identitas login.
- Google login cukup menggunakan OAuth Supabase.

## 2. `devices`

Satu perangkat hanya dimiliki satu customer. Satu customer bisa punya banyak perangkat.

```text
devices
- id uuid PK
- customer_id uuid FK -> customers.id
- device_uid text unique
- serial_number text nullable
- name text
- status text
- metadata jsonb nullable
- last_seen_at timestamptz nullable
- created_at timestamptz
- updated_at timestamptz
```

Contoh status:

```text
active
inactive
offline
deleted
```

Relasinya:

```text
customers 1 ──── N devices
```

`device_uid` harus unik karena menjadi identitas perangkat CCTV. Jangan hanya mengandalkan nama perangkat, karena nama bisa sama.

## 3. `subscription_plans`

Saya menyarankan menggunakan nama `subscription_plans`, bukan `package`. `package` memang bisa digunakan di PostgreSQL, tetapi nama `subscription_plans` lebih jelas.

```text
subscription_plans
- id uuid PK
- code text unique
- name text
- device_limit integer nullable
- description text nullable
- is_free boolean
- is_active boolean
- created_at timestamptz
- updated_at timestamptz
```

Contoh data:

```text
code    name    device_limit
free    Free    1
basic   Basic   3
pro     Pro     10
ultra   Ultra   NULL
```

`device_limit = NULL` bisa berarti tidak terbatas, tetapi kalau Ultra sebenarnya punya batas tertentu, lebih baik selalu isi angka agar aturan lebih eksplisit.

## 4. `plan_prices`

Harga sebaiknya dipisah dari `subscription_plans`. Dengan begitu, nanti bisa mendukung paket bulanan dan tahunan tanpa mengubah struktur utama.

```text
plan_prices
- id uuid PK
- plan_id uuid FK -> subscription_plans.id
- billing_interval text
- amount numeric(14,2)
- currency char(3)
- is_active boolean
- created_at timestamptz
```

Contoh:

```text
plan       interval   amount       currency
basic      monthly    49000.00      IDR
basic      yearly     490000.00     IDR
pro        monthly    99000.00      IDR
ultra      monthly    199000.00     IDR
```

Jangan menggunakan `float` untuk uang. Gunakan `numeric` atau integer dalam satuan terkecil.

## 5. `subscriptions`

Tabel ini menyimpan hak akses pelanggan saat ini. Jangan menjadikan invoice sebagai sumber status subscription.

```text
subscriptions
- id uuid PK
- customer_id uuid FK -> customers.id
- plan_id uuid FK -> subscription_plans.id
- plan_price_id uuid FK -> plan_prices.id nullable
- status text
- started_at timestamptz
- current_period_start timestamptz
- current_period_end timestamptz nullable
- cancel_at_period_end boolean
- canceled_at timestamptz nullable
- provider_subscription_id text nullable
- created_at timestamptz
- updated_at timestamptz
```

Contoh status:

```text
trialing
active
past_due
canceled
expired
```

Relasinya:

```text
customers 1 ──── N subscriptions
subscription_plans 1 ──── N subscriptions
subscriptions 1 ──── N invoices
```

Untuk aturan normal, satu customer hanya boleh memiliki satu subscription aktif. Ini bisa dijaga dengan partial unique index:

```sql
CREATE UNIQUE INDEX one_active_subscription_per_customer
ON subscriptions (customer_id)
WHERE status IN ('trialing', 'active', 'past_due');
```

Paket gratis tetap dibuat sebagai subscription aktif agar batas perangkat bisa diproses dengan cara yang sama seperti paket berbayar.

## 6. `invoices`

Invoice adalah tagihan, bukan pembayaran.

```text
invoices
- id uuid PK
- customer_id uuid FK -> customers.id
- subscription_id uuid FK -> subscriptions.id nullable
- invoice_number text unique
- status text
- currency char(3)
- subtotal numeric(14,2)
- discount_amount numeric(14,2)
- tax_amount numeric(14,2)
- total_amount numeric(14,2)
- amount_paid numeric(14,2)
- due_at timestamptz nullable
- period_start timestamptz nullable
- period_end timestamptz nullable
- paid_at timestamptz nullable
- voided_at timestamptz nullable
- created_at timestamptz
- updated_at timestamptz
```

Contoh status:

```text
draft
open
paid
past_due
void
uncollectible
```

Invoice dibuat ketika:

1. Customer memilih paket berbayar.
2. Masa subscription akan diperpanjang.
3. Customer mengganti paket.
4. Ada biaya tambahan, kalau nanti fiturnya diperlukan.

Untuk paket gratis, ada dua pilihan:

- Tidak membuat invoice sama sekali.
- Membuat invoice dengan nominal `0` dan status `paid` untuk histori lengkap.

Saya lebih menyarankan opsi kedua jika aplikasi membutuhkan laporan histori subscription.

## 7. `invoice_items`

Ini penting agar harga pada invoice tidak berubah ketika harga paket diubah di masa depan.

```text
invoice_items
- id uuid PK
- invoice_id uuid FK -> invoices.id
- description text
- plan_id uuid FK -> subscription_plans.id nullable
- quantity integer
- unit_amount numeric(14,2)
- total_amount numeric(14,2)
- metadata jsonb nullable
- created_at timestamptz
```

Misalnya harga Pro naik dari Rp99.000 menjadi Rp129.000. Invoice lama tetap menyimpan harga Rp99.000 karena harga tersebut sudah disalin ke `invoice_items`.

## 8. `payment_attempts`

Jangan membuat satu kolom `payment_method` di invoice. Satu invoice bisa memiliki beberapa percobaan pembayaran:

- QRIS pertama expired.
- Customer mencoba QRIS baru.
- Customer kemudian memilih VA.
- Salah satu pembayaran berhasil.

```text
payment_attempts
- id uuid PK
- invoice_id uuid FK -> invoices.id
- provider text
- payment_method text
- provider_payment_id text nullable
- provider_reference text nullable
- amount numeric(14,2)
- status text
- checkout_url text nullable
- qr_string text nullable
- va_number text nullable
- expires_at timestamptz nullable
- paid_at timestamptz nullable
- failed_at timestamptz nullable
- raw_response jsonb nullable
- created_at timestamptz
- updated_at timestamptz
```

Nilai `payment_method`:

```text
qris
va
```

Nilai `status`:

```text
pending
paid
expired
failed
canceled
```

Relasinya:

```text
invoices 1 ──── N payment_attempts
```

Contoh alurnya:

```text
Invoice INV-001
├── QRIS, expired
├── QRIS, expired
└── VA, paid
```

Invoice baru berubah menjadi `paid` ketika payment attempt benar-benar dikonfirmasi oleh provider.

## 9. `payment_webhook_events`

Tabel ini berguna untuk mencatat webhook dari payment gateway dan mencegah webhook yang sama diproses dua kali.

```text
payment_webhook_events
- id uuid PK
- provider text
- provider_event_id text unique
- payment_attempt_id uuid FK -> payment_attempts.id nullable
- event_type text
- payload jsonb
- processed_at timestamptz nullable
- processing_error text nullable
- created_at timestamptz
```

Payment gateway bisa mengirim webhook berulang. `provider_event_id` harus dibuat unik supaya proses pembayaran bersifat idempotent.

## Relasi keseluruhan

```text
auth.users
    │
    └── 1:1 customers
             │
             ├── 1:N devices
             ├── 1:N subscriptions
             │         │
             │         └── N:1 subscription_plans
             │                    │
             │                    └── 1:N plan_prices
             │
             └── 1:N invoices
                       │
                       ├── 1:N invoice_items
                       └── 1:N payment_attempts
                                      │
                                      └── 1:N payment_webhook_events
```

## Flow pembayaran yang disarankan

```text
1. Customer memilih paket Pro.
2. Sistem membuat atau memperbarui subscription.
3. Sistem membuat invoice dengan status open.
4. Sistem meminta QRIS atau VA ke payment provider.
5. Sistem menyimpan hasilnya sebagai payment_attempt pending.
6. Customer melakukan pembayaran.
7. Payment provider mengirim webhook.
8. Sistem memvalidasi webhook.
9. Sistem mengubah payment_attempt menjadi paid.
10. Sistem mengubah invoice menjadi paid.
11. Sistem mengubah subscription menjadi active atau memperpanjang periodenya.
12. Aplikasi menghitung batas device dari subscription aktif.
```

Jika QRIS atau VA expired:

```text
payment_attempt.status = expired
invoice.status tetap open
```

Customer kemudian bisa membuat payment attempt baru untuk invoice yang sama.

## Masukan tambahan yang penting

### Batas perangkat jangan hanya dicek di aplikasi mobile

Saat menambah perangkat baru, backend harus melakukan pengecekan:

```text
jumlah device aktif customer < device_limit paket aktif
```

Pengecekan ini sebaiknya dilakukan dalam transaction dengan row lock supaya dua request bersamaan tidak bisa melewati limit.

### Simpan histori perubahan paket

Jangan menghapus subscription lama ketika customer upgrade atau downgrade. Buat record baru atau simpan histori statusnya. Ini penting untuk:

- laporan pembayaran
- refund
- audit
- perhitungan prorata
- mengetahui paket customer pada periode tertentu

### Jangan percaya status dari aplikasi mobile

Status pembayaran dan subscription hanya boleh berubah berdasarkan backend atau webhook payment provider. Aplikasi mobile hanya membaca status dari API backend.

### Jangan menyimpan secret payment provider di database yang bisa dibaca client

`raw_response` boleh disimpan di tabel internal, tetapi jangan pernah dikirim langsung ke aplikasi mobile jika berisi secret atau data sensitif.

Rekomendasi saya: mulai dari **9 tabel di atas**, lalu migration PostgreSQL dibuat setelah dipastikan:

1. Satu customer boleh punya berapa subscription aktif.
2. Billing hanya bulanan atau juga tahunan.
3. Payment provider yang dipakai, misalnya Midtrans, Xendit, atau provider lain.
4. Paket Ultra memiliki batas perangkat atau unlimited.
5. Apakah upgrade paket langsung aktif atau menunggu periode berikutnya.

## 4. User (2026-09-12 13:54:20)

gua ga mau pake supabase auth, gua mau pake login manual aja.
supabase nnti buat database aja fokusnya makanya gw pake direct connection

### Assistant

Siap, berarti **Supabase hanya dipakai sebagai PostgreSQL**, sedangkan seluruh autentikasi kita kelola sendiri di backend.

`.env` yang tadi sudah disimpan tetap bisa dipakai. Tapi koneksi database itu **hanya boleh dipakai backend**, jangan ditanam di aplikasi mobile atau frontend.

## Struktur auth manual

Jangan simpan password langsung di `customers`. Pisahkan data profil dan data login.

### 1. `customers`

Berisi data profil pelanggan.

```text
customers
- id uuid PK
- full_name text
- avatar_url text nullable
- is_active boolean
- created_at timestamptz
- updated_at timestamptz
```

### 2. `customer_auth_accounts`

Berisi semua metode login yang terhubung ke satu customer.

```text
customer_auth_accounts
- id uuid PK
- customer_id uuid FK -> customers.id
- provider text
- provider_subject text nullable
- email citext nullable
- phone_e164 text nullable
- password_hash text nullable
- is_verified boolean
- verified_at timestamptz nullable
- last_login_at timestamptz nullable
- created_at timestamptz
- updated_at timestamptz
```

Nilai `provider`:

```text
email
whatsapp
google
```

Contoh data:

```text
customer_id | provider  | email              | phone_e164       | password_hash
------------|-----------|--------------------|------------------|--------------
A           | email     | user@mail.com      | NULL             | argon2id_hash
A           | whatsapp  | NULL               | +628123456789    | NULL
A           | google    | user@gmail.com     | NULL             | NULL
```

Dengan struktur ini, satu customer bisa login menggunakan:

- email dan password
- WhatsApp OTP
- Google OAuth

Untuk Google, `provider_subject` menyimpan Google user ID atau `sub` dari token Google. Jangan hanya mencocokkan berdasarkan email.

Constraint yang disarankan:

```text
UNIQUE(provider, provider_subject)
UNIQUE(email) jika email tidak null
UNIQUE(phone_e164) jika phone_e164 tidak null
```

Email sebaiknya dinormalisasi menjadi lowercase. Nomor WhatsApp gunakan format E.164, contohnya:

```text
+628123456789
```

## 3. `customer_sessions`

Jangan menyimpan session token mentah di database. Simpan hash tokennya.

```text
customer_sessions
- id uuid PK
- customer_id uuid FK -> customers.id
- token_hash text unique
- refresh_token_hash text unique nullable
- user_agent text nullable
- ip_address inet nullable
- expires_at timestamptz
- revoked_at timestamptz nullable
- created_at timestamptz
- last_used_at timestamptz nullable
```

Alurnya:

```text
Login berhasil
→ backend membuat access token dan refresh token
→ hash token disimpan di customer_sessions
→ token asli dikirim ke client
```

Saat logout, isi `revoked_at`.

## 4. `auth_verification_codes`

Untuk OTP WhatsApp, verifikasi email, dan reset password.

```text
auth_verification_codes
- id uuid PK
- customer_id uuid FK -> customers.id nullable
- target text
- channel text
- purpose text
- code_hash text
- attempts integer
- expires_at timestamptz
- consumed_at timestamptz nullable
- created_at timestamptz
```

Contoh:

```text
channel:
whatsapp
email

purpose:
login
verify_phone
verify_email
reset_password
```

OTP juga jangan disimpan dalam bentuk plaintext. Simpan `code_hash`, lalu batasi:

- jumlah percobaan
- waktu kedaluwarsa
- jumlah request per nomor/IP
- penggunaan ulang kode

## 5. `password_reset_tokens`

Bisa memakai tabel OTP di atas, tetapi saya lebih suka memisahkan reset password jika flow-nya menggunakan link email.

```text
password_reset_tokens
- id uuid PK
- customer_id uuid FK -> customers.id
- token_hash text unique
- expires_at timestamptz
- used_at timestamptz nullable
- created_at timestamptz
```

## Password wajib di-hash

Untuk password gunakan:

- **Argon2id**, pilihan utama
- bcrypt, jika library backend lebih siap

Jangan gunakan:

- MD5
- SHA-1
- SHA-256 langsung
- encryption yang bisa dibalik
- password plaintext

`password_hash` hanya diisi untuk provider `email`. Password tidak diperlukan untuk Google atau WhatsApp OTP.

## Login Google tetap membutuhkan OAuth

Manual auth bukan berarti Google login dibuat dari nol. Flow-nya:

```text
1. Mobile meminta login Google.
2. Google mengembalikan ID token.
3. Backend memvalidasi token ke Google.
4. Backend mengambil nilai sub dari token.
5. Backend mencari provider = google dan provider_subject = sub.
6. Jika belum ada, backend membuat customer dan auth account.
7. Backend membuat session aplikasi sendiri.
```

Jadi Google hanya memverifikasi identitas, sedangkan session aplikasi tetap milik sistem kita.

## Tabel bisnis tetap seperti sebelumnya

Tabel utama:

```text
customers
customer_auth_accounts
customer_sessions
auth_verification_codes
password_reset_tokens

devices
subscription_plans
plan_prices
subscriptions
invoices
invoice_items
payment_attempts
payment_webhook_events
```

Relasi auth:

```text
customers 1 ──── N customer_auth_accounts
customers 1 ──── N customer_sessions
customers 1 ──── N auth_verification_codes
```

Relasi bisnis:

```text
customers 1 ──── N devices
customers 1 ──── N subscriptions
customers 1 ──── N invoices
invoices 1 ──── N invoice_items
invoices 1 ──── N payment_attempts
```

## Catatan direct connection Supabase

Connection string port `5432` tersebut cocok untuk backend yang koneksinya stabil. Jangan digunakan langsung dari:

- React Native
- Flutter
- browser
- aplikasi desktop client-side

Sebab password database akan mudah diekstrak.

Gunakan pola:

```text
Mobile App
    ↓ HTTPS
Backend API
    ↓ DATABASE_URL
PostgreSQL Supabase
```

Karena password database sudah tertulis di chat dan file lokal, sebaiknya nanti di-rotate sebelum production.

Untuk langkah berikutnya, saya sarankan kita buat dulu **migration PostgreSQL untuk lima tabel auth** dengan UUID, index, constraint, dan trigger `updated_at`, baru lanjut ke tabel perangkat dan subscription.

## 5. User (2026-09-12 13:55:34)

terus ada master user juga untuk web app. karna ini dikendalikan dari admin.

jadi sistemnya itu ada 2, web untuk admin dan mobile untuk customer.

tolong lengkapi rancangan databasenya.

### Assistant

Si Karena sistemnya terbagi menjadi **web admin** dan **mobile customer**, sebaiknya autentikasinya benar-benar dipisah:

```text
Admin Web
  └── admin_users

Customer Mobile
  └── customers
      └── customer_auth_accounts
```

Jangan memakai tabel `customers` untuk login admin. Admin dan customer memiliki hak akses, session, dan audit yang berbeda.

# Rancangan database lengkap

## 1. Modul admin web

### `admin_users`

Data akun admin untuk web.

```text
admin_users
- id uuid PK
- username citext UNIQUE
- email citext UNIQUE
- full_name text
- password_hash text
- avatar_url text nullable
- status text
- is_super_admin boolean
- last_login_at timestamptz nullable
- created_at timestamptz
- updated_at timestamptz
```

Status yang disarankan:

```text
active
inactive
locked
```

Password admin juga wajib menggunakan Argon2id atau bcrypt.

`is_super_admin` boleh digunakan untuk satu master user pertama, tetapi untuk jangka panjang tetap lebih baik menggunakan role dan permission.

### `admin_roles`

Daftar role admin.

```text
admin_roles
- id uuid PK
- code text UNIQUE
- name text
- description text nullable
- created_at timestamptz
```

Contoh role:

```text
super_admin
finance
customer_support
device_operator
content_manager
```

### `admin_permissions`

Daftar izin granular.

```text
admin_permissions
- id uuid PK
- code text UNIQUE
- name text
- description text nullable
```

Contoh permission:

```text
customer.read
customer.update
customer.suspend
device.read
device.update
subscription.read
subscription.manage
invoice.read
payment.refund
admin.manage
audit.read
```

### `admin_user_roles`

Relasi admin dengan role.

```text
admin_user_roles
- admin_user_id uuid FK -> admin_users.id
- role_id uuid FK -> admin_roles.id
- created_at timestamptz

PRIMARY KEY (admin_user_id, role_id)
```

### `admin_role_permissions`

Relasi role dengan permission.

```text
admin_role_permissions
- role_id uuid FK -> admin_roles.id
- permission_id uuid FK -> admin_permissions.id

PRIMARY KEY (role_id, permission_id)
```

Relasinya:

```text
admin_users N ──── N admin_roles
admin_roles N ──── N admin_permissions
```

Untuk awal, jika belum membutuhkan permission serinci ini, bisa mulai dari `admin_users.role_id`. Namun struktur many-to-many lebih siap jika jumlah admin bertambah.

### `admin_sessions`

Session login admin web.

```text
admin_sessions
- id uuid PK
- admin_user_id uuid FK -> admin_users.id
- token_hash text UNIQUE
- ip_address inet nullable
- user_agent text nullable
- expires_at timestamptz
- revoked_at timestamptz nullable
- created_at timestamptz
- last_used_at timestamptz nullable
```

Token asli tidak disimpan. Simpan hash token saja.

### `admin_login_attempts`

Untuk brute-force protection dan monitoring login.

```text
admin_login_attempts
- id uuid PK
- admin_user_id uuid FK -> admin_users.id nullable
- username_attempted citext
- ip_address inet nullable
- success boolean
- failure_reason text nullable
- created_at timestamptz
```

### `audit_logs`

Semua tindakan penting admin perlu dicatat.

```text
audit_logs
- id uuid PK
- admin_user_id uuid FK -> admin_users.id nullable
- action text
- entity_type text
- entity_id uuid nullable
- old_data jsonb nullable
- new_data jsonb nullable
- ip_address inet nullable
- user_agent text nullable
- created_at timestamptz
```

Contoh action:

```text
customer.suspend
customer.update
device.assign
device.unassign
subscription.change
invoice.void
payment.refund
admin.create
admin.role_update
```

Jangan hanya mencatat “admin mengubah data”. Simpan entity dan perubahan pentingnya supaya bisa diaudit.

---

# 2. Modul customer mobile

## `customers`

Profil customer.

```text
customers
- id uuid PK
- full_name text
- avatar_url text nullable
- status text
- created_at timestamptz
- updated_at timestamptz
```

Status:

```text
active
suspended
deleted
```

Email dan nomor WhatsApp sebaiknya tidak disimpan sebagai kolom utama di sini karena satu customer bisa memiliki beberapa metode login.

## `customer_auth_accounts`

Metode autentikasi customer.

```text
customer_auth_accounts
- id uuid PK
- customer_id uuid FK -> customers.id
- provider text
- provider_subject text nullable
- email citext nullable
- phone_e164 text nullable
- password_hash text nullable
- is_verified boolean
- verified_at timestamptz nullable
- last_login_at timestamptz nullable
- created_at timestamptz
- updated_at timestamptz
```

Provider:

```text
email
whatsapp
google
```

Aturan:

```text
email:
  email wajib ada
  password_hash wajib ada

whatsapp:
  phone_e164 wajib ada
  password_hash NULL
  login menggunakan OTP

google:
  provider_subject wajib ada
  password_hash NULL
```

Constraint yang diperlukan:

```text
UNIQUE(provider, provider_subject)
UNIQUE(email) WHERE email IS NOT NULL
UNIQUE(phone_e164) WHERE phone_e164 IS NOT NULL
```

Satu customer dapat memiliki beberapa account:

```text
Customer A
├── email + password
├── WhatsApp OTP
└── Google
```

## `customer_sessions`

Session login mobile.

```text
customer_sessions
- id uuid PK
- customer_id uuid FK -> customers.id
- token_hash text UNIQUE
- refresh_token_hash text UNIQUE nullable
- device_id text nullable
- platform text nullable
- app_version text nullable
- ip_address inet nullable
- expires_at timestamptz
- revoked_at timestamptz nullable
- created_at timestamptz
- last_used_at timestamptz nullable
```

`device_id` di sini adalah identitas instalasi aplikasi mobile, bukan CCTV.

## `auth_verification_codes`

OTP WhatsApp atau email.

```text
auth_verification_codes
- id uuid PK
- customer_id uuid FK -> customers.id nullable
- target text
- channel text
- purpose text
- code_hash text
- attempt_count integer
- expires_at timestamptz
- consumed_at timestamptz nullable
- created_at timestamptz
```

Purpose:

```text
login
verify_email
verify_phone
reset_password
```

Kode OTP jangan disimpan plaintext.

---

# 3. Modul perangkat CCTV

## `devices`

Data utama CCTV.

```text
devices
- id uuid PK
- customer_id uuid FK -> customers.id
- device_uid text UNIQUE
- serial_number text UNIQUE nullable
- name text
- model text nullable
- firmware_version text nullable
- status text
- last_seen_at timestamptz nullable
- activated_at timestamptz nullable
- deactivated_at timestamptz nullable
- metadata jsonb nullable
- created_at timestamptz
- updated_at timestamptz
```

Status:

```text
pending
active
offline
suspended
deleted
```

Relasi:

```text
customers 1 ──── N devices
```

Satu `device` hanya memiliki satu `customer_id`.

### `device_credentials`

Kalau CCTV memiliki credential atau secret untuk koneksi, jangan campur dengan data umum `devices`.

```text
device_credentials
- id uuid PK
- device_id uuid UNIQUE FK -> devices.id
- credential_type text
- encrypted_username text nullable
- encrypted_secret text
- rotated_at timestamptz nullable
- created_at timestamptz
- updated_at timestamptz
```

Secret harus dienkripsi di backend. Jangan dikirim utuh ke aplikasi mobile jika tidak diperlukan.

### `device_events`

Untuk histori online/offline atau event perangkat.

```text
device_events
- id uuid PK
- device_id uuid FK -> devices.id
- event_type text
- payload jsonb nullable
- occurred_at timestamptz
- created_at timestamptz
```

Contoh event:

```text
online
offline
firmware_updated
credential_rotated
assigned
unassigned
```

---

# 4. Modul paket subscription

## `subscription_plans`

Master paket.

```text
subscription_plans
- id uuid PK
- code text UNIQUE
- name text
- description text nullable
- device_limit integer nullable
- is_free boolean
- is_active boolean
- sort_order integer
- created_at timestamptz
- updated_at timestamptz
```

Contoh:

```text
free   | Free  | 1
basic  | Basic | 3
pro    | Pro   | 10
ultra  | Ultra | NULL
```

`NULL` pada `device_limit` bisa berarti unlimited. Jika tidak ingin makna ambigu, tambahkan:

```text
is_unlimited_devices boolean
```

Namun jangan mengisi keduanya dengan makna yang bertentangan.

## `plan_prices`

Harga paket berdasarkan periode.

```text
plan_prices
- id uuid PK
- plan_id uuid FK -> subscription_plans.id
- billing_interval text
- amount numeric(14,2)
- currency char(3)
- is_active boolean
- created_at timestamptz
- updated_at timestamptz
```

Interval:

```text
monthly
yearly
```

Harga tidak boleh menggunakan `float`.

## `subscriptions`

Status hak akses customer.

```text
subscriptions
- id uuid PK
- customer_id uuid FK -> customers.id
- plan_id uuid FK -> subscription_plans.id
- plan_price_id uuid FK -> plan_prices.id nullable
- status text
- started_at timestamptz
- current_period_start timestamptz
- current_period_end timestamptz nullable
- cancel_at_period_end boolean
- canceled_at timestamptz nullable
- ended_at timestamptz nullable
- created_at timestamptz
- updated_at timestamptz
```

Status:

```text
trialing
active
past_due
canceled
expired
```

Paket gratis tetap dibuat sebagai subscription. Dengan begitu pengecekan limit perangkat selalu melalui mekanisme yang sama.

Untuk satu subscription aktif per customer:

```sql
CREATE UNIQUE INDEX one_active_subscription_per_customer
ON subscriptions (customer_id)
WHERE status IN ('trialing', 'active', 'past_due');
```

---

# 5. Modul invoice dan pembayaran

Sebaiknya jangan memakai tabel bernama `transaction` sebagai tabel utama. Kata transaction juga merupakan istilah penting di database. Gunakan struktur berikut:

```text
invoices
invoice_items
payment_attempts
payment_webhook_events
```

## `invoices`

Tagihan customer.

```text
invoices
- id uuid PK
- customer_id uuid FK -> customers.id
- subscription_id uuid FK -> subscriptions.id nullable
- invoice_number text UNIQUE
- status text
- currency char(3)
- subtotal numeric(14,2)
- discount_amount numeric(14,2)
- tax_amount numeric(14,2)
- total_amount numeric(14,2)
- amount_paid numeric(14,2)
- due_at timestamptz nullable
- period_start timestamptz nullable
- period_end timestamptz nullable
- paid_at timestamptz nullable
- voided_at timestamptz nullable
- created_at timestamptz
- updated_at timestamptz
```

Status:

```text
draft
open
paid
past_due
void
uncollectible
```

## `invoice_items`

Detail item pada tagihan.

```text
invoice_items
- id uuid PK
- invoice_id uuid FK -> invoices.id
- description text
- plan_id uuid FK -> subscription_plans.id nullable
- quantity integer
- unit_amount numeric(14,2)
- total_amount numeric(14,2)
- metadata jsonb nullable
- created_at timestamptz
```

Harga disalin ke `invoice_items` agar invoice lama tidak ikut berubah saat harga master diperbarui.

## `payment_attempts`

Satu invoice dapat memiliki beberapa percobaan pembayaran.

```text
payment_attempts
- id uuid PK
- invoice_id uuid FK -> invoices.id
- provider text
- payment_method text
- provider_payment_id text nullable
- provider_reference text nullable
- amount numeric(14,2)
- status text
- checkout_url text nullable
- qr_string text nullable
- va_number text nullable
- expires_at timestamptz nullable
- paid_at timestamptz nullable
- failed_at timestamptz nullable
- raw_response jsonb nullable
- created_at timestamptz
- updated_at timestamptz
```

Payment method:

```text
qris
va
```

Status:

```text
pending
paid
expired
failed
canceled
```

Contoh:

```text
Invoice INV-001
├── QRIS, expired
├── QRIS, expired
└── VA, paid
```

Invoice hanya berubah menjadi `paid` setelah backend menerima dan memvalidasi konfirmasi dari payment provider.

## `payment_webhook_events`

Untuk idempotensi webhook.

```text
payment_webhook_events
- id uuid PK
- provider text
- provider_event_id text UNIQUE
- payment_attempt_id uuid FK -> payment_attempts.id nullable
- event_type text
- payload jsonb
- processed_at timestamptz nullable
- processing_error text nullable
- created_at timestamptz
```

Webhook dari provider dapat dikirim berulang kali. `provider_event_id` wajib unik agar event yang sama tidak memproses pembayaran dua kali.

---

# 6. Diagram relasi keseluruhan

```text
ADMIN WEB
─────────

admin_users
    │
    ├── admin_sessions
    ├── admin_login_attempts
    └── admin_user_roles
             │
             └── admin_roles
                    │
                    └── admin_role_permissions
                              │
                              └── admin_permissions

admin_users
    │
    └── audit_logs


CUSTOMER MOBILE
───────────────

customers
    │
    ├── customer_auth_accounts
    ├── customer_sessions
    ├── auth_verification_codes
    ├── devices
    │     ├── device_credentials
    │     └── device_events
    ├── subscriptions
    │     ├── subscription_plans
    │     │     └── plan_prices
    │     └── invoices
    │           ├── invoice_items
    │           ├── payment_attempts
    │           └── payment_webhook_events
    └── audit_logs
```

---

# 7. Flow utama sistem

## Admin login

```text
1. Admin mengirim username/email dan password.
2. Backend mencari admin_users.
3. Backend membandingkan password_hash.
4. Backend memeriksa status dan role.
5. Backend membuat admin_sessions.
6. Semua aksi penting dicatat ke audit_logs.
```

## Customer login email

```text
1. Customer mengirim email dan password.
2. Backend mencari customer_auth_accounts dengan provider = email.
3. Backend memvalidasi password.
4. Backend memeriksa customer berstatus active.
5. Backend membuat customer_sessions.
```

## Customer login WhatsApp

```text
1. Customer meminta OTP.
2. Backend membuat code_hash dengan masa berlaku.
3. Backend mengirim OTP melalui provider WhatsApp.
4. Customer mengirim kode.
5. Backend memvalidasi kode.
6. Backend membuat atau mengambil customer.
7. Backend membuat customer_sessions.
```

## Customer login Google

```text
1. Mobile memperoleh Google ID token.
2. Backend memvalidasi token.
3. Backend mengambil Google subject/sub.
4. Backend mencari provider = google.
5. Backend membuat atau mengambil customer.
6. Backend membuat customer_sessions.
```

## Upgrade subscription

```text
1. Customer memilih paket.
2. Backend membuat invoice.
3. Backend membuat payment_attempt.
4. Backend meminta QRIS atau VA ke provider.
5. Customer membayar.
6. Provider mengirim webhook.
7. Backend memvalidasi webhook.
8. Payment attempt menjadi paid.
9. Invoice menjadi paid.
10. Subscription diaktifkan atau diperpanjang.
11. Event dicatat ke audit_logs.
```

---

# 8. Aturan penting yang perlu diterapkan

## Hak akses perangkat

Saat customer menambah CCTV:

```text
1. Ambil subscription aktif.
2. Ambil device_limit paket.
3. Hitung device aktif customer.
4. Jika jumlah sudah mencapai limit, tolak.
5. Jika masih tersedia, buat device dalam transaksi database.
```

Pengecekan ini wajib dilakukan di backend, bukan hanya di mobile.

## Admin tidak boleh mengubah status pembayaran sembarangan

Untuk perubahan manual seperti:

- void invoice
- refund
- memberikan paket gratis
- suspend customer
- memindahkan perangkat

wajib:

1. Admin memiliki permission yang sesuai.
2. Ada alasan perubahan.
3. Masuk ke `audit_logs`.

## Direct connection tetap hanya di backend

Strukturnya:

```text
Mobile App ──HTTPS──> Backend API ──DATABASE_URL──> PostgreSQL
Admin Web  ──HTTPS──> Backend API ──DATABASE_URL──> PostgreSQL
```

Connection string database tidak boleh berada di mobile atau browser.

## Jangan hapus data bisnis secara permanen

Untuk `customers`, `devices`, `subscriptions`, dan `invoices`, lebih aman menggunakan status:

```text
inactive
suspended
deleted
void
```

Daripada langsung `DELETE`, karena histori invoice, pembayaran, dan audit harus tetap tersedia.

# Rekomendasi final

Struktur inti yang saya sarankan:

```text
ADMIN
1. admin_users
2. admin_roles
3. admin_permissions
4. admin_user_roles
5. admin_role_permissions
6. admin_sessions
7. admin_login_attempts
8. audit_logs

CUSTOMER AUTH
9. customers
10. customer_auth_accounts
11. customer_sessions
12. auth_verification_codes

DEVICES
13. devices
14. device_credentials
15. device_events

SUBSCRIPTION
16. subscription_plans
17. plan_prices
18. subscriptions

BILLING
19. invoices
20. invoice_items
21. payment_attempts
22. payment_webhook_events
```

Kalau ingin mulai lebih sederhana, tabel permission dan device event dapat ditambahkan belakangan. Tetapi `admin_users`, `admin_sessions`, dan `audit_logs` sebaiknya sudah ada sejak versi pertama karena web admin akan mengubah data customer, perangkat, subscription, dan pembayaran.

## 6. User (2026-09-12 13:56:38)

oke, tolong simpan rancangan database tadi di file DB_Plan.md

Tool yang dipanggil:

- `skill`: {"name": "antislop-copywriting"}
- `glob`: {"path": ".", "pattern": "DB_Plan.md"}
- `write`: DB_Plan.md
- `write`: DB_Plan.md
- `read`: DB_Plan.md

### Assistant

Rancangan database sudah disimpan di [`DB_Plan.md`](DB_Plan.md).

Isinya mencakup:

- Auth admin web dan customer mobile
- Role, permission, session, dan audit log
- Customer dan perangkat CCTV
- Paket subscription dan batas perangkat
- Invoice, invoice item, QRIS, VA, dan webhook pembayaran
- Relasi antar tabel
- Flow login dan pembayaran
- Aturan bisnis serta catatan keamanan
- Daftar keputusan yang masih perlu dikonfirmasi sebelum migration final

## 7. User (2026-09-12 14:00:17)

oke, kita lanjut ke api contract ya, coba dari database skarang lu gmna?

### Assistant

Dari database sekarang, kita sudah bisa lanjut ke API contract. Menurut gue, API-nya jangan dibuat mengikuti nama tabel secara mentah, tapi mengikuti **fitur dan flow aplikasi**.

Saya sarankan kontraknya dibuat REST API dengan prefix:

```text
/api/v1
```

Arsitekturnya:

```text
Mobile Customer ──┐
                  ├── Backend API ─── PostgreSQL
Admin Web ────────┘
```

## 1. Standar umum API

### Format response sukses

```json
{
  "data": {},
  "meta": {
    "request_id": "uuid"
  }
}
```

Untuk list:

```json
{
  "data": [],
  "meta": {
    "request_id": "uuid",
    "pagination": {
      "next_cursor": "cursor-value",
      "has_more": true
    }
  }
}
```

### Format error

```json
{
  "error": {
    "code": "DEVICE_LIMIT_REACHED",
    "message": "Batas perangkat pada paket saat ini sudah tercapai.",
    "details": {},
    "request_id": "uuid"
  }
}
```

Jangan mengirim error database langsung ke client.

### Status HTTP

```text
200 OK          Request berhasil
201 Created     Data berhasil dibuat
204 No Content  Berhasil tanpa response body
400 Bad Request Input tidak valid
401 Unauthorized Belum login atau token invalid
403 Forbidden   Tidak punya permission
404 Not Found   Data tidak ditemukan
409 Conflict    Bentrok dengan kondisi data
422 Unprocessable Entity Validasi bisnis gagal
429 Too Many Requests Rate limit
500 Internal Server Error Error internal
```

### Standar data

- Semua ID memakai UUID.
- Timestamp memakai ISO 8601 UTC.
- Uang dikirim sebagai integer dalam satuan rupiah, bukan float.

Contoh:

```json
{
  "amount": 99000,
  "currency": "IDR"
}
```

- Status memakai string enum yang sudah ditentukan.
- Endpoint protected menggunakan:

```http
Authorization: Bearer <access_token>
```

## 2. Auth customer mobile

### Register email

```http
POST /api/v1/customer/auth/register
```

Request:

```json
{
  "full_name": "Budi Santoso",
  "email": "budi@example.com",
  "password": "password-user"
}
```

Response:

```json
{
  "data": {
    "customer": {
      "id": "customer-uuid",
      "full_name": "Budi Santoso",
      "status": "active"
    },
    "verification_required": true
  },
  "meta": {
    "request_id": "request-uuid"
  }
}
```

Password tidak pernah dikembalikan dalam response.

### Login email

```http
POST /api/v1/customer/auth/login/email
```

Request:

```json
{
  "email": "budi@example.com",
  "password": "password-user"
}
```

Response:

```json
{
  "data": {
    "access_token": "access-token",
    "refresh_token": "refresh-token",
    "expires_in": 900,
    "customer": {
      "id": "customer-uuid",
      "full_name": "Budi Santoso",
      "status": "active"
    }
  },
  "meta": {
    "request_id": "request-uuid"
  }
}
```

### Request OTP WhatsApp

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
  "meta": {
    "request_id": "request-uuid"
  }
}
```

### Verifikasi OTP WhatsApp

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

Response sama seperti login email, yaitu access token, refresh token, dan data customer.

### Login Google

```http
POST /api/v1/customer/auth/google
```

Request:

```json
{
  "id_token": "google-id-token"
}
```

Backend memvalidasi token tersebut ke Google. Client tidak mengirim `provider_subject` secara manual.

### Refresh token

```http
POST /api/v1/customer/auth/refresh
```

Request:

```json
{
  "refresh_token": "refresh-token"
}
```

Response:

```json
{
  "data": {
    "access_token": "new-access-token",
    "refresh_token": "new-refresh-token",
    "expires_in": 900
  },
  "meta": {
    "request_id": "request-uuid"
  }
}
```

### Logout

```http
POST /api/v1/customer/auth/logout
```

Header:

```http
Authorization: Bearer <access_token>
```

Response:

```http
204 No Content
```

### Profil customer

```http
GET /api/v1/customer/me
PATCH /api/v1/customer/me
```

Request PATCH:

```json
{
  "full_name": "Budi Santoso Baru",
  "avatar_url": "https://example.com/avatar.jpg"
}
```

## 3. Auth admin web

Admin sebaiknya memiliki namespace berbeda dari customer.

### Login admin

```http
POST /api/v1/admin/auth/login
```

Request:

```json
{
  "email": "admin@example.com",
  "password": "password-admin"
}
```

Response:

```json
{
  "data": {
    "access_token": "admin-access-token",
    "refresh_token": "admin-refresh-token",
    "expires_in": 900,
    "admin": {
      "id": "admin-uuid",
      "email": "admin@example.com",
      "full_name": "Master Admin",
      "roles": [
        "super_admin"
      ],
      "permissions": [
        "customer.read",
        "customer.update",
        "device.read",
        "subscription.manage"
      ]
    }
  },
  "meta": {
    "request_id": "request-uuid"
  }
}
```

### Endpoint admin lainnya

```http
POST /api/v1/admin/auth/refresh
POST /api/v1/admin/auth/logout
GET  /api/v1/admin/me
```

Master user pertama sebaiknya dibuat melalui seed atau CLI backend, bukan endpoint register publik.

## 4. Customer dan device

### List perangkat customer

```http
GET /api/v1/customer/devices
```

Response:

```json
{
  "data": [
    {
      "id": "device-uuid",
      "device_uid": "CCTV-001",
      "serial_number": "SN-001",
      "name": "Kamera Depan",
      "model": "Model CCTV",
      "status": "active",
      "last_seen_at": "2026-01-01T10:00:00Z"
    }
  ],
  "meta": {
    "request_id": "request-uuid"
  }
}
```

### Detail perangkat

```http
GET /api/v1/customer/devices/{device_id}
```

### Tambah atau pairing perangkat

```http
POST /api/v1/customer/devices
```

Request sebaiknya tidak membolehkan user memasukkan `customer_id`.

Contoh request:

```json
{
  "pairing_code": "PAIRING-CODE",
  "name": "Kamera Depan"
}
```

Backend akan:

1. Memvalidasi pairing code.
2. Memastikan device belum dimiliki customer lain.
3. Mengecek batas perangkat subscription.
4. Mengaitkan device ke customer yang sedang login.
5. Menjalankan proses dalam database transaction.

### Ubah nama perangkat

```http
PATCH /api/v1/customer/devices/{device_id}
```

Request:

```json
{
  "name": "Kamera Garasi"
}
```

### Nonaktifkan atau hapus perangkat

Daripada hard delete:

```http
POST /api/v1/customer/devices/{device_id}/deactivate
```

Response:

```json
{
  "data": {
    "id": "device-uuid",
    "status": "deleted"
  },
  "meta": {
    "request_id": "request-uuid"
  }
}
```

Untuk operasi create, pairing, dan pembayaran, gunakan header:

```http
Idempotency-Key: unique-client-generated-key
```

## 5. Subscription dan paket

### Lihat paket yang tersedia

```http
GET /api/v1/subscription-plans
```

Response:

```json
{
  "data": [
    {
      "id": "plan-uuid",
      "code": "basic",
      "name": "Basic",
      "device_limit": 3,
      "prices": [
        {
          "id": "price-uuid",
          "billing_interval": "monthly",
          "amount": 49000,
          "currency": "IDR"
        }
      ]
    }
  ],
  "meta": {
    "request_id": "request-uuid"
  }
}
```

Paket yang `is_active = false` tidak dikirim ke customer mobile.

### Lihat subscription aktif

```http
GET /api/v1/customer/subscription
```

Response:

```json
{
  "data": {
    "id": "subscription-uuid",
    "status": "active",
    "plan": {
      "code": "pro",
      "name": "Pro",
      "device_limit": 10
    },
    "current_period_start": "2026-01-01T00:00:00Z",
    "current_period_end": "2026-02-01T00:00:00Z",
    "cancel_at_period_end": false
  },
  "meta": {
    "request_id": "request-uuid"
  }
}
```

### Riwayat subscription

```http
GET /api/v1/customer/subscriptions
```

### Memilih atau upgrade paket

Saya menyarankan flow ini:

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

Response:

```json
{
  "data": {
    "invoice": {
      "id": "invoice-uuid",
      "invoice_number": "INV-202601-000001",
      "status": "open",
      "total_amount": 99000,
      "currency": "IDR"
    },
    "payment": {
      "id": "payment-attempt-uuid",
      "payment_method": "qris",
      "status": "pending",
      "qr_string": "qris-data",
      "expires_at": "2026-01-01T10:15:00Z"
    }
  },
  "meta": {
    "request_id": "request-uuid"
  }
}
```

Client tidak boleh mengirim harga atau total amount. Backend mengambil harga dari `plan_prices`.

## 6. Invoice dan pembayaran customer

### List invoice

```http
GET /api/v1/customer/invoices
```

Query:

```text
?status=open
?limit=20
?cursor=...
```

### Detail invoice

```http
GET /api/v1/customer/invoices/{invoice_id}
```

### Membuat metode pembayaran baru

Jika invoice masih `open` dan payment attempt sebelumnya expired:

```http
POST /api/v1/customer/invoices/{invoice_id}/payments
```

Request:

```json
{
  "payment_method": "va"
}
```

Response:

```json
{
  "data": {
    "id": "payment-attempt-uuid",
    "invoice_id": "invoice-uuid",
    "payment_method": "va",
    "status": "pending",
    "va_number": "1234567890",
    "amount": 99000,
    "currency": "IDR",
    "expires_at": "2026-01-01T10:15:00Z"
  },
  "meta": {
    "request_id": "request-uuid"
  }
}
```

Provider pembayaran dipilih backend. Client cukup mengirim metode yang memang tersedia, misalnya `qris` atau `va`.

### Cek status pembayaran

```http
GET /api/v1/customer/payments/{payment_id}
```

Status dari endpoint ini hanya berasal dari backend dan webhook payment provider.

## 7. Endpoint admin

### Customer

```http
GET   /api/v1/admin/customers
GET   /api/v1/admin/customers/{customer_id}
PATCH /api/v1/admin/customers/{customer_id}
POST  /api/v1/admin/customers/{customer_id}/suspend
POST  /api/v1/admin/customers/{customer_id}/activate
```

### Device

```http
GET   /api/v1/admin/devices
GET   /api/v1/admin/devices/{device_id}
PATCH /api/v1/admin/devices/{device_id}
POST  /api/v1/admin/devices/{device_id}/assign
POST  /api/v1/admin/devices/{device_id}/unassign
```

### Paket

```http
GET   /api/v1/admin/subscription-plans
POST  /api/v1/admin/subscription-plans
PATCH /api/v1/admin/subscription-plans/{plan_id}

GET   /api/v1/admin/plan-prices
POST  /api/v1/admin/plan-prices
PATCH /api/v1/admin/plan-prices/{price_id}
```

### Subscription

```http
GET  /api/v1/admin/subscriptions
GET  /api/v1/admin/subscriptions/{subscription_id}
POST /api/v1/admin/subscriptions/{subscription_id}/change-plan
POST /api/v1/admin/subscriptions/{subscription_id}/cancel
```

### Invoice dan pembayaran

```http
GET  /api/v1/admin/invoices
GET  /api/v1/admin/invoices/{invoice_id}
POST /api/v1/admin/invoices/{invoice_id}/void

GET /api/v1/admin/payments
GET /api/v1/admin/payments/{payment_id}
POST /api/v1/admin/payments/{payment_id}/refund
```

Endpoint refund hanya perlu dibuat jika memang payment provider dan kebutuhan bisnis mendukung refund.

### Audit log

```http
GET /api/v1/admin/audit-logs
GET /api/v1/admin/login-attempts
```

## 8. Endpoint webhook provider

Webhook tidak memakai auth customer atau admin. Endpoint ini menggunakan signature dari payment provider.

```http
POST /api/v1/webhooks/payments/{provider}
```

Contoh header:

```http
X-Provider-Signature: signature-value
X-Provider-Event-Id: event-id
```

Flow backend:

```text
1. Validasi signature.
2. Cek provider_event_id.
3. Jika event sudah diproses, return 200.
4. Simpan payload webhook.
5. Update payment_attempt.
6. Update invoice.
7. Update subscription.
8. Commit dalam satu transaction.
```

## 9. Hal yang perlu ditambahkan ke database

Dari API contract di atas, ada satu tabel yang belum ada di rancangan database, yaitu tabel untuk proses pairing CCTV.

### `device_pairing_codes`

```text
device_pairing_codes
- id uuid PK
- device_id uuid FK -> devices.id
- code_hash text UNIQUE
- expires_at timestamptz
- used_at timestamptz nullable
- created_at timestamptz
```

Kegunaannya:

- CCTV menghasilkan pairing code.
- Customer memasukkan atau scan code dari mobile.
- Backend memvalidasi code.
- Code hanya dapat digunakan satu kali.
- Code memiliki masa berlaku.

Selain itu, bila nanti ada refund yang perlu dilacak secara detail, tambahkan:

### `payment_refunds`

```text
payment_refunds
- id uuid PK
- payment_attempt_id uuid FK -> payment_attempts.id
- provider_refund_id text nullable
- amount numeric(14,2)
- reason text nullable
- status text
- requested_by_admin_id uuid FK -> admin_users.id nullable
- created_at timestamptz
- completed_at timestamptz nullable
```

## 10. Keputusan yang masih harus dikunci

Sebelum API contract dianggap final, kita perlu mengunci beberapa hal:

1. Backend memakai framework apa?
2. Token session mau opaque token seperti rancangan `*_sessions`, atau JWT?
3. Payment provider yang dipakai apa?
4. Pairing CCTV memakai QR code, kode angka, atau keduanya?
5. Upgrade paket langsung aktif atau menunggu periode selesai?
6. Downgrade paket ditolak jika jumlah perangkat melebihi limit, atau perangkat otomatis dinonaktifkan?
7. Apakah customer boleh mengganti email dan nomor WhatsApp?
8. Apakah admin web menggunakan bearer token atau HTTP-only cookie?

Rekomendasi default gue:

```text
API style       REST
Version         /api/v1
Customer auth   Bearer access token + refresh token
Admin auth      HTTP-only secure cookie jika web dan backend satu domain
Password        Argon2id
Payment flow    Invoice + payment attempt + webhook
Device pairing  QR code atau one-time pairing code
Money format    Integer IDR
Pagination      Cursor-based
```

Dari database sekarang, langkah berikutnya yang paling tepat adalah menambahkan `device_pairing_codes`, lalu menulis kontrak ini ke `API_Contract.md` atau langsung membuat `openapi.yaml`.

## 8. User (2026-09-12 14:31:08)

gw jawab pertanyaan ini ya
1. Backend memakai framework apa? nextjs, gua mau bkin fullstack.
2. Token session mau opaque token seperti rancangan *_sessions, atau JWT? pake JTW, buat web ditaro di cookie
3. Payment provider yang dipakai apa? smentara pake pakasir, gw udah punya akunnya.
4. Pairing CCTV memakai QR code, kode angka, atau keduanya? keduanya
5. Upgrade paket langsung aktif atau menunggu periode selesai? langsung aktif, tapi tinggal bayar selisih aja dari selisih juga dihitung dari durasi yang sudah terpakai.
6. Downgrade paket ditolak jika jumlah perangkat melebihi limit, atau perangkat otomatis dinonaktifkan? ga bisa downgrade, harus expired dlu baru beli plan lagi.
7. Apakah customer boleh mengganti email dan nomor WhatsApp? boleh tapi harus di verfikasi ulang
8. Apakah admin web menggunakan bearer token atau HTTP-only cookie? pake jwt tapi ditaro di cookie

Tool yang dipanggil:

- `glob`: {"pattern": "API_Contract.md", "path": "."}
- `read`: DB_Plan.md
- `todo_write`: {"todos": [{"content": "Tetapkan keputusan arsitektur API dari jawaban pengguna", "status": "in_progress"}, {"content": "Buat API contract Next.js untuk cust...
- `write`: API_Contract.md
- `write`: API_Contract.md
- `write`: API_Contract.md
- `write`: API_Contract.md
- `edit`: DB_Plan.md
- `edit`: DB_Plan.md
- `edit`: 

## 9. User (2026-09-12 17:35:43)

lanjut

Tool yang dipanggil:

- `todo_write`: {"todos": [{"content": "Tetapkan keputusan arsitektur API dari jawaban pengguna", "status": "completed"}, {"content": "Buat API contract Next.js untuk custom...
- `read`: DB_Plan.md
- `read`: DB_Plan.md
- `edit`: DB_Plan.md
- `edit`: DB_Plan.md
- `read`: DB_Plan.md
- `edit`: DB_Plan.md
- `edit`: DB_Plan.md
- `read`: DB_Plan.md
- `edit`: DB_Plan.md
- `read`: DB_Plan.md
- `edit`: DB_Plan.md
- `read`: DB_Plan.md
- `read`: DB_Plan.md
- `edit`: DB_Plan.md
- `edit`: DB_Plan.md
- `grep`: {"pattern": "^## |^### \">\n<parameter name=\"path\">DB_Plan.md"}
- `grep`: {"path": "DB_Plan.md", "pattern": "^#{2,3} "}
- `read`: DB_Plan.md
- `edit`: DB_Plan.md
- `read`: DB_Plan.md
- `edit`: DB_Plan.md
- `grep`: {"path": ".", "pattern": "token_hash|Supabase Auth|payment provider|Xendit|Midtrans"}
- `edit`: DB_Plan.md
- `todo_write`: {"todos": [{"content": "Tetapkan keputusan arsitektur API dari jawaban pengguna", "status": "completed"}, {"content": "Buat API contract Next.js untuk custom...
- `read`: DB_Plan.md
- `edit`: DB_Plan.md
- `bash`: grep -n '—\|–' DB_Plan.md API_Contract.md | head -20; echo "exit=$?"
- `bash`: wc -l DB_Plan.md API_Contract.md; ls -la
- `read`: API_Contract.md
- `edit`: API_Contract.md
- `grep`: {"path": "API_Contract.md", "pattern": "^# "}
- `bash`: awk 'NR==1 {print; next} /^#+ / { match($0, /^#+/); lvl=RLENGTH; if (lvl<=3) { printf "%s%s\n", substr("####", 1, lvl+1), substr($0, lvl+1) ; next } } { prin...
- `bash`: sed -i -e '5s/^###/##/' -e '22s/^###/##/' -e '33s/^###/##/' -e '57s/^####/###/' -e '83s/^####/###/' -e '101s/^####/###/' -e '120s/^####/###/' -e '343s/^####/...
- `bash`: wc -l API_Contract.md DB_Plan.md; grep -c '```' API_Contract.md DB_Plan.md
- `read`: API_Contract.md
- `todo_write`: {"todos": [{"content": "Tetapkan keputusan arsitektur API dari jawaban pengguna", "status": "completed"}, {"content": "Buat API contract Next.js untuk custom...

### Assistant

Lanjut. Dua file sudah sinkron dengan keputusan yang kamu berikan.

## Yang berubah di `DB_Plan.md`

Tabel baru:

- `device_pairing_codes` untuk QR dan kode angka one-time
- `subscription_events` untuk histori aktivasi, upgrade, expiry, cancel
- `payment_refunds` untuk refund via Pakasir
- `idempotency_keys` untuk mencegah request ganda

Penyesuaian:

- `admin_sessions` dan `customer_sessions` sekarang menyimpan `refresh_token_hash` dan `replaced_by_session_id`. Access JWT tidak disimpan di database karena umurnya pendek.
- `invoice_items.metadata` menyimpan detail prorata: plan lama, plan baru, sisa waktu, periode, kredit, dan nominal yang ditagih.
- `subscription_plans.sort_order` dipakai sebagai penentu level plan untuk upgrade.
- Aturan upgrade prorata dan larangan downgrade ditulis di bagian aturan bisnis.
- Flow pairing perangkat dan urutan migration ditambahkan.

Total: 26 tabel.

## Isi `API_Contract.md`

- Konvensi response, error, dan cursor pagination
- Auth customer: email, WhatsApp OTP, Google, refresh, logout
- Ganti email dan WhatsApp dengan verifikasi ulang
- Device: list, detail, buat pairing code, pair, rename, deactivate
- Subscription: paket aktif, subscription aktif, checkout, upgrade preview dan execute
- Invoice dan payment attempt dengan QRIS atau VA
- Auth admin dengan JWT di cookie HttpOnly plus catatan CSRF
- Webhook Pakasir dengan urutan validasi dan idempotensi
- Claims JWT, error code, dan daftar keputusan yang belum dikunci

## Catatan penting

Upgrade prorata menyimpan selisih nilai sisa periode. Karena periode berakhir tidak berubah, customer yang upgrade di tengah bulan hanya membayar selisih, dan plan baru langsung aktif setelah webhook sukses.

Downgrade tidak punya endpoint sama sekali. Customer menunggu subscription `expired`, lalu checkout plan baru.

## Langkah berikutnya

1. Tambahkan placeholder `JWT_SECRET`, `PAKASIR_*`, dan `ENCRYPTION_KEY` ke `.env.example`.
2. Tulis migration SQL PostgreSQL untuk 26 tabel tersebut.
3. Kunci 9 keputusan yang masih terbuka, terutama durasi JWT dan detail webhook Pakasir.
4. Terjemahkan kontrak ini menjadi `openapi.yaml` kalau kamu mau generate client untuk mobile.

File utama: `DB_Plan.md` dan `API_Contract.md`.

## 10. User (2026-09-12 18:38:24)

gua perlu baca history chat, ini ga muncul history chat terakhirnya

Tool yang dipanggil:

- `bash`: ls -la ~/.dsh/ 2>/dev/null | head -40
- `bash`: ls -la ~/.dsh/sessions 2>/dev/null | tail -20; echo "---"; find ~/.dsh -maxdepth 2 -type d 2>/dev/null | head -30
- `bash`: ls -la ~/.dsh/sessions/--home-unity008-Projekan-Nayaka--/; echo "==="; find ~/.dsh/sessions/--home-unity008-Projekan-Nayaka--/ -type f | head -40
- `bash`: ls -la ~/.dsh/sessions/--home-unity008-Projekan-Nayaka--/session-08d10714-e947-4ef8-82bc-bb7684e15ebf/; command -v zstd || echo "no zstd"; command -v zstdcat...
- `bash`: cd /tmp && zstdcat ~/.dsh/sessions/--home-unity008-Projekan-Nayaka--/session-08d10714-e947-4ef8-82bc-bb7684e15ebf/session.jsonl.zstd > /tmp/nayaka-session.js...
