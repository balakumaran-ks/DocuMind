import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/health", () => {
  it("reports ok and lists missing config by name", async () => {
    vi.stubEnv("MONGODB_URI", "");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.configured).toBe(false);
    expect(body.missingEnv).toContain("MONGODB_URI");
  });

  it("reports configured when every required var is set", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb+srv://secret-value@example");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "k");
    vi.stubEnv("AUTH_SECRET", "s");
    vi.stubEnv("AUTH_GOOGLE_ID", "id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "gs");
    const body = await (await GET()).json();
    expect(body.configured).toBe(true);
    expect(body.missingEnv).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("secret-value");
  });
});
