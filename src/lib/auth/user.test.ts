import type { Session } from "next-auth";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { auth } from "@/auth";
import { getUserId } from "./user";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

// `auth` is overloaded (session reader and proxy wrapper); the tests only use the session reader.
const mockedAuth = auth as unknown as Mock<() => Promise<Session | null>>;

const session = (user: Session["user"]): Session => ({ user, expires: "2026-11-07T00:00:00.000Z" });

afterEach(() => {
  mockedAuth.mockReset();
});

describe("getUserId", () => {
  it("returns the signed-in user's id from the session", async () => {
    mockedAuth.mockResolvedValue(session({ id: "google:108234567890", name: "Ada" }));
    expect(await getUserId()).toBe("google:108234567890");
  });

  it("returns null when nobody is signed in", async () => {
    mockedAuth.mockResolvedValue(null);
    expect(await getUserId()).toBeNull();
  });

  it("returns null when the session has no user id, so routes fail closed", async () => {
    mockedAuth.mockResolvedValue(session({ name: "Ada" }));
    expect(await getUserId()).toBeNull();
    mockedAuth.mockResolvedValue(session(undefined));
    expect(await getUserId()).toBeNull();
    mockedAuth.mockResolvedValue(session({ id: "" }));
    expect(await getUserId()).toBeNull();
  });

  it("has no development shortcut: without a session there is no user, in any environment", async () => {
    mockedAuth.mockResolvedValue(null);
    for (const env of ["development", "test", "production"]) {
      vi.stubEnv("NODE_ENV", env);
      expect(await getUserId()).toBeNull();
    }
    vi.unstubAllEnvs();
  });
});
