import {
  CameraIcon,
  ClipboardTextIcon,
  CreditCardIcon,
  CubeIcon,
  FileTextIcon,
  GaugeIcon,
  KeyIcon,
  PaletteIcon,
  PlugsConnectedIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  TicketIcon,
  UsersIcon,
} from "@phosphor-icons/react/dist/ssr";

import type { NavEntry } from "@/components/molecules/nav-item";

/*
  Peta kerja konsol.

  Daftar ini memuat seluruh area kerja yang sudah direncanakan, termasuk yang belum dibangun.
  Bagian yang belum dibangun ditandai `planned` supaya tidak pernah menjadi tautan mati, dan
  supaya urutan pengerjaan berikutnya terbaca dari antarmuka, bukan hanya dari dokumen.

  Izin yang dibutuhkan dicantumkan per entri. Entri tanpa izin tetap terlihat oleh semua admin
  karena hanya berisi data lintas modul yang tidak sensitif.
*/
export const navEntries: NavEntry[] = [
  { label: "Beranda", href: "/", Icon: GaugeIcon, status: "ready" },
  {
    label: "Perlu tindakan",
    href: "/tindakan",
    Icon: ClipboardTextIcon,
    status: "ready",
    /*
      Antrian tindakan memuat data dari seluruh modul, termasuk pembayaran dan klaim perangkat.
      Izinnya mengikuti izin dashboard, karena isinya sama-sama lintas modul.
    */
    permission: "dashboard.read",
  },
  {
    label: "Pelanggan",
    href: "/customers",
    Icon: UsersIcon,
    status: "ready",
    permission: "customer.read",
  },
  {
    label: "Perangkat",
    href: "/devices",
    Icon: CameraIcon,
    status: "ready",
    permission: "device.read",
  },
  {
    label: "Paket dan harga",
    href: "/plans",
    Icon: CubeIcon,
    status: "ready",
    permission: "plan.read",
  },
  {
    label: "Langganan",
    href: "/subscriptions",
    Icon: TicketIcon,
    status: "ready",
    permission: "subscription.read",
  },
  {
    label: "Tagihan",
    href: "/invoices",
    Icon: ReceiptIcon,
    status: "ready",
    permission: "invoice.read",
  },
  {
    label: "Pembayaran",
    href: "/payments",
    Icon: CreditCardIcon,
    status: "ready",
    permission: "payment.read",
  },
  {
    label: "Log provider",
    href: "/provider-logs",
    Icon: PlugsConnectedIcon,
    status: "ready",
    permission: "payment.read",
  },
  {
    label: "Laporan",
    href: "/laporan",
    Icon: FileTextIcon,
    status: "ready",
    permission: "report.read",
  },
  {
    label: "Audit",
    href: "/audit",
    Icon: ShieldCheckIcon,
    status: "ready",
    permission: "audit.read",
  },
  {
    label: "Admin dan peran",
    href: "/admin-users",
    Icon: ShieldCheckIcon,
    status: "ready",
    permission: "admin.manage",
  },
  {
    label: "Peran dan izin",
    href: "/roles",
    Icon: KeyIcon,
    status: "ready",
    permission: "admin.manage",
  },
  {
    label: "Design system",
    href: "/design-system",
    Icon: PaletteIcon,
    status: "ready",
  },
];
