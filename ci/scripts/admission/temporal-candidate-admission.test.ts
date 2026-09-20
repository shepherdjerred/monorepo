import { expect, test } from "vitest";
import {
  assertNoPendingVersionBump,
  assertTemporalCandidatePinsConverged,
} from "./temporal-candidate-admission.ts";
import type { CommandExecutor } from "../images/bake-images.ts";
import type { BuildxCommandResult } from "../images/bake-retry.ts";
import { TransientError } from "../../../scripts/lib/transient-error.ts";

function commandResult(
  exitCode = 0,
  stdout = "",
  stderr = "",
): BuildxCommandResult {
  return { exitCode, stdout, stderr };
}

// A catalog whose Temporal tracks are converged, so this build would publish a
// new Workflow candidate and therefore does care about a pending bump.
const PUBLISHING_CANDIDATE_CATALOG = JSON.stringify({
  entries: [
    {
      name: "shepherdjerred/temporal-worker/workflows/stable",
      value: `2.0.0-500@sha256:${"a".repeat(64)}`,
    },
    {
      name: "shepherdjerred/temporal-worker/workflows/candidate",
      value: `2.0.0-500@sha256:${"a".repeat(64)}`,
    },
  ],
});

// Tracks diverged and neither is legacy: no candidate publication is pending, so
// a bump branch on main has no bearing on this build.
const SETTLED_CATALOG = JSON.stringify({
  entries: [
    {
      name: "shepherdjerred/temporal-worker/workflows/stable",
      value: `2.0.0-500@sha256:${"a".repeat(64)}`,
    },
    {
      name: "shepherdjerred/temporal-worker/workflows/candidate",
      value: `2.0.0-501@sha256:${"b".repeat(64)}`,
    },
  ],
});

function admissionExecutor(
  catalog: string,
  lsRemote: () => BuildxCommandResult,
): CommandExecutor {
  return async (command) => {
    if (command[1] === "ls-remote") return lsRemote();
    if (command[1] === "fetch") return commandResult();
    return commandResult(0, catalog);
  };
}

test("blocks candidate admission while the durable version branch exists", async () => {
  await expect(
    assertNoPendingVersionBump(
      admissionExecutor(PUBLISHING_CANDIDATE_CATALOG, () =>
        commandResult(0, "abc123\trefs/heads/chore/version-bump-pending\n"),
      ),
    ),
  ).rejects.toThrow(TransientError);
});
test("fails transiently when the durable version branch cannot be checked", async () => {
  await expect(
    assertNoPendingVersionBump(
      admissionExecutor(PUBLISHING_CANDIDATE_CATALOG, () =>
        commandResult(1, "", "network"),
      ),
    ),
  ).rejects.toThrow(TransientError);
});
// Regression: version commit-back opens the bump branch after every main build,
// so gating unrelated builds on it made main red on a scheduling race. A pending
// bump must not block a build that is not publishing a Workflow candidate.
test("ignores a pending version bump when no candidate publication is due", async () => {
  let lsRemoteCalls = 0;
  await expect(
    assertNoPendingVersionBump(
      admissionExecutor(SETTLED_CATALOG, () => {
        lsRemoteCalls += 1;
        return commandResult(
          0,
          "abc123\trefs/heads/chore/version-bump-pending\n",
        );
      }),
    ),
  ).resolves.toBe(SETTLED_CATALOG);
  expect(lsRemoteCalls).toBe(0);
});
test("ignores a pending version bump when Temporal admission is not enforced", async () => {
  await expect(
    assertNoPendingVersionBump(
      admissionExecutor(PUBLISHING_CANDIDATE_CATALOG, () =>
        commandResult(0, "abc123\trefs/heads/chore/version-bump-pending\n"),
      ),
      false,
    ),
  ).resolves.toBe(PUBLISHING_CANDIDATE_CATALOG);
});
test("blocks admission when live main has a divergent Temporal candidate", async () => {
  const catalog = JSON.stringify({
    entries: [
      {
        name: "shepherdjerred/temporal-worker/workflows/stable",
        value: "2.0.0-41@sha256:stable",
      },
      {
        name: "shepherdjerred/temporal-worker/workflows/candidate",
        value: "2.0.0-42@sha256:candidate",
      },
      {
        name: "shepherdjerred/scout-for-lol/beta/workflows/stable",
        value: "2.0.0-41@sha256:stable",
      },
      {
        name: "shepherdjerred/scout-for-lol/beta/workflows/candidate",
        value: "2.0.0-41@sha256:stable",
      },
      {
        name: "shepherdjerred/scout-for-lol/prod/workflows/stable",
        value: "2.0.0-41@sha256:stable",
      },
      {
        name: "shepherdjerred/scout-for-lol/prod/workflows/candidate",
        value: "2.0.0-41@sha256:stable",
      },
    ],
  });
  const executor: CommandExecutor = async (command) =>
    command[1] === "fetch" || command[1] === "ls-remote"
      ? commandResult()
      : commandResult(0, catalog);
  await expect(assertTemporalCandidatePinsConverged(executor)).rejects.toThrow(
    TransientError,
  );
  await expect(assertNoPendingVersionBump(executor)).resolves.toBe(catalog);
});
test("allows the one-time central stable bootstrap transition", async () => {
  const legacy = `2.0.0-12197@sha256:${"a".repeat(64)}`;
  const stable = `2.0.0-12369@sha256:${"b".repeat(64)}`;
  const catalog = JSON.stringify({
    entries: [
      {
        name: "shepherdjerred/temporal-worker/workflows/stable",
        value: stable,
      },
      {
        name: "shepherdjerred/temporal-worker/workflows/candidate",
        value: legacy,
      },
      {
        name: "shepherdjerred/scout-for-lol/beta/workflows/stable",
        value: stable,
      },
      {
        name: "shepherdjerred/scout-for-lol/beta/workflows/candidate",
        value: stable,
      },
    ],
  });
  const executor: CommandExecutor = async (command) =>
    command[1] === "fetch" || command[1] === "ls-remote"
      ? commandResult()
      : commandResult(0, catalog);
  await expect(assertTemporalCandidatePinsConverged(executor)).resolves.toBe(
    catalog,
  );
});
test("allows admission when all live Temporal candidates match stable", async () => {
  const catalog = JSON.stringify({
    entries: [
      {
        name: "shepherdjerred/temporal-worker/workflows/stable",
        value: "2.0.0-41@sha256:stable",
      },
      {
        name: "shepherdjerred/temporal-worker/workflows/candidate",
        value: "2.0.0-41@sha256:stable",
      },
      {
        name: "shepherdjerred/scout-for-lol/beta/workflows/stable",
        value: "2.0.0-41@sha256:stable",
      },
      {
        name: "shepherdjerred/scout-for-lol/beta/workflows/candidate",
        value: "2.0.0-41@sha256:stable",
      },
    ],
  });
  const executor: CommandExecutor = async (command) =>
    command[1] === "ls-remote" || command[1] === "fetch"
      ? commandResult()
      : commandResult(0, catalog);
  await expect(assertTemporalCandidatePinsConverged(executor)).resolves.toBe(
    catalog,
  );
  await expect(assertNoPendingVersionBump(executor)).resolves.toBe(catalog);
});
test("rejects admission when a live Temporal workflow pin is missing", async () => {
  const catalog = JSON.stringify({
    entries: [
      {
        name: "shepherdjerred/temporal-worker/workflows/stable",
        value: "2.0.0-41@sha256:stable",
      },
    ],
  });
  const executor: CommandExecutor = async (command) =>
    command[1] === "fetch" || command[1] === "ls-remote"
      ? commandResult()
      : commandResult(0, catalog);
  await expect(assertTemporalCandidatePinsConverged(executor)).rejects.toThrow(
    "missing Temporal workflow pins",
  );
});
test("fails transiently when origin main cannot be refreshed", async () => {
  await expect(
    assertTemporalCandidatePinsConverged(async () => commandResult(1)),
  ).rejects.toThrow(TransientError);
});
test("fails transiently when the live version catalog cannot be read", async () => {
  await expect(
    assertTemporalCandidatePinsConverged(async (command) =>
      command[1] === "fetch" ? commandResult() : commandResult(1),
    ),
  ).rejects.toThrow(TransientError);
});
test("rejects malformed live version catalogs", async () => {
  const malformedCatalogs = [
    JSON.stringify({ entries: "invalid" }),
    JSON.stringify({ entries: ["invalid"] }),
  ];
  for (const catalog of malformedCatalogs) {
    const executor: CommandExecutor = async (command) =>
      command[1] === "fetch" ? commandResult() : commandResult(0, catalog);
    await expect(
      assertTemporalCandidatePinsConverged(executor),
    ).rejects.toThrow(Error);
  }
});
