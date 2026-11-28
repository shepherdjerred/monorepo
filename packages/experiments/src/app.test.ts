import { expect, it } from "vitest";
import {
  createInternalExperimentApp,
  createPublicExperimentApp,
} from "./app.ts";
import {
  EXPERIMENTS_API_PATH,
  EXPERIMENTS_MAX_BODY_BYTES,
  EXPERIMENTS_OPERATOR_HEADER,
  EXPERIMENTS_REVIEW_SUMMARY_PATH,
  ExperimentListSchema,
  ExperimentSchema,
} from "./contract.ts";
import { createMemoryExperimentStore } from "./store.ts";

const operator = "local-operator";
const machineHeaders = {
  authorization: "Bearer toolkit-test",
  "content-type": "application/json",
};
const completePlan = {
  change: "Optimize CLI status reads",
  hypothesis: "Commands respond faster",
  scope: "Toolkit maintenance jobs",
  successCriteria: "Less waiting for first status",
  measurementMethod: "Compare command timing",
};

async function status(request: Response | Promise<Response>): Promise<number> {
  const response = await request;
  return response.status;
}

async function body(request: Response | Promise<Response>): Promise<unknown> {
  const response = await request;
  return response.json();
}

async function result(request: Response | Promise<Response>) {
  return ExperimentSchema.parse(await body(request));
}

function fixture() {
  const store = createMemoryExperimentStore();
  let now = new Date("2026-11-27T07:59:00.000Z");
  const opts = { store, now: () => now };
  const publicApp = createPublicExperimentApp({
    ...opts,
    verifyOperator: () =>
      Promise.resolve({ status: 401, error: "Untrusted peer" }),
    peerAddress: () => null,
    machineToken: "toolkit-test",
  });
  const internalApp = createInternalExperimentApp({
    ...opts,
    operatorLogins: [operator],
    hubToken: "hub-test",
  });
  const mutate = (path: string, input: object, method = "POST") =>
    publicApp.request(`${EXPERIMENTS_API_PATH}${path}`, {
      method,
      body: JSON.stringify(input),
      headers: machineHeaders,
    });
  return {
    publicApp,
    internalApp,
    mutate,
    setNow: (at: string) => {
      now = new Date(at);
    },
  };
}

it("preserves the original plan and maintains a Pacific review queue through extensions", async () => {
  const { publicApp, internalApp, mutate, setNow } = fixture();
  const summary = () =>
    body(internalApp.request(EXPERIMENTS_REVIEW_SUMMARY_PATH));
  const draftResponse = await mutate("", {
    requestId: crypto.randomUUID(),
    title: "Faster Toolkit status",
    owner: operator,
  });
  expect(draftResponse.status).toBe(201);
  const draft = await result(draftResponse);
  const path = `/${draft.id}`;
  const start = {
    requestId: crypto.randomUUID(),
    expectedRevision: draft.revision,
  };
  expect(await status(mutate(`${path}/start`, start))).toBe(422);

  const edit = await result(
    mutate(
      path,
      {
        requestId: crypto.randomUUID(),
        expectedRevision: draft.revision,
        plan: completePlan,
        reviewDate: "2026-11-27",
      },
      "PATCH",
    ),
  );
  expect(edit.revision).toBe(2);
  const running = await result(
    mutate(`${path}/start`, { ...start, expectedRevision: edit.revision }),
  );
  expect(running).toMatchObject({
    status: "running",
    originalPlan: completePlan,
    originalReviewDate: "2026-11-27",
    isDue: false,
  });
  expect(await summary()).toEqual({ dueCount: 0 });
  setNow("2026-11-27T08:00:00.000Z");
  expect(await summary()).toEqual({ dueCount: 1 });
  const due = await body(
    publicApp.request(`${EXPERIMENTS_API_PATH}?view=due`, {
      headers: machineHeaders,
    }),
  );
  expect(ExperimentListSchema.parse(due).items).toHaveLength(1);

  const amendment = await result(
    mutate(`${path}/amend`, {
      requestId: crypto.randomUUID(),
      expectedRevision: running.revision,
      rationale: "Sample cached and uncached runs",
      plan: { measurementMethod: "Use two runs per environment" },
    }),
  );
  expect(amendment.originalPlan?.measurementMethod).toBe(
    completePlan.measurementMethod,
  );
  expect(amendment.plan.measurementMethod).toBe("Use two runs per environment");

  const link = {
    kind: "flag",
    deployment: "tracker/prod",
    key: "tracker-writes-enabled",
  };
  const evidence = await result(
    mutate(`${path}/evidence`, {
      requestId: crypto.randomUUID(),
      expectedRevision: amendment.revision,
      note: "First measurements collected",
      link,
    }),
  );
  const review = {
    requestId: crypto.randomUUID(),
    expectedRevision: evidence.revision,
    outcome: "extend",
    rationale: "Collect enough samples",
  };
  expect(
    await status(
      mutate(`${path}/review`, { ...review, reviewDate: "2026-11-27" }),
    ),
  ).toBe(422);
  const extended = await result(
    mutate(`${path}/review`, { ...review, reviewDate: "2026-12-02" }),
  );
  expect(extended).toMatchObject({
    status: "running",
    reviewDate: "2026-12-02",
    originalReviewDate: "2026-11-27",
    isDue: false,
  });
  expect(extended.timeline.at(-1)).toMatchObject({
    kind: "review",
    outcome: "extend",
    reviewDate: "2026-12-02",
  });

  const decided = await result(
    mutate(`${path}/review`, {
      requestId: crypto.randomUUID(),
      expectedRevision: extended.revision,
      outcome: "keep",
      rationale: "The new path passed the measurement plan",
    }),
  );
  expect(decided).toMatchObject({ status: "decided", decision: "keep" });
  expect(decided.timeline.map((item) => item.kind)).toEqual([
    "created",
    "edited",
    "started",
    "amendment",
    "evidence",
    "review",
    "review",
  ]);
  expect(await summary()).toEqual({ dueCount: 0 });
});

it("returns the original response on retry and refuses stale revisions or a reused request ID", async () => {
  const { mutate } = fixture();
  const create = {
    requestId: crypto.randomUUID(),
    title: "Draft",
    owner: operator,
  };
  const original = await result(mutate("", create));
  const path = `/${original.id}`;
  const edit = {
    requestId: crypto.randomUUID(),
    expectedRevision: 1,
    title: "New title",
  };
  expect(await status(mutate(path, edit, "PATCH"))).toBe(200);
  expect(await body(mutate("", create))).toEqual(original);
  expect(
    await body(mutate("", { ...create, title: "Different draft" })),
  ).toMatchObject({ code: "request_id_conflict" });
  expect(
    await body(
      mutate(path, { ...edit, requestId: crypto.randomUUID() }, "PATCH"),
    ),
  ).toMatchObject({ code: "revision_conflict" });
});

it("keeps Hub authorization and the summary isolated from the public listener", async () => {
  const { publicApp, internalApp } = fixture();
  expect(await status(publicApp.request("/healthz"))).toBe(200);
  expect(await status(publicApp.request("/readyz"))).toBe(200);
  expect(await status(publicApp.request("/metrics"))).toBe(200);
  expect(await status(publicApp.request(EXPERIMENTS_REVIEW_SUMMARY_PATH))).toBe(
    404,
  );
  expect(
    await status(
      publicApp.request(EXPERIMENTS_API_PATH, {
        headers: { "Tailscale-User-Login": operator },
      }),
    ),
  ).toBe(401);
  const hubHeaders = {
    authorization: "Bearer hub-test",
    "content-type": "application/json",
    [EXPERIMENTS_OPERATOR_HEADER]: operator,
  };
  expect(
    await status(
      publicApp.request(EXPERIMENTS_API_PATH, { headers: hubHeaders }),
    ),
  ).toBe(401);
  expect(
    await status(
      internalApp.request(EXPERIMENTS_API_PATH, {
        headers: { ...machineHeaders, [EXPERIMENTS_OPERATOR_HEADER]: operator },
      }),
    ),
  ).toBe(401);
  expect(
    await status(
      internalApp.request(EXPERIMENTS_API_PATH, {
        headers: { authorization: "Bearer hub-test" },
      }),
    ),
  ).toBe(403);
  const valid = await result(
    internalApp.request(EXPERIMENTS_API_PATH, {
      method: "POST",
      headers: hubHeaders,
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        owner: operator,
        title: "Via Hub",
      }),
    }),
  );
  expect(valid.timeline[0]?.actor).toBe(operator);
});

it("supports a fully populated plan even when its fields require JSON escaping", async () => {
  const { mutate } = fixture();
  const text = "\u{1}".repeat(8000);
  const plan = {
    change: text,
    hypothesis: text,
    scope: text,
    successCriteria: text,
    measurementMethod: text,
    baseline: text,
    guardrails: text,
  };
  const draft = {
    requestId: crypto.randomUUID(),
    title: "Draft",
    owner: operator,
  };
  expect(await status(mutate("", { ...draft, plan }))).toBe(201);
  const tooLarge = "x".repeat(EXPERIMENTS_MAX_BODY_BYTES);
  expect(await status(mutate("", { ...draft, plan, tooLarge }))).toBe(413);
});
