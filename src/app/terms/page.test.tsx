import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TermsPage from "./page";

afterEach(cleanup);

const text = () => document.body.textContent ?? "";

describe("Terms of use", () => {
  it("presents DocuMind as a demonstration provided as is, whose answers should be checked", () => {
    render(<TermsPage />);
    expect(screen.getByRole("heading", { level: 1, name: /terms of use/i })).toBeTruthy();
    expect(text()).toMatch(/as is/i);
    expect(text()).toMatch(/check the cited page/i);
  });

  it("asks users not to upload confidential material or abuse the free service, and links the privacy policy", () => {
    render(<TermsPage />);
    expect(text()).toMatch(/confidential/i);
    expect(text()).toMatch(/automated/i);
    expect(screen.getByRole("link", { name: /privacy policy/i }).getAttribute("href")).toBe("/privacy");
  });
});
