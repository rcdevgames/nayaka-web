import { findDevice } from "@/lib/server/devices";
import { AppError } from "@/lib/server/errors";
import { requireAdmin, requirePermission } from "@/lib/server/guard";
import { requireUuid } from "@/lib/server/request";
import { routeHandler } from "@/lib/server/route";

type Params = { params: Promise<{ device_id?: string }> };

export const GET = routeHandler("admin.devices.stream", async (_request, _requestId, context) => {
  const admin = await requireAdmin();
  requirePermission(admin, "device.read");

  const { device_id: rawId } = await (context as Params).params;
  const deviceId = requireUuid(rawId, "device_id");
  const device = await findDevice(deviceId);

  if (!device || !device.stream_url) {
    throw new AppError({ code: "RESOURCE_NOT_FOUND", message: "Stream CCTV tidak ditemukan." });
  }

  const upstream = await fetch(device.stream_url, {
    headers: { Accept: "multipart/x-mixed-replace" },
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    throw new AppError({ code: "INTERNAL_ERROR", message: "Stream CCTV tidak dapat dimuat." });
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
