import { describe, expect, it, mock } from "bun:test";
import { sign } from "@octokit/webhooks-methods";
import { buildWebhookApp } from "./github-webhook.ts";
import type { CancelBuildkiteBuildsInput } from "#shared/schemas.ts";

const SECRET = "test-webhook-secret-do-not-use-anywhere";

const RESOLVED: Promise<void> = Promise.resolve();
const noopCancel = (_input: CancelBuildkiteBuildsInput): Promise<void> =>
  RESOLVED;
type ConflictMainArgs = { owner: string; repo: string; mainSha: string };
type ConflictPrArgs = {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  baseRef: string;
};
const noopConflictMain = (_args: ConflictMainArgs): Promise<void> => RESOLVED;
const noopConflictPr = (_args: ConflictPrArgs): Promise<void> => RESOLVED;

type CancelCall = [CancelBuildkiteBuildsInput];
type ConflictMainCall = [ConflictMainArgs];
type ConflictPrCall = [ConflictPrArgs];

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

describe("buildWebhookApp signature verification", () => {
  it("returns 401 when X-Hub-Signature-256 is missing", async () => {
    const startPr = mock(noopConflictPr);
    const app = buildWebhookApp(SECRET, { startConflictCheckPr: startPr });
    const res = await postWebhook(app, makeBaseEvent(), { sign: false });
    expect(res.status).toBe(401);
    expect(startPr).not.toHaveBeenCalled();
  });

  it("returns 401 when the signature is wrong", async () => {
    const startPr = mock(noopConflictPr);
    const app = buildWebhookApp(SECRET, { startConflictCheckPr: startPr });
    const res = await postWebhook(app, makeBaseEvent(), {
      signature: "sha256=deadbeef",
    });
    expect(res.status).toBe(401);
    expect(startPr).not.toHaveBeenCalled();
  });

  it("ignores non-pull_request events (ping)", async () => {
    const app = buildWebhookApp(SECRET);
    const res = await postWebhook(app, { zen: "thing" }, { event: "ping" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("pong");
  });
});

function makePushEvent(
  overrides: Partial<{ ref: string; after: string }> = {},
): unknown {
  return {
    ref: overrides.ref ?? "refs/heads/main",
    after: overrides.after ?? "ab".repeat(20),
    repository: {
      name: "monorepo",
      owner: { login: "shepherdjerred" },
    },
  };
}

describe("buildWebhookApp push to main", () => {
  it("starts the conflict-check workflow for a push to refs/heads/main", async () => {
    const calls: ConflictMainCall[] = [];
    const startMain = mock(async (args: ConflictMainArgs) => {
      calls.push([args]);
    });
    const app = buildWebhookApp(SECRET, {
      startConflictCheckMain: startMain,
    });
    const res = await postWebhook(app, makePushEvent(), { event: "push" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("started");
    expect(startMain).toHaveBeenCalledTimes(1);
    const call = calls[0];
    if (call === undefined) {
      throw new Error("expected one call");
    }
    expect(call[0].owner).toBe("shepherdjerred");
    expect(call[0].repo).toBe("monorepo");
    expect(call[0].mainSha).toBe("ab".repeat(20));
  });

  it("ignores pushes to refs that are not main", async () => {
    const startMain = mock(noopConflictMain);
    const app = buildWebhookApp(SECRET, {
      startConflictCheckMain: startMain,
    });
    const res = await postWebhook(
      app,
      makePushEvent({ ref: "refs/heads/feature/x" }),
      { event: "push" },
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("non-main");
    expect(startMain).not.toHaveBeenCalled();
  });

  it("returns 401 when a push has a bad signature", async () => {
    const startMain = mock(noopConflictMain);
    const app = buildWebhookApp(SECRET, {
      startConflictCheckMain: startMain,
    });
    const res = await postWebhook(app, makePushEvent(), {
      event: "push",
      signature: "sha256=deadbeef",
    });
    expect(res.status).toBe(401);
    expect(startMain).not.toHaveBeenCalled();
  });

  it("returns 500 when the conflict-check start function throws", async () => {
    const startMain = mock((_args: ConflictMainArgs): Promise<void> => {
      throw new Error("Temporal unavailable");
    });
    const app = buildWebhookApp(SECRET, {
      startConflictCheckMain: startMain,
    });
    const res = await postWebhook(app, makePushEvent(), { event: "push" });
    expect(res.status).toBe(500);
  });
});

describe("buildWebhookApp per-PR conflict check", () => {
  it("starts the per-PR conflict check on opened", async () => {
    const calls: ConflictPrCall[] = [];
    const startPr = mock(async (args: ConflictPrArgs) => {
      calls.push([args]);
    });
    const app = buildWebhookApp(SECRET, { startConflictCheckPr: startPr });
    const res = await postWebhook(app, makeBaseEvent({ action: "opened" }));
    expect(res.status).toBe(200);
    expect(startPr).toHaveBeenCalledTimes(1);
    const call = calls[0];
    if (call === undefined) {
      throw new Error("expected one call");
    }
    expect(call[0].prNumber).toBe(42);
    expect(call[0].headSha).toBe("ab".repeat(20));
    expect(call[0].baseRef).toBe("main");
  });

  it("starts the per-PR conflict check on synchronize", async () => {
    const startPr = mock(noopConflictPr);
    const app = buildWebhookApp(SECRET, { startConflictCheckPr: startPr });
    const res = await postWebhook(
      app,
      makeBaseEvent({ action: "synchronize" }),
    );
    expect(res.status).toBe(200);
    expect(startPr).toHaveBeenCalledTimes(1);
  });

  it("starts the per-PR conflict check on edited (covers base-ref changes)", async () => {
    const startPr = mock(noopConflictPr);
    const app = buildWebhookApp(SECRET, { startConflictCheckPr: startPr });
    const res = await postWebhook(app, makeBaseEvent({ action: "edited" }));
    expect(res.status).toBe(200);
    expect(startPr).toHaveBeenCalledTimes(1);
  });

  it("starts the per-PR conflict check even for draft PRs", async () => {
    // Drafts can still conflict with main — paint the status regardless.
    const startPr = mock(noopConflictPr);
    const app = buildWebhookApp(SECRET, { startConflictCheckPr: startPr });
    const res = await postWebhook(
      app,
      makeBaseEvent({ action: "synchronize", draft: true }),
    );
    expect(res.status).toBe(200);
    expect(startPr).toHaveBeenCalledTimes(1);
  });

  it("starts the per-PR conflict check even for bot-authored PRs (Renovate etc.)", async () => {
    const startPr = mock(noopConflictPr);
    const app = buildWebhookApp(SECRET, { startConflictCheckPr: startPr });
    const res = await postWebhook(
      app,
      makeBaseEvent({
        action: "synchronize",
        userType: "Bot",
        authorLogin: "renovate[bot]",
      }),
    );
    expect(res.status).toBe(200);
    expect(startPr).toHaveBeenCalledTimes(1);
  });

  it("does NOT start the per-PR conflict check for closed PRs", async () => {
    const startPr = mock(noopConflictPr);
    const app = buildWebhookApp(SECRET, { startConflictCheckPr: startPr });
    const res = await postWebhook(
      app,
      makeBaseEvent({ action: "closed", merged: true }),
    );
    expect(res.status).toBe(200);
    expect(startPr).not.toHaveBeenCalled();
  });

  it("does NOT fail the webhook delivery when conflict-check start throws", async () => {
    const startPr = mock((_args: ConflictPrArgs): Promise<void> => {
      throw new Error("Temporal unavailable");
    });
    const app = buildWebhookApp(SECRET, { startConflictCheckPr: startPr });
    const res = await postWebhook(app, makeBaseEvent({ action: "opened" }));
    // The failure is captured to Sentry, not surfaced to GitHub.
    expect(res.status).toBe(200);
    expect(startPr).toHaveBeenCalledTimes(1);
  });
});

describe("buildWebhookApp PR closed", () => {
  it("starts the cancel workflow when a merged PR is closed", async () => {
    const cancelCalls: CancelCall[] = [];
    const cancel = mock(async (input: CancelBuildkiteBuildsInput) => {
      cancelCalls.push([input]);
    });
    const app = buildWebhookApp(SECRET, { startCancel: cancel });
    const res = await postWebhook(
      app,
      makeBaseEvent({ action: "closed", merged: true }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("cancel started");
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
    const app = buildWebhookApp(SECRET, { startCancel: cancel });
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
    const app = buildWebhookApp(SECRET, { startCancel: cancel });
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
    const app = buildWebhookApp(SECRET, { startCancel: cancel });
    const res = await postWebhook(app, makeBaseEvent({ action: "opened" }));
    expect(res.status).toBe(200);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("returns 500 when the cancel start function throws", async () => {
    const cancel = mock((_input: CancelBuildkiteBuildsInput): Promise<void> => {
      throw new Error("Temporal unavailable");
    });
    const app = buildWebhookApp(SECRET, { startCancel: cancel });
    const res = await postWebhook(
      app,
      makeBaseEvent({ action: "closed", merged: true }),
    );
    expect(res.status).toBe(500);
  });
});
