import { describe, expect, test } from "vitest";
import {
  carries,
  commentWasSaved,
  issueWasCreated,
  mayStillLand,
  settlePending,
  textWasSaved,
  type Pending,
} from "./pending-drafts.ts";

const sentAt = Date.parse("2026-11-10T12:00:00.000Z");
const at = (secondsAfterSend: number) =>
  new Date(sentAt + secondsAfterSend * 1000).toISOString();
function pending(overrides: Partial<Pending> = {}): Pending {
  return {
    kind: "comment",
    subject: "AI-1",
    text: "Looks right to me",
    attachments: [],
    sentAt,
    ...overrides,
  };
}
const me = { key: "human:jerred" };
const other = { key: "agent:helper" };

const issue = (
  comments: Parameters<typeof commentWasSaved>[1]["comments"],
  events: { requestId: string }[] = [],
) => ({ actorKey: me.key, comments, events });
const recent = (issues: Parameters<typeof issueWasCreated>[1]["issues"]) => ({
  actorKey: me.key,
  issues,
});

describe("a pending comment", () => {
  test("was saved when this actor has the same body from the send on", () => {
    expect(
      commentWasSaved(
        pending(),
        issue([{ author: me, body: "Looks right to me", createdAt: at(1) }]),
      ),
    ).toBe(true);
    // The server's clock may trail this device's a little.
    expect(
      commentWasSaved(
        pending(),
        issue([{ author: me, body: "Looks right to me", createdAt: at(-30) }]),
      ),
    ).toBe(true);
    // The server stores a comment trimmed.
    expect(
      commentWasSaved(
        pending({ text: "  Looks right to me\n" }),
        issue([{ author: me, body: "Looks right to me", createdAt: at(1) }]),
      ),
    ).toBe(true);
  });

  test("was not saved by an older, another actor's or a different comment", () => {
    expect(
      commentWasSaved(
        pending(),
        issue([
          { author: me, body: "Looks right to me", createdAt: at(-3600) },
          { author: other, body: "Looks right to me", createdAt: at(1) },
          { author: me, body: "Looks wrong to me", createdAt: at(1) },
        ]),
      ),
    ).toBe(false);
    expect(commentWasSaved(pending(), issue([]))).toBe(false);
  });

  test("was saved when the issue's history names its request", () => {
    expect(
      commentWasSaved(
        pending({ requestId: "request-1" }),
        issue([], [{ requestId: "request-0" }, { requestId: "request-1" }]),
      ),
    ).toBe(true);
    // A send that never got a request ID matches no event.
    expect(
      commentWasSaved(pending(), issue([], [{ requestId: "request-1" }])),
    ).toBe(false);
  });
});

describe("a pending edit", () => {
  test("a description was saved when the server holds exactly that text", () => {
    const sent = pending({ kind: "description", text: "New words\n" });
    expect(textWasSaved(sent, "New words\n")).toBe(true);
    expect(textWasSaved(sent, "New words")).toBe(false);
    expect(textWasSaved(sent, "Old words")).toBe(false);
  });

  test("a comment edit was saved when the comment holds that text, trimmed", () => {
    const sent = pending({ kind: "comment-edit", text: " Reworded " });
    expect(textWasSaved(sent, "Reworded")).toBe(true);
    expect(textWasSaved(sent, "Original")).toBe(false);
  });
});

describe("a pending new issue", () => {
  const title = pending({ kind: "new-issue-title", text: "Fix the build" });

  test("was created when this actor has that title from the send on", () => {
    expect(
      issueWasCreated(
        title,
        recent([{ creator: me, title: "Fix the build", createdAt: at(2) }]),
      ),
    ).toBe(true);
  });

  test("was not created by an older or another actor's issue of that title", () => {
    expect(
      issueWasCreated(
        title,
        recent([
          { creator: me, title: "Fix the build", createdAt: at(-3600) },
          { creator: other, title: "Fix the build", createdAt: at(2) },
          { creator: me, title: "Fix the tests", createdAt: at(2) },
        ]),
      ),
    ).toBe(false);
  });

  test("its description follows the title it was sent with", () => {
    const description = pending({
      kind: "new-issue-description",
      subject: "Fix the build",
      text: "It fails on main.",
    });
    expect(
      issueWasCreated(
        description,
        recent([{ creator: me, title: "Fix the build", createdAt: at(2) }]),
      ),
    ).toBe(true);
    expect(
      issueWasCreated(
        description,
        recent([{ creator: me, title: "It fails on main.", createdAt: at(2) }]),
      ),
    ).toBe(false);
  });
});

describe("settling a pending send", () => {
  test("saved text is dropped, even while a recent send is given time", () => {
    expect(settlePending(true, false)).toBe("drop");
    expect(settlePending(true, true)).toBe("drop");
  });

  test("nothing is decided before the server's copy has loaded", () => {
    expect(settlePending(undefined, false)).toBe("wait");
  });

  test("unsaved text waits while the send may still land, then comes back", () => {
    expect(settlePending(false, true)).toBe("wait");
    expect(settlePending(false, false)).toBe("restore");
    expect(mayStillLand(pending(), sentAt + 500)).toBe(true);
    expect(mayStillLand(pending(), sentAt + 60_000)).toBe(false);
  });
});

describe("recognising the request that carries a pending send", () => {
  test("each kind matches its own procedure, subject and text", () => {
    expect(
      carries(pending({ kind: "comment-edit", subject: "comment-9" }), {
        path: "comments.update",
        input: { id: "comment-9", body: "Looks right to me" },
      }),
    ).toBe(true);
    expect(
      carries(pending({ kind: "description" }), {
        path: "issues.update",
        input: { identifier: "AI-1", description: "Looks right to me" },
      }),
    ).toBe(true);
    // A status change to the same issue is not the description being saved.
    expect(
      carries(pending({ kind: "description" }), {
        path: "issues.update",
        input: { identifier: "AI-1", stateName: "Done" },
      }),
    ).toBe(false);
    expect(
      carries(pending({ kind: "new-issue-title", text: "Fix the build" }), {
        path: "issues.create",
        input: { teamKey: "AI", title: "Fix the build" },
      }),
    ).toBe(true);
    expect(
      carries(pending({ kind: "comment" }), {
        path: "comments.create",
        input: undefined,
      }),
    ).toBe(false);
  });
});
