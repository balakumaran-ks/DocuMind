import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_USER_ID, getUserId } from "./user";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getUserId (before real sign-in exists)", () => {
  it.each(["development", "test"])("returns the fixed dev user when NODE_ENV=%s", async (env) => {
    vi.stubEnv("NODE_ENV", env);
    expect(await getUserId()).toBe(DEV_USER_ID);
  });

  it("returns null in production, so every protected route fails closed with 401", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await getUserId()).toBeNull();
  });

  it("uses a dev user id that cannot be mistaken for a real one", () => {
    expect(DEV_USER_ID).toMatch(/^dev-/);
  });
});
