import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { GENERIC_ERROR } from "@/lib/api/client";
import { FeedbackButtons } from "./feedback-buttons";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(initialRating: "up" | "down" | null = null) {
  render(<FeedbackButtons messageId="m2" initialRating={initialRating} />);
  return {
    user: userEvent.setup(),
    good: () => screen.getByRole("button", { name: "Good answer" }) as HTMLButtonElement,
    bad: () => screen.getByRole("button", { name: "Bad answer" }) as HTMLButtonElement,
  };
}

const pressed = (button: HTMLElement) => button.getAttribute("aria-pressed");
/** Each request as [url, method, parsed body]. */
const sent = () => fetchMock.mock.calls.map(([url, init]) => [url, init?.method, JSON.parse(String(init?.body))]);
/** Answers each rating request by echoing the rating back, as the route does. */
const echo = () => fetchMock.mockImplementation(async (_url, init) => json(200, JSON.parse(String(init?.body))));

describe("FeedbackButtons", () => {
  it("shows an unrated answer with neither button pressed", () => {
    const { good, bad } = setup();
    expect(pressed(good())).toBe("false");
    expect(pressed(bad())).toBe("false");
  });

  it("shows a saved rating as pressed", () => {
    const { good, bad } = setup("down");
    expect(pressed(good())).toBe("false");
    expect(pressed(bad())).toBe("true");
  });

  it("shows a new rating at once, saves it, and blocks other clicks until it's saved", async () => {
    let release: (response: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => void (release = resolve)));
    const { user, good, bad } = setup();

    await user.click(good());

    expect(pressed(good())).toBe("true");
    expect(sent()).toEqual([["/api/messages/m2/feedback", "POST", { rating: "up" }]]);
    expect(good().disabled).toBe(true);
    expect(bad().disabled).toBe(true);

    release(json(200, { rating: "up" }));
    await waitFor(() => expect(good().disabled).toBe(false));
    expect(pressed(good())).toBe("true");
  });

  it("switches a rating from good to bad", async () => {
    echo();
    const { user, good, bad } = setup("up");

    await user.click(bad());

    expect(pressed(bad())).toBe("true");
    expect(pressed(good())).toBe("false");
    expect(sent()).toEqual([["/api/messages/m2/feedback", "POST", { rating: "down" }]]);
  });

  it("clears the rating when the pressed button is clicked again", async () => {
    echo();
    const { user, good, bad } = setup("up");

    await user.click(good());

    expect(pressed(good())).toBe("false");
    expect(pressed(bad())).toBe("false");
    expect(sent()).toEqual([["/api/messages/m2/feedback", "POST", { rating: null }]]);
  });

  it("puts the rating back and shows the server's message when saving fails", async () => {
    fetchMock.mockResolvedValue(
      json(503, { error: { code: "database_unavailable", message: "The database is unavailable right now." } }),
    );
    const { user, good, bad } = setup("up");

    await user.click(bad());

    expect((await screen.findByRole("alert")).textContent).toBe("The database is unavailable right now.");
    expect(pressed(good())).toBe("true");
    expect(pressed(bad())).toBe("false");
  });

  it("puts the rating back when the network fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("network error"));
    const { user, good } = setup();

    await user.click(good());

    expect((await screen.findByRole("alert")).textContent).toBe(GENERIC_ERROR);
    expect(pressed(good())).toBe("false");
  });
});
