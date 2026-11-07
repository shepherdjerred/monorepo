import { expect, test } from "bun:test";
import { requestTargetedMissilePresentation } from "./latest-targeted-missile-client.mjs";
import { TARGETED_MISSILE_PRESENTATION_POLICY as policy } from "./latest-targeted-missile-presentation.mjs";
import { DIRECT_MISSILE_PRESENTATION_POLICY } from "./latest-direct-missile-presentation.mjs";

const report = {
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  replaySha256: "a".repeat(64),
  endTime: 3,
};
async function withWorker(reply, check) {
  const original = globalThis.Worker;
  let worker;
  globalThis.Worker = class {
    constructor() {
      worker = this;
      this.terminated = false;
    }
    postMessage(request) {
      this.request = request;
      queueMicrotask(() => this.onmessage({ data: reply(request) }));
    }
    terminate() {
      this.terminated = true;
    }
  };
  try {
    await check(
      (options = {}) =>
        requestTargetedMissilePresentation({ report, ...options }),
      () => worker,
    );
  } finally {
    globalThis.Worker = original;
  }
}
const response = (request) => ({
  version: 1,
  id: request.id,
  ok: true,
  preparationMetrics: {
    candidateRecords: 8,
    namedPoseAssetsLoaded: true,
    scanElapsedMs: 1,
    elapsedMs: 2,
    uniqueStaticInputFiles: 3,
    uniqueStaticInputBytes: 4,
    scope: "initialization-only control",
  },
  result: { ...report, policy, traces: [] },
});

test("requested direct missile prefixes must match while omitted optional prefixes stay optional", async () => {
  const direct = {
    ...report,
    policy: DIRECT_MISSILE_PRESENTATION_POLICY,
    traces: [],
  };
  const changes = [
    () => undefined,
    ...["build", "protocol", "replaySha256", "endTime", "policy"].map(
      (key) => () => ({ ...direct, [key]: "foreign" }),
    ),
  ];
  for (const change of changes)
    await withWorker(
      (request) => ({
        ...response(request),
        result: {
          ...response(request).result,
          directMissilePresentation: change(),
        },
      }),
      async (run, getWorker) => {
        await expect(
          run({ includeDirectMissilePresentation: true }),
        ).rejects.toThrow("direct missile prefix");
        expect(getWorker().terminated).toBe(true);
      },
    );
  await withWorker(response, async (run) => {
    await expect(
      run({ includeDirectMissilePresentation: false }),
    ).resolves.toMatchObject({ policy });
  });
  let source;
  await withWorker(
    (request) =>
      (source = {
        ...response(request),
        result: {
          ...response(request).result,
          directMissilePresentation: structuredClone(direct),
        },
      }),
    async (run) => {
      const result = await run({ includeDirectMissilePresentation: true });
      source.result.directMissilePresentation.traces.push({ foreign: true });
      expect(result.directMissilePresentation.traces).toEqual([]);
    },
  );
  await expect(
    requestTargetedMissilePresentation({
      report,
      includeDirectMissilePresentation: "true",
    }),
  ).rejects.toThrow("option");
});
test("targeted worker accepts only an owned matching prefix and detaches returned data", async () => {
  let source;
  await withWorker(
    (request) => (source = response(request)),
    async (run, getWorker) => {
      const result = await run();
      source.result.traces.push({ foreign: true });
      expect(result.traces).toEqual([]);
      expect(getWorker().request.type).toBe("prepare");
      expect(getWorker().terminated).toBe(true);
    },
  );
});
test("targeted worker rejects malformed, foreign and stale responses", async () => {
  const changes = [
    (row) => ({ ...row, id: row.id + 1 }),
    (row) => ({ ...row, version: 2 }),
    (row) => ({ ...row, ok: false, error: { name: "Error" } }),
    ...["build", "protocol", "replaySha256", "endTime", "policy"].map(
      (key) => (row) => ({
        ...row,
        result: { ...row.result, [key]: "foreign" },
      }),
    ),
  ];
  for (const change of changes)
    await withWorker(
      (request) => change(response(request)),
      async (run, getWorker) => {
        await expect(run()).rejects.toThrow();
        expect(getWorker().terminated).toBe(true);
      },
    );
});

test("source preparation metrics stay outside raw family results and callback is not posted", async () => {
  let observed;
  await withWorker(response, async (run, getWorker) => {
    const result = await run({
      onPreparationMetrics: (value) => {
        observed = value;
      },
    });
    expect(observed).toEqual(response({ id: 1 }).preparationMetrics);
    expect(getWorker().request.payload.onPreparationMetrics).toBeUndefined();
    expect(result.preparationMetrics).toBeUndefined();
  });
  for (const change of [
    () => undefined,
    (value) => ({ ...value, elapsedMs: NaN }),
    (value) => ({ ...value, uniqueStaticInputBytes: -1 }),
  ])
    await withWorker(
      (request) => ({
        ...response(request),
        preparationMetrics: change(response(request).preparationMetrics),
      }),
      async (run) => {
        await expect(run()).rejects.toThrow("metrics");
      },
    );
});
