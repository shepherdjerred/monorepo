import { describe, expect, it, mock } from "bun:test";
import { sign } from "@octokit/webhooks-methods";
import { buildWebhookApp } from "./github-webhook.ts";
import type { PrAgentInput } from "#shared/schemas.ts";

const SECRET = "test-webhook-secret-do-not-use-anywhere";

const RESOLVED: Promise<void> = Promise.resolve();
const noopStart = (_input: PrAgentInput): Promise<void> => RESOLVED;

type StartCall = [PrAgentInput];

function makeBaseEvent(
  overrides: Partial<{
    action: string;
    draft: boolean;
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
      title: "Add foo support",
      base: { ref: "main", sha: "00".repeat(20) },
      head: { ref: "feature/foo", sha: overrides.headSha ?? "ab".repeat(20) },
      user: {
        login: overrides.authorLogin ?? "alice",
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
    expect(input.prAuthor).toBe("alice");
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

  it("skips irrelevant actions like closed", async () => {
    const start = mock(noopStart);
    const app = buildWebhookApp(SECRET, start);
    const res = await postWebhook(app, makeBaseEvent({ action: "closed" }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("ignored");
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
});
