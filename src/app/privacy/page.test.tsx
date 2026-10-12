import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PrivacyPage from "./page";

afterEach(cleanup);

const text = () => document.body.textContent ?? "";

describe("Privacy policy", () => {
  it("says which Google account data is collected and why", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: /privacy policy/i })).toBeTruthy();
    expect(text()).toMatch(/name, email address and profile picture/i);
    expect(text()).toMatch(/only to identify you/i);
    expect(text()).toMatch(/not sold/i);
  });

  it("discloses that document text and questions go to Google's Gemini API, whose free tier may use them", () => {
    render(<PrivacyPage />);
    expect(text()).toMatch(/Gemini API/);
    expect(text()).toMatch(/human reviewers/i);
    expect(text()).toMatch(/confidential/i);
  });

  it("explains how to delete documents and the whole account", () => {
    render(<PrivacyPage />);
    expect(text()).toMatch(/delete my account/i);
  });

  it("includes Google's Limited Use statement and a way to get in touch", () => {
    render(<PrivacyPage />);
    expect(text()).toMatch(/Google API Services User Data Policy, including the Limited Use requirements/);
    expect(screen.getByRole("link", { name: /Google API Services User Data Policy/ }).getAttribute("href")).toBe(
      "https://developers.google.com/terms/api-services-user-data-policy",
    );
    expect(screen.getByRole("link", { name: /open an issue/i }).getAttribute("href")).toBe(
      "https://github.com/balakumaran-ks/DocuMind/issues",
    );
  });
});
