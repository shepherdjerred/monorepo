import { describe, expect, it } from "vitest";
import {
  buildFishProgram,
  directBinary,
  fishSpawnProgram,
  fishWord,
  noFishCommand,
  resolveFishEntries,
  resolveFishEntry,
  resolveFishProgram,
  type FishRunner,
} from "#lib/brim/fish.ts";

function abbrProbe(word: string): string {
  return `-i -c abbr --show | string match -r -g -- '^abbr -a -- ${word} (.*)$' | string unescape --style=script`;
}

function stubRunner(
  handlers: Record<string, { exitCode: number; stdout: string }>,
): FishRunner {
  return async (args: string[]) => {
    const key = args.join(" ");
    const found = handlers[key];
    return found === undefined
      ? { exitCode: 1, stdout: "", stderr: "" }
      : { exitCode: found.exitCode, stdout: found.stdout, stderr: "" };
  };
}

describe("fishWord", () => {
  it("maps Brim providers to their fish words", () => {
    expect(fishWord("claude-code")).toBe("claude");
    expect(fishWord("codex")).toBe("codex");
    expect(fishWord("antigravity")).toBe("agy");
    expect(fishWord("muse")).toBe("muse");
    expect(fishWord("grok")).toBe("grok");
  });

  it("returns null when no fish word is configured", () => {
    expect(fishWord("cursor")).toBe(null);
    expect(fishWord("kimi")).toBe(null);
    expect(fishWord("unknown-provider")).toBe(null);
  });

  it("falls back to the bare binary for providers without a fish word", () => {
    expect(directBinary("cursor")).toBe("cursor-agent");
    expect(directBinary("kimi")).toBe("kimi");
    expect(directBinary("grok")).toBe("grok");
    expect(directBinary("codex")).toBe(null);
  });
});

describe("resolveFishEntry", () => {
  it("prefers the function body when one exists", async () => {
    const run = stubRunner({
      "-i -c functions codex": {
        exitCode: 0,
        stdout: "function codex --wraps codex\nend\n",
      },
    });
    const resolved = await resolveFishEntry("codex", run);
    expect(resolved.kind).toBe("function");
  });

  it("falls back to the abbreviation expansion", async () => {
    const run = stubRunner({
      "-i -c functions claude": { exitCode: 1, stdout: "" },
      [abbrProbe("claude")]: {
        exitCode: 0,
        stdout: "env -u FOO claude --flag\n",
      },
    });
    const resolved = await resolveFishEntry("claude", run);
    expect(resolved).toEqual({
      kind: "abbr",
      expansion: "env -u FOO claude --flag",
    });
  });

  it("strips interactive cursor sequences before matching", async () => {
    const run = stubRunner({
      "-i -c functions agy": { exitCode: 1, stdout: "" },
      [abbrProbe("agy")]: {
        exitCode: 0,
        stdout: "[6 qagy --dangerously-skip-permissions\n",
      },
    });
    const resolved = await resolveFishEntry("agy", run);
    expect(resolved).toEqual({
      kind: "abbr",
      expansion: "agy --dangerously-skip-permissions",
    });
  });

  it("returns none when fish defines neither", async () => {
    const run = stubRunner({
      "-i -c functions nope": { exitCode: 1, stdout: "" },
      [abbrProbe("nope")]: { exitCode: 1, stdout: "" },
    });
    expect(await resolveFishEntry("nope", run)).toEqual({ kind: "none" });
  });

  it("returns none when the expansion is empty", async () => {
    const run = stubRunner({
      "-i -c functions nope": { exitCode: 1, stdout: "" },
      [abbrProbe("nope")]: { exitCode: 0, stdout: "\n" },
    });
    expect(await resolveFishEntry("nope", run)).toEqual({ kind: "none" });
  });
});

describe("resolveFishEntries", () => {
  it("resolves several words in parallel", async () => {
    const run = stubRunner({
      "-i -c functions codex": {
        exitCode: 0,
        stdout: "function codex --wraps codex\nend\n",
      },
      [abbrProbe("claude")]: {
        exitCode: 0,
        stdout: "env -u FOO claude --flag\n",
      },
    });
    const entries = await resolveFishEntries(["codex", "claude"], run);
    expect(entries.get("codex")?.kind).toBe("function");
    expect(entries.get("claude")).toEqual({
      kind: "abbr",
      expansion: "env -u FOO claude --flag",
    });
  });
});

describe("buildFishProgram", () => {
  it("invokes function words by name", () => {
    expect(
      buildFishProgram(
        "codex",
        { kind: "function", body: "function codex\nend" },
        ["explain"],
      ),
    ).toBe("codex 'explain'");
  });

  it("splices abbreviation expansions instead of the bare word", () => {
    expect(
      buildFishProgram(
        "claude",
        { kind: "abbr", expansion: "env -u FOO claude --flag" },
        ["it's here"],
      ),
    ).toBe(String.raw`env -u FOO claude --flag 'it'\''s here'`);
  });

  it("returns null when fish defines neither", () => {
    expect(buildFishProgram("nope", { kind: "none" }, [])).toBe(null);
  });
});

describe("resolveFishProgram", () => {
  it("resolves an abbreviation to its expansion with args", async () => {
    const run = stubRunner({
      "-i -c functions claude": { exitCode: 1, stdout: "" },
      [abbrProbe("claude")]: {
        exitCode: 0,
        stdout: "env -u FOO claude --flag\n",
      },
    });
    await expect(resolveFishProgram("claude", ["go"], run)).resolves.toBe(
      "env -u FOO claude --flag 'go'",
    );
  });

  it("throws when fish defines neither", async () => {
    const run = stubRunner({
      "-i -c functions nope": { exitCode: 1, stdout: "" },
      [abbrProbe("nope")]: { exitCode: 1, stdout: "" },
    });
    await expect(resolveFishProgram("nope", [], run)).rejects.toThrow(
      'fish defines neither a function nor an abbreviation for "nope"',
    );
  });
});

describe("fishSpawnProgram", () => {
  it("quotes extra args for fish", () => {
    expect(fishSpawnProgram("codex", [])).toBe("codex");
    expect(fishSpawnProgram("codex", ["explain", "it's here"])).toBe(
      String.raw`codex 'explain' 'it'\''s here'`,
    );
  });
});

describe("noFishCommand", () => {
  it("keeps the interactive flags for known providers", () => {
    expect(noFishCommand("claude-code")?.argv).toContain(
      "--allow-dangerously-skip-permissions",
    );
    expect(noFishCommand("muse")?.argv).toContain("--yolo");
  });

  it("scrubs direct provider API keys like the fish wrappers", () => {
    expect(noFishCommand("codex")?.scrubEnv).toEqual(
      expect.arrayContaining([
        "OPENAI_API_KEY",
        "CODEX_API_KEY",
        "ANTHROPIC_API_KEY",
      ]),
    );
  });

  it("returns null for unmapped providers", () => {
    expect(noFishCommand("unknown-provider")).toBe(null);
  });

  it("uses the bare cursor-agent binary for --no-fish", () => {
    expect(noFishCommand("cursor")?.argv).toEqual(["cursor-agent"]);
    expect(noFishCommand("kimi")?.argv).toEqual(["kimi"]);
  });
});
