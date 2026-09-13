"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react";
import Link from "next/link";

import { Button, Timestamp } from "@/components/atoms";
import { ErrorState, LoadingState, PageHeader, StatusLabel } from "@/components/molecules";
import { useApiQuery } from "@/lib/use-api";

/*
  Detail akun admin.

  Halaman ini menampilkan tiga hal yang saling melengkapi, dan ketiganya perlu terlihat bersama
  untuk bisa menjawab pertanyaan "orang ini sebenarnya bisa apa":

  1. Peran yang dipegangnya. Ini yang ditetapkan admin lain.
  2. Izin efektifnya, yaitu gabungan izin dari seluruh peran. Nama peran saja tidak
     memberitahu apa yang boleh dilakukan seseorang. Untuk super admin, seluruh izin berlaku
     tanpa perlu peran, dan itu dinyatakan terpisah supaya daftar peran yang kosong tidak
     disalahartikan sebagai akun tanpa akses.
  3. Sesi yang aktif. Ini menunjukkan dari mana akun ini dipakai, dan sesi yang mencurigakan bisa
     langsung dihentikan dari halaman audit.

  Menampilkan peran saja tanpa izin efektif akan membuat operator mengira tahu apa yang bisa
  dilakukan seseorang, padahal yang dipegangnya hanya nama peran.
*/

type Detail = {
  admin_user: {
    id: string;
    username: string;
    email: string;
    full_name: string;
    status: string;
    is_super_admin: boolean;
    last_login_at: string | null;
    created_at: string;
  };
  roles: { id: string; code: string; name: string; granted_at: string }[];
  effective_permissions: { code: string; name: string; via_roles: string[] }[];
  sessions: {
    id: string;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
    last_used_at: string | null;
    expires_at: string;
    revoked_at: string | null;
  }[];
  is_self: boolean;
};

/*
  Apakah ini akun sendiri tidak dihitung di sisi klien, melainkan dibaca dari `is_self` yang
  dikirim server. Menghitungnya di klien berarti ada dua sumber kebenaran untuk pertanyaan yang
  menentukan tombol mana yang boleh muncul.
*/
export function AdminUserDetail({ adminUserId }: { adminUserId: string }) {
  const query = useApiQuery<Detail>(`/api/v1/admin/admin-users/${adminUserId}`);

  if (query.status === "memuat") return <LoadingState label="Memuat data akun admin" />;

  if (query.status === "galat" || !query.data) {
    return (
      <ErrorState
        title="Data akun admin gagal dimuat"
        description={query.error ?? "Server tidak mengirim keterangan galat."}
        onRetry={query.reload}
      />
    );
  }

  const { admin_user: user, roles, effective_permissions: permissions, sessions, is_self: isSelf } =
    query.data;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/admin-users"
        className="text-muted-foreground inline-flex w-fit items-center gap-1.5 text-[13px] underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden className="size-3.5" />
        Daftar admin
      </Link>

      <PageHeader
        title={user.full_name}
        description={`${user.username} · ${user.email}${isSelf ? " · akun Anda sendiri" : ""}`}
        actions={<StatusLabel kind="admin_user" value={user.status} />}
      />

      {isSelf ? (
        <div className="bg-muted/40 rounded-xl border border-border p-4">
          <p className="text-[13px] leading-relaxed">
            Anda sedang melihat akun sendiri. Status dan peran akun sendiri tidak dapat diubah
            dari sini, dan itu memang disengaja: mengubah peran sendiri berarti memberi izin
            kepada diri sendiri tanpa diperiksa orang lain.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="bg-card flex flex-col gap-3 rounded-xl border border-border p-4">
          <h2 className="text-base font-semibold">Peran yang dipegang</h2>
          {user.is_super_admin ? (
            <p className="text-[13px] leading-relaxed">
              Akun ini super admin. Seluruh izin berlaku baginya tanpa perlu peran, jadi daftar
              peran di bawah ini hanya menunjukkan peran tambahan yang secara eksplisit
              dipegangnya.
            </p>
          ) : null}
          {roles.length === 0 ? (
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              {user.is_super_admin
                ? "Tidak ada peran tambahan yang dipegang."
                : "Akun ini tidak memegang peran apa pun, sehingga tidak dapat melakukan apa pun di konsol ini. Berikan peran lewat halaman daftar admin."}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {roles.map((role) => (
                <li key={role.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                  <span className="tabular text-[13px] font-medium">{role.code}</span>
                  <span className="text-[13px]">{role.name}</span>
                  <span className="text-muted-foreground ml-auto text-[12px]">
                    Diberikan <Timestamp value={role.granted_at} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-card flex flex-col gap-3 rounded-xl border border-border p-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">Izin efektif</h2>
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              Gabungan izin dari seluruh peran. Inilah yang sebenarnya menentukan apa yang boleh
              dilakukan akun ini.
            </p>
          </div>
          {permissions.length === 0 ? (
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              Tidak ada izin yang berlaku, karena tidak ada peran yang dipegang dan akun ini
              bukan super admin.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {permissions.map((permission) => (
                <li key={permission.code} className="flex flex-col gap-1 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="tabular text-[13px] font-medium">{permission.code}</span>
                    <span className="text-muted-foreground text-[12px]">{permission.name}</span>
                  </div>
                  <span className="text-muted-foreground text-[12px]">
                    lewat peran {permission.via_roles.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="bg-card flex flex-col gap-3 rounded-xl border border-border p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Sesi</h2>
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            Sesi yang mencurigakan dapat dihentikan dari halaman audit. Menonaktifkan akun atau
            mengganti perannya juga mencabut seluruh sesinya secara otomatis.
          </p>
        </div>
        {sessions.length === 0 ? (
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            Belum pernah ada sesi untuk akun ini. Akun yang baru dibuat memang belum pernah masuk.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-[13px]">
              <caption className="sr-only">Riwayat sesi akun admin ini</caption>
              <thead>
                <tr className="text-muted-foreground border-b border-border text-left">
                  <th scope="col" className="py-2 pr-3 font-medium">Dibuat</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Terakhir dipakai</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Alamat IP</th>
                  <th scope="col" className="py-2 font-medium">Keadaan</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="border-b border-border last:border-0">
                    <td className="py-2.5 pr-3">
                      <Timestamp value={session.created_at} />
                    </td>
                    <td className="py-2.5 pr-3">
                      <Timestamp value={session.last_used_at} fallback="Belum pernah" />
                    </td>
                    <td className="tabular py-2.5 pr-3">
                      {session.ip_address ?? "Tidak tercatat"}
                    </td>
                    <td className="py-2.5">
                      {session.revoked_at ? (
                        <span className="text-muted-foreground">
                          Dihentikan <Timestamp value={session.revoked_at} />
                        </span>
                      ) : new Date(session.expires_at) > new Date() ? (
                        <span className="text-success">Aktif</span>
                      ) : (
                        <span className="text-muted-foreground">Kedaluwarsa</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="secondary">
          <Link href="/admin-users">Kembali ke daftar admin</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/roles">Kelola peran</Link>
        </Button>
      </div>
    </div>
  );
}
