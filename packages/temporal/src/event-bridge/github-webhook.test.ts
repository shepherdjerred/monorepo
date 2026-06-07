import { describe, expect, it, mock } from "bun:test";
import { sign } from "@octokit/webhooks-methods";
import { buildWebhookApp, postWebhookStatus } from "./github-webhook.ts";
import type {
  CancelBuildkiteBuildsInput,
  PrAgentInput,
} from "#shared/schemas.ts";
import type { PostReviewOctokit } from "#activities/pr-review/post-github.ts";

const SECRET = "test-webhook-secret-do-not-use-anywhere";

const RESOLVED: Promise<void> = Promise.resolve();
const noopStart = (_input: PrAgentInput): Promise<void> => RESOLVED;
const noopStatus = (
  _input: PrAgentInput,
  _state: "draft_skipped",
): Promise<void> => RESOLVED;
const noopCancel = (_input: CancelBuildkiteBuildsInput): Promise<void> =>
  RESOLVED;

type StartCall = [PrAgentInput];
type StatusCall = [PrAgentInput, "draft_skipped"];
type CancelCall = [CancelBuildkiteBuildsInput];

function makePrInput(): PrAgentInput {
  return {
    kind: "review",
    owner: "shepherdjerred",
    repo: "monorepo",
    prNumber: 42,
    commitSha: "ab".repeat(20),
    baseRef: "main",
    headRef: "feature/foo",
    prTitle: "Add foo support",
    prAuthor: "alice",
  };
}

function makeStatusOctokit(calls: {
  createdBodies: string[];
  updateCommentIds: number[];
}): PostReviewOctokit {
  return {
    paginate: {
      iterator: async function* () {
        yield { data: [] };
      },
    },
    rest: {
      issues: {
        listComments: {},
        createComment: async (params) => {
          calls.createdBodies.push(params.body);
          return { data: { id: 1234 } };
        },
        updateComment: async (params) => {
          calls.updateCommentIds.push(params.comment_id);
          return { data: { id: params.comment_id } };
        },
      },
      pulls: {
        listReviewComments: {},
        createReview: async () => ({ data: { id: 5678 } }),
      },
    },
  };
}

function makeBaseEvent(
  overrides: Partial<{
    action: string;
    draft: boolean;
    merged: boolean;
    userType: string;
    number: number;
    headSha: string;
    authorLogin: string;
  }> = {},
): unknown {
  const action = overrides.action ?? "opened";
  return {
    action,
    pull_request: {
      number: overrides.number ?? 42,
      draft: overrides.draft ?? false,
      merged: overrides.merged ?? false,
      title: "Add foo support",
      base: { ref: "main", sha: "00".repeat(20) },
      head: { ref: "feature/foo", sha: overrides.headSha ?? "ab".repeat(20) },
      user: {
        login: overrides.authorLogin ?? "shepherdjerred",
        type: overrides.userType ?? "User",
      },
    },
    repository: {
      name: "monorepo",
      owner: { login: "shepherdjerred" },
    },
  };
}

async function postWebhook(
  app: ReturnType<typeof buildWebhookApp>,
  payload: unknown,
  opts: { event?: string; sign?: boolean; signature?: string } = {},
): Promise<Response> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": opts.event ?? "pull_request",
    "x-github-delivery": "test-delivery-id",
  };
  if (opts.signature !== undefined) {
    headers["x-hub-signature-256"] = opts.signature;
  } else if (opts.sign !== false) {
    headers["x-hub-signature-256"] = await sign(SECRET, body);
  }
  return app.fetch(
    new Request("http://test/webhook", { method: "POST", headers, body }),
  );
}

describe("postWebhookStatus", () => {
  it("posts draft-skipped status with a GitHub App installation token", async () => {
    const previousPostEnabled = Bun.env["PR_REVIEW_POST_ENABLED"];
    const previousGhToken = Bun.env["GH_TOKEN"];
    Bun.env["PR_REVIEW_POST_ENABLED"] = "true";
    Bun.env["GH_TOKEN"] = "";
    const tokens: string[] = [];
    const calls: { createdBodies: string[]; updateCommentIds: number[] } = {
      createdBodies: [],
      updateCommentIds: [],
    };

    try {
      await postWebhookStatus(makePrInput(), "draft_skipped", {
        createInstallationToken: async () => ({
          token: "github-app-installation-token",
          expiresAt: new Date(Date.now() + 60_000),
        }),
        createOctokit: (token) => {
          tokens.push(token);
          return makeStatusOctokit(calls);
        },
      });
    } finally {
      if (previousPostEnabled === undefined) {
        delete Bun.env["PR_REVIEW_POST_ENABLED"];
      } else {
        Bun.env["PR_REVIEW_POST_ENABLED"] = previousPostEnabled;
      }
      if (previousGhToken === undefined) {
        delete Bun.env["GH_TOKEN"];
      } else {
        Bun.env["GH_TOKEN"] = previousGhToken;
      }
    }

    expect(tokens).toEqual(["github-app-installation-token"]);
    expect(calls.createdBodies).toHaveLength(1);
    expect(calls.createdBodies[0]).toContain("draft");
  });
});

describe("buildWebhookApp", () => {
  it("returns 401 when X-Hub-Signature-256 is missing", async () => {
    const start = mock(noopStart);
    const app = buildWebhookApp(SECRET, start);
    const res = await postWebhook(app, makeBaseEvent(), { sign: false });
    expect(res.status).toBe(401);
    expect(start).not.toHaveBeenCalled();
  });

  it("returns 401 when the signature is wrong", async () => {
    const start = mock(noopStart);
    const app = buildWebhookApp(SECRET, start);
    const res = await postWebhook(app, makeBaseEvent(), {
      signature: "sha256=deadbeef",
    });
    expect(res.status).toBe(401);
    expect(start).not.toHaveBeenCalled();
  });

  it("starts both workflows when an opened PR is delivered", async () => {
    const calls: StartCall[] = [];
    const start = mock(async (input: PrAgentInput) => {
      calls.push([input]);
    });
    const app = buildWebhookApp(SECRET, start);
    const res = await postWebhook(app, makeBaseEvent());
    expect(res.status).toBe(200);
    // The handler delegates to `start` once per delivery; fan-out across
    // prReview / prSummary / prReviewPipeline happens inside the
    // implementation supplied to buildWebhookApp.
    expect(start).toHaveBeenCalledTimes(1);
    expect(calls.length).toBe(1);
    const firstCall = calls[0];
    if (firstCall === undefined) {
      throw new Error("expected one call");
    }
    const input = firstCall[0];
    expect(input.owner).toBe("shepherdjerred");
    expect(input.repo).toBe("monorepo");
    expect(input.prNumber).toBe(42);
    expect(input.headRef).toBe("feature/foo");
    expect(input.baseRef).toBe("main");
    expect(input.commitSha).toBe("ab".repeat(20));
    expect(input.prAuthor).toBe("shepherdjerred");
  });

  it("foundation: passes through fields the pr-review pipeline derives its id from", async () => {
    const calls: StartCall[] = [];
    const start = mock(async (input: PrAgentInput) => {
      calls.push([input]);
    });
    const app = buildWebhookApp(SECRET, start);
    const res = await postWebhook(
      app,
      makeBaseEvent({ number: 9001, headSha: "cd".repeat(20) }),
    );
    expect(res.status).toBe(200);
    const firstCall = calls[0];
    if (firstCall === undefined) {
      throw new Error("expected one call");
    }
    const input = firstCall[0];
    expect(input.prNumber).toBe(9001);
    expect(input.commitSha).toBe("cd".repeat(20));
    // The pipeline workflow id constructor lives in the production
    // start-workflows function; verify the inputs it relies on are
    // present and non-empty so callers can deterministically build it.
    expect(input.owner.length).toBeGreaterThan(0);
    expect(input.repo.length).toBeGreaterThan(0);
  });

  it("skips draft PRs unless action is ready_for_review", async () => {
    const start = mock(noopStart);
    const app = buildWebhookApp(SECRET, start);
    const res = await postWebhook(
      app,
      makeBaseEvent({ draft: true, action: "synchronize" }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("draft");
    expect(start).not.toHaveBeenCalled();
  });

  it("posts a visible draft-skipped status for draft PRs", async () => {
    const start = mock(noopStart);
    const statusCalls: StatusCall[] = [];
    const postStatus = mock(
      async (input: PrAgentInput, state: "draft_skipped") => {
        statusCalls.push([input, state]);
      },
    );
    const app = buildWebhookApp(SECRET, start, postStatus);
    const res = await postWebhook(
      app,
      makeBaseEvent({ draft: true, action: "synchronize" }),
    );
    expect(res.status).toBe(200);
    expect(start).not.toHaveBeenCalled();
    expect(postStatus).toHaveBeenCalledTimes(1);
    const call = statusCalls[0];
    if (call === undefined) {
      throw new Error("expected status call");
    }
    expect(call[0].prNumber).toBe(42);
    expect(call[1]).toBe("draft_skipped");
  });

  it("processes ready_for_review even when draft is true", async () => {
    const start = mock(noopStart);
    const app = buildWebhookApp(SECRET, start);
    const res = await postWebhook(
      app,
      makeBaseEvent({ draft: true, action: "ready_for_review" }),
    );
    expect(res.status).toBe(200);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("skips bot-authored PRs", async () => {
    const start = mock(noopStart);
    const app = buildWebhookApp(SECRET, start);
    const res = await postWebhook(
      app,
      makeBaseEvent({ userType: "Bot", authorLogin: "renovate[bot]" }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("bot");
    expect(start).not.toHaveBeenCalled();
  });

  it("skips PRs whose author is not the allowlisted owner", async () => {
    const start = mock(noopStart);
    const app = buildWebhookApp(SECRET, start);
    const res = await postWebhook(
      app,
      makeBaseEvent({ authorLogin: "mallory" }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("untrusted");
    expect(start).not.toHaveBeenCalled();
  });

  it("ignores non-pull_request events", async () => {
    const start = mock(noopStart);
    const app = buildWebhookApp(SECRET, start);
    const res = await postWebhook(app, { zen: "thing" }, { event: "ping" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("pong");
    expect(start).not.toHaveBeenCalled();
  });

  it("returns 500 when the workflow start function throws", async () => {
    const start = mock((_input: PrAgentInput): Promise<void> => {
      throw new Error("Temporal unavailable");
    });
    const app = buildWebhookApp(SECRET, start);
    const res = await postWebhook(app, makeBaseEvent());
    expect(res.status).toBe(500);
  });

  it("acks but skips all processing when PR_BOT_ENABLED=false", async () => {
    const previous = Bun.env["PR_BOT_ENABLED"];
    Bun.env["PR_BOT_ENABLED"] = "false";
    try {
      const start = mock(noopStart);
      const statusCalls: StatusCall[] = [];
      const postStatus = mock(
        async (input: PrAgentInput, state: "draft_skipped") => {
          statusCalls.push([input, state]);
        },
      );
      const app = buildWebhookApp(SECRET, start, postStatus);
      const res = await postWebhook(app, makeBaseEvent());
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("pr-bot disabled");
      expect(start).not.toHaveBeenCalled();
      expect(postStatus).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete Bun.env["PR_BOT_ENABLED"];
      } else {
        Bun.env["PR_BOT_ENABLED"] = previous;
      }
    }
  });
});

describe("buildWebhookApp PR closed", () => {
  it("starts the cancel workflow when a merged PR is closed", async () => {
    const cancelCalls: CancelCall[] = [];
    const start = mock(noopStart);
    const cancel = mock(async (input: CancelBuildkiteBuildsInput) => {
      cancelCalls.push([input]);
    });
    const app = buildWebhookApp(SECRET, start, noopStatus, cancel);
    const res = await postWebhook(
      app,
      makeBaseEvent({ action: "closed", merged: true }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("cancel started");
    // The review/summary start fn must NOT run for a closed PR.
    expect(start).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    const call = cancelCalls[0];
    if (call === undefined) {
      throw new Error("expected one cancel call");
    }
    const input = call[0];
    expect(input.owner).toBe("shepherdjerred");
    expect(input.repo).toBe("monorepo");
    expect(input.prNumber).toBe(42);
    expect(input.branch).toBe("feature/foo");
    expect(input.commitSha).toBe("ab".repeat(20));
    expect(input.merged).toBe(true);
  });

  it("starts the cancel workflow when a PR is closed without merging", async () => {
    const cancelCalls: CancelCall[] = [];
    const cancel = mock(async (input: CancelBuildkiteBuildsInput) => {
      cancelCalls.push([input]);
    });
    const app = buildWebhookApp(SECRET, mock(noopStart), noopStatus, cancel);
    const res = await postWebhook(
      app,
      makeBaseEvent({ action: "closed", merged: false }),
    );
    expect(res.status).toBe(200);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancelCalls[0]?.[0].merged).toBe(false);
  });

  it("cancels builds even for bot-authored closed PRs", async () => {
    const cancel = mock(noopCancel);
    const app = buildWebhookApp(SECRET, mock(noopStart), noopStatus, cancel);
    const res = await postWebhook(
      app,
      makeBaseEvent({
        action: "closed",
        merged: true,
        userType: "Bot",
        authorLogin: "renovate[bot]",
      }),
    );
    expect(res.status).toBe(200);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("does not start the cancel workflow for opened PRs", async () => {
    const cancel = mock(noopCancel);
    const start = mock(noopStart);
    const app = buildWebhookApp(SECRET, start, noopStatus, cancel);
    const res = await postWebhook(app, makeBaseEvent({ action: "opened" }));
    expect(res.status).toBe(200);
    expect(start).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("returns 500 when the cancel start function throws", async () => {
    const cancel = mock((_input: CancelBuildkiteBuildsInput): Promise<void> => {
      throw new Error("Temporal unavailable");
    });
    const app = buildWebhookApp(SECRET, mock(noopStart), noopStatus, cancel);
    const res = await postWebhook(
      app,
      makeBaseEvent({ action: "closed", merged: true }),
    );
    expect(res.status).toBe(500);
  });
});
