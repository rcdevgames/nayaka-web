"use client";

import { useCallback, useEffect, useState } from "react";

import { toErrorMessage } from "@/lib/http";
import { csrfHeader, ensureCsrfToken } from "@/stores/session-store";

/*
  Pengambil data untuk halaman admin.

  Tiga keadaan yang harus dibedakan dengan jelas, karena ketiganya menuntut tindakan yang
  berbeda dari operator:

  - `memuat`  : permintaan sedang berjalan
  - `siap`    : data ada dan bisa dipakai
  - `galat`   : permintaan gagal, dan pesannya menyebut langkah berikutnya

  Yang tidak dilakukan: menampilkan angka nol saat data gagal dimuat. Nol dan "gagal dimuat"
  terlihat sama di layar tetapi artinya jauh berbeda, dan operator bisa mengambil keputusan
  berdasarkan angka nol yang sebenarnya tidak pernah diketahui.
*/

export type DataState<T> = {
  status: "memuat" | "siap" | "galat";
  data: T | null;
  error: string | null;
  /** Kode galat dari server, dipakai membedakan izin kurang dari kegagalan lain. */
  errorCode: string | null;
  requestId: string | null;
};

export type DataQuery<T> = DataState<T> & {
  /** Mengambil ulang data yang sama. Dipakai tombol "Coba lagi". */
  reload: () => void;
  /** Mengganti parameter dan mengambil ulang, misalnya saat filter berubah. */
  setParams: (params: Record<string, string | number | undefined>) => void;
  params: Record<string, string | number | undefined>;
};

function buildUrl(url: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${url}?${query}` : url;
}

/*
  Mengambil data dari endpoint admin.

  Parameter sengaja dipisahkan dari URL supaya perubahan filter memicu pengambilan ulang secara
  otomatis, tanpa setiap halaman perlu menulis efek sendiri dan berisiko lupa membatalkan
  permintaan lama saat filter diganti cepat berturut-turut.
*/
export function useApiQuery<T>(
  url: string,
  initialParams: Record<string, string | number | undefined> = {},
): DataQuery<T> {
  const [params, setParamsState] = useState(initialParams);
  const [reloadToken, setReloadToken] = useState(0);

  /*
    Hasil disimpan bersama kunci permintaannya, bukan sekadar nilainya.

    Alasannya: keadaan "sedang memuat" tidak perlu disetel, ia disimpulkan. Selama hasil yang
    tersimpan belum berasal dari kunci yang sedang diminta, tampilannya adalah memuat. Cara ini
    menghindari penyetelan keadaan di dalam efek, yang memicu render berantai: satu render untuk
    menandai memuat, lalu satu lagi saat datanya tiba.
  */
  const [result, setResult] = useState<{
    key: string;
    data: T | null;
    error: string | null;
    errorCode: string | null;
    requestId: string | null;
  } | null>(null);

  const key = `${url}?${buildUrl("", params)}#${reloadToken}`;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      let next: {
        key: string;
        data: T | null;
        error: string | null;
        errorCode: string | null;
        requestId: string | null;
      };

      try {
        const response = await fetch(buildUrl(url, params), {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        const body = (await response.json().catch(() => null)) as
          | { data?: T; error?: { code: string; message: string; request_id?: string } }
          | null;

        if (!response.ok || !body || body.error) {
          next = {
            key,
            data: null,
            error: body?.error?.message ?? "Server tidak mengirim keterangan galat.",
            errorCode: body?.error?.code ?? null,
            requestId: body?.error?.request_id ?? null,
          };
        } else {
          next = {
            key,
            data: (body.data ?? null) as T,
            error: null,
            errorCode: null,
            requestId: null,
          };
        }
      } catch (error) {
        /*
          Permintaan yang dibatalkan bukan kegagalan, jadi hasilnya tidak ditulis sama sekali.
          Menuliskannya akan membuat daftar berkedip menjadi galat setiap kali filter diganti.
        */
        if (controller.signal.aborted) return;
        next = {
          key,
          data: null,
          error: toErrorMessage(error),
          errorCode: "NETWORK_ERROR",
          requestId: null,
        };
      }

      if (!cancelled) setResult(next);
    }

    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url, params, key]);

  const fresh = result?.key === key ? result : null;

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  const setParams = useCallback(
    (next: Record<string, string | number | undefined>) => setParamsState(next),
    [],
  );

  return {
    status: fresh ? (fresh.error ? "galat" : "siap") : "memuat",
    data: fresh?.data ?? null,
    error: fresh?.error ?? null,
    errorCode: fresh?.errorCode ?? null,
    requestId: fresh?.requestId ?? null,
    reload,
    setParams,
    params,
  };
}

/*
  Menerjemahkan keadaan pengambilan data ke prop `status` milik DataTable.

  Dipisahkan di satu tempat karena setiap halaman daftar membutuhkannya, dan pemetaan yang
  ditulis ulang di tiap halaman adalah tempat yang mudah salah: satu halaman akan lupa
  memetakan `galat` dan menampilkan tabel kosong sebagai ganti pesan kegagalan.
*/
export function tableStatus(state: DataState<unknown>["status"]): "ready" | "loading" | "error" {
  if (state === "memuat") return "loading";
  if (state === "galat") return "error";
  return "ready";
}

/*
  Pemanggil mutasi dengan CSRF.

  Token CSRF dibaca dari cookie pada saat pemanggilan, bukan disimpan di localStorage. Kalau
  token itu disimpan, ia bertahan lebih lama daripada sesinya dan halaman yang dibuka esok hari
  akan mengirim token basi, yang hasilnya adalah 403 yang sulit dijelaskan.
*/
export async function mutate<T>(
  url: string,
  options: { method?: "POST" | "PATCH" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  /*
    Token diambil lewat ensureCsrfToken(), yang meminta token baru kalau cookie-nya belum ada.
    Tanpa itu, mutasi pertama setelah cookie dibersihkan selalu gagal dengan 403 yang
    membingungkan, padahal pengguna hanya perlu memuat halaman sekali.
  */
  const token = await ensureCsrfToken();

  const response = await fetch(url, {
    method: options.method ?? "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...csrfHeader(token),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const payload = (await response.json().catch(() => null)) as
    | { data?: T; error?: { code: string; message: string } }
    | null;

  if (!response.ok || payload?.error) {
    const error = new Error(
      payload?.error?.message ?? "Server tidak mengirim keterangan galat.",
    ) as Error & { code?: string; status?: number };
    error.code = payload?.error?.code;
    error.status = response.status;
    throw error;
  }

  return (payload?.data ?? null) as T;
}
