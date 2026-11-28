#!/usr/bin/env bun

/**
 * Renovate hint checker.
 *
 * A `# renovate: datasource=… depName=…` comment above a version pin does
 * nothing by itself: Renovate only reads it when a `customManagers` entry in
 * renovate.json covers the file and its `matchStrings` match the hint and the
 * pin below it. Hints in files no manager read looked tracked for months while
 * the pins drifted, and some named datasources that do not exist.
 *
 * This check fails when a hint in a tracked file is not extracted by exactly
 * one custom manager, names an unknown datasource, or sits in a match that
 * repeats the pinned value (Renovate rewrites every occurrence inside a
 * match). It runs the same expressions Renovate runs, so a hint that passes
 * here is one Renovate extracts.
 */

import { z } from "zod";

const RENOVATE_CONFIG_PATH = "renovate.json";

const RegexManagerSchema = z.object({
  customType: z.literal("regex"),
  description: z.string(),
  managerFilePatterns: z.array(z.string()),
  matchStrings: z.array(z.string()),
});

/**
 * Hinted pins are read only by regex managers. Other manager types (the
 * JSONata manager that reads the root Bun catalog) are not hint readers.
 */
const CustomManagerSchema = z.union([
  RegexManagerSchema,
  z.looseObject({ customType: z.literal("jsonata") }),
]);

const RenovateConfigSchema = z.object({
  customManagers: z
    .array(CustomManagerSchema)
    .transform((managers) =>
      managers.flatMap((manager) =>
        manager.customType === "regex" ? [manager] : [],
      ),
    ),
  customDatasources: z.record(z.string(), z.unknown()).optional(),
  ignorePaths: z.array(z.string()).optional(),
});

export type RegexManager = z.infer<typeof RegexManagerSchema>;

export type Violation = {
  file: string;
  line: number;
  message: string;
};

type Extraction = {
  manager: string;
  index: number;
  text: string;
  currentValue: string | undefined;
  currentDigest: string | undefined;
};

/**
 * Built-in Renovate datasource ids a hint may name. A `custom.<name>` id is
 * accepted when renovate.json defines that custom datasource. Add an id here
 * only after confirming it in Renovate's datasource list:
 * https://docs.renovatebot.com/modules/datasource/
 */
export const KNOWN_DATASOURCES: ReadonlySet<string> = new Set([
  "crate",
  "deb",
  "docker",
  "dotnet-version",
  "git-refs",
  "git-tags",
  "github-releases",
  "github-tags",
  "gitlab-releases",
  "gitlab-tags",
  "go",
  "golang-version",
  "gradle-version",
  "helm",
  "java-version",
  "maven",
  "node-version",
  "npm",
  "nuget",
  "pypi",
  "python-version",
  "ruby-version",
  "rust-version",
  "terraform-provider",
]);

/** A hint is a whole-line `#` or `//` comment; prose that mentions one is not. */
const HINT_LINE = /^[ \t]*(?:#|\/\/)[ \t]*renovate:[ \t]*datasource=(\S+)/;

/** The pathspec that finds the same lines `HINT_LINE` matches. */
const HINT_GREP =
  "^[[:space:]]*(#|//)[[:space:]]*renovate:[[:space:]]*datasource=";

/**
 * Documentation shows hints as examples. Renovate never reads Markdown through
 * a custom manager here, so those lines are not pins.
 */
const DOCUMENTATION = /\.mdx?$/;

function isRegexPattern(pattern: string): boolean {
  return pattern.length > 2 && pattern.startsWith("/") && pattern.endsWith("/");
}

/** Renovate treats a `/…/` file pattern as a regular expression, else a glob. */
export function managerCoversFile(
  manager: Pick<RegexManager, "managerFilePatterns">,
  file: string,
): boolean {
  return manager.managerFilePatterns.some((pattern) =>
    isRegexPattern(pattern)
      ? new RegExp(pattern.slice(1, -1)).test(file)
      : new Bun.Glob(pattern).match(file),
  );
}

function extractions(
  managers: readonly RegexManager[],
  file: string,
  source: string,
): Extraction[] {
  return managers
    .filter((manager) => managerCoversFile(manager, file))
    .flatMap((manager) =>
      manager.matchStrings.flatMap((expression) =>
        // Renovate compiles each matchString with the global flag only.
        [...source.matchAll(new RegExp(expression, "g"))].map((match) => ({
          manager: manager.description,
          index: match.index,
          text: match[0],
          currentValue: match.groups?.["currentValue"],
          currentDigest: match.groups?.["currentDigest"],
        })),
      ),
    );
}

type HintLine = {
  line: number;
  start: number;
  end: number;
  datasource: string;
  next: string;
};

function hintLines(source: string): HintLine[] {
  const lines = source.split("\n");
  const hints: HintLine[] = [];
  let offset = 0;
  for (const [index, text] of lines.entries()) {
    const start = offset;
    offset += text.length + 1;
    const datasource = HINT_LINE.exec(text)?.[1];
    if (datasource === undefined) continue;
    hints.push({
      line: index + 1,
      start,
      end: start + text.length,
      datasource,
      next: lines[index + 1] ?? "",
    });
  }
  return hints;
}

function isKnownDatasource(
  datasource: string,
  customDatasources: readonly string[],
): boolean {
  return datasource.startsWith("custom.")
    ? customDatasources.includes(datasource.slice("custom.".length))
    : KNOWN_DATASOURCES.has(datasource);
}

/** Problems with the single match that extracts a hint. */
function ownerProblems(hint: HintLine, owner: Extraction): string[] {
  // Without a repository and a ref the version grammar reads the commit as a
  // version, which Renovate can never resolve.
  if (hint.datasource === "git-refs" && owner.currentDigest === undefined) {
    return [
      "a git-refs hint must name packageName=<repository URL> and ref=HEAD or branch=<name> so the commit below it is extracted as a digest",
    ];
  }
  return (
    [
      ["currentValue", owner.currentValue],
      ["currentDigest", owner.currentDigest],
    ] as const
  ).flatMap(([name, value]) => {
    if (value === undefined) return [];
    const count = owner.text.split(value).length - 1;
    return count === 1
      ? []
      : [
          `${name} "${value}" occurs ${String(count)} times inside the matched text; Renovate rewrites every occurrence, so the hint or pin must not repeat it`,
        ];
  });
}

function extractionProblems(
  hint: HintLine,
  matches: readonly Extraction[],
): string[] {
  // The native dockerfile manager tracks every FROM image; a hint above one
  // only documents the image name for readers.
  if (hint.datasource === "docker" && /^[ \t]*FROM[ \t]/.test(hint.next)) {
    return [];
  }
  const owners = matches.filter(
    (match) => match.index >= hint.start && match.index < hint.end,
  );
  const [owner, ...others] = owners;
  if (owner === undefined) {
    return [
      "no custom manager in renovate.json extracts this hint, so Renovate ignores the pin below it; cover the file and follow the hint grammar in the 'Hinted version pins' manager",
    ];
  }
  if (others.length > 0) {
    return [
      `${String(owners.length)} custom manager matches extract this hint (${owners.map((match) => match.manager.slice(0, 40)).join(" | ")}); Renovate would open duplicate updates`,
    ];
  }
  return ownerProblems(hint, owner);
}

export function hintViolations(input: {
  managers: readonly RegexManager[];
  customDatasources: readonly string[];
  file: string;
  source: string;
}): Violation[] {
  const { managers, customDatasources, file, source } = input;
  const matches = extractions(managers, file, source);
  return hintLines(source).flatMap((hint) =>
    [
      ...(isKnownDatasource(hint.datasource, customDatasources)
        ? []
        : [
            `datasource=${hint.datasource} is not a Renovate datasource this repository knows; fix the id or add it to KNOWN_DATASOURCES`,
          ]),
      ...extractionProblems(hint, matches),
    ].map((message) => ({ file, line: hint.line, message })),
  );
}

async function filesWithHints(): Promise<string[]> {
  const child = Bun.spawn(["git", "grep", "-lIE", HINT_GREP, "--", "."], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const output = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  // git grep exits 1 when nothing matches.
  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(`git grep failed with exit code ${String(exitCode)}`);
  }
  return output.split("\n").filter((file) => file !== "");
}

async function main(): Promise<void> {
  const config = RenovateConfigSchema.parse(
    await Bun.file(RENOVATE_CONFIG_PATH).json(),
  );
  const ignored = (config.ignorePaths ?? []).map(
    (pattern) => new Bun.Glob(pattern),
  );
  const candidates = await filesWithHints();
  const files = candidates.filter(
    (file) =>
      !DOCUMENTATION.test(file) && !ignored.some((glob) => glob.match(file)),
  );

  const violations: Violation[] = [];
  let hints = 0;
  for (const file of files) {
    const source = await Bun.file(file).text();
    hints += hintLines(source).length;
    violations.push(
      ...hintViolations({
        managers: config.customManagers,
        customDatasources: Object.keys(config.customDatasources ?? {}),
        file,
        source,
      }),
    );
  }

  if (violations.length > 0) {
    console.error("Renovate hint violations:\n");
    for (const violation of violations) {
      console.error(`  ${violation.file}:${String(violation.line)}`);
      console.error(`    ${violation.message}\n`);
    }
    console.error(`${String(violations.length)} violation(s) found.`);
    process.exit(1);
  }

  console.log(
    `Renovate reads all ${String(hints)} version-pin hints in ${String(files.length)} files.`,
  );
}

if (import.meta.main) await main();
