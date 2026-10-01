import { missingServerEnv, placeholderServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness plus a configuration check. Reports problem variables by name only,
 * so it is safe to expose publicly.
 */
export async function GET() {
  const missing = missingServerEnv();
  const placeholders = placeholderServerEnv();
  return Response.json({
    status: "ok",
    service: "documind",
    configured: missing.length === 0 && placeholders.length === 0,
    missingEnv: missing,
    placeholderEnv: placeholders,
  });
}
