"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CameraIcon,
  ReceiptIcon,
} from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  Button,
  FieldMessage,
  Identifier,
  Money,
  RequiredMark,
  Spinner,
  StatusRail,
  TextArea,
  TextInput,
  Timestamp,
  type Tone,
} from "@/components/atoms";
import {
  AppShell,
  type Column,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SelectField,
  StatusBadge,
  TextField,
} from "@/components/molecules";
import { Label } from "@/components/ui/label";
import { confirmAction, notifyError, notifySuccess } from "@/lib/alert";
import {
  apiGet,
  toErrorMessage,
} from "@/lib/http";
/*
  Galeri memakai skema perangkat yang sama dengan yang dipakai server, bukan salinan sendiri.
  Salinan akan berbeda dari waktu ke waktu, dan galeri yang menampilkan aturan yang sudah tidak
  berlaku justru menyesatkan orang yang memakainya sebagai acuan.
*/
import {
  createDeviceDefaults,
  createDeviceSchema,
  type CreateDeviceInput,
} from "@/lib/schemas/admin-device";
import { cn } from "@/lib/utils";

type DeviceRow = {
  id: string;
  device_uid: string;
  serial_number: string;
  model: string;
  state: "claimed" | "suspended";
};

/*
  Baris di bawah adalah contoh untuk galeri, bukan data nyata.
  Galeri butuh bentuk baris supaya tabel bisa diperiksa, jadi datanya diberi
  label contoh yang terlihat pengguna.
*/
const contohBaris: DeviceRow[] = [
  {
    id: "1",
    device_uid: "NYK-000001",
    serial_number: "SN-2026-000123",
    model: "NYK-C200",
    state: "claimed",
  },
  {
    id: "2",
    device_uid: "NYK-000002",
    serial_number: "SN-2026-000124",
    model: "NYK-C200",
    state: "claimed",
  },
  {
    id: "3",
    device_uid: "NYK-000003",
    serial_number: "SN-2026-000125",
    model: "NYK-C400",
    state: "suspended",
  },
];

const stateTone: Record<DeviceRow["state"], Tone> = {
  claimed: "success",
  suspended: "warning",
};

const stateLabel: Record<DeviceRow["state"], string> = {
  claimed: "Aktif",
  suspended: "Nonaktif",
};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 border-b border-border pb-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? (
          <p className="text-muted-foreground max-w-prose text-[13px]">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-card rounded-xl border border-border p-5", className)}>
      <p className="text-muted-foreground mb-4 text-[13px] font-medium">{title}</p>
      {children}
    </div>
  );
}

const swatches = [
  { name: "Latar halaman", light: "#f4f4f5", dark: "#09090b" },
  { name: "Permukaan", light: "#ffffff", dark: "#18181b" },
  { name: "Teks utama", light: "#18181b", dark: "#fafafa" },
  { name: "Teks sekunder", light: "#52525b", dark: "#a1a1aa" },
  { name: "Aksen", light: "#c2410c", dark: "#f97316" },
  { name: "Batas input", light: "#71717a", dark: "#71717a" },
];

const contrastRows = [
  { pair: "Teks utama di permukaan", light: "17.72:1", dark: "16.97:1" },
  { pair: "Teks sekunder di permukaan", light: "7.73:1", dark: "6.91:1" },
  { pair: "Teks di atas aksen", light: "5.18:1", dark: "6.32:1" },
  { pair: "Batas input di permukaan", light: "4.83:1", dark: "3.67:1" },
];

export default function DesignSystemPage() {
  const [tableState, setTableState] = useState<
    "ready" | "loading" | "error" | "empty"
  >("ready");
  const [apiState, setApiState] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [apiResult, setApiResult] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string>("");
  const [submitted, setSubmitted] = useState<CreateDeviceInput | null>(null);

  const form = useForm<CreateDeviceInput>({
    resolver: zodResolver(createDeviceSchema),
    defaultValues: createDeviceDefaults,
  });

  async function periksaKoneksi() {
    setApiState("loading");
    setApiError("");
    setApiResult(null);
    try {
      const response = await apiGet<{ status: string; checked_at: string }>("/health");
      setApiResult(`Status ${response.data.status}, diperiksa ${response.data.checked_at}`);
      setApiState("done");
    } catch (error) {
      setApiError(toErrorMessage(error));
      setApiState("error");
    }
  }

  function kirimDevice(values: CreateDeviceInput) {
    setSubmitted(values);
    notifySuccess(
      "Device siap didaftarkan",
      "Payload di bawah memakai bentuk yang sama dengan kontrak API.",
    );
  }

  const columns: Column<DeviceRow>[] = [
    {
      key: "device_uid",
      header: "Device ID",
      cell: (row) => <Identifier value={row.device_uid} />,
    },
    {
      key: "serial_number",
      header: "Nomor seri",
      cell: (row) => <span className="tabular">{row.serial_number}</span>,
    },
    { key: "model", header: "Model", cell: (row) => row.model },
    {
      key: "state",
      header: "Status",
      cell: (row) => (
        <StatusBadge tone={stateTone[row.state]}>{stateLabel[row.state]}</StatusBadge>
      ),
    },
    {
      key: "claimed_at",
      header: "Diklaim",
      align: "right",
      cell: () => <Timestamp value="2026-01-01T10:00:00Z" />,
    },
  ];

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <PageHeader
          title="Design system"
          description="Kumpulan atom dan molekul yang sudah dipakai. Setiap warna di halaman ini sudah dihitung rasio kontrasnya, bukan dikira-kira."
        />

        <Section
          title="Arah desain"
          description="Reading this as: internal admin console untuk operasional subscription CCTV, untuk staf support, finance, dan device operator, dengan bahasa visual industrial yang tegas."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Panel title="ENERGY 2">
              <p className="text-[13px]">
                Hierarki tegas dan kontras tinggi, tanpa dekorasi yang tidak berfungsi.
              </p>
            </Panel>
            <Panel title="RHYTHM 2">
              <p className="text-[13px]">
                Pola halaman konsisten, dengan beberapa bagian sengaja dibedakan.
              </p>
            </Panel>
            <Panel title="MOTION 1">
              <p className="text-[13px]">
                Hanya transisi hover, focus, dan buka tutup. Tidak ada animasi yang berjalan sendiri.
              </p>
            </Panel>
          </div>
        </Section>

        <Section
          title="Warna dan kontras"
          description="Dua warna inti plus satu aksen. Ambang WCAG AA adalah 4.5:1 untuk teks normal dan 3:1 untuk batas komponen."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {swatches.map((swatch) => (
              <div key={swatch.name} className="bg-card rounded-xl border border-border p-3">
                <div className="mb-2 flex gap-2">
                  <span
                    className="size-9 rounded-md border border-border"
                    style={{ background: swatch.light }}
                    aria-hidden
                  />
                  <span
                    className="size-9 rounded-md border border-border"
                    style={{ background: swatch.dark }}
                    aria-hidden
                  />
                </div>
                <p className="text-[13px] font-medium">{swatch.name}</p>
                <p className="text-muted-foreground tabular text-[12px]">
                  {swatch.light} / {swatch.dark}
                </p>
              </div>
            ))}
          </div>

          <div className="bg-card overflow-hidden rounded-xl border border-border">
            <table className="w-full text-[13px]">
              <caption className="sr-only">
                Rasio kontras yang sudah diverifikasi pada kedua tema
              </caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="text-muted-foreground px-4 py-2 text-left font-medium">
                    Pasangan
                  </th>
                  <th scope="col" className="text-muted-foreground px-4 py-2 text-right font-medium">
                    Tema terang
                  </th>
                  <th scope="col" className="text-muted-foreground px-4 py-2 text-right font-medium">
                    Tema gelap
                  </th>
                </tr>
              </thead>
              <tbody>
                {contrastRows.map((row) => (
                  <tr key={row.pair} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">{row.pair}</td>
                    <td className="tabular px-4 py-2 text-right">{row.light}</td>
                    <td className="tabular px-4 py-2 text-right">{row.dark}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Atom"
          description="Satuan terkecil, dibangun di atas primitif shadcn. Tombol dan input setinggi 44px di layar sentuh, 36px di layar besar."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Tombol">
              <div className="flex flex-wrap items-center gap-2">
                <Button>Aksi utama</Button>
                <Button variant="outline">Sekunder</Button>
                <Button variant="ghost">Halus</Button>
                <Button variant="destructive">Hapus</Button>
                <Button disabled>Nonaktif</Button>
              </div>
            </Panel>

            <Panel title="Bidang isian dan pesan">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="contoh-input" className="text-[13px] font-medium">
                    Nomor seri
                    <RequiredMark />
                  </Label>
                  <TextInput id="contoh-input" placeholder="SN-2026-000123" />
                  <FieldMessage>Dicetak pada label di bagian bawah perangkat.</FieldMessage>
                </div>
                <div className="flex flex-col gap-1.5">
                  <TextInput id="contoh-error" aria-invalid defaultValue="abc" />
                  <FieldMessage tone="error">
                    Format MAC harus AA:BB:CC:DD:EE:FF.
                  </FieldMessage>
                </div>
                <TextArea placeholder="Catatan untuk tim gudang" />
              </div>
            </Panel>

            <Panel title="Rail status dan lencana">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone="success">Aktif</StatusBadge>
                  <StatusBadge tone="warning">Nonaktif</StatusBadge>
                  <StatusBadge tone="danger">Gagal</StatusBadge>
                  <StatusBadge tone="info">Menunggu</StatusBadge>
                  <StatusBadge tone="neutral">Draft</StatusBadge>
                </div>
                <ul className="flex flex-col gap-1">
                  {(["success", "warning", "danger", "info", "neutral"] as Tone[]).map(
                    (tone) => (
                      <li
                        key={tone}
                        className="bg-muted/40 flex items-center gap-3 rounded-md py-2 pr-3"
                      >
                        <StatusRail tone={tone} />
                        <span className="text-[13px] capitalize">{tone}</span>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </Panel>

            <Panel title="Angka, waktu, dan penanda">
              <div className="flex flex-col gap-3 text-[13px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Nominal</span>
                  <Money value={99000} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Biaya layanan</span>
                  <Money value={1003} />
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <span className="font-medium">Total pembayaran</span>
                  <Money value={100003} className="font-medium" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Waktu</span>
                  <Timestamp value="2026-01-01T10:00:00Z" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Waktu kosong</span>
                  <Timestamp value={null} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Pengenal</span>
                  <Identifier value="2b1f8c44-9e21-4c0a-9c3f-77a1b0c9d5e2" />
                </div>
                <div className="flex items-center gap-2 border-t border-border pt-3">
                  <Spinner />
                  <span className="text-muted-foreground">Contoh indikator memuat</span>
                </div>
              </div>
            </Panel>
          </div>
        </Section>

        <Section
          title="Molekul: tabel data"
          description="Tabel selalu menyiapkan empat keadaannya. Baris di bawah memakai data contoh untuk keperluan galeri, bukan data nyata."
        >
          <div className="flex flex-wrap gap-2">
            {(["ready", "loading", "error", "empty"] as const).map((state) => (
              <Button
                key={state}
                variant={tableState === state ? "default" : "outline"}
                onClick={() => setTableState(state)}
                aria-pressed={tableState === state}
              >
                {state === "ready"
                  ? "Ada data"
                  : state === "loading"
                    ? "Memuat"
                    : state === "error"
                      ? "Gagal"
                      : "Kosong"}
              </Button>
            ))}
          </div>

          <DataTable
            label="Daftar perangkat contoh"
            columns={columns}
            rows={tableState === "empty" ? [] : contohBaris}
            getRowId={(row) => row.id}
            status={tableState === "empty" ? "ready" : tableState}
            rail={(row) => stateTone[row.state]}
            loadingLabel="Memuat daftar perangkat"
            errorTitle="Daftar perangkat gagal dimuat"
            errorDescription="Server tidak merespons dalam 10 detik. Periksa koneksi kantor, lalu muat ulang."
            onRetry={() => setTableState("ready")}
            emptyState={
              <EmptyState
                icon={<CameraIcon aria-hidden weight="regular" className="size-7" />}
                title="Belum ada perangkat terdaftar"
                description="Daftarkan nomor seri perangkat lebih dulu supaya customer bisa mengklaimnya dari aplikasi."
                action={<Button>Daftarkan perangkat</Button>}
              />
            }
          />
        </Section>

        <Section
          title="Molekul: keadaan data"
          description="Keadaan kosong menyebut sebab dan langkah berikutnya. Keadaan gagal menyebut apa yang gagal dan cara mencobanya lagi."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <EmptyState
              icon={<ReceiptIcon aria-hidden weight="regular" className="size-7" />}
              title="Belum ada invoice"
              description="Invoice muncul setelah customer melakukan checkout paket berbayar."
            />
            <LoadingState label="Memuat daftar invoice" />
            <ErrorState
              title="Daftar invoice gagal dimuat"
              description="Permintaan ditolak karena sesi berakhir. Masuk kembali untuk melanjutkan."
              onRetry={() => notifyError("Contoh", "Ini hanya contoh, tidak ada permintaan yang dikirim.")}
              retryLabel="Masuk kembali"
            />
          </div>
        </Section>

        <Section
          title="Molekul: form dengan validasi"
          description="React Hook Form dipadukan zod. Schema yang dipakai adalah schema registrasi device yang sama dengan kontrak API."
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <Panel title="Form registrasi device">
              <form
                onSubmit={form.handleSubmit(kirimDevice)}
                className="flex flex-col gap-4"
                noValidate
              >
                <TextField
                  control={form.control}
                  name="name"
                  label="Nama perangkat"
                  placeholder="Contoh: Gerbang depan"
                />
                <TextField
                  control={form.control}
                  name="serial_number"
                  label="Nomor seri"
                  placeholder="SN-2026-000123"
                  required
                  hint="Wajib unik. Server menolak nomor seri yang sudah terdaftar."
                />
                <SelectField
                  control={form.control}
                  name="model"
                  label="Model"
                  placeholder="Pilih model perangkat"
                  options={[
                    { value: "NYK-C200", label: "NYK-C200" },
                    { value: "NYK-C400", label: "NYK-C400" },
                  ]}
                  hint="Daftar model diambil dari katalog perangkat."
                />
                <TextField
                  control={form.control}
                  name="batch_number"
                  label="Nomor batch"
                  placeholder="BATCH-2026-01"
                />
                <TextField
                  control={form.control}
                  name="mac_address"
                  label="Alamat MAC"
                  placeholder="AA:BB:CC:DD:EE:FF"
                  hint="Kosongkan kalau belum tercetak pada unit."
                />
                <TextField
                  control={form.control}
                  name="warranty_start_at"
                  label="Tanggal mulai garansi"
                  type="date"
                  hint="Diisi tanggal pembelian yang sebenarnya, supaya perangkat lama tetap dapat didaftarkan dengan benar."
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit">Daftarkan perangkat</Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      form.reset();
                      setSubmitted(null);
                    }}
                  >
                    Kosongkan
                  </Button>
                </div>
              </form>
            </Panel>

            <Panel title="Payload yang akan dikirim">
              {submitted ? (
                <pre className="bg-muted overflow-x-auto rounded-md p-3 text-[12px]">
                  {JSON.stringify(submitted, null, 2)}
                </pre>
              ) : (
                <p className="text-muted-foreground text-[13px]">
                  Isi form lalu kirim. Payload muncul di sini supaya bentuknya bisa
                  dicocokkan dengan kontrak API sebelum dihubungkan ke server.
                </p>
              )}
            </Panel>
          </div>
        </Section>

        <Section
          title="Molekul: dialog dan notifikasi"
          description="SweetAlert2 dipakai sebagai layanan imperatif, bukan komponen React, karena ia merender di luar pohon React. Warnanya tetap mengikuti token yang sama."
        >
          <Panel title="Coba tindakan">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => notifySuccess("Perubahan disimpan", "Data device sudah diperbarui.")}
              >
                Notifikasi berhasil
              </Button>
              <Button
                variant="outline"
                onClick={() => notifyError("Gagal menyimpan", "Server menolak permintaan.")}
              >
                Notifikasi gagal
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  const ok = await confirmAction({
                    title: "Nonaktifkan perangkat ini?",
                    text: "Perangkat berhenti dihitung dalam batas paket, tetapi tidak bisa diklaim ulang oleh customer lain.",
                    confirmLabel: "Nonaktifkan",
                    destructive: true,
                  });
                  if (ok) notifySuccess("Perangkat dinonaktifkan");
                }}
              >
                Dialog konfirmasi
              </Button>
            </div>
          </Panel>
        </Section>

        <Section
          title="Jalur data"
          description="Klien axios memakai envelope yang sama dengan kontrak API, dan mengubah setiap kegagalan menjadi satu bentuk galat."
        >
          <Panel title="Pemeriksaan koneksi ke /api/v1/health">
            <div className="flex flex-col gap-3">
              <div>
                <Button onClick={periksaKoneksi} disabled={apiState === "loading"}>
                  {apiState === "loading" ? <Spinner /> : null}
                  Periksa koneksi
                </Button>
              </div>
              {apiState === "idle" ? (
                <p className="text-muted-foreground text-[13px]">
                  Belum diperiksa. Tombol ini benar-benar memanggil route handler di server.
                </p>
              ) : null}
              {apiState === "loading" ? <LoadingState label="Menghubungi server" /> : null}
              {apiState === "done" && apiResult ? (
                <p className="text-success text-[13px]">{apiResult}</p>
              ) : null}
              {apiState === "error" ? (
                <ErrorState
                  title="Koneksi gagal"
                  description={apiError}
                  onRetry={periksaKoneksi}
                />
              ) : null}
            </div>
          </Panel>
        </Section>
      </div>
    </AppShell>
  );
}
