import { describe, expect, it } from "vitest";
import { buildLatestAiInterventionDigest } from "@/lib/ai/intervention-digest";

describe("latest AI intervention digest", () => {
  it("summarizes long AI interventions instead of copying the full response", () => {
    const longOriginal = [
      "AI summary: The team discussed the launch decision in detail.",
      "- Risk: privacy review is still unresolved and needs a named owner.",
      "- Action item: compare the evidence table before approving release.",
      "FULL ORIGINAL BLOCK ".repeat(80),
    ].join("\n\n");

    const digest = buildLatestAiInterventionDigest({
      message: longOriginal,
      aiTask: "summarizeDiscussion",
    }, "en");

    expect(digest.markdown.length < longOriginal.length).toBe(true);
    expect(digest.markdown).toContain("What AI did");
    expect(digest.markdown).toContain("Risk: privacy review");
    expect(digest.markdown).not.toContain("FULL ORIGINAL BLOCK FULL ORIGINAL BLOCK FULL ORIGINAL BLOCK FULL ORIGINAL BLOCK");
    expect(digest.isTruncated).toBe(true);
  });

  it("explains normal conversation replies separately from graph or summary results", () => {
    const digest = buildLatestAiInterventionDigest({
      message: "I recommend turning the strongest point into an action item and asking one follow-up question about the missing evidence.",
    }, "en");

    expect(digest.markdown).toContain("normal AI reply");
    expect(digest.markdown).toContain("not automatically a graph or summary result");
  });
});
