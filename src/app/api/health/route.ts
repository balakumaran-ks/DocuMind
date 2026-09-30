import { missingServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness plus a configuration check. Reports which required variables are
 * missing by name only, so it is safe to expose publicly.
 */
export async function GET() {
  const missing = missingServerEnv();
  return Response.json({
    status: "ok",
    service: "documind",
    configured: missing.length === 0,
    missingEnv: missing,
  });
}
