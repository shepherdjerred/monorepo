import { afterEach, describe, expect, test, vi } from "vitest";
import { ciOperatorBlocker } from "#src/integrations/ci.ts";
import type { PrHealth } from "#src/domain/schemas.ts";

afterEach(() => vi.restoreAllMocks());
const HEAD = "a".repeat(40);
const health: PrHealth = {
  prNumber: 1,
  prUrl: "https://github.com/owner/repo/pull/1",
  overallStatus: "UNHEALTHY",
  checks: [
    {
      name: "CI Status",
      status: "UNHEALTHY",
      details: ["Woodpecker pipeline #42 for exact head aaaaaaaaaaaa: ERROR"],
    },
  ],
  nextSteps: [],
};
const input = {
  health,
  headSha: HEAD,
  config: {
    apiToken: "op://test/token/value",
    baseUrl: "https://woodpecker.sjer.red",
    repoId: 1,
  },
  token: "fixture-credential",
};

describe("CI operator blockers", () => {
  test("identifies author authorization failures from the exact pipeline", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        number: 42,
        commit: HEAD,
        status: "error",
        errors: [
          {
            message: 'HTTP 403: {"error":"actor is not permitted to run CI"}',
            is_warning: false,
          },
        ],
      }),
    );
    await expect(ciOperatorBlocker(input)).resolves.toContain(
      "operator must release",
    );
  });
  test("leaves ordinary failing checks eligible for a coding repair", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        number: 42,
        commit: HEAD,
        status: "failure",
        errors: [],
      }),
    );
    await expect(ciOperatorBlocker(input)).resolves.toBeNull();
  });
  test("never uses evidence from a different head", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        number: 42,
        commit: "b".repeat(40),
        status: "error",
        errors: [],
      }),
    );
    await expect(ciOperatorBlocker(input)).rejects.toThrow(
      "does not match the observed PR head",
    );
  });
  test.each(["skipped", "declined", "killed"])(
    "requires an operator for a %s pipeline",
    async (status) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        Response.json({ number: 42, commit: HEAD, status, errors: [] }),
      );
      await expect(ciOperatorBlocker(input)).resolves.toContain(
        "operator must restore or rerun",
      );
    },
  );
  test("does not inspect CI while checks are still pending", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    await expect(
      ciOperatorBlocker({
        ...input,
        health: {
          ...health,
          checks: [{ name: "CI Status", status: "PENDING", details: [] }],
        },
      }),
    ).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});
