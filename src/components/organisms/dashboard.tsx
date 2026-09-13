"use client";

import Link from "next/link";
import { useState } from "react";

import { Money, Timestamp } from "@/components/atoms";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  PeriodPicker,
  StatCard,
  jakartaToday,
  type Period,
} from "@/components/molecules";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumber } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api";

/*
  Dashboard.

  Tiga tab dipisah karena isinya berbeda dan tidak selalu dibuka bersamaan. Menggabungkannya
  menjadi satu permintaan berarti tab Bisnis selalu membayar biaya query tab Operasional, padahal
  tab Operasional membaca tabel log yang jauh lebih besar.

  Setiap tab punya status memuat, galat, dan kosongnya sendiri, karena satu tab yang gagal tidak
  boleh membuat dua tab lain yang datanya sudah siap ikut tampil kosong.

  Rentang tanggal dipilih di tingkat halaman dan hanya berlaku untuk tab Bisnis dan Keuangan.
  Tab Operasional selalu memantau keadaan sejak tengah malam, karena tujuannya melihat apa yang
  sedang terjadi, bukan menelusuri periode.
*/

type PeriodResponse = {
  customers: { total: number; active: number; suspended: number; new_in_period: number };
  subscriptions: {
    active: number;
    expired: number;
    canceled: number;
    by_plan: { plan_id: string; plan_name: string; active_count: number }[];
  };
  devices: {
    in_stock: number;
    claimed: number;
    suspended: number;
    claim_rate_percent: number | null;
  };
  mrr: { amount: string; currency: string; as_of: string } | null;
  period: { from: string; to: string; granularity: string };
  series: {
    bucket: string;
    new_customers: number;
    new_subscriptions: number;
    revenue: string;
  }[];
};

type FinanceResponse = {
  revenue: { in_period: string; previous_period: string; change_percent: number | null };
  receivables: {
    open_count: number;
    open_amount: string;
    past_due_count: number;
    past_due_amount: string;
  };
  refunds: { count: number; amount: string };
  payments: {
    settled_count: number;
    pending_count: number;
    failed_count: number;
    unverified_count: number;
  };
  period: { from: string; to: string };
};

type OperationsResponse = {
  provider: {
    inbound_webhook_count: number;
    inbound_verified_count: number;
    inbound_rejected_count: number;
    inbound_unknown_order_count: number;
    inbound_pending_count: number;
    outbound_call_count: number;
    outbound_failed_count: number;
    outbound_p95_duration_ms: number | null;
  };
  jobs: {
    job_name: string;
    last_started_at: string | null;
    last_finished_at: string | null;
    last_outcome: string | null;
    expected_interval_minutes: number;
    is_stale: boolean;
    stuck_running: boolean;
  }[];
  claim_anomalies: { flagged_customers: number; flagged_ips: number; failed_attempts: number };
  admin_sessions: { active: number };
  period: { from: string; to: string };
};

/*
  Nama job ditampilkan dalam bahasa Indonesia. Nama teknisnya tetap dipakai sebagai kunci,
  karena itulah yang muncul di log dan di database.
*/
const JOB_LABELS: Record<string, string> = {
  reconcile_payments: "Rekonsiliasi pembayaran",
  reprocess_webhooks: "Proses ulang notifikasi",
  expire_payment_attempts: "Kedaluwarsakan percobaan bayar",
  expire_invoices: "Kedaluwarsakan tagihan",
  expire_subscriptions: "Kedaluwarsakan langganan",
  cleanup_idempotency_keys: "Bersihkan kunci idempotensi",
  cleanup_verification_codes: "Bersihkan kode verifikasi",
};

export function Dashboard() {
  const [tab, setTab] = useState("bisnis");
  const [period, setPeriod] = useState<Period>(() => {
    const hariIni = jakartaToday();
    return { from: `${hariIni.slice(0, 7)}-01`, to: hariIni };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Keadaan pelanggan, keuangan, dan operasional. Setiap angka dihitung dari data nyata pada periode yang tertulis, bukan perkiraan."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="bisnis">Bisnis</TabsTrigger>
          <TabsTrigger value="keuangan">Keuangan</TabsTrigger>
          <TabsTrigger value="operasional">Operasional</TabsTrigger>
        </TabsList>

        <TabsContent value="bisnis" className="pt-4">
          <BusinessTab period={period} onPeriodChange={setPeriod} />
        </TabsContent>
        <TabsContent value="keuangan" className="pt-4">
          <FinanceTab period={period} />
        </TabsContent>
        <TabsContent value="operasional" className="pt-4">
          <OperationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BusinessTab({
  period,
  onPeriodChange,
}: {
  period: Period;
  onPeriodChange: (next: Period) => void;
}) {
  const query = useApiQuery<PeriodResponse>("/api/v1/admin/dashboard/business", {
    from: period.from,
    to: period.to,
    granularity: "day",
  });

  return (
    <div className="flex flex-col gap-6">
      <PeriodPicker value={period} onChange={onPeriodChange} onReload={query.reload} loading={query.status === "memuat"} />

      {query.status === "memuat" ? (
        <LoadingState label="Memuat angka bisnis" />
      ) : query.status === "galat" || !query.data ? (
        <ErrorState
          title="Angka bisnis gagal dimuat"
          description={query.error ?? "Server tidak mengirim keterangan galat."}
          onRetry={query.reload}
        />
      ) : (
        <BusinessBody data={query.data} period={period} />
      )}
    </div>
  );
}

function BusinessBody({ data, period }: { data: PeriodResponse; period: Period }) {
  const { customers, subscriptions, devices, mrr, series } = data;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pelanggan aktif"
          value={formatNumber(customers.active)}
          hint={`${formatNumber(customers.total)} pelanggan terdaftar seluruhnya`}
        />
        <StatCard
          label="Langganan aktif"
          value={formatNumber(subscriptions.active)}
          hint={`${formatNumber(subscriptions.expired)} berakhir dan ${formatNumber(subscriptions.canceled)} dibatalkan`}
        />
        <StatCard
          label="Perangkat terpasang"
          value={formatNumber(devices.claimed)}
          hint={
            devices.claim_rate_percent === null
              ? "Tingkat klaim belum dapat dihitung karena belum ada perangkat terdaftar"
              : `${devices.claim_rate_percent}% dari ${formatNumber(devices.in_stock + devices.claimed + devices.suspended)} perangkat terdaftar`
          }
        />
        <StatCard
          label="Pendapatan berulang bulanan"
          value={
            mrr
              ? mrr.amount === "0"
                ? null
                : formatNumber(Number(mrr.amount))
              : null
          }
          /*
            Nol di sini bukan hasil hitungan, melainkan tidak adanya langganan berbayar. Karena
            itu ditampilkan sebagai belum diketahui, bukan sebagai angka nol yang akan terbaca
            seperti pendapatan yang memang nol.
          */
          hint={
            mrr && mrr.amount === "0"
              ? "Belum ada langganan berbayar aktif, jadi belum ada pendapatan berulang"
              : "Dijumlahkan dari harga paket dibagi jumlah bulannya"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="bg-card flex flex-col gap-3 rounded-xl border border-border p-4">
          <h2 className="text-base font-semibold">Pelanggan per paket</h2>
          {subscriptions.by_plan.every((row) => row.active_count === 0) ? (
            <EmptyState
              title="Belum ada langganan aktif"
              description="Paket tetap ditampilkan meski belum ada pelanggannya, supaya susunan paket yang tersedia terlihat. Pelanggan memilih paket dari aplikasi, bukan dari konsol ini."
            />
          ) : (
            <table className="w-full text-[13px]">
              <caption className="sr-only">Jumlah langganan aktif per paket</caption>
              <thead>
                <tr className="text-muted-foreground border-b border-border text-left">
                  <th scope="col" className="py-2 pr-3 font-medium">Paket</th>
                  <th scope="col" className="py-2 font-medium">Langganan aktif</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.by_plan.map((row) => (
                  <tr key={row.plan_id} className="border-b border-border last:border-0">
                    <td className="py-2.5 pr-3">{row.plan_name}</td>
                    <td className="tabular py-2.5">{formatNumber(row.active_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="bg-card flex flex-col gap-3 rounded-xl border border-border p-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">Keadaan perangkat</h2>
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              Perangkat dianggap terpasang setelah pelanggan mengklaimnya lewat aplikasi.
              Perangkat yang sudah tidak dipakai pelanggan tetap dihitung sebagai pernah
              terpasang, karena yang diukur adalah berapa banyak perangkat yang sampai ke
              pelanggan.
            </p>
          </div>
          <dl className="flex flex-col gap-2 text-[13px]">
            <Row label="Terpasang di pelanggan" value={formatNumber(devices.claimed)} />
            <Row label="Masih tersedia" value={formatNumber(devices.in_stock)} />
            <Row label="Ditangguhkan" value={formatNumber(devices.suspended)} />
            <Row
              label="Tingkat klaim"
              value={
                devices.claim_rate_percent === null ? (
                  <span className="text-muted-foreground">Belum dapat dihitung</span>
                ) : (
                  `${devices.claim_rate_percent}%`
                )
              }
            />
            <Row label="Pelanggan ditangguhkan" value={formatNumber(customers.suspended)} />
          </dl>
        </section>
      </div>

      <section className="bg-card flex flex-col gap-3 rounded-xl border border-border p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Pendapatan harian</h2>
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            Dihitung pada tanggal pembayaran diterima, dan nilainya adalah jumlah tagihan tanpa
            biaya layanan penyedia pembayaran. Batas harinya mengikuti waktu Jakarta.
          </p>
        </div>

        {series.every((row) => Number(row.revenue) === 0) ? (
          <EmptyState
            title="Belum ada pendapatan pada periode ini"
            description="Tidak ada pembayaran yang diterima antara tanggal yang dipilih. Paket Gratis tidak menerbitkan tagihan, jadi periode tanpa pelanggan berbayar akan tampil seperti ini."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-[13px]">
              <caption className="sr-only">
                Pendapatan harian pada periode yang dipilih
              </caption>
              <thead>
                <tr className="text-muted-foreground border-b border-border text-left">
                  <th scope="col" className="py-2 pr-3 font-medium">Tanggal</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Pelanggan baru</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Langganan baru</th>
                  <th scope="col" className="py-2 font-medium">Pendapatan</th>
                </tr>
              </thead>
              <tbody>
                {/*
                  Hanya hari yang punya angka ditampilkan. Menampilkan seluruh 30 hari dengan
                  mayoritas nol akan menyembunyikan hari yang benar-benar ada isinya.
                */}
                {series
                  .filter(
                    (row) =>
                      Number(row.revenue) > 0 ||
                      row.new_customers > 0 ||
                      row.new_subscriptions > 0,
                  )
                  .map((row) => (
                    <tr key={row.bucket} className="border-b border-border last:border-0">
                      <td className="py-2.5 pr-3">
                        <Timestamp value={`${row.bucket}T00:00:00+07:00`} />
                      </td>
                      <td className="tabular py-2.5 pr-3">{formatNumber(row.new_customers)}</td>
                      <td className="tabular py-2.5 pr-3">
                        {formatNumber(row.new_subscriptions)}
                      </td>
                      <td className="py-2.5">
                        {Number(row.revenue) > 0 ? (
                          <Money value={Number(row.revenue)} />
                        ) : (
                          <span className="text-muted-foreground">Belum ada</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted-foreground text-[12px]">
          Periode {period.from} sampai {period.to}, waktu Jakarta.
        </p>
      </section>
    </>
  );
}

function FinanceTab({ period }: { period: Period }) {
  const query = useApiQuery<FinanceResponse>("/api/v1/admin/dashboard/finance", {
    from: period.from,
    to: period.to,
  });

  if (query.status === "memuat") return <LoadingState label="Memuat angka keuangan" />;

  if (query.status === "galat" || !query.data) {
    return (
      <ErrorState
        title="Angka keuangan gagal dimuat"
        description={query.error ?? "Server tidak mengirim keterangan galat."}
        onRetry={query.reload}
      />
    );
  }

  const { revenue, receivables, refunds, payments } = query.data;
  const outstanding = Number(receivables.open_amount) + Number(receivables.past_due_amount);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pendapatan periode ini"
          value={formatNumber(Number(revenue.in_period))}
          hint={`Dibandingkan periode sebelumnya sebesar ${formatNumber(Number(revenue.previous_period))}`}
        />
        <StatCard
          label="Perubahan antar periode"
          value={
            revenue.change_percent === null ? null : `${revenue.change_percent}%`
          }
          /*
            Perubahan dari periode kosong tidak punya persentase yang bermakna. Ditampilkan
            sebagai belum dapat dihitung, bukan sebagai nol persen atau seratus persen, karena
            keduanya akan terbaca sebagai fakta.
          */
          hint={
            revenue.change_percent === null
              ? "Belum dapat dihitung karena periode pembandingnya belum ada pendapatan"
              : "Dibandingkan periode dengan panjang yang sama tepat sebelumnya"
          }
        />
        <StatCard
          label="Belum tertagih"
          value={formatNumber(outstanding)}
          hint={`${formatNumber(receivables.open_count)} tagihan belum jatuh tempo dan ${formatNumber(receivables.past_due_count)} lewat jatuh tempo`}
          tone={outstanding > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Refund"
          value={formatNumber(Number(refunds.amount))}
          hint={`${formatNumber(refunds.count)} refund selesai pada periode ini`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="bg-card flex flex-col gap-3 rounded-xl border border-border p-4">
          <h2 className="text-base font-semibold">Pembayaran</h2>
          <dl className="flex flex-col gap-2 text-[13px]">
            <Row label="Lunas" value={formatNumber(payments.settled_count)} />
            <Row label="Menunggu pembayaran" value={formatNumber(payments.pending_count)} />
            <Row label="Gagal" value={formatNumber(payments.failed_count)} />
            <Row
              label="Lunas belum dikonfirmasi penyedia"
              value={
                <span className={payments.unverified_count > 0 ? "text-warning font-medium" : undefined}>
                  {formatNumber(payments.unverified_count)}
                </span>
              }
            />
          </dl>
          <p className="text-muted-foreground text-[12px] leading-relaxed">
            Pembayaran yang belum dikonfirmasi penyedia bergantung pada pemeriksaan ulang oleh job
            rekonsiliasi. Angka ini menunjukkan seberapa besar ketergantungan itu masih tersisa.
          </p>
        </section>

        <section className="bg-card flex flex-col gap-3 rounded-xl border border-border p-4">
          <h2 className="text-base font-semibold">Piutang</h2>
          <dl className="flex flex-col gap-2 text-[13px]">
            <Row
              label="Belum jatuh tempo"
              value={
                <span>
                  {formatNumber(receivables.open_count)} tagihan,{" "}
                  <Money value={Number(receivables.open_amount)} />
                </span>
              }
            />
            <Row
              label="Lewat jatuh tempo"
              value={
                <span className={receivables.past_due_count > 0 ? "text-warning" : undefined}>
                  {formatNumber(receivables.past_due_count)} tagihan,{" "}
                  <Money value={Number(receivables.past_due_amount)} />
                </span>
              }
            />
          </dl>
          <p className="text-muted-foreground text-[12px] leading-relaxed">
            Piutang dihitung dari sisa tagihan, yaitu jumlah tagihan dikurangi yang sudah dibayar.
            Tagihan yang dibatalkan tidak lagi menuntut pembayaran.
          </p>
          <Link href="/invoices" className="text-[13px] underline-offset-4 hover:underline">
            Buka daftar tagihan
          </Link>
        </section>
      </div>

      <p className="text-muted-foreground text-[13px] leading-relaxed">
        <span className="font-medium">Dasar perhitungan: </span>
        Pendapatan diakui pada tanggal pembayaran diterima, dan nilainya jumlah tagihan tanpa
        biaya layanan penyedia pembayaran. Refund diakui pada tanggal refund itu selesai, bukan
        mundur ke periode tagihan asalnya. Karena dasar kas, laporan periode yang sudah lewat
        tidak berubah angkanya.
      </p>
    </div>
  );
}

function OperationsTab() {
  const query = useApiQuery<OperationsResponse>("/api/v1/admin/dashboard/operations");

  if (query.status === "memuat") return <LoadingState label="Memuat keadaan operasional" />;

  if (query.status === "galat" || !query.data) {
    return (
      <ErrorState
        title="Keadaan operasional gagal dimuat"
        description={query.error ?? "Server tidak mengirim keterangan galat."}
        onRetry={query.reload}
      />
    );
  }

  const { provider, jobs, claim_anomalies: anomalies, admin_sessions: sessions } = query.data;
  /*
    Job yang tertinggal dan job yang berhenti di tengah jalan digabung menjadi satu daftar
    perhatian, karena keduanya sama-sama berarti pekerjaan itu sedang tidak berjalan. Yang
    membedakan hanya keterangannya.
  */
  const jobBermasalah = jobs.filter((job) => job.is_stale || job.stuck_running);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        Tab ini selalu memantau keadaan sejak tengah malam waktu Jakarta, bukan rentang tanggal
        yang dipilih, karena tujuannya melihat apa yang sedang terjadi.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Notifikasi masuk"
          value={formatNumber(provider.inbound_webhook_count)}
          hint={`${formatNumber(provider.inbound_verified_count)} cocok, ${formatNumber(provider.inbound_pending_count)} belum diproses`}
          tone={provider.inbound_pending_count > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Notifikasi mencurigakan"
          value={formatNumber(
            provider.inbound_rejected_count + provider.inbound_unknown_order_count,
          )}
          hint={`${formatNumber(provider.inbound_rejected_count)} tidak cocok, ${formatNumber(provider.inbound_unknown_order_count)} nomor pesanan tidak dikenal`}
          tone={
            provider.inbound_rejected_count + provider.inbound_unknown_order_count > 0
              ? "danger"
              : "neutral"
          }
        />
        <StatCard
          label="Panggilan keluar gagal"
          value={formatNumber(provider.outbound_failed_count)}
          hint={`Dari ${formatNumber(provider.outbound_call_count)} panggilan ke penyedia hari ini`}
          tone={provider.outbound_failed_count > 0 ? "danger" : "neutral"}
        />
        <StatCard
          label="Durasi panggilan terlama"
          value={
            provider.outbound_p95_duration_ms === null
              ? null
              : formatNumber(provider.outbound_p95_duration_ms)
          }
          hint={
            provider.outbound_p95_duration_ms === null
              ? "Belum ada panggilan keluar hari ini"
              : "Sembilan puluh lima persen panggilan selesai dalam waktu ini atau lebih cepat, dalam milidetik"
          }
          tone={
            provider.outbound_p95_duration_ms !== null &&
            provider.outbound_p95_duration_ms >= 5000
              ? "warning"
              : "neutral"
          }
        />
      </div>

      <section className="bg-card flex flex-col gap-3 rounded-xl border border-border p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Pekerjaan terjadwal</h2>
          <p className="text-muted-foreground text-[13px] leading-relaxed">
            Rekonsiliasi pembayaran adalah pengaman utama integrasi pembayaran. Notifikasi
            penyedia tidak bertanda tangan dan kebijakan pengirimannya ulang tidak terdokumentasi,
            sehingga pekerjaan inilah yang memastikan pembayaran tidak menggantung tanpa batas.
          </p>
        </div>

        {jobs.length === 0 ? (
          <EmptyState
            title="Belum ada catatan pekerjaan terjadwal"
            description="Tidak ada satu pun pekerjaan yang pernah berjalan. Selama keadaan ini berlangsung, tidak ada rekonsiliasi pembayaran maupun pembersihan otomatis. Pastikan penjadwalnya memang sudah dipasang."
          />
        ) : (
          <>
            {jobBermasalah.length > 0 ? (
              <div className="border-warning bg-warning-surface rounded-lg border p-3">
                <p className="text-warning text-[13px] font-medium">
                  {jobBermasalah.length} pekerjaan sedang tidak berjalan normal
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {jobBermasalah.map((job) => (
                    <li key={job.job_name} className="text-[13px]">
                      {JOB_LABELS[job.job_name] ?? job.job_name}:{" "}
                      {job.stuck_running
                        ? "mulai berjalan tetapi tidak pernah selesai"
                        : job.last_finished_at === null
                          ? "belum pernah selesai berjalan"
                          : `terakhir selesai lebih dari ${job.expected_interval_minutes * 2} menit lalu`}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-[13px]">
                <caption className="sr-only">Keadaan pekerjaan terjadwal</caption>
                <thead>
                  <tr className="text-muted-foreground border-b border-border text-left">
                    <th scope="col" className="py-2 pr-3 font-medium">Pekerjaan</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Terakhir mulai</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Terakhir selesai</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Hasil</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Selang diharapkan</th>
                    <th scope="col" className="py-2 font-medium">Keadaan</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.job_name} className="border-b border-border last:border-0">
                      <td className="py-2.5 pr-3">{JOB_LABELS[job.job_name] ?? job.job_name}</td>
                      <td className="py-2.5 pr-3">
                        <Timestamp value={job.last_started_at} fallback="Belum pernah" />
                      </td>
                      <td className="py-2.5 pr-3">
                        <Timestamp value={job.last_finished_at} fallback="Belum pernah" />
                      </td>
                      <td className="py-2.5 pr-3">
                        {job.last_outcome === null ? (
                          <span className="text-muted-foreground">Belum ada</span>
                        ) : job.last_outcome === "success" ? (
                          "Berhasil"
                        ) : job.last_outcome === "failed" ? (
                          <span className="text-destructive font-medium">Gagal</span>
                        ) : (
                          "Sedang berjalan"
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {job.expected_interval_minutes >= 60
                          ? `${job.expected_interval_minutes / 60} jam`
                          : `${job.expected_interval_minutes} menit`}
                      </td>
                      <td className="py-2.5">
                        {job.stuck_running ? (
                          <span className="text-warning font-medium">Berhenti di tengah</span>
                        ) : job.is_stale ? (
                          <span className="text-warning font-medium">Tertinggal</span>
                        ) : (
                          <span className="text-success">Berjalan normal</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="bg-card flex flex-col gap-3 rounded-xl border border-border p-4">
          <h2 className="text-base font-semibold">Percobaan klaim mencurigakan</h2>
          <dl className="flex flex-col gap-2 text-[13px]">
            <Row label="Percobaan klaim gagal, 24 jam" value={formatNumber(anomalies.failed_attempts)} />
            <Row
              label="Pelanggan melewati batas, 1 jam"
              value={
                <span className={anomalies.flagged_customers > 0 ? "text-destructive font-medium" : undefined}>
                  {formatNumber(anomalies.flagged_customers)}
                </span>
              }
            />
            <Row
              label="Alamat IP melewati batas, 1 jam"
              value={
                <span className={anomalies.flagged_ips > 0 ? "text-destructive font-medium" : undefined}>
                  {formatNumber(anomalies.flagged_ips)}
                </span>
              }
            />
          </dl>
          <p className="text-muted-foreground text-[12px] leading-relaxed">
            Batasnya lima percobaan gagal per pelanggan per jam, dan sepuluh per alamat IP per
            jam. Nomor seri perangkat bisa ditebak, sehingga jalur klaim ini yang paling perlu
            diawasi.
          </p>
          <Link href="/tindakan" className="text-[13px] underline-offset-4 hover:underline">
            Buka antrian tindakan
          </Link>
        </section>

        <section className="bg-card flex flex-col gap-3 rounded-xl border border-border p-4">
          <h2 className="text-base font-semibold">Sesi admin</h2>
          <dl className="flex flex-col gap-2 text-[13px]">
            <Row label="Sesi aktif" value={formatNumber(sessions.active)} />
          </dl>
          <p className="text-muted-foreground text-[12px] leading-relaxed">
            Sesi yang masih berlaku untuk seluruh admin. Sesi yang sudah dihentikan atau
            kedaluwarsa tidak dihitung. Daftar lengkapnya ada di halaman audit.
          </p>
          <Link href="/audit" className="text-[13px] underline-offset-4 hover:underline">
            Buka halaman audit
          </Link>
        </section>
      </div>

      <p className="text-muted-foreground text-[12px]">
        Periode pengamatan {new Date(query.data.period.from).toLocaleDateString("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" })}{" "}
        sampai {new Date(query.data.period.to).toLocaleDateString("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" })}, waktu Jakarta.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
