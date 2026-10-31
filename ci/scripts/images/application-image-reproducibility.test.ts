import { describe, expect, test } from "vitest";

// Rebuilding an application image from byte-identical inputs must reproduce
// its layer diff_ids, so bake-images.ts classifies it content-unchanged and
// Delivery retains the qualified artifact (packages/delivery/docs/model.md B2).
// These invariants keep the inputs that reach each layer stable.

const repoRoot = new URL("../../..", import.meta.url).pathname;

type Stage = {
  readonly name: string;
  readonly parent: string;
  readonly instructions: string[];
};

function dockerStages(dockerfile: string): Stage[] {
  const instructions = dockerfile
    .replaceAll("\\\n", " ")
    .split("\n")
    .map((line) => line.trim().replaceAll(/\s+/g, " "))
    .filter((line) => line !== "" && !line.startsWith("#"));
  const stages: Stage[] = [];
  for (const instruction of instructions) {
    const from = /^FROM (\S+)(?: AS (\S+))?$/.exec(instruction);
    if (from === null) {
      stages.at(-1)?.instructions.push(instruction);
    } else {
      stages.push({
        parent: from[1] ?? "",
        name: from[2] ?? "",
        instructions: [],
      });
    }
  }
  return stages;
}

const PROJECTION_COMMAND =
  "RUN bun /tools/ci/scripts/images/workspace-manifests.ts /workspace /closure ";

const installs = (stage: Stage): string[] =>
  stage.instructions.filter((instruction) =>
    instruction.startsWith("RUN bun install"),
  );

const quotedArguments = (instruction: string): string[] =>
  [...instruction.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? "");

async function read(path: string): Promise<string> {
  return Bun.file(`${repoRoot}/${path}`).text();
}

async function applicationDockerfiles(): Promise<string[]> {
  const bake = await read("docker-bake.hcl");
  const files = new Set<string>();
  for (const [, body = ""] of bake.matchAll(
    /^target "[^"]+" \{\n([\s\S]*?)^\}/gm,
  )) {
    if (!/inherits\s*=\s*\["_app"\]/.test(body)) continue;
    const file = /dockerfile\s*=\s*"([^"]+)"/.exec(body)?.[1];
    if (file === undefined) {
      throw new Error("application target lacks a Dockerfile");
    }
    files.add(file);
  }
  return [...files];
}

describe("application image reproducibility", () => {
  test("pushes clamp layer timestamps to a fixed epoch", async () => {
    const bake = await read("docker-bake.hcl");
    const app = /^target "_app" \{\n([\s\S]*?)^\}/m.exec(bake)?.[1] ?? "";
    expect(app).toContain('SOURCE_DATE_EPOCH = "1767225600"');
    expect(app).toContain("output = appoutput()");
    expect(bake).toContain(
      'result = equal(PUSH_IMAGES, "true") ? ["type=image,rewrite-timestamp=true"] : []',
    );
    // Only bake-images.ts's explicit `--push` may publish an image.
    expect(bake).not.toContain("push=true");
  });

  test("every application install sees only its projected closure", async () => {
    const dockerfiles = await applicationDockerfiles();
    expect(dockerfiles).toHaveLength(14);
    for (const file of dockerfiles) {
      const stages = dockerStages(await read(file));
      const byName = new Map(stages.map((stage) => [stage.name, stage]));
      const copiesClosure = (stage: Stage | undefined): boolean =>
        stage !== undefined &&
        (stage.instructions.includes("COPY --from=manifests /closure/ ./") ||
          copiesClosure(byName.get(stage.parent)));
      const projection = byName
        .get("manifests")
        ?.instructions.find((instruction) =>
          instruction.startsWith(PROJECTION_COMMAND),
        );
      expect(projection, file).toBeDefined();

      const leaks = stages
        .filter((stage) => stage.name !== "manifests")
        .flatMap((stage) => stage.instructions)
        .filter((instruction) =>
          instruction.includes("packages/*/package.json"),
        );
      expect(leaks, file).toEqual([]);
      const installing = stages.filter((stage) => installs(stage).length > 0);
      const unprojected = installing.filter((stage) => !copiesClosure(stage));
      expect(
        unprojected.map((stage) => stage.name),
        file,
      ).toEqual([]);
      const installed = installing.flatMap((stage) =>
        installs(stage).flatMap((install) => quotedArguments(install)),
      );
      expect(new Set(quotedArguments(projection ?? "")), file).toEqual(
        new Set(installed),
      );
    }
  });

  test("runtime images leave the root install inputs behind", async () => {
    for (const file of await applicationDockerfiles()) {
      const dockerfile = await read(file);
      const copies = dockerfile.match(/^COPY --from=prod-deps .*$/gm);
      for (const copy of copies ?? []) {
        for (const input of [
          "package.json",
          "bun.lock",
          "bunfig.toml",
          "patches",
        ]) {
          expect(copy, file).toContain(`--exclude=${input} `);
        }
      }
    }
  });

  test("production trees complete Bun's cycle bin links", async () => {
    for (const file of await applicationDockerfiles()) {
      for (const stage of dockerStages(await read(file))) {
        const { instructions } = stage;
        for (const [index, instruction] of instructions.entries()) {
          if (
            stage.name === "review-build" ||
            !instruction.startsWith(
              "RUN bun install --frozen-lockfile --production",
            )
          ) {
            continue;
          }
          expect(instructions.slice(index + 1, index + 3), file).toEqual([
            "COPY ci/scripts/images/complete-bin-links.ts /tools/",
            "RUN bun /tools/complete-bin-links.ts node_modules/.bun",
          ]);
        }
      }
    }
  });

  test("runtime Prisma generation leaves no per-run CLI state", async () => {
    for (const file of await applicationDockerfiles()) {
      const runtime = dockerStages(await read(file)).filter(
        (stage) => stage.name === "runtime",
      );
      for (const instruction of runtime.flatMap(
        (stage) => stage.instructions,
      )) {
        if (!instruction.includes("prisma generate")) continue;
        expect(instruction, file).toContain(
          'rm -rf "$HOME/.cache/checkpoint-nodejs" "$HOME/.config/prisma-nodejs"',
        );
      }
    }
  });

  test("build identity stays in the fingerprint-excluded environment", async () => {
    for (const file of await applicationDockerfiles()) {
      for (const stage of dockerStages(await read(file))) {
        for (const label of stage.instructions.filter((instruction) =>
          instruction.startsWith("LABEL "),
        )) {
          expect(label, file).not.toMatch(/\$\{?(VERSION|GIT_SHA)\b/);
        }
      }
    }
  });
});
