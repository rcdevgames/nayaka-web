import type { PoolClient } from "pg";

import { query, queryOne, type Queryable } from "./db";
import { AppError } from "./errors";

/*
  Data pelanggan untuk konsol admin.

  Yang perlu dipahami sebelum membaca berkas ini: satu pelanggan bisa punya beberapa cara masuk
  (email, WhatsApp, Google), dan cara masuk itu disimpan di tabel terpisah. Jadi "email
  pelanggan" bukan satu kolom, melainkan hasil penggabungan beberapa baris. Karena itu email dan
  nomor WhatsApp digabungkan di sini, bukan dibaca langsung oleh pemanggil, supaya tidak ada
  halaman yang menampilkan hanya salah satu cara masuk dan mengira itu satu-satunya.
*/

export type CustomerListRow = {
  id: string;
  cursor_value: string;
  full_name: string;
  status: string;
  created_at: Date;
  email: string | null;
  phone_e164: string | null;
  providers: string[] | null;
  plan_name: string | null;
  subscription_status: string | null;
  device_count: number;
};

export type CustomerFilter = {
  status?: string;
  q?: string;
  createdFrom?: string;
  createdTo?: string;
};

/*
  Pencarian pelanggan mencakup nama, email, dan nomor WhatsApp.

  Email dan nomor berada di tabel lain, jadi pencariannya memakai EXISTS, bukan JOIN. JOIN akan
  menggandakan baris pelanggan yang punya dua cara masuk, dan penggandaan itu membuat paginasi
  berbasis kursor melompati atau mengulang baris.
*/
export function customerFilterConditions(
  filter: CustomerFilter,
  params: unknown[],
): string {
  const conditions: string[] = [];

  if (filter.status) {
    conditions.push(`AND c.status = $${params.push(filter.status)}`);
  }

  if (filter.q) {
    /*
      Karakter % dan _ di-escape supaya pencarian "50%" tidak berubah menjadi pola yang cocok
      dengan apa pun. Tanpa ini, pencarian dengan tanda persen mengembalikan seluruh tabel.
    */
    const pattern = `%${filter.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    conditions.push(`AND (
      c.full_name ILIKE $${params.push(pattern)}
      OR EXISTS (
        SELECT 1 FROM customer_auth_accounts a
        WHERE a.customer_id = c.id
          AND (a.email::text ILIKE $${params.length} OR a.phone_e164 ILIKE $${params.length})
      )
    )`);
  }

  if (filter.createdFrom) {
    conditions.push(`AND c.created_at >= $${params.push(filter.createdFrom)}::timestamptz`);
  }

  if (filter.createdTo) {
    conditions.push(`AND c.created_at <= $${params.push(filter.createdTo)}::timestamptz`);
  }

  return conditions.join("\n          ");
}

export async function findCustomer(
  customerId: string,
  executor?: Queryable,
): Promise<CustomerListRow | null> {
  return queryOne<CustomerListRow>(
    `SELECT c.id,
            c.created_at::text AS cursor_value,
            c.full_name,
            c.status,
            c.created_at,
            (
              SELECT a.email::text FROM customer_auth_accounts a
              WHERE a.customer_id = c.id AND a.email IS NOT NULL
              ORDER BY a.created_at LIMIT 1
            ) AS email,
            (
              SELECT a.phone_e164 FROM customer_auth_accounts a
              WHERE a.customer_id = c.id AND a.phone_e164 IS NOT NULL
              ORDER BY a.created_at LIMIT 1
            ) AS phone_e164,
            (
              SELECT array_agg(a.provider ORDER BY a.provider)
              FROM customer_auth_accounts a WHERE a.customer_id = c.id
            ) AS providers,
            (
              SELECT p.name
              FROM subscriptions s
              JOIN subscription_plans p ON p.id = s.plan_id
              WHERE s.customer_id = c.id
              ORDER BY s.created_at DESC LIMIT 1
            ) AS plan_name,
            (
              SELECT s.status FROM subscriptions s
              WHERE s.customer_id = c.id
              ORDER BY s.created_at DESC LIMIT 1
            ) AS subscription_status,
            (
              SELECT count(*)::int FROM devices d
              WHERE d.customer_id = c.id AND d.status = 'claimed'
            ) AS device_count
     FROM customers c
     WHERE c.id = $1`,
    [customerId],
    executor,
  );
}

export type CustomerSummary = {
  total: number;
  active: number;
  suspended: number;
  without_device: number;
};

/*
  Ringkasan dihitung dari seluruh pelanggan, bukan dari halaman yang sedang terbuka.
  "Pelanggan tanpa perangkat" sengaja ada di sini karena itu daftar kerja yang paling sering
  dicari support: pelanggan yang sudah mendaftar tetapi belum pernah memasang kamera.
*/
export async function customerSummary(executor?: Queryable): Promise<CustomerSummary | null> {
  return queryOne<CustomerSummary>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'active')::int AS active,
            count(*) FILTER (WHERE status = 'suspended')::int AS suspended,
            count(*) FILTER (
              WHERE status = 'active'
                AND NOT EXISTS (
                  SELECT 1 FROM devices d
                  WHERE d.customer_id = customers.id AND d.status = 'claimed'
                )
            )::int AS without_device
     FROM customers
     WHERE status <> 'deleted'`,
    [],
    executor,
  );
}

/*
  Pelanggan yang dipakai pemilih di halaman lain.

  Bentuknya sengaja diringkas dan hanya memuat pelanggan aktif, karena pemilih itu dipakai untuk
  menugaskan perangkat, dan perangkat pada akun nonaktif tidak akan terpakai.
*/
export type CustomerOption = {
  id: string;
  full_name: string;
  email: string | null;
  plan_name: string | null;
  device_count: number;
};

export async function customerOptions(
  search: string | null,
  limit = 20,
  executor?: Queryable,
): Promise<CustomerOption[]> {
  const params: unknown[] = [];
  let condition = "";

  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    condition = `AND (
      c.full_name ILIKE $${params.push(pattern)}
      OR EXISTS (
        SELECT 1 FROM customer_auth_accounts a
        WHERE a.customer_id = c.id
          AND (a.email::text ILIKE $${params.length} OR a.phone_e164 ILIKE $${params.length})
      )
    )`;
  }

  return query<CustomerOption>(
    `SELECT c.id,
            c.full_name,
            (
              SELECT a.email::text FROM customer_auth_accounts a
              WHERE a.customer_id = c.id AND a.email IS NOT NULL LIMIT 1
            ) AS email,
            (
              SELECT p.name FROM subscriptions s
              JOIN subscription_plans p ON p.id = s.plan_id
              WHERE s.customer_id = c.id ORDER BY s.created_at DESC LIMIT 1
            ) AS plan_name,
            (
              SELECT count(*)::int FROM devices d
              WHERE d.customer_id = c.id AND d.status = 'claimed'
            ) AS device_count
     FROM customers c
     WHERE c.status = 'active'
          ${condition}
     ORDER BY c.full_name
     LIMIT $${params.push(limit)}`,
    params,
    executor,
  );
}

/*
  Mengunci baris pelanggan sebelum mengubah statusnya.

  Tanpa kunci ini, dua operator yang menekan "Tangguhkan" dan "Aktifkan" pada saat hampir
  bersamaan bisa menghasilkan catatan audit yang urutannya tidak sesuai kenyataan.
*/
export async function lockCustomer(
  client: PoolClient,
  customerId: string,
): Promise<{ id: string; full_name: string; status: string }> {
  const customer = await queryOne<{ id: string; full_name: string; status: string }>(
    "SELECT id, full_name, status FROM customers WHERE id = $1 FOR UPDATE",
    [customerId],
    client,
  );

  if (!customer) {
    throw new AppError({
      code: "RESOURCE_NOT_FOUND",
      message:
        "Pelanggan itu tidak ditemukan. Kembali ke daftar pelanggan untuk memilih pelanggan " +
        "yang benar.",
    });
  }

  return customer;
}
