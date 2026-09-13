/*
  Memeriksa bahwa batasan di database benar-benar bekerja, bukan sekadar terpasang.

  Kenapa ini ada: migrasi yang berhasil diterapkan hanya membuktikan sintaksnya sah. Yang perlu
  diketahui adalah apakah database benar-benar menolak data yang salah. Batasan yang salah tulis
  tetap terpasang tanpa galat, dan baru ketahuan setelah ada perangkat terklaim tanpa pemilik
  atau pelanggan tertagih dua kali.

  Semua uji batasan berjalan di dalam satu transaksi yang dibatalkan di akhir, sehingga tidak
  ada data uji yang tertinggal. Uji trigger updated_at adalah pengecualian dan dijelaskan di
  tempatnya.

  Jalankan dengan: npm run db:verify
*/
import { Client } from "pg";
import { databaseUrl, describeTarget } from "./env";
import { buildConnectionConfig, describeTls } from "../../src/lib/server/tls";

let lulus = 0;
let gagal = 0;

function hasil(nama: string, ok: boolean, detail = ""): void {
  if (ok) {
    lulus += 1;
    console.log(`  lulus  ${nama}`);
  } else {
    gagal += 1;
    console.log(`  GAGAL  ${nama} ${detail}`);
  }
}

/* Menjalankan pernyataan yang seharusnya ditolak database. Ditolak berarti lulus. */
async function harusDitolak(c: Client, nama: string, sql: string, params: unknown[] = []) {
  await c.query("SAVEPOINT s");
  try {
    await c.query(sql, params as never[]);
    await c.query("RELEASE SAVEPOINT s");
    hasil(nama, false, "-> malah diterima");
  } catch {
    await c.query("ROLLBACK TO SAVEPOINT s");
    hasil(nama, true);
  }
}

/* Menjalankan pernyataan yang seharusnya diterima database. */
async function harusDiterima(c: Client, nama: string, sql: string, params: unknown[] = []) {
  await c.query("SAVEPOINT s");
  try {
    await c.query(sql, params as never[]);
    await c.query("RELEASE SAVEPOINT s");
    hasil(nama, true);
  } catch (error) {
    await c.query("ROLLBACK TO SAVEPOINT s");
    hasil(nama, false, `-> ${(error as Error).message.split("\n")[0]}`);
  }
}

async function ujiBatasan(c: Client): Promise<void> {
  const customerId = (
    await c.query<{ id: string }>("INSERT INTO customers (full_name) VALUES ('Uji Skema') RETURNING id")
  ).rows[0].id;
  const planId = (
    await c.query<{ id: string }>("SELECT id FROM subscription_plans WHERE code = 'free'")
  ).rows[0].id;
  const adminId = (
    await c.query<{ id: string }>(
      `INSERT INTO admin_users (username, email, full_name, password_hash, is_super_admin, status)
       VALUES ('uji-skema', 'uji-skema@nayaka.test', 'Uji', 'x', true, 'active') RETURNING id`,
    )
  ).rows[0].id;

  console.log("\n-- akun auth customer --");
  await harusDitolak(c, "email tanpa kata sandi ditolak",
    `INSERT INTO customer_auth_accounts (customer_id, provider, email) VALUES ($1,'email','a@b.test')`, [customerId]);
  await harusDiterima(c, "email dengan kata sandi diterima",
    `INSERT INTO customer_auth_accounts (customer_id, provider, email, password_hash) VALUES ($1,'email','a@b.test','hash')`, [customerId]);
  await harusDitolak(c, "whatsapp dengan kata sandi ditolak",
    `INSERT INTO customer_auth_accounts (customer_id, provider, phone_e164, password_hash) VALUES ($1,'whatsapp','+62811','hash')`, [customerId]);
  await harusDitolak(c, "is_verified tanpa verified_at ditolak",
    `INSERT INTO customer_auth_accounts (customer_id, provider, phone_e164, is_verified) VALUES ($1,'whatsapp','+62812',true)`, [customerId]);
  await harusDitolak(c, "verified_at tanpa is_verified ditolak",
    `INSERT INTO customer_auth_accounts (customer_id, provider, phone_e164, verified_at) VALUES ($1,'whatsapp','+62813', now())`, [customerId]);
  /*
    Perbandingan tanpa peduli huruf besar-kecil bergantung pada ekstensi citext. Kalau ekstensi
    itu tidak terpasang, "A@B.TEST" akan lolos sebagai akun kedua dan satu orang punya dua akun.
  */
  await harusDitolak(c, "email beda huruf besar-kecil ditolak",
    `INSERT INTO customer_auth_accounts (customer_id, provider, email, password_hash) VALUES ($1,'email','A@B.TEST','hash')`, [customerId]);

  console.log("\n-- subscription --");
  await harusDiterima(c, "subscription aktif pertama diterima",
    `INSERT INTO subscriptions (customer_id, plan_id, status) VALUES ($1,$2,'active')`, [customerId, planId]);
  await harusDitolak(c, "subscription aktif kedua ditolak",
    `INSERT INTO subscriptions (customer_id, plan_id, status) VALUES ($1,$2,'active')`, [customerId, planId]);
  await harusDiterima(c, "subscription kedaluwarsa boleh menumpuk",
    `INSERT INTO subscriptions (customer_id, plan_id, status) VALUES ($1,$2,'expired')`, [customerId, planId]);
  await harusDitolak(c, "event sistem dengan pelaku ditolak",
    `INSERT INTO subscription_events (subscription_id, customer_id, event_type, actor_type, actor_id)
     SELECT id, $1, 'activated', 'system', $2 FROM subscriptions WHERE customer_id=$1 LIMIT 1`, [customerId, adminId]);
  await harusDiterima(c, "event sistem tanpa pelaku diterima",
    `INSERT INTO subscription_events (subscription_id, customer_id, event_type, actor_type)
     SELECT id, $1, 'activated', 'system' FROM subscriptions WHERE customer_id=$1 LIMIT 1`, [customerId]);

  console.log("\n-- perangkat --");
  await harusDitolak(c, "status claimed tanpa pemilik ditolak",
    `INSERT INTO devices (device_uid, serial_number, status, claimed_at) VALUES ('U-1','S-1','claimed', now())`);
  await harusDitolak(c, "perangkat gudang dengan claimed_at ditolak",
    `INSERT INTO devices (device_uid, serial_number, status, claimed_at) VALUES ('U-2','S-2','in_stock', now())`);
  await harusDiterima(c, "perangkat gudang diterima",
    `INSERT INTO devices (device_uid, serial_number, status, registered_by_admin_id) VALUES ('U-3','S-3','in_stock',$1)`, [adminId]);
  await harusDitolak(c, "device_uid duplikat ditolak",
    `INSERT INTO devices (device_uid, serial_number) VALUES ('U-3','S-9')`);
  await harusDitolak(c, "serial_number duplikat ditolak",
    `INSERT INTO devices (device_uid, serial_number) VALUES ('U-9','S-3')`);

  console.log("\n-- percobaan claim --");
  await harusDitolak(c, "gagal tanpa alasan ditolak",
    `INSERT INTO device_claim_attempts (submitted_kind, success, failure_reason) VALUES ('serial', false, NULL)`);
  await harusDitolak(c, "berhasil dengan alasan ditolak",
    `INSERT INTO device_claim_attempts (submitted_kind, success, failure_reason) VALUES ('qr', true, 'aneh')`);
  await harusDiterima(c, "berhasil tanpa alasan diterima",
    `INSERT INTO device_claim_attempts (submitted_kind, success) VALUES ('qr', true)`);

  console.log("\n-- invoice --");
  await harusDitolak(c, "status paid tanpa paid_at ditolak",
    `INSERT INTO invoices (customer_id, invoice_number, status, total_amount) VALUES ($1,'INV-1','paid',100)`, [customerId]);
  await harusDitolak(c, "paid_at tanpa status paid ditolak",
    `INSERT INTO invoices (customer_id, invoice_number, status, total_amount, paid_at) VALUES ($1,'INV-2','open',100, now())`, [customerId]);
  await harusDitolak(c, "void tanpa voided_at ditolak",
    `INSERT INTO invoices (customer_id, invoice_number, status, total_amount) VALUES ($1,'INV-3','void',100)`, [customerId]);
  await harusDiterima(c, "open dengan total diterima",
    `INSERT INTO invoices (customer_id, invoice_number, status, total_amount) VALUES ($1,'INV-4','open',150000.55)`, [customerId]);

  /*
    Uang wajib memakai numeric. Kalau kolomnya float, penjumlahan di bawah ini akan menghasilkan
    150000.54999999999 dan laporan keuangan tidak akan pernah cocok dengan mutasi bank.
  */
  const uang = await c.query<{ t: string }>(
    `SELECT round(sum(total_amount),2)::text AS t FROM invoices WHERE customer_id=$1`, [customerId]);
  hasil(`penjumlahan uang tepat (${uang.rows[0].t})`, uang.rows[0].t === "150000.55");

  console.log("\n-- percobaan pembayaran --");
  const invoiceId = (await c.query<{ id: string }>("SELECT id FROM invoices WHERE invoice_number='INV-4'")).rows[0].id;
  await harusDiterima(c, "attempt pertama diterima",
    `INSERT INTO payment_attempts (invoice_id, attempt_sequence, payment_method, provider_order_id, amount, status)
     VALUES ($1,1,'qris','INV-4-1',150000.55,'pending')`, [invoiceId]);
  await harusDitolak(c, "attempt_sequence duplikat ditolak",
    `INSERT INTO payment_attempts (invoice_id, attempt_sequence, payment_method, provider_order_id, amount, status)
     VALUES ($1,1,'bri_va','INV-4-1b',150000.55,'pending')`, [invoiceId]);
  await harusDitolak(c, "provider_order_id duplikat ditolak",
    `INSERT INTO payment_attempts (invoice_id, attempt_sequence, payment_method, provider_order_id, amount, status)
     VALUES ($1,2,'bri_va','INV-4-1',150000.55,'pending')`, [invoiceId]);
  await harusDitolak(c, "status paid tanpa paid_at ditolak",
    `INSERT INTO payment_attempts (invoice_id, attempt_sequence, payment_method, provider_order_id, amount, status)
     VALUES ($1,3,'qris','INV-4-3',150000.55,'paid')`, [invoiceId]);
  await harusDitolak(c, "verified_at tanpa verified_via ditolak",
    `INSERT INTO payment_attempts (invoice_id, attempt_sequence, payment_method, provider_order_id, amount, status, verified_at)
     VALUES ($1,4,'qris','INV-4-4',150000.55,'pending', now())`, [invoiceId]);
  await harusDiterima(c, "verified_at dengan verified_via diterima",
    `INSERT INTO payment_attempts (invoice_id, attempt_sequence, payment_method, provider_order_id, amount, status, paid_at, verified_at, verified_via)
     VALUES ($1,5,'qris','INV-4-5',150000.55,'paid', now(), now(), 'webhook')`, [invoiceId]);

  console.log("\n-- webhook --");
  await harusDiterima(c, "webhook pertama diterima",
    `INSERT INTO payment_webhook_events (provider_event_id, event_type, payload) VALUES ('INV-4-1:completed','payment.completed','{}'::jsonb)`);
  await harusDitolak(c, "webhook dengan kunci sama ditolak",
    `INSERT INTO payment_webhook_events (provider_event_id, event_type, payload) VALUES ('INV-4-1:completed','payment.completed','{}'::jsonb)`);

  console.log("\n-- panggilan ke provider --");
  await harusDitolak(c, "durasi negatif ditolak",
    `INSERT INTO payment_provider_calls (operation, duration_ms, outcome) VALUES ('transactiondetail', -1, 'success')`);
  await harusDitolak(c, "operasi tidak dikenal ditolak",
    `INSERT INTO payment_provider_calls (operation, duration_ms, outcome) VALUES ('hapusdata', 10, 'success')`);
  await harusDiterima(c, "panggilan gagal tanpa order_id diterima",
    `INSERT INTO payment_provider_calls (operation, duration_ms, outcome, error_message) VALUES ('transactioncreate', 5012, 'failed', 'timeout')`);

  console.log("\n-- idempotency --");
  await harusDiterima(c, "kunci pertama diterima",
    `INSERT INTO idempotency_keys (actor_key, actor_type, actor_id, endpoint, idempotency_key, request_hash, expires_at)
     VALUES ('customer:'||$1::text,'customer',$1::uuid,'/devices/claim','k1','h1', now() + interval '1 day')`, [customerId]);
  await harusDitolak(c, "kunci sama dengan isi berbeda ditolak",
    `INSERT INTO idempotency_keys (actor_key, actor_type, actor_id, endpoint, idempotency_key, request_hash, expires_at)
     VALUES ('customer:'||$1::text,'customer',$1::uuid,'/devices/claim','k1','h2', now() + interval '1 day')`, [customerId]);
  /*
    Bagian terpenting dari tabel ini. Permintaan tanpa login harus tetap terdedup. Kalau unique
    index memakai actor_id, keduanya akan lolos karena di PostgreSQL setiap NULL dianggap
    berbeda dari NULL lain, dan pendaftaran ganda tidak akan pernah tercegah.
  */
  await harusDiterima(c, "anon pertama diterima",
    `INSERT INTO idempotency_keys (actor_key, actor_type, endpoint, idempotency_key, request_hash, expires_at)
     VALUES ('anon:abc','anon','/register','k9','h9', now() + interval '1 day')`);
  await harusDitolak(c, "anon dengan kunci sama tetap terdedup",
    `INSERT INTO idempotency_keys (actor_key, actor_type, endpoint, idempotency_key, request_hash, expires_at)
     VALUES ('anon:abc','anon','/register','k9','h9', now() + interval '1 day')`);

  console.log("\n-- job terjadwal --");
  await harusDiterima(c, "job berjalan diterima",
    `INSERT INTO scheduled_job_runs (job_name, outcome) VALUES ('reconcile_payments','running')`);
  await harusDitolak(c, "job berjalan dengan finished_at ditolak",
    `INSERT INTO scheduled_job_runs (job_name, outcome, finished_at) VALUES ('reconcile_payments','running', now())`);
  await harusDitolak(c, "job sukses tanpa finished_at ditolak",
    `INSERT INTO scheduled_job_runs (job_name, outcome) VALUES ('reconcile_payments','success')`);
  await harusDitolak(c, "job sukses dengan error_message ditolak",
    `INSERT INTO scheduled_job_runs (job_name, outcome, finished_at, error_message) VALUES ('reconcile_payments','success', now(), 'ada galat')`);
  await harusDitolak(c, "nama job tidak dikenal ditolak",
    `INSERT INTO scheduled_job_runs (job_name, outcome) VALUES ('job_karangan','running')`);
}

/*
  Trigger updated_at diuji di luar transaksi utama.

  now() di PostgreSQL mengembalikan waktu mulai transaksi, bukan waktu pernyataan. Di dalam satu
  transaksi, created_at dan updated_at karena itu selalu bernilai sama dan pergerannya tidak
  dapat diamati. Uji di dalam transaksi akan selalu melaporkan "tidak bergerak" meski
  trigger-nya bekerja, dan itu sudah pernah terjadi.
*/
async function ujiTriggerUpdatedAt(url: string): Promise<void> {
  console.log("\n-- trigger updated_at (transaksi terpisah) --");
  const tulis = new Client({ ...buildConnectionConfig(url) });
  await tulis.connect();

  let id: string | null = null;
  try {
    const dibuat = await tulis.query<{ id: string; created_at: Date; updated_at: Date }>(
      "INSERT INTO customers (full_name) VALUES ('Uji Trigger') RETURNING id, created_at, updated_at",
    );
    id = dibuat.rows[0].id;

    // Jeda nyata, supaya transaksi berikutnya benar-benar mulai di waktu yang berbeda.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const lain = new Client({ ...buildConnectionConfig(url) });
    await lain.connect();
    const sesudah = (
      await lain.query<{ created_at: Date; updated_at: Date }>(
        "UPDATE customers SET full_name='Berubah' WHERE id=$1 RETURNING created_at, updated_at",
        [id],
      )
    ).rows[0];
    await lain.end();

    hasil(
      "updated_at bergerak maju",
      sesudah.updated_at.getTime() > dibuat.rows[0].updated_at.getTime(),
      `-> ${dibuat.rows[0].updated_at.toISOString()} menjadi ${sesudah.updated_at.toISOString()}`,
    );
    hasil(
      "created_at tidak ikut tersentuh",
      sesudah.created_at.getTime() === dibuat.rows[0].created_at.getTime(),
    );
  } finally {
    // Baris uji dibersihkan meski ada langkah yang gagal.
    if (id) await tulis.query("DELETE FROM customers WHERE id=$1", [id]).catch(() => {});
    await tulis.end();
  }
}

async function main(): Promise<void> {
  const url = databaseUrl();
  console.log(`Target   : ${describeTarget()}`);
  console.log(`Enkripsi : ${describeTls(url)}`);

  const c = new Client({ ...buildConnectionConfig(url) });
  await c.connect();

  try {
    console.log("\n-- jumlah tabel --");
    const tabel = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> 'schema_migrations'`,
    );
    hasil(`30 tabel domain (dapat ${tabel.rows[0].n})`, tabel.rows[0].n === 30);

    await c.query("BEGIN");
    await ujiBatasan(c);
    await c.query("ROLLBACK");
    console.log("\nTransaksi dibatalkan, tidak ada data uji yang tersimpan.");
  } catch (error) {
    await c.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await c.end();
  }

  await ujiTriggerUpdatedAt(url);

  console.log(`\n===== ${lulus} lulus, ${gagal} gagal =====`);
  if (gagal > 0) process.exitCode = 1;
}

main().catch((error: Error) => {
  console.error(`Pemeriksaan skema gagal: ${error.message}`);
  process.exitCode = 1;
});
