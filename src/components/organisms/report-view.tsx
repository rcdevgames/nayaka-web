"use client";

import { DownloadSimpleIcon } from "@phosphor-icons/react";
import Link from "next/link";

import { Button, Money } from "@/components/atoms";
import {
  ErrorState,
  LoadingState,
  PageHeader,
  PeriodPicker,
  StatCard,
  type Period,
} from "@/components/molecules";
import { formatNumber } from "@/lib/format";
import { REPORT_LABELS } from "@/lib/report-labels";
import { useApiQuery } from "@/lib/use-api";

/*
  Satu laporan.

  Bentuk response semua jenis laporan seragam: `columns` menentukan urutan dan label kolom,
  sehingga halaman ini tidak perlu mengetahui bentuk tiap jenis. Menambah jenis laporan baru
  berarti menambah satu penyusun di sisi server, tanpa mengubah berkas ini.

  Kalimat `definition` wajib ditampilkan di bawah judul. Angka pendapatan tanpa keterangan dasar
  perhitungan mudah disalahartikan: pembaca akan mengira itu uang yang masuk ke rekening, padahal
  di dalamnya belum diperhitungkan biaya layanan penyedia dan refund.

  Nilai null ditampilkan sebagai "belum dapat dihitung", bukan nol. Pada laporan, keduanya
  berbeda artinya: nol adalah hasil hitungan, sedangkan null berarti belum ada yang bisa
  dihitung.
*/

type Column = { key: string; label: string; format?: "number" | "currency" | "text" };
type SummaryLine = { label: string; value: number | null; format: string };

type Payload = {
  type: string;
  definition: string;
  period: { from: string; to: string };
  summary: SummaryLine[];
  columns: Column[];
  rows: Record<string, unknown>[];
  totals: Record<string, unknown>;
  notes: string[];
  granularity: string | null;
  granularity_applies: boolean;
};

export function ReportView({ type, period, onPeriodChange }: {
  type: string;
  period: Period;
  onPeriodChange: (next: Period) => void;
}) {
  const query = useApiQuery<Payload>(`/api/v1/admin/reports/${type}`, {
    from: period.from,
    to: period.to,
    granularity: "day",
  });

  const label = REPORT_LABELS[type] ?? { title: type, description: "" };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Laporan ${label.title.toLowerCase()}`}
        description={label.description}
        actions={
          <Button asChild variant="secondary">
            {/*
              Unduhan dipasang sebagai tautan biasa, bukan panggilan fetch. Berkasnya dikirim
              sebagai lampiran oleh server, dan peramban yang menanganinya berarti tidak ada isi
              berkas yang perlu disimpan di memori halaman ini.
            */}
            <a
              href={`/api/v1/admin/reports/${type}/export.csv?from=${period.from}&to=${period.to}&granularity=day`}
            >
              <DownloadSimpleIcon aria-hidden className="size-4" />
              Unduh CSV
            </a>
          </Button>
        }
      />

      <PeriodPicker
        value={period}
        onChange={onPeriodChange}
        onReload={query.reload}
        loading={query.status === "memuat"}
      />

      {query.status === "memuat" ? (
        <LoadingState label={`Memuat laporan ${label.title.toLowerCase()}`} />
      ) : query.status === "galat" || !query.data ? (
        <ErrorState
          title="Laporan gagal dimuat"
          description={query.error ?? "Server tidak mengirim keterangan galat."}
          onRetry={query.reload}
        />
      ) : (
        <ReportBody data={query.data} type={type} />
      )}

      <nav aria-label="Jenis laporan lain" className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-muted-foreground text-[13px]">Laporan lain:</span>
        {Object.entries(REPORT_LABELS)
          .filter(([key]) => key !== type)
          .map(([key, value]) => (
            <Link
              key={key}
              href={`/laporan/${key}`}
              className="text-[13px] underline-offset-4 hover:underline"
            >
              {value.title}
            </Link>
          ))}
      </nav>
    </div>
  );
}

function ReportBody({ data, type }: { data: Payload; type: string }) {
  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="sr-only">Dasar perhitungan</h2>
        <p className="text-muted-foreground text-[13px] leading-relaxed">{data.definition}</p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.summary.map((line) => (
          <StatCard
            key={line.label}
            label={line.label}
            value={nilaiTeks(line.value, line.format)}
            /*
              Satuan ditulis di keterangan supaya angka tanpa satuan tidak ditafsirkan keliru.
              "Tingkat berhenti" misalnya persen, sedangkan "Langganan aktif" adalah jumlah.
            */
            hint={satuanUntuk(line.label, line.format)}
          />
        ))}
      </div>

      {data.notes.length > 0 ? (
        <section className="bg-muted/40 flex flex-col gap-1.5 rounded-xl border border-border p-4">
          <h2 className="text-[13px] font-medium">Catatan</h2>
          <ul className="flex flex-col gap-1.5">
            {data.notes.map((note) => (
              <li key={note} className="text-muted-foreground text-[13px] leading-relaxed">
                {note}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.rows.length === 0 ? (
        <section className="bg-card flex flex-col gap-2 rounded-xl border border-border p-4">
          <h2 className="text-base font-semibold">Tidak ada baris pada periode ini</h2>
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            Tidak ada data yang masuk ke laporan ini antara {data.period.from} dan{" "}
            {data.period.to}. Kalau menurut perkiraan ada, periksa kembali rentang tanggalnya,
            karena laporan hanya memuat kejadian di dalam rentang yang dipilih.
          </p>
        </section>
      ) : (
        <section className="bg-card flex flex-col gap-3 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold">Rincian</h2>
            <span className="text-muted-foreground text-[13px]">
              {formatNumber(data.rows.length)} baris
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <caption className="sr-only">
                {REPORT_LABELS[type]?.title ?? type} dari {data.period.from} sampai{" "}
                {data.period.to}
              </caption>
              <thead>
                <tr className="text-muted-foreground border-b border-border text-left">
                  {data.columns.map((column) => (
                    <th key={column.key} scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => (
                  <tr
                    key={`${String(row[data.columns[0]?.key ?? "id"])}-${index}`}
                    className="border-b border-border last:border-0"
                  >
                    {data.columns.map((column) => (
                      <td key={column.key} className="py-2.5 pr-3 whitespace-nowrap">
                        {selTabel(row[column.key], column.format)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {/*
                Baris total hanya muncul kalau laporannya memang punya total. Laporan berupa
                daftar objek tidak punya angka yang bisa dijumlahkan, jadi barisnya tidak
                ditampilkan daripada menampilkan baris kosong.
              */}
              {Object.keys(data.totals).length > 0 && data.columns.some((c) => c.key in data.totals) ? (
                <tfoot>
                  <tr className="border-t border-border font-medium">
                    {data.columns.map((column, index) => (
                      <td key={column.key} className="py-2.5 pr-3 whitespace-nowrap">
                        {index === 0 ? (
                          "Total"
                        ) : column.key in data.totals ? (
                          selTabel(data.totals[column.key], column.format)
                        ) : (
                          <span className="text-muted-foreground">Tidak berlaku</span>
                        )}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </section>
      )}

      {data.granularity_applies ? (
        <p className="text-muted-foreground text-[13px] leading-relaxed">
          Dikelompokkan per hari, minggu, atau bulan sesuai pilihan, memakai batas hari waktu
          Jakarta. Batas yang memakai UTC akan memindahkan transaksi tengah malam ke tanggal yang
          salah.
        </p>
      ) : (
        <p className="text-muted-foreground text-[13px] leading-relaxed">
          Laporan ini berisi daftar kejadian, bukan angka per periode, sehingga tidak ada
          pengelompokan waktu yang berlaku.
        </p>
      )}
    </>
  );
}

/*
  Nilai null ditulis apa adanya sebagai belum dapat dihitung. Menuliskannya sebagai nol akan
  mengubah artinya dari "belum ada yang bisa dihitung" menjadi "hasil hitungannya nol".
*/
function nilaiTeks(value: number | null, format: string): string | null {
  if (value === null) return null;
  if (format === "currency") return formatNumber(value);
  if (format === "number") return formatNumber(value);
  return String(value);
}

function satuanUntuk(label: string, format: string): string {
  if (format === "currency") return "Dalam rupiah, tanpa biaya layanan penyedia";
  if (label.toLowerCase().includes("tingkat")) return "Dalam persen";
  return "Belum dapat dihitung bila tidak ada data untuk dibagi";
}

function selTabel(value: unknown, format?: string): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">Belum dapat dihitung</span>;
  }
  if (format === "currency") return <Money value={Number(value)} />;
  if (format === "number") {
    return <span className="tabular">{formatNumber(Number(value))}</span>;
  }
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  return String(value);
}
