import { beforeAll, describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { LITERAL_VAULT_PATH_SITES } from "./debt-allowlists.ts";

/**
 * Fleet conventions that synthesis cannot see because the rendered manifest
 * is the same either way: how a 1Password item path was spelled, and which
 * TypeScript type checked an Argo Application's Helm values. These read the
 * chart sources instead.
 */

const SOURCE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const HELM_TYPES_ROOT = fileURLToPath(
  new URL("../../generated/helm/", import.meta.url),
);
/** The one place a vault path may be spelled out. */
const VAULT_PATH_BUILDER = "misc/onepassword-vault.ts";
const PACKAGE_SOURCE_PREFIX = "@shepherdjerred/homelab/cdk8s/src/";
const HELM_VALUES_MAP = "misc/typed-helm-parameters.ts";

let sources: ReadonlyMap<string, string>;
let generatedCharts: readonly string[];

beforeAll(async () => {
  const files = await Array.fromAsync(
    new Bun.Glob("**/*.ts").scan({ cwd: SOURCE_ROOT }),
  );
  const authored = files.filter((file) => !file.endsWith(".test.ts")).sort();
  sources = new Map(
    await Promise.all(
      authored.map(
        async (file) =>
          [file, await Bun.file(`${SOURCE_ROOT}${file}`).text()] as const,
      ),
    ),
  );
  const typeFiles = await Array.fromAsync(
    new Bun.Glob("*.types.ts").scan({ cwd: HELM_TYPES_ROOT }),
  );
  generatedCharts = typeFiles
    .map((file) => file.replace(/\.types\.ts$/u, ""))
    .sort();
});

function matches(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** Sources of the first-party modules a file imports, one level deep. */
function importedSources(file: string, source: string): string[] {
  const directory = file.includes("/")
    ? file.slice(0, file.lastIndexOf("/") + 1)
    : "";
  return matches(source, /from "([^"]+\.ts)"/gu).flatMap((specifier) => {
    const key = specifier.startsWith("./")
      ? `${directory}${specifier.slice(2)}`
      : specifier.replace(PACKAGE_SOURCE_PREFIX, "");
    const imported = sources.get(key);
    return imported === undefined ? [] : [imported];
  });
}

describe("1Password item paths", () => {
  test("are built by vaultItemPath, except the listed literal sites", () => {
    const literalSites = Object.fromEntries(
      [...sources]
        .filter(([file]) => file !== VAULT_PATH_BUILDER)
        .map(
          ([file, source]) =>
            [
              file,
              matches(source, /["'`](vaults\/)[^"'`\n]*/gu).length,
            ] as const,
        )
        .filter(([, count]) => count > 0),
    );
    // Exact in both directions: a new literal site fails, and so does a
    // listed count that is now too high.
    expect(literalSites).toEqual(LITERAL_VAULT_PATH_SITES);
  });
});

describe("Argo Application Helm values", () => {
  test("every generated chart values type is registered", () => {
    const map = sources.get(HELM_VALUES_MAP);
    expect(map).toBeDefined();
    const unregistered = generatedCharts.filter(
      (chart) => map?.includes(`generated/helm/${chart}.types"`) !== true,
    );
    expect(unregistered).toEqual([]);
  });

  test("values are typed as the chart the Application installs", () => {
    const mismatched = [...sources].flatMap(([file, source]) => {
      const charts = new Set(matches(source, /\bchart: "([^"]+)"/gu));
      return charts.size === 0
        ? []
        : matches(source, /HelmValuesForChart<\s*"([^"]+)"\s*>/gu)
            .filter((typed) => !charts.has(typed))
            .map((typed) => `${file}: typed as ${typed}`);
    });
    expect(mismatched).toEqual([]);
  });

  test("an Application of a chart with generated types uses them", () => {
    const untyped = [...sources]
      .filter(([, source]) => source.includes("valuesObject"))
      .flatMap(([file, source]) => {
        // The values type may be an alias declared in a module this file
        // imports (kube-prometheus-stack's lives beside its Grafana values).
        const visible = [source, ...importedSources(file, source)].join("\n");
        return matches(source, /\bchart: "([^"]+)"/gu)
          .filter((chart) => generatedCharts.includes(chart))
          .filter(
            (chart) => !visible.includes(`HelmValuesForChart<"${chart}">`),
          )
          .map((chart) => `${file}: ${chart}`);
      });
    expect(untyped).toEqual([]);
  });
});
