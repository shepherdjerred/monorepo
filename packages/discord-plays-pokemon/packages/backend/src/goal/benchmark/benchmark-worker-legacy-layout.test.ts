import { expect, test } from "vitest";
import path from "node:path";
import { cp, mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { retargetWorkerSourceForLegacyGoalLayout } from "./benchmark-runtime-overlay.ts";
import { bootWorkerSource } from "./benchmark-worker-test-helpers.ts";

test("retargets every current goal/control and goal/game specifier to its legacy flat path", () => {
  const retargeted = retargetWorkerSourceForLegacyGoalLayout(
    [
      'import { startGoalControlServer } from "#src/goal/control/control-server.ts";',
      'import { runPokemonctl } from "#src/goal/control/pokemonctl.ts";',
      'import { readGameObservation } from "#src/goal/game/game-observation.ts";',
    ].join("\n"),
  );
  expect(retargeted).toContain('"#src/goal/control-server.ts"');
  expect(retargeted).toContain('"#src/goal/pokemonctl.ts"');
  expect(retargeted).toContain('"#src/goal/game-observation.ts"');
  expect(retargeted).not.toContain("goal/control/");
  expect(retargeted).not.toContain("goal/game/");
});

test("streamed worker boots against a target predating the goal/control and goal/game split", async () => {
  const backendRoot = path.resolve(import.meta.dir, "../../..");
  const workerSource = retargetWorkerSourceForLegacyGoalLayout(
    await Bun.file(
      path.join(backendRoot, "scripts/goal-benchmark-worker.ts"),
    ).text(),
  );
  // Stand in for a comparison checkout made before the goal directory split:
  // control/ and game/ flattened back into their pre-split location alongside
  // goal-manager.ts and catch-evidence.ts, which never moved.
  const target = await mkdtemp(path.join(tmpdir(), "pre-goal-split-target-"));
  try {
    await cp(path.join(backendRoot, "src"), path.join(target, "src"), {
      recursive: true,
    });
    for (const tier of ["control", "game"]) {
      const tierDirectory = path.join(target, "src/goal", tier);
      for (const entry of await readdir(tierDirectory)) {
        await cp(
          path.join(tierDirectory, entry),
          path.join(target, "src/goal", entry),
        );
      }
      await rm(tierDirectory, { recursive: true, force: true });
    }
    // The split converted 25 cross-sub-domain edges within these files from
    // relative sibling imports to #src/goal/control/* and #src/goal/game/*
    // package imports. A real pre-split checkout has neither the control/ nor
    // game/ directories nor those package-qualified specifiers; flatten the
    // relocated files' own specifiers too so this target is internally
    // self-consistent, the way an actual historical checkout is.
    const goalDirectory = path.join(target, "src/goal");
    for (const entry of await readdir(goalDirectory)) {
      const entryPath = path.join(goalDirectory, entry);
      const entryStat = await stat(entryPath);
      if (entryStat.isDirectory()) continue;
      const contents = await Bun.file(entryPath).text();
      const flattened = contents
        .replaceAll("#src/goal/control/", "#src/goal/")
        .replaceAll("#src/goal/game/", "#src/goal/")
        .replaceAll('from "./control/', 'from "./')
        .replaceAll('from "./game/', 'from "./');
      if (flattened !== contents) {
        await Bun.write(entryPath, flattened);
      }
    }
    await symlink(
      path.join(backendRoot, "node_modules"),
      path.join(target, "node_modules"),
      "dir",
    );
    await Bun.write(
      path.join(target, "package.json"),
      `${JSON.stringify({
        name: "pre-goal-split-target",
        imports: { "#src/*": "./src/*" },
      })}\n`,
    );

    const { output, exitCode } = await bootWorkerSource(target, workerSource);

    // Reaching main()'s argument check proves the whole worker module graph
    // (including control-server, pokemonctl, and game-observation) resolved
    // against the flat legacy layout. An unretargeted specifier would instead
    // surface "Cannot find module .../goal/control/..." here.
    expect(output).not.toContain("Cannot find");
    expect(exitCode).not.toBe(0);
    expect(output).toContain("benchmark worker requires --config");
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}, 30_000);
