/*
  Detail dan perubahan akun admin.

  Halaman ini bisa mengunci semua orang keluar dari konsol kalau tidak dijaga. Tiga penjagaan
  yang ditegakkan di sini, dan alasannya:

  1. Admin tidak dapat menonaktifkan dirinya sendiri. Tanpa aturan ini, satu klik bisa membuat
     orang yang melakukannya langsung kehilangan akses, dan ia tidak bisa membatalkannya lagi.

  2. Admin tidak dapat mencabut peran terakhir yang memiliki `admin.manage`. Kalau itu terjadi,
     tidak ada satu pun orang yang dapat mengelola admin lagi, dan keadaannya hanya bisa
     diperbaiki lewat akses langsung ke database.

  3. Admin tidak dapat mengubah perannya sendiri. Mengubah peran sendiri membuka jalan untuk
     memberi izin yang seharusnya tidak dimiliki, dan itu melewati seluruh pemeriksaan.
*/
import { writeAudit } from "@/lib/server/audit";
import {
  adminsLeftAbleToManage,
  adminSessionsOf,
  adminUserRoles,
  effectivePermissions,
  findAdminUser,
} from "@/lib/server/admin-users";
import { query, queryOne, withTransaction } from "@/lib/server/db";
import { AppError } from "@/lib/server/errors";
import { requireAdmin, requireCsrf, requirePermission } from "@/lib/server/guard";
import { hashPassword } from "@/lib/server/password";
import { parseJson } from "@/lib/server/parse";
import { ok, requireUuid } from "@/lib/server/request";
import { routeHandler } from "@/lib/server/route";
import { updateAdminUserSchema } from "@/lib/schemas/admin-user";

type Params = { params: Promise<{ admin_user_id?: string }> };

export const GET = routeHandler("admin.admin_users.detail", async (_request, requestId, context) => {
  const admin = await requireAdmin();
  requirePermission(admin, "admin.manage");

  const { admin_user_id: rawId } = await (context as Params).params;
  const adminUserId = requireUuid(rawId, "admin_user_id");

  const user = await findAdminUser(adminUserId);
  if (!user) {
    throw new AppError({
      code: "RESOURCE_NOT_FOUND",
      message:
        "Akun admin itu tidak ditemukan. Kembali ke daftar admin untuk memilih akun yang benar.",
    });
  }

  const [roles, permissions, sessions] = await Promise.all([
    adminUserRoles(adminUserId),
    effectivePermissions(adminUserId),
    adminSessionsOf(adminUserId),
  ]);

  return ok(
    {
      admin_user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        status: user.status,
        is_super_admin: user.is_super_admin,
        last_login_at: user.last_login_at?.toISOString() ?? null,
        created_at: user.created_at.toISOString(),
      },
      roles: roles.map((role) => ({
        id: role.id,
        code: role.code,
        name: role.name,
        granted_at: role.granted_at.toISOString(),
      })),
      /*
        Izin efektif adalah gabungan dari seluruh peran. Ini yang sebenarnya menentukan apa yang
        boleh dilakukan akun ini, dan nama peran saja tidak memberitahu hal itu.
      */
      effective_permissions: permissions.map((permission) => ({
        code: permission.code,
        name: permission.name,
        via_roles: permission.via_roles,
      })),
      sessions: sessions.map((session) => ({
        id: session.id,
        ip_address: session.ip_address,
        user_agent: session.user_agent,
        created_at: session.created_at.toISOString(),
        last_used_at: session.last_used_at?.toISOString() ?? null,
        expires_at: session.expires_at.toISOString(),
        revoked_at: session.revoked_at?.toISOString() ?? null,
      })),
      is_self: user.id === admin.identity.id,
    },
    requestId,
  );
});

export const PATCH = routeHandler(
  "admin.admin_users.update",
  async (request, requestId, context) => {
    const admin = await requireAdmin();
    requirePermission(admin, "admin.manage");
    await requireCsrf(request);

    const { admin_user_id: rawId } = await (context as Params).params;
    const adminUserId = requireUuid(rawId, "admin_user_id");
    const input = await parseJson(request, updateAdminUserSchema);

    const passwordHash = input.password ? await hashPassword(input.password) : null;

    const result = await withTransaction(async (client) => {
      const lama = await queryOne<{
        id: string;
        username: string;
        email: string;
        full_name: string;
        status: string;
      }>(
        `SELECT id, username, email, full_name, status FROM admin_users WHERE id = $1 FOR UPDATE`,
        [adminUserId],
        client,
      );

      if (!lama) {
        throw new AppError({
          code: "RESOURCE_NOT_FOUND",
          message: "Akun admin itu tidak ditemukan. Muat ulang halaman ini.",
        });
      }

      /*
        Menonaktifkan diri sendiri dikunci di sini, bukan hanya disembunyikan di layar, karena
        aturan ini menyangkut keamanan akses ke konsol itu sendiri.
      */
      if (adminUserId === admin.identity.id && input.status && input.status !== "active") {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message:
            "Akun sendiri tidak dapat dinonaktifkan atau dikunci dari halaman ini. Mintalah " +
            "admin lain melakukannya, supaya Anda tidak kehilangan akses secara tiba-tiba.",
          details: { fields: { status: "Tidak boleh mengubah status akun sendiri." } },
        });
      }

      if (adminUserId === admin.identity.id && input.role_ids) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message:
            "Peran akun sendiri tidak dapat diubah dari halaman ini. Mengubah peran sendiri " +
            "berarti memberi izin kepada diri sendiri, dan itu melewati pemeriksaan yang " +
            "seharusnya dilakukan admin lain.",
          details: { fields: { role_ids: "Tidak boleh mengubah peran akun sendiri." } },
        });
      }

      if (input.email) {
        const bentrok = await queryOne<{ id: string }>(
          `SELECT id FROM admin_users WHERE email = $1 AND id <> $2`,
          [input.email.toLowerCase(), adminUserId],
          client,
        );
        if (bentrok) {
          throw new AppError({
            code: "ADMIN_EMAIL_TAKEN",
            message: `Alamat email "${input.email}" sudah dipakai akun lain.`,
            details: { fields: { email: "Sudah dipakai akun lain." } },
          });
        }
      }

      /*
        Peran diperiksa sebelum perubahan disimpan.

        Yang dijaga di sini adalah satu hal saja: jangan sampai tidak ada seorang pun yang dapat
        mengelola admin setelah perubahan ini. Cara menghitungnya sengaja tidak dilakukan per
        peran, karena cara itu mudah salah: mencabut peran yang sejak awal tidak memberi izin
        mengelola admin bukanlah masalah, dan menilainya per peran akan menolak perubahan yang
        sebenarnya aman.
      */
      if (input.role_ids) {
        const peranBaru = await query<{ id: string; code: string }>(
          `SELECT id, code FROM admin_roles WHERE id = ANY($1::uuid[])`,
          [input.role_ids],
          client,
        );

        if (peranBaru.length !== new Set(input.role_ids).size) {
          const dikenal = new Set(peranBaru.map((row) => row.id));
          throw new AppError({
            code: "VALIDATION_ERROR",
            message: "Ada peran yang tidak ditemukan, jadi perubahannya dibatalkan.",
            details: { fields: { role_ids: input.role_ids.filter((id) => !dikenal.has(id)) } },
          });
        }

        const target = await queryOne<{ is_super_admin: boolean }>(
          `SELECT is_super_admin FROM admin_users WHERE id = $1`,
          [adminUserId],
          client,
        );

        /* Super admin memperoleh seluruh izin tanpa peran, jadi perannya tidak memengaruhi. */
        const superAdmin = target?.is_super_admin ?? false;

        const peranBaruMemberiAdminManage = await query<{ ada: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM admin_role_permissions rp
             JOIN admin_permissions p ON p.id = rp.permission_id
             WHERE p.code = 'admin.manage' AND rp.role_id = ANY($1::uuid[])
           ) AS ada`,
          [input.role_ids],
          client,
        );

        const targetMasihPunya = superAdmin || (peranBaruMemberiAdminManage[0]?.ada ?? false);

        /*
          Keadaan sesudah perubahan dihitung dengan membuang akun ini dari daftar penyelamat,
          lalu memeriksa apakah peran barunya masih memberi izin itu. Pertanyaan yang dijawab
          hanya satu: setelah perubahan ini, apakah masih ada yang dapat mengelola admin?
        */
        if (!targetMasihPunya) {
          const sisa = (await adminsLeftAbleToManage("admin.manage", {}, client)).filter(
            (row) => row.admin_id !== adminUserId,
          );

          if (sisa.length === 0) {
            throw new AppError({
              code: "VALIDATION_ERROR",
              message:
                "Perubahan ini akan membuat tidak ada seorang pun yang dapat mengelola admin, " +
                "karena akun ini satu-satunya yang memegang izin itu. Berikan izin mengelola " +
                "admin kepada akun lain lebih dulu.",
              details: { reason: "ADMIN_MANAGE_LAST_HOLDER" },
            });
          }
        }
      }

      if (input.role_ids) {
        await client.query(`DELETE FROM admin_user_roles WHERE admin_user_id = $1`, [adminUserId]);
        for (const roleId of new Set(input.role_ids)) {
          await client.query(
            `INSERT INTO admin_user_roles (admin_user_id, role_id) VALUES ($1, $2)`,
            [adminUserId, roleId],
          );
        }

        /*
          Sesi dicabut ketika peran berubah. Tanpa ini, izin yang pemegangnya sudah dicabut
          tetap berlaku sampai token aksesnya kedaluwarsa, karena izin ikut tertanam di token.
        */
        await client.query(
          `UPDATE admin_sessions SET revoked_at = now()
           WHERE admin_user_id = $1 AND revoked_at IS NULL`,
          [adminUserId],
        );
      }

      /*
        Perubahan peran sudah menangani pencabutan sesinya di atas. Perubahan kata sandi juga
        mencabut sesi, karena sesi lama memakai kredensial lama.
      */
      if (passwordHash) {
        await client.query(`UPDATE admin_users SET password_hash = $2 WHERE id = $1`, [
          adminUserId,
          passwordHash,
        ]);
        await client.query(
          `UPDATE admin_sessions SET revoked_at = now()
           WHERE admin_user_id = $1 AND revoked_at IS NULL`,
          [adminUserId],
        );
      }

      await client.query(
        `UPDATE admin_users
         SET full_name = COALESCE($2, full_name),
             email = COALESCE($3, email),
             status = COALESCE($4, status)
         WHERE id = $1`,
        [
          adminUserId,
          input.full_name ?? null,
          input.email?.toLowerCase() ?? null,
          input.status ?? null,
        ],
      );

      const sesudah = await findAdminUser(adminUserId, client);

      await writeAudit(client, {
        actor: {
          adminUserId: admin.identity.id,
          ipAddress: admin.ipAddress,
          userAgent: admin.userAgent,
        },
        action: "admin_user.update",
        entityType: "admin_user",
        entityId: adminUserId,
        oldData: {
          full_name: lama.full_name,
          email: lama.email,
          status: lama.status,
        },
        newData: {
          full_name: sesudah?.full_name,
          email: sesudah?.email,
          status: sesudah?.status,
          roles: sesudah?.roles,
          password_changed: passwordHash !== null,
          reason: input.reason,
        },
      });

      return { user: sesudah, passwordChanged: passwordHash !== null };
    });

    const sesiDicabut =
      input.role_ids !== undefined || result.passwordChanged;

    return ok(
      {
        admin_user: result.user
          ? {
              id: result.user.id,
              username: result.user.username,
              email: result.user.email,
              full_name: result.user.full_name,
              status: result.user.status,
              roles: result.user.roles,
              role_count: result.user.role_count,
              active_sessions: result.user.active_sessions,
            }
          : null,
        effect: {
          sessions_revoked: sesiDicabut,
          note: sesiDicabut
            ? "Seluruh sesi akun ini dicabut, sehingga izin barunya berlaku sejak masuk berikutnya. Tanpa pencabutan, izin lama masih berlaku sampai tokennya kedaluwarsa."
            : "Perubahan tersimpan. Sesi yang sedang berjalan tidak terpengaruh.",
        },
      },
      requestId,
    );
  },
);
