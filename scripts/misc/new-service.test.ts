import { afterEach, describe, expect, test } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  formatChecklist,
  loadRegistrationInputs,
  parseBakeTargets,
  registrationFindings,
} from "../checks/service-registration.ts";
import { scaffoldService } from "./new-service.ts";
import {
  parseServiceOptions,
  type ServiceOptions,
} from "./new-service-options.ts";
import { registrationEdits } from "./new-service-registrations.ts";

/**
 * The scaffolder's contract is the registration-completeness check: a service
 * it writes is completely registered, and each piece it writes is one the
 * check would otherwise ask for. Each case scaffolds a throwaway service into
 * a temporary copy of the files the scaffolder and the check read.
 */

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..");
const HELM_ROOT = "packages/homelab/src/cdk8s/helm";
const RECIPE_ROOT = "packages/delivery/registrations/v2";

const WEB: ServiceOptions = {
  name: "fixture-notes",
  kind: "web",
  port: 7400,
  host: "fixture-notes",
  title: "Fixture notes",
};
const WORKER: ServiceOptions = {
  name: "fixture-worker",
  kind: "worker",
  port: 7401,
  title: "Fixture worker",
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0))
    await rm(directory, { force: true, recursive: true });
});

async function glob(pattern: string, directory: string): Promise<string[]> {
  const files = await Array.fromAsync(
    new Bun.Glob(pattern).scan({
      cwd: path.join(REPOSITORY_ROOT, directory),
    }),
  );
  return files.map((file) => path.join(directory, file));
}

/** A copy of every file the scaffolder edits and the check reads. */
async function fixtureTree(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "new-service-"));
  temporaryDirectories.push(root);
  const bake = await Bun.file(
    path.join(REPOSITORY_ROOT, "docker-bake.hcl"),
  ).text();
  const files = new Set([
    ...registrationEdits(WEB).map((edit) => edit.file),
    ...[...parseBakeTargets(bake).values()].map((target) => target.dockerfile),
    ...(await glob("*/Chart.yaml", HELM_ROOT)),
    ...(await glob("**/recipe.json", RECIPE_ROOT)),
  ]);
  for (const file of files)
    await cp(path.join(REPOSITORY_ROOT, file), path.join(root, file), {
      recursive: true,
    });
  return root;
}

async function checklist(root: string): Promise<string> {
  return formatChecklist(
    registrationFindings(await loadRegistrationInputs(root)),
  );
}

async function rewrite(
  root: string,
  file: string,
  edit: (text: string) => string,
): Promise<void> {
  const target = path.join(root, file);
  const text = await Bun.file(target).text();
  const next = edit(text);
  expect(next, `${file} was not changed by the removal`).not.toBe(text);
  await Bun.write(target, next);
}

function withoutLines(matching: RegExp): (text: string) => string {
  return (text) =>
    text
      .split("\n")
      .filter((line) => !matching.test(line))
      .join("\n");
}

describe("scaffoldService", () => {
  test("the fixture tree is completely registered before scaffolding", async () => {
    expect(await checklist(await fixtureTree())).toBe("");
  });

  test.each([WEB, WORKER])(
    "a scaffolded $kind service is completely registered",
    async (options) => {
      const root = await fixtureTree();
      const files = await scaffoldService(root, options);

      const inputs = await loadRegistrationInputs(root);
      expect(
        inputs.services.find((service) => service.id === options.name),
      ).toEqual({
        id: options.name,
        package: options.name,
        images: [options.name],
        charts: [options.name],
      });
      expect(formatChecklist(registrationFindings(inputs))).toBe("");

      expect(files).toEqual(
        expect.arrayContaining([
          `packages/${options.name}/Dockerfile`,
          `packages/${options.name}/package.json`,
          `packages/${options.name}/src/index.ts`,
          `${HELM_ROOT}/${options.name}/Chart.yaml`,
          `packages/homelab/src/cdk8s/src/cdk8s-charts/${options.name}.ts`,
          `packages/homelab/src/cdk8s/src/resources/${options.name}/index.ts`,
          `packages/homelab/src/cdk8s/src/resources/argo-applications/apps/${options.name}.ts`,
        ]),
      );
      for (const file of files)
        expect(await Bun.file(path.join(root, file)).exists(), file).toBe(true);
    },
  );

  test("uses the construct that matches the kind, behind the activation gate", async () => {
    const root = await fixtureTree();
    await scaffoldService(root, WEB);
    await scaffoldService(root, WORKER);
    const source = "packages/homelab/src/cdk8s/src";
    const read = async (file: string) =>
      Bun.file(path.join(root, source, file)).text();

    const web = await read("resources/fixture-notes/index.ts");
    expect(web).toContain("new FirstPartyWebService(");
    expect(web).toContain(
      'host: "fixture-notes",\n            namespace: "fixture-notes",\n            exposure: "ingress",',
    );
    expect(web).toContain("export const FIXTURE_NOTES_ACTIVE = false;");
    const worker = await read("resources/fixture-worker/index.ts");
    expect(worker).toContain("new FirstPartyWorker(");
    expect(worker).not.toContain("tailscale");

    expect(await read("cdk8s-charts/fixture-notes.ts")).toContain(
      'new ConfigMap(chart, "activation", { data: { active: "false" } });',
    );
    const application = await read(
      "resources/argo-applications/apps/fixture-notes.ts",
    );
    expect(application).toContain("if (!active) return;");
    expect(application).toContain("createFirstPartyApplication(chart, {");
  });

  test("only adds to the files that already exist", async () => {
    const root = await fixtureTree();
    await scaffoldService(root, WEB);
    for (const { file } of registrationEdits(WEB)) {
      const original = await Bun.file(path.join(REPOSITORY_ROOT, file)).text();
      const edited = await Bun.file(path.join(root, file)).text();
      const before = original.split("\n");
      const after = edited.split("\n");
      // Every original line survives in order, give or take the comma a new
      // last entry puts on the line before it.
      let cursor = 0;
      const missing = before.filter((line) => {
        const found = after.findIndex(
          (candidate, index) =>
            index >= cursor && (candidate === line || candidate === `${line},`),
        );
        if (found === -1) return true;
        cursor = found + 1;
        return false;
      });
      expect(missing, file).toEqual([]);
      expect(after.length, file).toBeGreaterThan(before.length);
    }
  });

  test.each<[string, string, (text: string) => string, RegExp]>([
    [
      "image registry entry",
      "packages/version-catalog/src/image-registry.json",
      withoutLines(/"fixture-notes"/u),
      /\[ \] image:fixture-notes: add it to packages\/version-catalog\/src\/image-registry\.json/u,
    ],
    [
      "build target",
      "ci/scripts/images/image-targets.ts",
      withoutLines(/"fixture-notes"/u),
      /\[ \] image:fixture-notes: register it in ci\/scripts\/images\/image-targets\.ts/u,
    ],
    [
      "bake target",
      "docker-bake.hcl",
      (text) => text.replace('target "fixture-notes"', 'target "_fixture"'),
      /\[ \] image:fixture-notes: add target "fixture-notes" to docker-bake\.hcl/u,
    ],
    [
      "smoke stage",
      "packages/fixture-notes/Dockerfile",
      withoutLines(/ AS smoke$/u),
      /\[ \] image:fixture-notes: add a `smoke` stage to packages\/fixture-notes\/Dockerfile/u,
    ],
    [
      "in-image smoke command",
      "ci/scripts/images/smoke-app-in-image.ts",
      (text) => text.replace('  "fixture-notes": {', '  "fixture-other": {'),
      /\[ \] image:fixture-notes: add an in-image smoke command to ci\/scripts\/images\/smoke-app-in-image\.ts/u,
    ],
    [
      "root workspace",
      "package.json",
      withoutLines(/"packages\/fixture-notes"/u),
      /\[ \] package fixture-notes: add packages\/fixture-notes to the root package\.json workspaces/u,
    ],
    [
      "prepared-chart exemption",
      "scripts/checks/service-registration-exemptions.json",
      (text) =>
        text.replace('"fixture-notes": "prepared', '"fixture-gone": "prepared'),
      /\[ \] chart:fixture-notes: no recipe under packages\/delivery\/registrations\/v2 deploys it/u,
    ],
  ])(
    "the check asks for a missing %s",
    async (_piece, file, remove, expected) => {
      const root = await fixtureTree();
      await scaffoldService(root, WEB);
      await rewrite(root, file, remove);
      const found = await checklist(root);
      expect(found).toMatch(/^fixture-notes\n/mu);
      expect(found).toMatch(expected);
    },
  );

  test("the check asks for a missing Helm chart", async () => {
    const root = await fixtureTree();
    await scaffoldService(root, WEB);
    await rm(path.join(root, HELM_ROOT, "fixture-notes/Chart.yaml"));
    expect(await checklist(root)).toBe(
      `fixture-notes\n  [ ] chart:fixture-notes: add ${HELM_ROOT}/fixture-notes/Chart.yaml`,
    );
  });

  test("refuses a service that exists and writes nothing", async () => {
    const root = await fixtureTree();
    await scaffoldService(root, WEB);
    const catalog = path.join(root, "packages/ops-model/catalog-document.json");
    const before = await Bun.file(catalog).text();
    await expect(scaffoldService(root, WEB)).rejects.toThrow(
      "packages/fixture-notes/package.json already exists",
    );
    // An image the registry already names, with no file of its own to collide.
    await expect(
      scaffoldService(root, { ...WORKER, name: "ci-base" }),
    ).rejects.toThrow("image-registry.json already declares ci-base");
    expect(await Bun.file(catalog).text()).toBe(before);
    expect(
      await Bun.file(path.join(root, "packages/ci-base/package.json")).exists(),
    ).toBe(false);
  });
});

describe("parseServiceOptions", () => {
  test("reads a web service and a worker", () => {
    expect(
      parseServiceOptions(
        "--name fixture-notes --kind web --port 7400 --host notes".split(" "),
      ),
    ).toEqual({ ...WEB, host: "notes" });
    expect(
      parseServiceOptions(
        "--name fixture-worker --kind worker --port 7401".split(" "),
      ),
    ).toEqual(WORKER);
  });

  test.each([
    ["--kind web --port 7400 --host notes", "--name is required"],
    ["--name Bad_Name --kind web --port 7400 --host notes", "kebab-name"],
    ["--name notes --kind job --port 7400", "--kind must be web or worker"],
    ["--name notes --kind web --port 80 --host notes", "--port must be"],
    ["--name notes --kind web --port 60000 --host notes", "--port must be"],
    ["--name notes --kind web --port 7400", "--host is required"],
    ["--name notes --kind worker --port 7400 --host notes", "no ingress"],
    ["--name notes --kind web --port 7400 --host Notes.example", "--host must"],
  ])("rejects %s", (argv, message) => {
    expect(() => parseServiceOptions(argv.split(" "))).toThrow(message);
  });
});
