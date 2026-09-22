import { queryOne } from "@/lib/server/db";
import { AppError } from "@/lib/server/errors";
import { requireMobile } from "@/lib/server/mobile";
import { requireUuid } from "@/lib/server/request";
import { routeHandler } from "@/lib/server/route";

type Params = { params: Promise<{ device_id?: string }> };

export const GET = routeHandler("mobile.stream.proxy", async (request, _requestId, context) => {
  const { device_id: rawId } = await (context as Params).params;
  const deviceId = requireUuid(rawId, "device_id");
  const session = await requireMobile(request);

  const device = await queryOne<{ stream_url: string | null }>(
    "SELECT t.stream_url FROM devices d JOIN camera_telemetry t ON t.device_id = d.id WHERE d.id=$1 AND d.customer_id=$2 AND d.status IN ('claimed','suspended')",
    [deviceId, session.customerId],
  );

  if (!device?.stream_url) {
    throw new AppError({ code: "RESOURCE_NOT_FOUND", message: "Stream tidak ditemukan." });
  }

  const upstream = await fetch(device.stream_url, {
    headers: { Accept: "multipart/x-mixed-replace" },
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    throw new AppError({ code: "INTERNAL_ERROR", message: "Stream tidak dapat dimuat." });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      "Content-Type": upstream.headers.get("content-type") ?? "multipart/x-mixed-replace; boundary=frame",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
