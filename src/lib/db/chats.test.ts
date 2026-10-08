import { describe, expect, it } from "vitest";
import { startOfUtcDay } from "./chats";

describe("startOfUtcDay", () => {
  it("is midnight UTC of the same UTC day, whatever the time of day", () => {
    expect(startOfUtcDay(new Date("2026-10-08T00:00:00.000Z")).toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(startOfUtcDay(new Date("2026-10-08T13:45:12.345Z")).toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(startOfUtcDay(new Date("2026-10-08T23:59:59.999Z")).toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });

  it("uses the UTC day, not the server's local day", () => {
    // 22:30 on 7 October in UTC is already 8 October in India (UTC+5:30).
    expect(startOfUtcDay(new Date("2026-10-07T22:30:00.000Z")).toISOString()).toBe("2026-10-07T00:00:00.000Z");
  });

  it("does not modify the date it is given", () => {
    const now = new Date("2026-10-08T13:45:12.345Z");
    startOfUtcDay(now);
    expect(now.toISOString()).toBe("2026-10-08T13:45:12.345Z");
  });
});
