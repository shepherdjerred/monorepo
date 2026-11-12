#!/usr/bin/env bun
/**
 * Scaffolds a hosted first-party service in its prepared state.
 *
 *   bun scripts/misc/new-service.ts --name notes --kind web --port 7400 --host notes
 *
 * It creates the package (Bun entrypoint with a health endpoint, Dockerfile),
 * a cdk8s chart on the matching first-party construct, the Argo Application
 * and the Helm chart manifest, and registers the service everywhere
 * `scripts/checks/service-registration.ts` looks. The chart and the
 * Application sit behind an activation gate, so the image builds and the chart
 * publishes inactive while nothing deploys. Activation is a separate reviewed
 * change; the wiki how-to "Add a hosted service" lists it.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { $ } from "bun";
import prettier from "prettier";
import {
  formatChecklist,
  loadRegistrationInputs,
  registrationFindings,
} from "../checks/service-registration.ts";
import {
  packageFiles,
  validatePackageName,
  writePackageScaffold,
} from "./migration-core.ts";
import { activationConstant, serviceFiles } from "./new-service-files.ts";
import {
  parseServiceOptions,
  type ServiceOptions,
} from "./new-service-options.ts";
import { registrationEdits } from "./new-service-registrations.ts";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..");
/** The Dockerfile whose stages and base-image pins a new service starts from. */
const DOCKERFILE_MODEL = "packages/tracker/Dockerfile";
const FORMATTED = /\.(?:ts|json)$/u;

/**
 * Formats with this checkout's prettier configuration, whichever root the
 * file is written under.
 */
async function formatted(file: string, text: string): Promise<string> {
  if (!FORMATTED.test(file)) return text;
  const configured = path.join(REPOSITORY_ROOT, file);
  return prettier.format(text, {
    ...(await prettier.resolveConfig(configured)),
    filepath: configured,
  });
}

async function basePins(root: string) {
  const model = await Bun.file(path.join(root, DOCKERFILE_MODEL)).text();
  const [syntax, base] = model.split("\n");
  if (
    syntax?.startsWith("# syntax=") !== true ||
    base?.startsWith("FROM ") !== true ||
    !base.endsWith(" AS base")
  )
    throw new Error(
      `${DOCKERFILE_MODEL} no longer opens with its syntax and base-image lines`,
    );
  return { syntax, base };
}

/**
 * Writes the service into the repository at `root` and returns the files it
 * created or changed, relative to `root`. Nothing is written when the service
 * already exists or a registration file has lost the shape an edit expects.
 */
export async function scaffoldService(
  root: string,
  options: ServiceOptions,
): Promise<string[]> {
  const name = validatePackageName(options.name);
  const directory = path.join(root, "packages", name);
  const created = serviceFiles(options, await basePins(root));
  for (const file of [`packages/${name}/package.json`, ...Object.keys(created)])
    if (await Bun.file(path.join(root, file)).exists())
      throw new Error(`${file} already exists`);

  // Compute every edit before writing anything, so a failed one leaves the
  // tree untouched.
  const edited: Record<string, string> = {};
  for (const edit of registrationEdits(options)) {
    const text = await Bun.file(path.join(root, edit.file)).text();
    const next = edit.apply(text);
    edited[edit.file] = await formatted(
      edit.file,
      edit.json === "expanded"
        ? JSON.stringify(JSON.parse(next), undefined, 2)
        : next,
    );
  }

  await writePackageScaffold(directory, name);
  // The base scaffold's test imports the entrypoint, which here starts a server.
  await rm(path.join(directory, "src/index.test.ts"));
  const scaffolded: Record<string, string> = {};
  for (const file of Object.keys(packageFiles(name))) {
    if (file === "src/index.test.ts") continue;
    scaffolded[`packages/${name}/${file}`] = await Bun.file(
      path.join(directory, file),
    ).text();
  }
  const written = { ...scaffolded, ...created, ...edited };
  for (const [file, text] of Object.entries(written))
    await Bun.write(path.join(root, file), await formatted(file, text), {
      createPath: true,
    });
  return Object.keys(written).sort();
}

/** What the scaffolder leaves to its author; the how-to has the detail. */
function nextSteps({ name }: ServiceOptions): string[] {
  return [
    `Nothing deploys while ${activationConstant(name)} is false. Left to you:`,
    "  1. Bump the three inventory counts the new image and chart change:",
    "     bunx turbo run test --filter=@shepherdjerred/root-scripts",
    `  2. Add ${name} to the inventory table in packages/README.md.`,
    `  3. Write packages/${name}/README.md and the service itself.`,
    "  4. Activate it in a later change, once its image is published.",
    'See the wiki how-to "Add a hosted service":',
    "  packages/docs/wiki/src/content/docs/how-to/add-a-hosted-service.md",
  ];
}

if (import.meta.main) {
  const options = parseServiceOptions(Bun.argv.slice(2));
  const files = await scaffoldService(REPOSITORY_ROOT, options);
  await $`bun install`.cwd(REPOSITORY_ROOT);
  await $`bun run generate:catalog`.cwd(
    path.join(REPOSITORY_ROOT, "packages/homelab/src/cdk8s"),
  );
  const findings = registrationFindings(
    await loadRegistrationInputs(REPOSITORY_ROOT),
  );
  if (findings.length > 0)
    throw new Error(
      `Service registration is incomplete:\n\n${formatChecklist(findings)}`,
    );
  console.log(
    [
      `Prepared ${options.kind} service ${options.name}; its registration is complete:`,
      ...files.map((file) => `  ${file}`),
      "",
      ...nextSteps(options),
    ].join("\n"),
  );
}
