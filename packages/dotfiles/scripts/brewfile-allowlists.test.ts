import { expect, test } from "vitest";
import path from "node:path";

// dot_Brewfile.tmpl filters the workstation's `.Brewfile_darwin` dump through
// the .chezmoidata allowlists. The dump is regenerated from the workstation,
// so an allowlisted name the workstation no longer has would silently vanish
// from that profile's Brewfile. Every allowlisted entry must exist in the dump
// under the same kind.

const sourceDirectory = path.resolve(import.meta.dir, "..");

type Kind = "tap" | "brew" | "cask";

async function dumpedEntries(): Promise<Map<Kind, Set<string>>> {
  const dump = await Bun.file(
    path.join(sourceDirectory, ".Brewfile_darwin"),
  ).text();
  const entries = new Map<Kind, Set<string>>([
    ["tap", new Set()],
    ["brew", new Set()],
    ["cask", new Set()],
  ]);
  for (const line of dump.split("\n")) {
    const match = /^(tap|brew|cask) "([^"]+)"/.exec(line);
    if (match === null) continue;
    const [, kind, name] = match;
    if (kind !== "tap" && kind !== "brew" && kind !== "cask") continue;
    if (name === undefined) continue;
    entries.get(kind)?.add(name);
  }
  return entries;
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const entries: [string, unknown][] = Object.entries(value);
  return new Map(entries).get(key);
}

async function readAllowlist(file: string, key: string): Promise<unknown> {
  const text = await Bun.file(
    path.join(sourceDirectory, ".chezmoidata", file),
  ).text();
  const section = field(Bun.YAML.parse(text), key);
  if (typeof section !== "object" || section === null) {
    throw new Error(`${file} has no top-level ${key} mapping`);
  }
  return section;
}

function names(section: unknown, kind: string): string[] {
  const list = field(section, `${kind}s`);
  if (!Array.isArray(list)) throw new TypeError(`${kind}s must be a list`);
  return list.map((item: unknown) => {
    if (typeof item !== "string") throw new TypeError(`${kind}s must be names`);
    return item;
  });
}

test("every assistant-host allowlist entry exists in the workstation dump", async () => {
  const dump = await dumpedEntries();
  const allowlist = await readAllowlist("assistant-host.yaml", "assistantHost");
  for (const kind of ["tap", "brew", "cask"] as const) {
    const allowed = names(allowlist, kind);
    expect(allowed.length).toBeGreaterThan(0);
    const missing = allowed.filter((name) => !dump.get(kind)?.has(name));
    expect(missing, `${kind}s missing from .Brewfile_darwin`).toEqual([]);
  }
});

test("assistant-host taps cover every tap-qualified formula it keeps", async () => {
  const allowlist = await readAllowlist("assistant-host.yaml", "assistantHost");
  const taps = new Set(names(allowlist, "tap"));
  const neededTaps = names(allowlist, "brew")
    .filter((name) => name.split("/").length === 3)
    .map((name) => name.split("/").slice(0, 2).join("/"));
  expect(neededTaps.filter((tap) => !taps.has(tap))).toEqual([]);
});

test("every agent-host cask exists in the workstation dump", async () => {
  const dump = await dumpedEntries();
  const allowlist = await readAllowlist("agent-host.yaml", "agentHost");
  const missing = names(allowlist, "cask").filter(
    (name) => !dump.get("cask")?.has(name),
  );
  expect(missing).toEqual([]);
});

test("workstation dump omits broken cirruslabs/cli tap and trusts installed tap formulae (AI-372)", async () => {
  const dumpText = await Bun.file(
    path.join(sourceDirectory, ".Brewfile_darwin"),
  ).text();
  expect(dumpText).not.toContain("cirruslabs/cli");

  const tapTrustedFormulae = new Map<string, Set<string> | "all" | "default">();
  const tapBrews: { tap: string; formula: string }[] = [];

  for (const line of dumpText.split("\n")) {
    const tapMatch = /^tap "([^"]+)"(.*)$/u.exec(line);
    if (tapMatch?.[1] !== undefined) {
      const tapName = tapMatch[1];
      const rest = tapMatch[2] ?? "";
      const listMatch = /formulae:\s*\[([^\]]*)\]/u.exec(rest);
      if (listMatch?.[1] !== undefined) {
        const parsed = [...listMatch[1].matchAll(/"([^"]+)"/gu)].flatMap((m) =>
          m[1] === undefined ? [] : [m[1]],
        );
        tapTrustedFormulae.set(tapName, new Set(parsed));
      } else if (/trusted:\s*true/u.test(rest)) {
        tapTrustedFormulae.set(tapName, "all");
      } else {
        tapTrustedFormulae.set(tapName, "default");
      }
      continue;
    }

    const brewMatch = /^brew "([^"/]+\/[^"/]+\/[^"/]+)"/u.exec(line);
    if (brewMatch?.[1] !== undefined) {
      const parts = brewMatch[1].split("/");
      const tap = `${parts[0] ?? ""}/${parts[1] ?? ""}`;
      const formula = parts[2] ?? "";
      tapBrews.push({ tap, formula });
    }
  }

  expect(tapBrews).toContainEqual({ tap: "openai/tools", formula: "tart" });
  for (const { tap, formula } of tapBrews) {
    const trust = tapTrustedFormulae.get(tap);
    expect(trust, `missing tap "${tap}" for ${tap}/${formula}`).toBeDefined();
    if (trust instanceof Set) {
      expect(
        trust.has(formula),
        `tap "${tap}" trusted.formulae omits installed formula "${formula}"`,
      ).toBe(true);
    }
  }
});

test("every non-stdlib go package in .Brewfile_darwin is listed in dot_default-go-packages (AI-904)", async () => {
  const [dumpText, defaultGoText] = await Promise.all([
    Bun.file(path.join(sourceDirectory, ".Brewfile_darwin")).text(),
    Bun.file(path.join(sourceDirectory, "dot_default-go-packages")).text(),
  ]);
  const defaultGoPackages = new Set(
    defaultGoText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
  const dumpedGoPackages = [...dumpText.matchAll(/^go "([^"]+)"/gmu)].flatMap(
    (match) =>
      match[1] === undefined || match[1].startsWith("cmd/") ? [] : [match[1]],
  );

  expect(dumpedGoPackages.length).toBeGreaterThan(0);
  const missing = dumpedGoPackages.filter((pkg) => !defaultGoPackages.has(pkg));
  expect(missing).toEqual([]);
});
