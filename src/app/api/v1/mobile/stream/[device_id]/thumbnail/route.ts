import { queryOne } from "@/lib/server/db";
import { AppError } from "@/lib/server/errors";
import { requireStreamToken } from "@/lib/server/mobile";
import { requireUuid } from "@/lib/server/request";
import { routeHandler } from "@/lib/server/route";

type Params = { params: Promise<{ device_id?: string }> };

export const GET = routeHandler("mobile.stream.thumbnail", async (request, _requestId, context) => {
  const { device_id: rawId } = await (context as Params).params;
  const deviceId = requireUuid(rawId, "device_id");
  const claims = await requireStreamToken(request, "thumbnail");

  if (claims.deviceId !== deviceId) {
    throw new AppError({ code: "RESOURCE_NOT_FOUND", message: "Thumbnail tidak ditemukan." });
  }

  const device = await queryOne<{ thumbnail_url: string | null }>(
    "SELECT t.thumbnail_url FROM devices d JOIN camera_telemetry t ON t.device_id = d.id WHERE d.id=$1 AND d.customer_id=$2 AND d.status IN ('claimed','suspended')",
    [deviceId, claims.customerId],
  );

  if (!device?.thumbnail_url) {
    throw new AppError({ code: "RESOURCE_NOT_FOUND", message: "Thumbnail tidak ditemukan." });
  }

  const upstream = await fetch(device.thumbnail_url, {
    headers: { Accept: "image/jpeg" },
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    throw new AppError({ code: "INTERNAL_ERROR", message: "Thumbnail tidak dapat dimuat." });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
