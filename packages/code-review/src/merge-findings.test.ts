import { describe, expect, test } from "bun:test";
import { mergeDuplicateFindings } from "./merge-findings.ts";
import { codexProvider } from "./providers/codex.ts";
import {
  markQodoFindingResolved,
  parseQodoFindingTitle,
  QODO_RESOLVED_CHIP,
  qodoFindingKey,
  qodoProvider,
} from "./providers/qodo.ts";
import type { ReviewThread } from "./types.ts";

describe("mergeDuplicateFindings", () => {
  // Qodo posts every finding twice: once inside its persistent review comment
  // and once as an addressable thread on the offending line. These are the two
  // renderings of ONE finding from PR #2095, kept verbatim — the ordinals
  // differ (4 vs 1), the capitalization differs, and only the thread carries a
  // Markdown-escaped `\.`. That is exactly what the key has to see through.
  const fromComment: ReviewThread = {
    authorLogin: "qodo-code-review",
    isResolved: false,
    isOutdated: false,
    path: "packages/streambot/src/session/destroy-session.ts",
    line: null,
    url: "https://github.com/o/r/pull/2095/files#diff-abc",
    priority: 1,
    title: "Turn outlives session destroy",
    threadId: null,
    commentId: 5_236_306_054,
  };
  const fromThread: ReviewThread = {
    authorLogin: "qodo-code-review",
    isResolved: false,
    isOutdated: false,
    path: "packages/streambot/src/session/destroy-session.ts",
    line: 10,
    url: "https://github.com/o/r/pull/2095#discussion_r1",
    priority: 1,
    title: "Turn outlives session destroy",
    threadId: "PRRT_kwDOHf4r4c6ZlJlJ",
    commentId: null,
  };

  test("counts one finding rendered on both surfaces once", () => {
    const merged = mergeDuplicateFindings(
      [fromComment, fromThread],
      qodoProvider,
    );
    expect(merged).toHaveLength(1);
  });

  test("keeps both handles so either surface can be acted on", () => {
    const [merged] = mergeDuplicateFindings(
      [fromComment, fromThread],
      qodoProvider,
    );
    expect(merged?.threadId).toBe("PRRT_kwDOHf4r4c6ZlJlJ");
    expect(merged?.commentId).toBe(5_236_306_054);
    // The thread knows the line; the comment copy does not.
    expect(merged?.line).toBe(10);
  });

  test("resolves the finding when only the thread copy is resolved", () => {
    const merged = mergeDuplicateFindings(
      [fromComment, { ...fromThread, isResolved: true }],
      qodoProvider,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.isResolved).toBe(true);
  });

  test("resolves the finding when only the comment copy is chipped", () => {
    const merged = mergeDuplicateFindings(
      [{ ...fromComment, isResolved: true }, fromThread],
      qodoProvider,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.isResolved).toBe(true);
  });

  test("does not let an outdated resolved copy resolve a live finding", () => {
    // The gate blocks on `!isResolved && !isOutdated`, so taking resolution
    // from the outdated copy while the current copy keeps the finding current
    // produced a merged finding that was neither — and passed the gate on a
    // finding nobody had dealt with.
    for (const order of [
      [fromComment, { ...fromThread, isOutdated: true, isResolved: true }],
      [{ ...fromThread, isOutdated: true, isResolved: true }, fromComment],
    ]) {
      const merged = mergeDuplicateFindings(order, qodoProvider);
      expect(merged).toHaveLength(1);
      expect(merged[0]?.isResolved).toBe(false);
      expect(merged[0]?.isOutdated).toBe(false);
    }
  });

  test("reports an all-outdated finding's resolution from its outdated copies", () => {
    const merged = mergeDuplicateFindings(
      [
        { ...fromComment, isOutdated: true },
        { ...fromThread, isOutdated: true, isResolved: true },
      ],
      qodoProvider,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.isOutdated).toBe(true);
    expect(merged[0]?.isResolved).toBe(true);
  });

  test("does not mutate its input", () => {
    const input = [{ ...fromComment, isResolved: true }, { ...fromThread }];
    mergeDuplicateFindings(input, qodoProvider);
    expect(input[1]?.isResolved).toBe(false);
  });

  test("takes the more severe priority when the surfaces disagree", () => {
    const merged = mergeDuplicateFindings(
      [{ ...fromComment, priority: 2 }, fromThread],
      qodoProvider,
    );
    expect(merged[0]?.priority).toBe(1);
  });

  test("keeps findings in different files apart despite an identical title", () => {
    const elsewhere = {
      ...fromThread,
      path: "packages/streambot/src/other.ts",
    };
    expect(
      mergeDuplicateFindings([fromComment, elsewhere], qodoProvider),
    ).toHaveLength(2);
  });

  test("never merges a finding it cannot identify", () => {
    // A null key means "cannot identify this one". Two unidentifiable findings
    // must stay two, or an unparseable finding would silently disappear into
    // another one and stop blocking.
    const untitled = { ...fromThread, title: null };
    expect(
      mergeDuplicateFindings([untitled, { ...untitled }], qodoProvider),
    ).toHaveLength(2);
  });

  test("never merges another reviewer's thread into a provider finding", () => {
    // A second reviewer on the same PR can render a matching headline on the
    // same file. Folding it into the provider's finding would stop it being
    // counted at all.
    const otherReviewer = {
      ...fromThread,
      authorLogin: "chatgpt-codex-connector",
      isResolved: true,
    };
    const merged = mergeDuplicateFindings(
      [fromComment, otherReviewer],
      qodoProvider,
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((t) => t.commentId === 5_236_306_054)?.isResolved).toBe(
      false,
    );
  });

  test("leaves providers that post each finding once untouched", () => {
    const threads = [fromComment, fromThread];
    expect(mergeDuplicateFindings(threads, codexProvider)).toHaveLength(2);
  });
});

describe("parseQodoFindingTitle", () => {
  // Verbatim from PR #2095, thread PRRT_kwDOHf4r4c6ZlJlJ.
  const threadBody = [
    '<img src="https://img.shields.io/badge/High-634FD1?style=flat-square" height="20px" alt="Action required">',
    "",
    String.raw`1\. Turn outlives session destroy <code>🐞 Bug</code> <code>☼ Reliability</code>`,
    "",
    "<pre>",
    "destroySession() closes the voice assistant but does not await completion",
    "</pre>",
  ].join("\n");

  test("reads the title past the badge, the ordinal, and the category chips", () => {
    expect(parseQodoFindingTitle(threadBody)).toBe(
      "Turn outlives session destroy",
    );
  });

  test("gives a thread and its review-comment twin the same key", () => {
    const base = {
      authorLogin: "qodo-code-review",
      isResolved: false,
      isOutdated: false,
      path: "packages/discord-video-stream/src/client/Streamer.ts",
      line: null,
      url: null,
      priority: 1,
      threadId: null,
      commentId: null,
    };
    // The comment says "joinVoice"; the thread says "Joinvoice".
    expect(
      qodoFindingKey({ ...base, title: "joinVoice can hang forever" }),
    ).toBe(qodoFindingKey({ ...base, title: "Joinvoice can hang forever" }));
  });

  test("keys a finding with a string that survives a process argument", () => {
    const base = {
      authorLogin: "qodo-code-review",
      isResolved: false,
      isOutdated: false,
      line: null,
      url: null,
      priority: 1,
      threadId: null,
      commentId: null,
    };
    // `toolkit pr review list` prints the key and `resolve --finding <key>`
    // matches it back by equality, so a control character in the key puts the
    // finding out of reach of the command built to clear it.
    const key = qodoFindingKey({ ...base, path: "a b/c.ts", title: "Boom" });
    expect(key).not.toBeNull();
    expect(key).not.toMatch(/\p{Cc}/u);
    // Escaping the path keeps the space separator unambiguous, so a path that
    // contains one cannot collide with a different path plus a longer title.
    expect(qodoFindingKey({ ...base, path: "a b", title: "c" })).not.toBe(
      qodoFindingKey({ ...base, path: "a", title: "b c" }),
    );
  });

  test("reads the title of a finding Qodo has struck as resolved", () => {
    // Verbatim from PR #2095 after its thread was resolved: Qodo wraps the
    // whole title in <s>, so the line no longer opens with the ordinal.
    const struck = [
      '<img src="https://img.shields.io/badge/High-634FD1?style=flat-square" height="20px" alt="Action required">',
      "",
      String.raw`<s>1\. Joinvoice can hang forever</s> <code>🐞 Bug</code> <code>☼ Reliability</code>`,
      "",
      "<pre><s>",
      "Streamer.joinVoice() now calls setAudioPacketizer() inside the ready callback",
      "</s></pre>",
    ].join("\n");
    expect(parseQodoFindingTitle(struck)).toBe("Joinvoice can hang forever");
  });

  test("returns null when no numbered title line exists", () => {
    expect(parseQodoFindingTitle("just prose, no finding here")).toBeNull();
    expect(parseQodoFindingTitle(null)).toBeNull();
  });
});

describe("markQodoFindingResolved", () => {
  // Both sections carry the SAME finding, unstruck. Qodo re-appends its
  // previous results below the fold marker and the parser reads only what is
  // above it, so a chip written below would change nothing while rewriting
  // what the provider recorded.
  const body = [
    "<h3>Code Review by Qodo</h3>",
    '<img alt="Action required">',
    "<details>",
    "<summary>  1. Turn outlives session destroy <code>🐞 Bug</code></summary>",
    "</details>",
    "<!-- FOLDED_SECTION_START -->",
    "<details>",
    "<summary>  1. Turn outlives session destroy <code>🐞 Bug</code></summary>",
    "</details>",
  ].join("\n");

  test("chips the finding in the current review", () => {
    const edited = markQodoFindingResolved(
      body,
      "Turn outlives session destroy",
    );
    if (edited === null) throw new Error("expected an edit");
    expect(edited).toContain(QODO_RESOLVED_CHIP);
  });

  test("never edits Qodo's archive of previous results", () => {
    const edited = markQodoFindingResolved(
      body,
      "Turn outlives session destroy",
    );
    if (edited === null) throw new Error("expected an edit");
    const fold = edited.indexOf("<!-- FOLDED_SECTION_START -->");
    expect(edited.slice(fold)).toBe(
      body.slice(body.indexOf("<!-- FOLDED_SECTION_START -->")),
    );
    // Exactly one chip: the archived copy of the same finding is untouched.
    expect(edited.split(QODO_RESOLVED_CHIP)).toHaveLength(2);
  });

  test("a chipped finding reads back as resolved", () => {
    // The whole point: the writer's output must satisfy the reader.
    const edited = markQodoFindingResolved(
      body,
      "Turn outlives session destroy",
    );
    if (edited === null) throw new Error("expected an edit");
    expect(edited).toContain("☑");
  });

  test("is idempotent", () => {
    const once = markQodoFindingResolved(body, "Turn outlives session destroy");
    if (once === null) throw new Error("expected an edit");
    const twice = markQodoFindingResolved(
      once,
      "Turn outlives session destroy",
    );
    expect(twice).toBe(once);
  });

  test("leaves a finding Qodo already struck alone", () => {
    const struck = body.replace(
      "  1. Turn outlives session destroy <code>🐞 Bug</code>",
      "<s>  1. Turn outlives session destroy</s> <code>🐞 Bug</code>",
    );
    const result = markQodoFindingResolved(
      struck,
      "Turn outlives session destroy",
    );
    expect(result).toBe(struck);
  });

  test("reports a title it cannot find rather than succeeding at nothing", () => {
    expect(markQodoFindingResolved(body, "No such finding")).toBeNull();
  });
});
