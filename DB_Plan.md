# Database Plan

Rancangan database untuk sistem CCTV dengan dua aplikasi:

- Web admin untuk mengelola customer, perangkat, subscription, invoice, pembayaran, dan admin.
- Mobile customer untuk autentikasi, melihat perangkat, dan mengelola subscription.
- PostgreSQL dikelola melalui Supabase sebagai database saja.
- Autentikasi dikelola manual oleh backend, bukan Supabase Auth.
- Backend fullstack memakai Next.js, dengan Route Handlers di `/app/api`.
- Session memakai JWT. Admin web memakai JWT di cookie HttpOnly, customer mobile memakai access JWT dan refresh token.
- Payment provider memakai Pakasir mode API, sehingga QR string dan nomor VA ditampilkan sendiri oleh aplikasi.
- Device CCTV didaftarkan admin ke inventory, lalu diklaim customer dengan scan QR atau input serial number.
- Integrasi CCTV belum dikerjakan. Device yang diklaim baru berupa data baris di database.

## Arsitektur akses

```text
Mobile App ──HTTPS──> Next.js server ──DATABASE_URL──> PostgreSQL Supabase
Admin Web  ──HTTPS──> Next.js server ──DATABASE_URL──> PostgreSQL Supabase
Pakasir    ──webhook──> Next.js server
```

Connection string database hanya boleh digunakan server. Jangan menaruhnya di browser, aplikasi mobile, atau kode client-side.

## Daftar tabel

### Admin web

1. `admin_users`
2. `admin_roles`
3. `admin_permissions`
4. `admin_user_roles`
5. `admin_role_permissions`
6. `admin_sessions`
7. `admin_login_attempts`
8. `admin_session_events`
9. `audit_logs`

### Customer mobile

10. `customers`
11. `customer_auth_accounts`
12. `customer_sessions`
13. `auth_verification_codes`
14. `emergency_contacts`

### Perangkat CCTV

15. `devices`
16. `device_claim_codes`
17. `device_claim_attempts`
18. `device_credentials` (fase 2, belum dipakai)
19. `device_events` (fase 2, belum dipakai)

### Subscription

20. `subscription_plans`
21. `plan_prices`
22. `subscriptions`
23. `subscription_events`

### Billing dan pembayaran

24. `invoices`
25. `invoice_items`
26. `payment_attempts`
27. `payment_webhook_events`
28. `payment_provider_calls`
29. `payment_refunds`

### Diskon

30. `discount_vouchers`
31. `discount_voucher_prices`
32. `discount_voucher_redemptions`
33. `plan_flash_sales`
34. `plan_flash_sale_prices`

### Infrastruktur API

35. `idempotency_keys`
36. `scheduled_job_runs`

Tabel nomor 17 dan 18 dibuat pada migration tetapi sengaja tidak dipakai selama integrasi CCTV belum dikerjakan. Tabel 29 sampai 33 ditambahkan pada migration `0008_discount_module.sql`; batas invoice pada `0009_invoice_discount_limit.sql`. Lihat bagian modul diskon.

---

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

Status: `active`, `inactive`, `locked`.

Password admin wajib menggunakan Argon2id atau bcrypt. `is_super_admin` dapat dipakai untuk master user awal, tetapi role dan permission tetap menjadi mekanisme utama.

### `admin_roles`

```text
admin_roles
- id uuid PK
- code text UNIQUE
- name text
- description text nullable
- created_at timestamptz
```

Contoh role: `super_admin`, `finance`, `customer_support`, `device_operator`, `content_manager`.

### `admin_permissions`

```text
admin_permissions
- id uuid PK
- code text UNIQUE
- name text
- description text nullable
```

Contoh permission: `customer.read`, `customer.update`, `customer.suspend`, `device.read`, `device.update`, `subscription.read`, `subscription.manage`, `invoice.read`, `payment.refund`, `admin.manage`, `audit.read`.

### `admin_user_roles`

```text
admin_user_roles
- admin_user_id uuid FK -> admin_users.id
- role_id uuid FK -> admin_roles.id
- created_at timestamptz

PRIMARY KEY (admin_user_id, role_id)
```

### `admin_role_permissions`

```text
admin_role_permissions
- role_id uuid FK -> admin_roles.id
- permission_id uuid FK -> admin_permissions.id

PRIMARY KEY (role_id, permission_id)
```

Relasi: `admin_users N:N admin_roles`, dan `admin_roles N:N admin_permissions`.

### `admin_sessions`

Session login admin web. Access JWT berumur pendek, sedangkan refresh token dirotasi dan disimpan dalam bentuk hash. Token asli tidak disimpan di database.

```text
admin_sessions
- id uuid PK
- admin_user_id uuid FK -> admin_users.id
- refresh_token_hash text UNIQUE
- ip_address inet nullable
- user_agent text nullable
- expires_at timestamptz
- revoked_at timestamptz nullable
- replaced_by_session_id uuid FK -> admin_sessions.id nullable
- created_at timestamptz
- last_used_at timestamptz nullable
```

### `admin_login_attempts`

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

Dipakai untuk brute-force protection dan monitoring login.

### `admin_session_events`

Siklus hidup sesi admin, dari masuk sampai sesi berakhir.

```text
admin_session_events
- id uuid PK
- admin_session_id uuid FK -> admin_sessions.id nullable
- admin_user_id uuid FK -> admin_users.id
- event_type text
- ip_address inet nullable
- user_agent text nullable
- metadata jsonb nullable
- created_at timestamptz
```

Nilai `event_type`:

| Nilai | Muncul saat |
|---|---|
| `login` | Login berhasil dan sesi dibuat |
| `refresh` | Refresh token dirotasi, sesi lama digantikan yang baru |
| `logout` | Admin keluar sendiri |
| `revoked` | Sesi dicabut admin lain atau oleh sistem |
| `expired` | Sesi melewati `expires_at` |
| `password_changed` | Kata sandi diubah, sesi lain dianggap tidak berlaku lagi |

`admin_session_id` nullable karena event `login` dicatat sebelum baris `admin_sessions` ada.
Untuk event itu, `metadata` memuat penanda bahwa sesi baru dibuat.

Tabel ini melengkapi `audit_logs`, bukan menggantikannya. `audit_logs` merekam tindakan
terhadap data, sedangkan tabel ini merekam keadaan sesi. Logout tidak mengubah data apa pun,
tetapi tanpa catatan ini pertanyaan "apakah sesi admin ini benar-benar ditutup" tidak dapat
dijawab.

### `audit_logs`

```text
audit_logs
- id uuid PK
- actor_type text
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

Nilai `actor_type`: `admin` atau `system`.

`admin_user_id` memakai `ON DELETE RESTRICT`, bukan `ON DELETE SET NULL`. Alasannya: batasan
`audit_logs_actor_consistency` mewajibkan kolom pelaku terisi selama `actor_type` bernilai
`admin`, sedangkan `SET NULL` justru mengosongkannya saat admin dihapus. Keduanya tidak dapat
dipenuhi bersamaan, sehingga penghapusan admin yang pernah melakukan satu tindakan saja selalu
gagal dengan galat batasan kunci asing yang tidak menerangkan sebabnya. Dengan `RESTRICT`,
admin tidak dihapus melainkan dinonaktifkan, dan itu memang yang seharusnya dilakukan pada akun
yang punya jejak audit.

`admin_user_id` bernilai null ketika `actor_type` bernilai `system`, misalnya job rekonsiliasi
menandai pembayaran terverifikasi atau scheduler mengubah subscription menjadi `expired`.
Tanpa kolom ini, tindakan otomatis tidak dapat dibedakan dari tindakan manusia, dan pertanyaan
"kenapa status ini berubah padahal tidak ada admin yang menyentuhnya" tidak dapat dijawab.

Kolom `ip_address` dan `user_agent` bernilai null untuk tindakan sistem.

Contoh action: `customer.suspend`, `customer.update`, `device.assign`, `device.unassign`, `subscription.change`, `invoice.void`, `payment.refund`, `admin.create`, `admin.role_update`, dan untuk sistem `payment.verified_by_reconciliation`, `subscription.expired_by_scheduler`.

Index yang dibutuhkan:

```sql
CREATE INDEX audit_logs_created_at_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_admin_idx ON audit_logs (admin_user_id, created_at DESC);
```

Halaman audit menyaring berdasarkan pelaku, jenis entitas, dan rentang waktu, sehingga ketiga
index ini diperlukan.

---

## 2. Modul customer mobile

### `customers`

Profil customer. Data login disimpan di `customer_auth_accounts`.

```text
customers
- id uuid PK
- full_name text
- avatar_url text nullable
- status text
- created_at timestamptz
- updated_at timestamptz
```

Status: `active`, `suspended`, `deleted`.

### `customer_auth_accounts`

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

Provider: `email`, `whatsapp`, `google`.

Aturan provider:

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

Constraint yang disarankan:

```text
UNIQUE(provider, provider_subject)
UNIQUE(email) WHERE email IS NOT NULL
UNIQUE(phone_e164) WHERE phone_e164 IS NOT NULL
```

Email dinormalisasi menjadi lowercase. Nomor WhatsApp disimpan dalam format E.164, misalnya `+628123456789`. Untuk Google, `provider_subject` menyimpan nilai `sub` dari token Google.

### `customer_sessions`

Access JWT berumur pendek dan tidak disimpan di database. Yang disimpan adalah refresh token dalam bentuk hash, karena refresh token dirotasi dan harus bisa dicabut.

```text
customer_sessions
- id uuid PK
- customer_id uuid FK -> customers.id
- refresh_token_hash text UNIQUE
- device_id text nullable
- platform text nullable
- app_version text nullable
- ip_address inet nullable
- expires_at timestamptz
- revoked_at timestamptz nullable
- replaced_by_session_id uuid FK -> customer_sessions.id nullable
- created_at timestamptz
- last_used_at timestamptz nullable
```

`device_id` di tabel ini berarti identitas instalasi aplikasi mobile, bukan CCTV. Kolom `replaced_by_session_id` dipakai untuk mendeteksi reuse refresh token lama.

### `auth_verification_codes`

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

Purpose: `login`, `verify_email`, `verify_phone`, `change_email`, `change_phone`, `reset_password`.

Satu kode dipakai untuk satu target. Saat customer mengganti email atau nomor WhatsApp, kode dikirim ke target baru, dan target lama tetap aktif sebagai metode login sampai kode tersebut berhasil diverifikasi. Setelah verifikasi berhasil, barulah record di `customer_auth_accounts` diarahkan ke email atau nomor baru, lalu `is_verified` dan `verified_at` diperbarui.

OTP tidak disimpan dalam bentuk plaintext. Terapkan batas percobaan, masa berlaku, dan rate limit berdasarkan nomor serta IP.

---

## 3. Modul perangkat CCTV

### `devices`

Device didaftarkan admin ke inventory sebelum dimiliki customer. Karena itu `customer_id` nullable: NULL berarti device masih di gudang dan belum diklaim.

```text
devices
- id uuid PK
- device_uid text UNIQUE
- serial_number text UNIQUE
- name text nullable
- model text nullable
- hardware_revision text nullable
- batch_number text nullable
- mac_address text nullable
- imei text nullable
- customer_id uuid FK -> customers.id nullable
- status text
- claim_method text nullable
- registered_by_admin_id uuid FK -> admin_users.id nullable
- warranty_start_at timestamptz nullable
- claimed_at timestamptz nullable
- activated_at timestamptz nullable
- deactivated_at timestamptz nullable
- metadata jsonb nullable
- created_at timestamptz
- updated_at timestamptz
```

Status: `in_stock`, `claimed`, `suspended`, `retired`, `deleted`.

`device_uid` digenerate server saat registrasi dan tidak pernah dikirim client. `serial_number` wajib dan unik. `name` diisi customer saat claim, sehingga nullable sebelum diklaim.

Status pada v1 hanya menggambarkan siklus hidup pendaftaran, bukan status koneksi. Jangan memakai `offline` atau `online` sebelum ada heartbeat perangkat. `claim_method` bernilai `qr` atau `serial`, dan bernilai NULL bila perangkat ditugaskan langsung oleh admin. Penugasan admin bukan klaim oleh customer, jadi kolom ini tidak diisi pada jalur tersebut; keterangannya ada di `audit_logs`.

Satu device hanya memiliki satu pemilik melalui jalur customer. Claim code bersifat sekali pakai dan tidak diterbitkan ulang otomatis. Perpindahan kepemilikan hanya dapat dilakukan admin sebagai tindakan korektif dengan alasan dan audit log.

### `device_claim_codes`

Kode claim dibuat server saat device didaftarkan admin, lalu dicetak pada label atau dus perangkat. Customer memakai kode ini lewat scan QR. Kode tidak pernah dibuat customer.

```text
device_claim_codes
- id uuid PK
- device_id uuid UNIQUE FK -> devices.id
- code_hash text UNIQUE
- format text
- expires_at timestamptz nullable
- attempt_count integer
- used_at timestamptz nullable
- used_by_customer_id uuid FK -> customers.id nullable
- created_at timestamptz
```

Format: `qr`, `both`.

Server menyimpan hash token claim, bukan token plaintext. Token plaintext hanya dikembalikan sekali, yaitu pada response saat pembuatan atau rotasi.

`device_id` unik karena satu device hanya memiliki satu claim code aktif. `expires_at` nullable berarti tidak kedaluwarsa, dipakai pada v1 supaya device yang lama tersimpan di gudang tetap dapat diklaim.

Rotasi claim code mencabut kode lama dan membuat yang baru. Dipakai jika label rusak atau device diterbitkan ulang setelah unassign.

### `device_claim_attempts`

Catatan setiap percobaan claim, berhasil maupun gagal. Wajib ada karena jalur serial number dapat ditebak.

```text
device_claim_attempts
- id uuid PK
- device_id uuid FK -> devices.id nullable
- customer_id uuid FK -> customers.id nullable
- submitted_kind text
- submitted_value_masked text
- ip_address inet nullable
- user_agent text nullable
- success boolean
- failure_reason text nullable
- created_at timestamptz
```

`submitted_kind` bernilai `qr` atau `serial`. Nilai yang dikirim customer disimpan dalam bentuk tersamarkan, bukan plaintext. `device_id` nullable karena percobaan dengan serial yang tidak dikenal tidak dapat dihubungkan ke device mana pun.

Tabel ini menjadi dasar rate limit claim dan alat utama untuk menelusuri penyalahgunaan.

### `device_credentials`

**Fase 2. Belum dipakai di v1.**

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

Secret harus dienkripsi di backend dan tidak dikirim utuh ke aplikasi mobile jika tidak diperlukan.

### `device_events`

**Fase 2. Belum dipakai di v1.**

```text
device_events
- id uuid PK
- device_id uuid FK -> devices.id
- event_type text
- payload jsonb nullable
- occurred_at timestamptz
- created_at timestamptz
```

Contoh event: `online`, `offline`, `firmware_updated`, `credential_rotated`, `assigned`, `unassigned`.

### Fase 2: integrasi perangkat

Belum dikerjakan. Device yang sudah diklaim hanya berupa data baris di database. Backend tidak tahu apakah unit fisiknya hidup, terpasang, atau online.

Yang akan ditambahkan saat fase ini dikerjakan:

- Endpoint auth perangkat dan rotasi kredensial.
- Heartbeat dan pelaporan status koneksi.
- Push event perangkat ke `device_events`.
- Kolom `firmware_version`, `last_seen_at`, dan detail konektivitas pada `devices`.
- Nilai status `online` dan `offline`.

---

## 4. Modul paket subscription

### `subscription_plans`

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

Contoh: `free | Free | 1`, `basic | Basic | 3`, `pro | Pro | 10`, `ultra | Ultra | NULL`.

`device_limit = NULL` dapat berarti unlimited. Jika Ultra memiliki batas, isi dengan angka agar aturan eksplisit.

Nilai batas yang dipakai saat ini pada seed: paket Gratis `device_limit = 1`. Angka ini **belum
diputuskan pemilik produk** dan masih tercatat sebagai pertanyaan terbuka. Nilai 1 dipakai
sementara supaya jalur klaim gratis tidak terbuka tanpa batas, yang berarti satu pelanggan dapat
mengklaim kamera sebanyak apa pun. `NULL` pada paket Gratis berarti tanpa batas dan itu tidak
boleh dibiarkan sebagai nilai bawaan selama keputusannya belum diambil.

### `plan_prices`

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

Interval: `monthly`, `yearly`. Gunakan `numeric`, bukan `float`, untuk nilai uang.

Satu paket hanya punya satu harga per interval, karena `plan_prices` memiliki
`UNIQUE (plan_id, billing_interval)`. Batasan ini bertabrakan dengan aturan di
`API_Contract.md` yang menyuruh membuat record harga baru lalu menonaktifkan yang lama: baris
kedua untuk paket dan interval yang sama selalu ditolak database, sehingga riwayat harga tidak
dapat disimpan.

Pilihan yang tersedia, dan belum ditetapkan pemilik produk:

1. Cabut batasan `UNIQUE` itu supaya banyak harga per interval dapat hidup berdampingan, dengan
   `is_active` menentukan mana yang berlaku. Ini yang diperlukan agar riwayat harga benar-benar
   tersimpan, dan cara ini juga membuat perbandingan harga lama dan baru mungkin dilakukan.
2. Pertahankan batasan dan ubah kontraknya, sehingga harga yang sudah dipakai tidak pernah
   berubah dan perubahan harga dilakukan dengan membuat paket baru. Ini menjaga tabel tetap
   sederhana, tetapi berarti paket lama tidak dapat diperbarui harganya.

Selama belum diputuskan, `PATCH /api/v1/admin/plan-prices/{price_id}` hanya boleh mengubah
`is_active`, dan `amount` hanya boleh diubah selama belum ada satu pun langganan yang menunjuk
harga tersebut. Setelah dipakai, nominalnya ditolak, karena mengubahnya akan membuat tagihan
berikutnya berbeda dari yang sudah disetujui pelanggan tanpa jejak perubahan yang dapat ditelusuri.

### `subscriptions`

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

Status: `trialing`, `active`, `past_due`, `canceled`, `expired`.

Paket gratis tetap dibuat sebagai subscription agar pengecekan batas perangkat memakai mekanisme yang sama.

Subscription plan free dibuat otomatis saat customer register, dengan status `active` dan `current_period_end` bernilai NULL yang berarti tidak kedaluwarsa. Customer baru karena itu sudah dapat mengklaim device sesuai batas paket free tanpa checkout.

```sql
CREATE UNIQUE INDEX one_active_subscription_per_customer
ON subscriptions (customer_id)
WHERE status IN ('trialing', 'active', 'past_due');
```

Aturan upgrade dan downgrade:

- Upgrade aktif setelah pembayaran selisih prorata berhasil dikonfirmasi webhook.
- Upgrade hanya ke plan dengan `sort_order` lebih tinggi.
- Upgrade hanya boleh antar `billing_interval` yang sama. Upgrade dari bulanan ke tahunan ditolak dengan `UPGRADE_INTERVAL_MISMATCH`. Karena itu `period_seconds` pada perhitungan prorata selalu sama untuk plan lama dan plan baru.
- `current_period_end` tidak berubah saat upgrade, karena yang dibayar hanya selisih nilai sisa periode.
- Jika `amount_due` setelah pembulatan bernilai 0, plan baru langsung aktif tanpa invoice, dan `subscription_events.metadata` mencatat `charged_amount: 0` dengan alasan `below_minimum`.
- Downgrade tidak tersedia selama subscription masih aktif.
- Setelah subscription berstatus `expired`, customer membeli plan baru melalui checkout biasa.
- Urutan level plan ditentukan oleh `subscription_plans.sort_order`.
- Checkout ditolak dengan `SUBSCRIPTION_ALREADY_ACTIVE` selama masih ada subscription aktif.

### `subscription_events`

Histori perubahan subscription. Tanpa tabel ini, riwayat upgrade, expiry, dan cancel tidak dapat diaudit.

```text
subscription_events
- id uuid PK
- subscription_id uuid FK -> subscriptions.id
- customer_id uuid FK -> customers.id
- event_type text
- from_plan_id uuid FK -> subscription_plans.id nullable
- to_plan_id uuid FK -> subscription_plans.id nullable
- invoice_id uuid FK -> invoices.id nullable
- actor_type text
- actor_id uuid nullable
- metadata jsonb nullable
- created_at timestamptz
```

Event type: `activated`, `renewed`, `upgraded`, `expired`, `canceled`, `past_due`, `manual_change`.

`actor_type` bernilai `customer`, `admin`, atau `system`. Untuk upgrade, `metadata` menyimpan nilai sisa periode lama, nilai sisa periode baru, dan nominal yang ditagihkan.

---

## 5. Modul invoice dan pembayaran

Jangan memakai satu tabel `transaction` sebagai tabel utama. Pisahkan tagihan, detail tagihan, percobaan pembayaran, dan webhook.

### `invoices`

Invoice adalah tagihan, bukan pembayaran.

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

Status: `draft`, `open`, `paid`, `past_due`, `void`, `uncollectible`.

### `invoice_items`

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

Harga disalin agar invoice lama tidak berubah ketika harga master diperbarui. Untuk invoice upgrade, `metadata` menyimpan `previous_plan_id`, `previous_period_price`, `new_period_price`, `remaining_seconds`, `period_seconds`, `credit_amount`, dan `charged_amount` supaya perhitungan prorata dapat diaudit ulang.

### `payment_attempts`

Provider yang dipakai saat ini adalah Pakasir, memakai mode API. Server memanggil `transactioncreate`, menerima QR string atau nomor VA, lalu menampilkannya sendiri.

```text
payment_attempts
- id uuid PK
- invoice_id uuid FK -> invoices.id
- attempt_sequence integer
- provider text
- payment_method text
- provider_order_id text UNIQUE
- provider_payment_id text nullable
- provider_fee numeric(14,2) nullable
- provider_total_payment numeric(14,2) nullable
- amount numeric(14,2)
- status text
- checkout_url text nullable
- qr_string text nullable
- va_number text nullable
- expires_at timestamptz nullable
- paid_at timestamptz nullable
- failed_at timestamptz nullable
- canceled_at timestamptz nullable
- verified_at timestamptz nullable
- verified_via text nullable
- raw_response jsonb nullable
- created_at timestamptz
- updated_at timestamptz

UNIQUE (invoice_id, attempt_sequence)
```

`verified_at` diisi saat status pembayaran dikonfirmasi lewat `transactiondetail`, dan `verified_via` mencatat pemicunya: `webhook`, `reconciliation`, atau `sync`. Kolom ini membedakan attempt yang statusnya benar-benar terverifikasi dari yang masih mengandalkan asumsi.

`amount` adalah nominal tagihan dan harus sama dengan `invoices.total_amount`. Pakasir menambahkan biaya layanan di atas nominal tersebut, sehingga:

```text
provider_fee           = fee dari Pakasir
provider_total_payment = amount + provider_fee
```

`provider_total_payment` adalah yang benar-benar dibayar customer dan wajib ditampilkan di aplikasi. `invoices.amount_paid` diisi sebesar `amount`, bukan `provider_total_payment`. Biaya layanan tidak pernah masuk ke `invoices` dan tidak dihitung sebagai pendapatan subscription.

`discount_amount` tidak boleh lebih besar dari `subtotal`, ditegakkan oleh constraint pada migrasi `0009_invoice_discount_limit.sql`. Resolver harga diskon memilih satu aturan paling menguntungkan, bukan menjumlahkan voucher dan flash sale.

`provider_order_id` adalah nilai `order_id` yang dikirim ke Pakasir. Karena Pakasir memakai `order_id` sebagai kunci transaksi dan satu invoice dapat memiliki banyak attempt, nilainya harus unik per attempt:

```text
provider_order_id = {invoice_number}-{attempt_sequence}

contoh: INV-2026-0001-1
        INV-2026-0001-2
```

Webhook yang datang membawa `order_id` langsung dipetakan ke satu payment attempt melalui kolom ini.

Pakasir tidak mengembalikan ID transaksi internal, sehingga `provider_payment_id` tidak diisi dan seluruh penelusuran memakai `provider_order_id`.

Payment method memakai kode Pakasir apa adanya:

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

`qris` mengisi `qr_string` dari field `payment_number`. Metode VA mengisi `va_number` dari field yang sama.

Status: `pending`, `paid`, `expired`, `failed`, `canceled`.

Contoh:

```text
Invoice INV-2026-0001
├── attempt 1, qris,      expired
├── attempt 2, bri_va,    expired
└── attempt 3, qris,      paid
```

Invoice hanya menjadi `paid` setelah backend menerima dan memvalidasi konfirmasi dari Pakasir melalui webhook.

### `payment_webhook_events`

```text
payment_webhook_events
- id uuid PK
- provider text
- provider_event_id text UNIQUE
- payment_attempt_id uuid FK -> payment_attempts.id nullable
- provider_order_id text nullable
- provider_status text nullable
- event_type text
- payload jsonb
- ip_address inet nullable
- user_agent text nullable
- processed_at timestamptz nullable
- processing_error text nullable
- created_at timestamptz
```

`provider_event_id` wajib unik karena provider dapat mengirim webhook berulang.

Webhook Pakasir tidak memuat signature, tidak memuat secret, dan tidak memuat event ID. Payload-nya hanya:

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

Karena tidak ada event ID, kunci idempotensi disusun dari data yang tersedia:

```text
provider_event_id = {order_id}:{status}
```

Satu `order_id` hanya mewakili satu transaksi, sehingga kombinasi ini cukup mencegah pemrosesan ganda.

`payment_attempt_id` dan `provider_order_id` nullable karena webhook dengan `order_id` yang tidak dikenal tetap disimpan sebagai bukti, lalu ditandai pada `processing_error`.

`ip_address` dan `user_agent` disimpan karena webhook tidak terautentikasi, sehingga asal request perlu dapat ditelusuri.

### `payment_provider_calls`

Panggilan keluar kita ke Pakasir. Tabel ini mencatat arah komunikasi yang berlawanan dengan
`payment_webhook_events`, dan keduanya dibutuhkan untuk mengetahui apa yang sebenarnya terjadi
saat integrasi bermasalah.

```text
payment_provider_calls
- id uuid PK
- provider text
- operation text
- payment_attempt_id uuid FK -> payment_attempts.id nullable
- order_id text nullable
- request_body jsonb nullable
- response_body jsonb nullable
- http_status integer nullable
- duration_ms integer
- outcome text
- error_message text nullable
- attempt_number integer
- created_at timestamptz
```

Nilai `operation`: `transactioncreate`, `transactioncancel`, `transactiondetail`, `paymentsimulation`.

Nilai `outcome`:

| Nilai | Arti |
|---|---|
| `success` | Panggilan berhasil dan response dapat dipakai |
| `failed` | Gagal karena HTTP error, jaringan, atau timeout |

`duration_ms` wajib diisi meski panggilan gagal, karena timeout juga punya durasi, dan durasi
timeout itulah yang menunjukkan berapa lama pengguna menunggu.

`attempt_number` dimulai dari satu dan bertambah pada setiap percobaan ulang. Retry hanya
dilakukan untuk operasi baca seperti `transactiondetail`, dan tidak pernah untuk
`transactioncreate` atau `transactioncancel`.

`request_body` dan `response_body` disaring sebelum disimpan. Field `api_key` selalu ditulis
ulang menjadi `"[disaring]"`. Penyaringan dilakukan saat penulisan supaya nilai aslinya tidak
pernah tersimpan di database. Ini berbeda dari `payment_webhook_events.payload` yang disimpan
apa adanya, karena payload webhook tidak memuat kredensial apa pun, sedangkan request kita
memuat `api_key`.

`order_id` nullable karena panggilan `transactioncreate` yang gagal sebelum order dibuat tidak
memiliki order id, dan baris itu tetap perlu tercatat.

Index yang dibutuhkan:

```sql
CREATE INDEX payment_provider_calls_created_at_idx ON payment_provider_calls (created_at DESC);
CREATE INDEX payment_provider_calls_order_idx ON payment_provider_calls (order_id, created_at DESC);
CREATE INDEX payment_provider_calls_outcome_idx ON payment_provider_calls (outcome, created_at DESC);
```

### Verifikasi pembayaran

Webhook Pakasir tidak bertanda tangan, sehingga payload-nya tidak dapat dipercaya. Dokumentasi Pakasir sendiri menyarankan pengecekan ulang:

> Penting: Saat menerima webhook pastikan amount dan order_id sesuai dengan transaksi di sistem Anda. Kami sarankan untuk tetap menggunakan API dibawah ini untuk pengecekan status yang lebih valid.

Karena itu webhook hanya berfungsi sebagai pemicu. Sumber kebenaran status pembayaran adalah Transaction Detail API:

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

Aturan:

- Status pembayaran hanya berubah jika `transactiondetail` mengembalikan `status: completed`.
- `amount` dan `order_id` dari response wajib cocok dengan `payment_attempts`.
- Nilai `amount`, `status`, dan `payment_method` dari payload webhook tidak pernah dipakai untuk mengubah data.
- Webhook palsu tidak dapat mengaktifkan subscription, karena Pakasir tidak akan mengenali `order_id` yang tidak pernah dibuat.
- `completed_at` memakai offset waktu lokal dan dikonversi ke UTC sebelum disimpan.

Karena `transactiondetail` mewajibkan `amount` dikirim sebagai query parameter, `payment_attempts.amount` harus dibaca lebih dulu dan tidak boleh dihitung ulang.

### Job rekonsiliasi pembayaran

Kebijakan retry webhook Pakasir tidak didokumentasikan. Karena itu backend tidak boleh menggantungkan diri pada retry dari Pakasir.

Job yang berjalan setiap 5 menit:

```text
1. Ambil payment_attempts berstatus pending yang belum melewati expires_at.
2. Panggil transactiondetail untuk masing-masing.
3. Jika status completed dan amount cocok, aktifkan invoice dan subscription.
4. Jika status lain, biarkan pending.
5. Ambil payment_webhook_events dengan processed_at NULL dan proses kembali.
```

Job ini adalah pengaman utama agar pembayaran yang benar-benar masuk tetap terdeteksi meski webhook hilang atau gagal diverifikasi.

### `payment_refunds`

Hanya dipakai jika refund melalui Pakasir diaktifkan.

```text
payment_refunds
- id uuid PK
- payment_attempt_id uuid FK -> payment_attempts.id
- provider_refund_id text nullable
- amount numeric(14,2)
- reason text
- status text
- requested_by_admin_id uuid FK -> admin_users.id nullable
- created_at timestamptz
- completed_at timestamptz nullable
```

Status: `pending`, `completed`, `failed`.

---

## 6. Modul diskon

### `discount_vouchers`

Voucher berkode, dengan potongan persen atau nominal tetap. `scope` menentukan semua harga atau daftar harga terpilih.

```text
discount_vouchers
- id uuid PK
- code text UNIQUE
- name text
- description text nullable
- discount_type text
- percent_value integer nullable
- fixed_amount numeric(14,2) nullable
- scope text
- starts_at timestamptz nullable
- ends_at timestamptz nullable
- max_redemptions integer nullable
- max_redemptions_per_customer integer
- min_amount numeric(14,2) nullable
- applies_to text
- is_active boolean
- created_by_admin_id uuid FK -> admin_users.id
- created_at timestamptz
- updated_at timestamptz
```

Kode 3 sampai 32 karakter, huruf besar, angka, `_`, atau `-`. Voucher dinonaktifkan, bukan dihapus,
karena riwayat redemption menyimpan foreign key. `discount_voucher_prices` menyimpan harga terpilih;
cakupan `all_prices` tidak boleh memiliki baris terkait.

### `discount_voucher_redemptions`

Satu pelanggan hanya dapat menebus voucher sekali. Kuota total dihitung dari jumlah baris redemption.
Setiap baris menyimpan nominal sebelum, potongan, dan nominal sesudah untuk audit.

### `plan_flash_sales` dan `plan_flash_sale_prices`

Satu baris flash sale terikat pada satu `plan_id`. Pilihan beberapa paket dari admin membuat beberapa
baris dalam satu transaksi. Jendela waktu wajib dan tidak boleh bertabrakan pada paket yang sama.
Harga terpilih harus berasal dari paket barisnya.

Resolver harga tidak menjumlahkan voucher dan flash sale. Jika keduanya berlaku, potongan terbesar
menang. Batas `invoices.discount_amount <= subtotal` ditambahkan pada `0009_invoice_discount_limit.sql`.

---

## 7. Modul infrastruktur API

### `idempotency_keys`

Mencegah request yang diulang membuat dua invoice, dua payment attempt, atau dua claim. Penting untuk jaringan mobile yang tidak stabil.

```text
idempotency_keys
- id uuid PK
- actor_key text
- actor_type text
- actor_id uuid nullable
- endpoint text
- idempotency_key text
- request_hash text
- response_status integer nullable
- response_body jsonb nullable
- expires_at timestamptz
- created_at timestamptz
```

`actor_key` adalah identifier bertipe teks yang selalu terisi, misalnya `customer:<uuid>`, `admin:<uuid>`, atau `anon:<hash-ip>`. Kolom ini dipakai untuk unique index, bukan `actor_id`.

`actor_id` sengaja nullable dan hanya dipakai untuk penelusuran. Unique index tidak boleh memakai `actor_id` karena pada endpoint anonymous seperti register nilainya NULL, dan di PostgreSQL NULL dianggap berbeda satu sama lain sehingga dedup tidak akan pernah bekerja.

Unique index:

```sql
CREATE UNIQUE INDEX idempotency_keys_unique_request
ON idempotency_keys (actor_key, endpoint, idempotency_key);
```

`request_hash` dipakai untuk memastikan idempotency key yang sama tidak dipakai dengan payload berbeda. Jika hash berbeda, backend mengembalikan error `IDEMPOTENCY_KEY_REUSED`.

`response_body` tidak boleh memuat access token, refresh token, OTP, atau claim token plaintext. Untuk endpoint yang mengembalikan token, simpan hanya penanda bahwa response sudah pernah dihasilkan.

Idempotensi webhook Pakasir tidak memakai tabel ini. Webhook memakai `payment_webhook_events.provider_event_id`, karena Pakasir tidak mengirim header `Idempotency-Key`.

### `scheduled_job_runs`

Catatan setiap kali job terjadwal berjalan.

```text
scheduled_job_runs
- id uuid PK
- job_name text
- started_at timestamptz
- finished_at timestamptz nullable
- outcome text
- affected_rows integer
- error_message text nullable
- created_at timestamptz
```

Nilai `outcome`: `running`, `success`, `failed`.

`finished_at` nullable karena baris dibuat saat job mulai, lalu diperbarui saat selesai. Cara ini
membuat job yang mati di tengah jalan tetap terlihat sebagai baris `running` yang tidak pernah
selesai, bukan hilang tanpa jejak.

`affected_rows` mencatat berapa baris yang disentuh. Job rekonsiliasi yang berjalan sukses tetapi
menyentuh nol baris selama berhari-hari adalah tanda ada yang salah pada konfigurasi atau pada
kredensial provider, dan angka ini yang memunculkannya. Tanpa kolom ini, job yang berjalan
tetapi tidak melakukan apa pun akan tampak sehat.

Job yang belum pernah jalan sama sekali tidak memiliki baris di tabel ini. Dashboard menampilkan
keadaan itu sebagai `last_finished_at` bernilai null dengan `is_stale` bernilai true, bukan
menyembunyikannya, karena job yang tidak pernah jalan adalah keadaan yang paling perlu diketahui.

```sql
CREATE INDEX scheduled_job_runs_job_idx ON scheduled_job_runs (job_name, started_at DESC);
```

Nama job yang dipakai: `reconcile_payments`, `reprocess_webhooks`, `expire_payment_attempts`,
`expire_invoices`, `expire_subscriptions`, `cleanup_idempotency_keys`, `cleanup_verification_codes`.

---

## 8. Diagram relasi

```text
ADMIN WEB

admin_users
    │
    ├── admin_sessions
    │     └── admin_session_events
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
    └── audit_logs            (actor_type admin atau system)

CUSTOMER MOBILE

customers
    │
    ├── customer_auth_accounts
    ├── customer_sessions
    ├── auth_verification_codes
    ├── devices
    │     ├── device_claim_codes
    │     ├── device_claim_attempts
    │     ├── device_credentials   (fase 2)
    │     └── device_events        (fase 2)
    ├── subscriptions
    │     ├── subscription_plans
    │     │     └── plan_prices
    │     ├── subscription_events
    │     └── invoices
    │           ├── invoice_items
    │           └── payment_attempts
    │                 ├── payment_webhook_events
    │                 ├── payment_provider_calls
    │                 └── payment_refunds
    └── audit_logs

API INFRASTRUCTURE

idempotency_keys
scheduled_job_runs
```

---

## 9. Aturan bisnis dan keamanan

### Batas perangkat

Saat customer mengklaim CCTV:

```text
1. Ambil subscription aktif.
2. Ambil device_limit paket.
3. Hitung device aktif customer, yaitu yang berstatus claimed.
4. Jika jumlah sudah mencapai limit, tolak.
5. Jika masih tersedia, kaitkan device ke customer dalam transaction database.
```

Pengecekan dilakukan di backend, bukan hanya di aplikasi mobile. Gunakan row lock atau mekanisme concurrency yang sesuai agar dua request bersamaan tidak melewati limit. Device yang berstatus `suspended` tidak dihitung dalam limit.

### Registrasi dan claim perangkat

Registrasi oleh admin:

```text
1. Admin mendaftarkan device ke inventory dengan serial number dan data fisik.
2. Server menolak serial number yang sudah terdaftar.
3. Server men-generate device_uid.
4. Server men-generate claim token, menyimpan hash-nya, dan mengembalikan plaintext sekali.
5. Admin mencetak token tersebut pada label atau dus perangkat.
6. Device berstatus in_stock dengan customer_id NULL.
```

Claim oleh customer:

```text
1. Customer scan QR atau memasukkan serial number di aplikasi.
2. Backend mengunci record claim code dengan row lock.
3. Backend memvalidasi hash token, atau mencari device berdasarkan serial number.
4. Backend memvalidasi masa berlaku dan status pemakaian.
5. Backend memeriksa subscription aktif dan batas perangkat.
6. Backend mengaitkan device ke customer dan menandai claim code terpakai.
7. Backend menulis device_claim_attempts.
8. Semua langkah dijalankan dalam satu transaction.
```

Aturan penting:

- Serial number hanya valid jika device sudah terdaftar di inventory. Serial acak selalu gagal.
- Serial number CCTV umumnya tercetak di bodi dan sering berurutan, sehingga jalur serial diperlakukan sebagai jalur lemah. Wajib diterapkan rate limit per customer dan per IP, misalnya maksimal 5 percobaan gagal per customer per jam dan 10 percobaan gagal per IP per jam.
- Setiap percobaan claim dicatat di `device_claim_attempts`, dan nilai yang dikirim disimpan tersamarkan.
- Claim code bersifat sekali pakai. Setelah dipakai, kode itu tidak pernah berlaku lagi.
- Perpindahan kepemilikan hanya dapat dilakukan admin melalui unassign sebagai tindakan korektif, wajib dengan alasan dan audit log.
- Setelah unassign, claim code lama tetap dianggap terpakai. Device hanya dapat diklaim lagi jika admin merotasi claim code baru.

### Upgrade dan perpanjangan subscription

```text
1. Customer memilih plan yang lebih tinggi pada interval billing yang sama.
2. Backend menghitung nilai sisa periode berjalan.
3. Backend menghitung selisih terhadap plan baru untuk sisa periode yang sama.
4. Backend membuat invoice untuk selisih tersebut.
5. Customer membayar melalui QRIS atau VA Pakasir.
6. Webhook Pakasir mengonfirmasi pembayaran.
7. Backend mengaktifkan plan baru dan mencatat subscription_events.
```

Nilai sisa periode dihitung dari harga periode plan dibagi durasi periode, dikalikan sisa waktu. Nominal final dihitung backend, bukan dari client. Pembulatan memakai half-up ke rupiah utuh.

Upgrade antar interval dilarang. Customer bulanan yang ingin pindah ke tahunan harus menunggu `expired`, lalu checkout plan tahunan sebagai plan baru.

Downgrade tidak tersedia selama subscription aktif. Customer menunggu subscription berstatus `expired`, lalu membeli plan baru melalui checkout biasa.

### Status pembayaran

Aplikasi mobile bukan sumber status pembayaran. Status pembayaran hanya berubah melalui backend setelah pembayaran diverifikasi lewat Transaction Detail API Pakasir.

Webhook Pakasir tidak bertanda tangan, sehingga webhook diperlakukan sebagai pemicu saja, bukan sumber kebenaran. Nominal, `order_id`, dan status selalu diambil dari `transactiondetail`.

Aturan validasi nominal:

- Verifikasi dibandingkan dengan `payment_attempts.amount`, bukan `provider_total_payment`, karena biaya layanan Pakasir tidak termasuk tagihan.
- `amount_paid` diisi sebesar `amount`.
- Selisih sekecil apa pun menahan aktivasi subscription dan menandai kasus untuk peninjauan manual.

Pembuatan transaksi ke Pakasir:

```text
1. Backend membuat record payment_attempts dengan attempt_sequence berikutnya.
2. Backend menyusun order_id dari invoice_number dan attempt_sequence.
3. Backend memanggil transactioncreate dengan amount sama dengan invoices.total_amount.
4. Backend menyimpan fee, total_payment, payment_number, dan expired_at dari response.
5. Status tetap pending sampai diverifikasi lewat transactiondetail.
```

Response synchronous dari `transactioncreate` tidak pernah mengaktifkan subscription.

### Perubahan oleh admin

Untuk tindakan seperti void invoice, refund, memberikan paket gratis, suspend customer, atau memindahkan perangkat:

1. Admin harus memiliki permission yang sesuai.
2. Sistem meminta alasan perubahan jika tindakan bersifat sensitif.
3. Perubahan dicatat di `audit_logs`.

### Password dan token

- Password menggunakan Argon2id atau bcrypt.
- Access JWT berumur pendek dan tidak disimpan di database.
- Refresh token disimpan sebagai hash dan dirotasi setiap kali dipakai.
- OTP dan claim code disimpan sebagai hash.
- Password, token asli, dan OTP plaintext tidak disimpan di database.
- Claim token plaintext hanya ditampilkan sekali saat pembuatan atau rotasi.
- Nilai yang dikirim pada percobaan claim gagal disimpan tersamarkan di `device_claim_attempts`.
- Secret perangkat dienkripsi di backend.
- JWT admin dikirim melalui cookie HttpOnly, bukan disimpan di localStorage.

### Penghapusan data

Untuk data bisnis, gunakan status seperti `inactive`, `suspended`, `deleted`, atau `void` daripada menghapus permanen. Histori invoice, pembayaran, dan audit harus tetap tersedia.

## 10. Rekomendasi implementasi

Urutan migration yang disarankan:

1. Ekstensi dan tipe dasar: `citext`, fungsi `updated_at`, dan helper UUID.
2. Tabel admin: `admin_users`, `admin_roles`, `admin_permissions`, `admin_user_roles`, `admin_role_permissions`, `admin_sessions`, `admin_login_attempts`, `admin_session_events`, `audit_logs`.
3. Tabel customer: `customers`, `customer_auth_accounts`, `customer_sessions`, `auth_verification_codes`.
4. Tabel perangkat: `devices`, `device_claim_codes`, `device_claim_attempts`.
5. Tabel perangkat fase 2: `device_credentials`, `device_events`. Dibuat sekarang, tetapi tidak dipakai sampai integrasi CCTV dikerjakan.
6. Tabel subscription: `subscription_plans`, `plan_prices`, `subscriptions`, `subscription_events`.
7. Tabel billing: `invoices`, `invoice_items`, `payment_attempts`, `payment_webhook_events`, `payment_provider_calls`, `payment_refunds`.
8. Tabel infrastruktur: `idempotency_keys`, `scheduled_job_runs`.

Tambahkan seed awal untuk:

- Role `super_admin`.
- Permission dasar admin.
- Paket `free`, `basic`, `pro`, dan `ultra` setelah batas perangkat dikonfirmasi.
- Master admin pertama lewat perintah `npm run db:create-admin`, bukan endpoint register publik.
  Kata sandinya diminta lewat prompt sehingga tidak pernah masuk shell history.

Isi seed paket dan harga harus berasal dari keputusan pemilik produk, bukan angka yang dikarang.
Selama angka itu belum ada, seed hanya memuat paket `free` dan tabel harga dibiarkan kosong.
Menu yang membutuhkan harga akan menampilkan keadaan kosong, dan itu lebih benar daripada
menampilkan harga karangan yang tampak resmi.

Keputusan yang perlu dikunci sebelum migration final:

1. Batas perangkat paket Ultra dan apakah ada paket unlimited.
2. Daftar lengkap nilai `status` pada webhook dan `transactiondetail`. Yang terdokumentasi baru `completed`.
3. Bentuk response API `transactioncancel`, termasuk cara memastikan pembatalan benar-benar berhasil.
4. Kebijakan retry webhook Pakasir, sehingga ketergantungan pada job rekonsiliasi belum dapat dikurangi.
5. Apakah Pakasir menyediakan rentang IP tetap untuk webhook.
6. Ambang `PAKASIR_MIN_AMOUNT`, saat ini dipakai `1000` sebagai kebijakan internal.
7. Apakah jalur claim memakai serial number dipertahankan, atau diubah menjadi antrian persetujuan admin.
8. Apakah billing tahunan dibuka sejak awal, mengingat upgrade antar interval dilarang.
9. Apakah refund melalui Pakasir diaktifkan sejak awal. Dokumentasi tidak memuat API refund, sehingga refund kemungkinan hanya manual dari dashboard Pakasir.
10. Apakah satu nomor WhatsApp atau email boleh terhubung ke lebih dari satu customer. Rekomendasi: tidak boleh.
11. Apakah device boleh dipakai bersama antar anggota keluarga. Belum ada di v1.
12. Berapa lama `payment_webhook_events` dan `payment_provider_calls` disimpan. Rekomendasi: dua belas bulan.
13. Apakah periode akuntansi perlu dapat ditutup. Dengan dasar kas, laporan periode lampau sudah tidak berubah angkanya, jadi ini belum dibutuhkan.

Durasi token sudah dipakai sebagai default: customer access 15 menit dengan refresh 30 hari sliding, admin access 15 menit dengan refresh 8 jam dan batas absolut 12 jam. Masa berlaku claim code pada v1 adalah tidak kedaluwarsa.

Kontrak API yang sesuai dengan rancangan ini ada di `API_Contract.md`.
