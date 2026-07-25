import { describe, expect, test } from "bun:test";

import { moveDocumentInList } from "./cache.ts";
import { DocumentListResponseSchema } from "#shared/schema";

const LIST = DocumentListResponseSchema.parse({
  repository: {
    root: "/repo",
    branch: "feature/docs-kanban",
    dirty: false,
    actor: "Reviewer",
  },
  documents: [
    {
      id: "plan-one",
      path: "plans/one.md",
      title: "One",
      type: "plan",
      status: "in-progress",
      board: true,
      verification: "human",
      disposition: "active",
      remainingCount: 0,
      hasHumanVerification: true,
      commentCount: 0,
      lastActivity: null,
      revision: "revision-one",
    },
    {
      id: "plan-two",
      path: "plans/two.md",
      title: "Two",
      type: "plan",
      status: "planned",
      board: true,
      verification: "agent",
      disposition: "active",
      remainingCount: 1,
      hasHumanVerification: false,
      commentCount: 0,
      lastActivity: null,
      revision: "revision-two",
    },
  ],
  invalidDocuments: [],
});

describe("React Query cache updates", () => {
  test("optimistically moves only the selected document", () => {
    const updated = moveDocumentInList(LIST, "plan-one", "awaiting-human");

    expect(updated.documents.map((document) => document.status)).toEqual([
      "awaiting-human",
      "planned",
    ]);
    expect(updated.repository).toEqual(LIST.repository);
    expect(LIST.documents[0]?.status).toBe("in-progress");
  });
});
