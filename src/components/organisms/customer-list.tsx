"use client";

import Link from "next/link";

import { Timestamp } from "@/components/atoms";
import {
  Column,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  StatCard,
  StatusLabel,
  statusTone,
  type FilterDefinition,
} from "@/components/molecules";
import { formatNumber } from "@/lib/format";
import { tableStatus, useApiQuery } from "@/lib/use-api";

/*
  Daftar pelanggan.

  Warna rail pada tiap baris mengikuti status akun, bukan status langganan, karena halaman ini
  diurutkan berdasarkan akun. Status langganan ditampilkan sebagai lencana terpisah supaya
  keduanya tidak tercampur menjadi satu sinyal.

  Kolom "cara masuk" penting karena pelanggan yang tidak bisa masuk aplikasi hampir selalu
  memakai salah satu dari tiga cara masuk, dan operator perlu tahu cara mana yang dipakai
  sebelum menyuruh pelanggan mencoba lagi.
*/

type CustomerRow = {
  id: string;
  full_name: string;
  status: string;
  email: string | null;
  phone_e164: string | null;
  providers: string[];
  plan_name: string | null;
  subscription_status: string | null;
  device_count: number;
  created_at: string;
};

type CustomersResponse = {
  customers: CustomerRow[];
  summary: {
    total: number;
    active: number;
    suspended: number;
    active_without_device: number;
  };
};

/*
  Nama cara masuk diterjemahkan karena istilah teknisnya tidak dikenal operator lapangan.
  Cara masuk yang tidak dikenali ditampilkan apa adanya, bukan disamarkan.
*/
const PROVIDER_LABELS: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  google: "Google",
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function CustomerList() {
  const query = useApiQuery<CustomersResponse>("/api/v1/admin/customers");

  const filters: FilterDefinition[] = [
    {
      kind: "search",
      key: "q",
      label: "Cari pelanggan",
      placeholder: "Nama, email, atau nomor WhatsApp",
    },
    {
      kind: "select",
      key: "status",
      label: "Status akun",
      anyLabel: "Semua status",
      options: [
        { value: "active", label: "Aktif" },
        { value: "suspended", label: "Ditangguhkan" },
      ],
    },
  ];

  const rows = query.data?.customers ?? [];
  const summary = query.data?.summary;

  const columns: Column<CustomerRow>[] = [
    {
      key: "full_name",
      header: "Nama",
      cell: (row) => (
        <Link
          href={`/customers/${row.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.full_name}
        </Link>
      ),
    },
    {
      key: "contact",
      header: "Kontak",
      cell: (row) =>
        row.email || row.phone_e164 ? (
          <div className="flex flex-col">
            {row.email ? <span className="text-[13px]">{row.email}</span> : null}
            {row.phone_e164 ? (
              <span className="tabular text-muted-foreground text-[13px]">{row.phone_e164}</span>
            ) : null}
          </div>
        ) : (
          /*
            Pelanggan tanpa cara masuk sama sekali adalah keadaan yang wajar pada akun yang
            baru dibuat, tetapi juga bisa berarti pendaftarannya tidak selesai. Karena itu
            keadaannya disebutkan, bukan dibiarkan kosong tanpa keterangan.
          */
          <span className="text-muted-foreground text-[13px]">Belum ada cara masuk</span>
        ),
    },
    {
      key: "providers",
      header: "Cara masuk",
      cell: (row) =>
        row.providers.length > 0 ? (
          <span className="text-muted-foreground text-[13px]">
            {row.providers.map(providerLabel).join(", ")}
          </span>
        ) : (
          <span className="text-muted-foreground text-[13px]">Belum ada</span>
        ),
    },
    {
      key: "status",
      header: "Status akun",
      cell: (row) => <StatusLabel kind="customer" value={row.status} />,
    },
    {
      key: "plan",
      header: "Paket",
      cell: (row) =>
        row.plan_name ? (
          <div className="flex flex-col items-start gap-1">
            <span className="text-[13px]">{row.plan_name}</span>
            <StatusLabel kind="subscription" value={row.subscription_status} />
          </div>
        ) : (
          <span className="text-muted-foreground text-[13px]">Belum berlangganan</span>
        ),
    },
    {
      key: "device_count",
      header: "Perangkat",
      cell: (row) =>
        row.device_count > 0 ? (
          <span className="tabular">{formatNumber(row.device_count)}</span>
        ) : (
          <span className="text-muted-foreground">Belum ada</span>
        ),
    },
    {
      key: "created_at",
      header: "Terdaftar",
      cell: (row) => <Timestamp value={row.created_at} />,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pelanggan"
        description="Akun pelanggan aplikasi Nayaka. Perangkat dan langganan pelanggan dikelola dari halaman detail masing-masing."
        /*
          Tidak ada tombol tambah di sini, dan itu disengaja: pendaftaran pelanggan terjadi di
          aplikasi mobile. Tombol "Tambah pelanggan" yang membuka formulir kosong akan menjadi
          kontrol mati, karena tidak ada jalur sah untuk membuat akun pelanggan dari konsol.
        */
      />

      {query.status === "galat" ? null : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Pelanggan aktif"
            value={summary ? formatNumber(summary.active) : null}
            hint="Akun yang dapat memakai aplikasi dan perangkatnya"
          />
          <StatCard
            label="Ditangguhkan"
            value={summary ? formatNumber(summary.suspended) : null}
            hint="Akun yang aksesnya dihentikan sementara"
            tone={summary && summary.suspended > 0 ? "warning" : "neutral"}
          />
          <StatCard
            label="Aktif tanpa perangkat"
            value={summary ? formatNumber(summary.active_without_device) : null}
            hint="Sudah mendaftar tetapi belum memasang kamera"
          />
          <StatCard
            label="Total pelanggan"
            value={summary ? formatNumber(summary.total) : null}
            hint="Seluruh akun yang belum dihapus"
          />
        </div>
      )}

      <FilterBar
        filters={filters}
        values={{
          q: query.params.q as string | undefined,
          status: query.params.status as string | undefined,
        }}
        onChange={(next) => query.setParams(next)}
        onReset={() => query.setParams({})}
      />

      <DataTable
        label="Daftar pelanggan"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        status={tableStatus(query.status)}
        loadingLabel="Memuat daftar pelanggan"
        errorTitle="Daftar pelanggan gagal dimuat"
        errorDescription={query.error ?? undefined}
        onRetry={query.reload}
        rail={(row) => statusTone("customer", row.status)}
        emptyState={
          query.params.q || query.params.status ? (
            <EmptyState
              title="Tidak ada pelanggan yang cocok"
              description="Tidak ada pelanggan yang sesuai dengan filter yang dipasang. Pencarian mencakup nama, email, dan nomor WhatsApp. Bersihkan filter untuk melihat seluruh pelanggan."
            />
          ) : (
            <EmptyState
              title="Belum ada pelanggan"
              description="Pelanggan mendaftar sendiri lewat aplikasi Nayaka, jadi daftar ini akan terisi setelah pendaftaran pertama. Akun yang dibuat lewat aplikasi otomatis mendapat paket Gratis."
            />
          )
        }
      />
    </div>
  );
}
