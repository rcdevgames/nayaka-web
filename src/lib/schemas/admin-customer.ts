import { z } from "zod";

/*
  Skema pelanggan untuk konsol admin.

  Batas yang ditegakkan di sini mengikuti aturan yang sama di klien dan server, jadi tidak ada
  kolom yang tampak boleh diisi di layar tetapi ditolak diam-diam oleh server.
*/

/*
  Alasan wajib untuk tindakan yang mengubah akses pelanggan.

  Menangguhkan akun memutus perangkat pelanggan dari layanan. Pertanyaan "kenapa akun saya
  dimatikan" harus bisa dijawab dari catatan, bukan dari ingatan operator yang bertugas.
*/
const reason = z
  .string()
  .trim()
  .min(10, "Alasan minimal 10 karakter supaya cukup menjelaskan keputusannya.")
  .max(500, "Alasan maksimal 500 karakter.");

export const suspendCustomerSchema = z.object({
  reason,
  /*
    Menangguhkan pelanggan dengan perangkat terpasang punya akibat yang lebih besar daripada
    menangguhkan akun kosong. Operator perlu menyadarinya sebelum menekan tombol, jadi
    persetujuannya diminta secara eksplisit, bukan disimpulkan dari alasan yang diketik.
  */
  acknowledge_devices: z
    .boolean()
    .optional()
    .default(false),
});

export type SuspendCustomerInput = z.infer<typeof suspendCustomerSchema>;

export const activateCustomerSchema = z.object({
  reason,
});

export type ActivateCustomerInput = z.infer<typeof activateCustomerSchema>;

/*
  Nama pelanggan boleh diperbaiki admin, karena kesalahan ketik saat pendaftaran adalah hal yang
  biasa dan menunggu pelanggan memperbaikinya sendiri di aplikasi tidak selalu masuk akal.
  Status dan cara masuk tidak dapat diubah lewat endpoint ini: status punya jalurnya sendiri
  yang mewajibkan alasan, sedangkan cara masuk adalah milik pelanggan.
*/
export const updateCustomerSchema = z
  .object({
    full_name: z
      .string()
      .trim()
      .min(2, "Nama minimal 2 karakter.")
      .max(120, "Nama maksimal 120 karakter.")
      .optional(),
  })
  .refine((value) => value.full_name !== undefined, {
    message: "Tidak ada perubahan yang dikirim. Isi minimal satu kolom.",
  });

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
