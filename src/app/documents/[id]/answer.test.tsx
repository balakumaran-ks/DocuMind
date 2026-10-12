import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REFUSAL, REFUSAL_ACROSS } from "@/lib/rag/prompt";
import { Answer } from "./answer";

afterEach(cleanup);

function setup(content: string, citedPages: number[], streaming = false) {
  const onOpenPage = vi.fn();
  render(
    <Answer
      content={content}
      citations={citedPages.map((pageNumber) => ({ pageNumber }))}
      streaming={streaming}
      onOpenPage={onOpenPage}
    />,
  );
  return { onOpenPage, user: userEvent.setup() };
}

const pageButtons = () => screen.queryAllByRole("button", { name: /open page/i });

describe("Answer — citations", () => {
  it("turns each validated [p. N] marker into a button that opens that page", async () => {
    const { onOpenPage, user } = setup("Fees are due monthly [p. 2]. Late fees apply [p. 7].", [2, 7]);

    expect(pageButtons().map((b) => b.textContent)).toEqual(["p. 2", "p. 7"]);
    await user.click(screen.getByRole("button", { name: "Open page 7" }));
    expect(onOpenPage).toHaveBeenCalledWith(7);
  });

  it("keeps the text around markers intact, replacing only the brackets with the button", () => {
    setup("Fees are due monthly [p. 2].", [2]);
    expect(document.body.textContent).toContain("Fees are due monthly p. 2.");
  });

  it("splits a multi-page marker into one button per page", () => {
    setup("Both rules apply [p. 3, 7].", [3, 7]);
    expect(pageButtons().map((b) => b.textContent)).toEqual(["p. 3", "p. 7"]);
  });

  it("shows pages that failed validation as plain text, not buttons", () => {
    setup("Real [p. 3]. Invented [p. 12]. Mixed [p. 3, 9].", [3]);

    expect(pageButtons().map((b) => b.textContent)).toEqual(["p. 3", "p. 3"]);
    const invented = screen.getByText("p. 12");
    expect(invented.tagName).not.toBe("BUTTON");
    expect(invented.getAttribute("title")).toMatch(/not.*retrieved/i);
    expect(screen.getByText("p. 9").tagName).not.toBe("BUTTON");
  });

  it("renders a button for every repeated citation of the same page", () => {
    setup("A [p. 2]. B [p. 2].", [2]);
    expect(pageButtons()).toHaveLength(2);
  });

  it("leaves malformed markers as written", () => {
    setup("See [p. 1-3] and [page 2].", [1, 2, 3]);
    expect(pageButtons()).toHaveLength(0);
    expect(document.body.textContent).toContain("See [p. 1-3] and [page 2].");
  });

  it("shows plain text with no buttons while the answer is still streaming", () => {
    setup("Fees are due monthly [p. 2", [], true);
    expect(pageButtons()).toHaveLength(0);
    expect(document.body.textContent).toContain("Fees are due monthly [p. 2");
  });

  it("keeps line breaks from the answer", () => {
    setup("First line.\nSecond line [p. 1].", [1]);
    expect(screen.getByText(/First line\./).className).toMatch(/whitespace-pre-wrap/);
  });
});

describe("Answer — refusal", () => {
  it("marks the refusal sentence as 'Not in this document'", () => {
    setup(REFUSAL, []);
    expect(screen.getByText("Not in this document")).toBeTruthy();
    expect(document.body.textContent).toContain(REFUSAL);
  });

  it("does not mark an ordinary answer as a refusal", () => {
    setup("Fees are due monthly [p. 2].", [2]);
    expect(screen.queryByText("Not in this document")).toBeNull();
  });

  it("recognises the refusal with surrounding whitespace", () => {
    setup(`  ${REFUSAL}\n`, []);
    expect(screen.getByText("Not in this document")).toBeTruthy();
  });

  it("leaves lettered markers as written in a single-document answer", () => {
    setup("Monthly [A p. 2].", [2]);
    expect(pageButtons()).toEqual([]);
    expect(document.body.textContent).toContain("[A p. 2]");
  });
});

describe("Answer — across documents", () => {
  const documents = [
    { id: "6ac68534ae92936b3b5a0515", filename: "handbook.pdf" },
    { id: "6ac7025ed3d5f6ed7fd8be94", filename: "policy.pdf" },
  ];
  const [handbook, policy] = documents.map((d) => d.id);

  function setupAcross(content: string, citations: { documentId?: string; pageNumber: number }[]) {
    const onOpenPage = vi.fn();
    render(<Answer content={content} citations={citations} streaming={false} onOpenPage={onOpenPage} documents={documents} />);
    return { onOpenPage, user: userEvent.setup() };
  }

  it("turns validated lettered markers into buttons that open that document's page, naming it", async () => {
    const { onOpenPage, user } = setupAcross("Monthly [A p. 2]. Refunds [B p. 4, 5].", [
      { documentId: handbook, pageNumber: 2 },
      { documentId: policy, pageNumber: 4 },
      { documentId: policy, pageNumber: 5 },
    ]);

    expect(pageButtons().map((b) => b.textContent)).toEqual(["A p. 2", "B p. 4", "B p. 5"]);
    const button = screen.getByRole("button", { name: "Open page 4 of policy.pdf" });
    expect(button.getAttribute("title")).toBe("policy.pdf");
    await user.click(button);
    expect(onOpenPage).toHaveBeenCalledWith(4, policy);
  });

  it("strikes through a page validated for a different document, unlettered markers and unknown letters", () => {
    setupAcross("X [B p. 2]. Y [p. 2]. Z [C p. 2].", [{ documentId: handbook, pageNumber: 2 }]);
    expect(pageButtons()).toEqual([]);
    expect(screen.getByText("B p. 2").className).toMatch(/line-through/);
    expect(screen.getByText("p. 2").className).toMatch(/line-through/);
    expect(screen.getByText("C p. 2").className).toMatch(/line-through/);
  });

  it("marks the cross-document refusal as 'Not in these documents'", () => {
    setupAcross(REFUSAL_ACROSS, []);
    expect(screen.getByText("Not in these documents")).toBeTruthy();
  });
});
