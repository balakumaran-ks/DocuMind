import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "./headers";

const header = (key: string) => SECURITY_HEADERS.find((h) => h.key === key)?.value;

describe("SECURITY_HEADERS", () => {
  it("forbids other sites from framing the app (clickjacking), in both the old and the CSP form", () => {
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("Content-Security-Policy")).toBe("frame-ancestors 'none'");
  });

  it("stops browsers guessing content types, and limits what the referrer reveals", () => {
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("turns off device features the app never uses", () => {
    expect(header("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("sets each header once", () => {
    const keys = SECURITY_HEADERS.map((h) => h.key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });
});
