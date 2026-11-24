import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createTempGitRepo, type TempGitRepo } from "../lib/test-git.ts";
import {
  immutableRevisionFindings,
  nextRevisionId,
} from "./service-registration.ts";

async function writeRevision(
  root: string,
  relPath: string,
  content: unknown,
): Promise<void> {
  await Bun.write(path.join(root, relPath), `${JSON.stringify(content)}\n`);
}

describe("immutableRevisionFindings", () => {
  let repo: TempGitRepo | undefined;

  afterEach(async () => {
    if (repo !== undefined) {
      await repo.cleanup();
      repo = undefined;
    }
  });

  test("computes the next <prefix>/<N+1> revision id", () => {
    expect(nextRevisionId("prometheus/prod/8")).toBe("prometheus/prod/9");
    expect(nextRevisionId("delivery/3")).toBe("delivery/4");
  });

  test("fails when a committed or working-tree revision mutates payload without bumping id", async () => {
    repo = await createTempGitRepo("immutable-rev-");
    const recipePath =
      "packages/delivery/registrations/v2/tasknotes-server/prod/recipe.json";
    const configPath =
      "packages/delivery/registrations/v2/prometheus/prod/configuration.json";

    await writeRevision(repo.directory, recipePath, {
      id: "tasknotes-server/prod/2",
      definition: { kind: "kubernetes-application", replicas: 1 },
    });
    await writeRevision(repo.directory, configPath, {
      id: "prometheus/prod/8",
      content: { retention: "7d" },
      forwardOnly: [],
    });
    await repo.git(["add", "."]);
    await repo.git(["commit", "-m", "base"]);
    await repo.git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await repo.git(["checkout", "-b", "feature/edit"]);

    await writeRevision(repo.directory, recipePath, {
      id: "tasknotes-server/prod/2",
      definition: { kind: "kubernetes-application", replicas: 2 },
    });
    await repo.git(["add", recipePath]);
    await repo.git(["commit", "-m", "in-place recipe edit"]);

    await writeRevision(repo.directory, configPath, {
      id: "prometheus/prod/8",
      content: { retention: "14d" },
      forwardOnly: [],
    });

    const findings = await immutableRevisionFindings({
      root: repo.directory,
      env: { ...repo.env, CI_CHANGED_BASE: "" },
    });
    expect(findings).toEqual([
      {
        subject: "prometheus/prod",
        item: expect.stringContaining(
          'bump "id" and configurationRevisionId in packages/ops-model/catalog-document.json to "prometheus/prod/9"',
        ),
      },
      {
        subject: "tasknotes-server/prod",
        item: expect.stringContaining(
          'bump "id" and recipeRevisionId in packages/ops-model/catalog-document.json to "tasknotes-server/prod/3"',
        ),
      },
    ]);
  });

  test("passes when id was incremented relative to base, newly added, or key-order-only", async () => {
    repo = await createTempGitRepo("immutable-rev-ok-");
    const configPath =
      "packages/delivery/registrations/v2/prometheus/prod/configuration.json";
    const newRecipePath =
      "packages/delivery/registrations/v2/new-service/prod/recipe.json";

    await writeRevision(repo.directory, configPath, {
      id: "prometheus/prod/8",
      content: { a: "1", b: "2" },
      forwardOnly: [],
    });
    await repo.git(["add", "."]);
    await repo.git(["commit", "-m", "base"]);
    const rawHead = await repo.git(["rev-parse", "HEAD"]);
    const baseSha = rawHead.trim();

    await writeRevision(repo.directory, configPath, {
      forwardOnly: [],
      content: { b: "2", a: "1" },
      id: "prometheus/prod/8",
    });
    expect(
      await immutableRevisionFindings({
        root: repo.directory,
        env: { ...repo.env, CI_CHANGED_BASE: baseSha },
      }),
    ).toEqual([]);

    await writeRevision(repo.directory, configPath, {
      id: "prometheus/prod/9",
      content: { a: "10", b: "2" },
      forwardOnly: [],
    });
    await writeRevision(repo.directory, newRecipePath, {
      id: "new-service/prod/1",
      definition: { kind: "static-site" },
    });
    await repo.git(["add", "."]);
    await repo.git(["commit", "-m", "bump to 9"]);

    await writeRevision(repo.directory, configPath, {
      id: "prometheus/prod/9",
      content: { a: "20", b: "2" },
      forwardOnly: [],
    });
    await repo.git(["add", "."]);
    await repo.git(["commit", "-m", "refine 9 on same PR"]);

    expect(
      await immutableRevisionFindings({
        root: repo.directory,
        env: { ...repo.env, CI_CHANGED_BASE: baseSha },
      }),
    ).toEqual([]);
  });

  test("falls back to HEAD when origin/main is absent", async () => {
    repo = await createTempGitRepo("immutable-rev-fallback-");
    const recipePath =
      "packages/delivery/registrations/v2/arcade/prod/recipe.json";
    await writeRevision(repo.directory, recipePath, {
      id: "arcade/3",
      definition: { kind: "kubernetes-application", chart: "arcade" },
    });
    await repo.git(["add", "."]);
    await repo.git(["commit", "-m", "initial"]);

    await writeRevision(repo.directory, recipePath, {
      id: "arcade/3",
      definition: { kind: "kubernetes-application", chart: "arcade-v2" },
    });

    const findings = await immutableRevisionFindings({
      root: repo.directory,
      env: { ...repo.env, CI_CHANGED_BASE: "" },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.subject).toBe("arcade/prod");
    expect(findings[0]?.item).toContain('"arcade/4"');
  });
});
