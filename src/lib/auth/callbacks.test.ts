import { describe, expect, it } from "vitest";
import { isProtectedPath, jwtCallback, sessionCallback, userIdFor } from "./callbacks";

const googleAccount = { provider: "google", providerAccountId: "108234567890" };

describe("userIdFor", () => {
  it("combines the provider and the provider's own account id", () => {
    expect(userIdFor(googleAccount)).toBe("google:108234567890");
  });

  it("gives the same id on every sign-in, so documents stay with their owner", () => {
    expect(userIdFor({ ...googleAccount })).toBe(userIdFor(googleAccount));
  });
});

describe("jwtCallback", () => {
  it("stores the stable user id in the token at sign-in, ignoring Auth.js's random per-sign-in id", () => {
    const token = jwtCallback({ token: { sub: "3f1c0d1e-random-uuid", name: "Ada" }, account: googleAccount });
    expect(token).toEqual({ sub: "3f1c0d1e-random-uuid", name: "Ada", userId: "google:108234567890" });
  });

  it("keeps the user id on later requests, when there is no account", () => {
    expect(jwtCallback({ token: { userId: "google:108234567890" }, account: null })).toEqual({
      userId: "google:108234567890",
    });
    expect(jwtCallback({ token: { userId: "google:108234567890" } })).toEqual({ userId: "google:108234567890" });
  });
});

describe("sessionCallback", () => {
  const session = { user: { name: "Ada", email: "ada@example.com" }, expires: "2026-11-07T00:00:00.000Z" };

  it("exposes the stable user id as session.user.id", () => {
    const result = sessionCallback({ session, token: { userId: "google:108234567890", sub: "random" } });
    expect(result.user).toEqual({ name: "Ada", email: "ada@example.com", id: "google:108234567890" });
    expect(result.expires).toBe(session.expires);
  });

  it("leaves no user id when the token has none, so routes answer 401", () => {
    expect(sessionCallback({ session, token: { sub: "random" } }).user?.id).toBeUndefined();
    expect(sessionCallback({ session, token: { userId: 42 } }).user?.id).toBeUndefined();
    expect(sessionCallback({ session, token: { userId: "" } }).user?.id).toBeUndefined();
  });

  it("never falls back to Auth.js's random token subject", () => {
    expect(sessionCallback({ session, token: { sub: "3f1c0d1e-random-uuid" } }).user?.id).not.toBe(
      "3f1c0d1e-random-uuid",
    );
  });
});

describe("isProtectedPath", () => {
  it.each(["/documents", "/documents/", "/documents/6ac68534ae92936b3b5a0515"])("protects %s", (path) => {
    expect(isProtectedPath(path)).toBe(true);
  });

  it.each(["/", "/api/auth/signin", "/api/documents", "/documentsx", "/favicon.ico"])("leaves %s public", (path) => {
    expect(isProtectedPath(path)).toBe(false);
  });
});
