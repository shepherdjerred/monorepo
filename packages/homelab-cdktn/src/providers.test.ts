import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  loadProviderPins,
  lockedProviders,
  requirePin,
} from "homelab/scripts/tofu/provider-versions.ts";
import { SYNTHESIZED_STACKS } from "#src/app.ts";
import { bindingSpecification } from "#scripts/generate-bindings.ts";
import {
  exactPinConfiguration,
  staleLockEntries,
  withConstraintsOf,
} from "#scripts/refresh-providers.ts";

const TOFU_ROOT = path.resolve(import.meta.dir, "../../homelab/src/tofu");

async function lockOf(stack: string): Promise<string> {
  return Bun.file(path.join(TOFU_ROOT, stack, ".terraform.lock.hcl")).text();
}

describe("provider pins", () => {
  test("every provider any stack has locked is pinned", async () => {
    const pins = await loadProviderPins();
    const locks = await Array.fromAsync(
      new Bun.Glob("*/.terraform.lock.hcl").scan({ cwd: TOFU_ROOT, dot: true }),
    );
    expect(locks.length).toBeGreaterThanOrEqual(18);
    for (const lock of locks) {
      const locked = lockedProviders(
        await Bun.file(path.join(TOFU_ROOT, lock)).text(),
      );
      expect(locked.length, lock).toBeGreaterThan(0);
      for (const { address } of locked)
        expect(() => requirePin(pins, address), lock).not.toThrow();
    }
  });

  test("a synthesized stack runs exactly the pinned versions its bindings were generated from", async () => {
    const pins = await loadProviderPins();
    for (const stack of SYNTHESIZED_STACKS) {
      const lock = await lockOf(stack);
      // providers:refresh moves a lock to the pins; a difference here is a
      // provider bump that was only half applied.
      expect(staleLockEntries(lock, pins), stack).toEqual([]);
      for (const { address } of lockedProviders(lock))
        expect(requirePin(pins, address).bindings, `${stack}: ${address}`).toBe(
          true,
        );
    }
  });

  test("reports each locked provider whose version differs from its pin, never a local one", async () => {
    const pins = await loadProviderPins();
    const github = requirePin(
      pins,
      "registry.opentofu.org/integrations/github",
    );
    const asuswrt = requirePin(
      pins,
      "registry.opentofu.org/shepherdjerred/asuswrt",
    );
    expect(
      staleLockEntries(
        [
          'provider "registry.opentofu.org/integrations/github" {',
          '  version     = "0.0.1"',
          '  constraints = "~> 0.0"',
          "}",
          'provider "registry.opentofu.org/shepherdjerred/asuswrt" {',
          '  version = "0.0.1"',
          "}",
          "",
        ].join("\n"),
        pins,
      ),
    ).toEqual([
      {
        address: "registry.opentofu.org/integrations/github",
        locked: "0.0.1",
        pinned: github.version,
      },
    ]);
    expect(asuswrt.local).toBe(true);
    expect(() =>
      staleLockEntries(
        'provider "registry.opentofu.org/x/unpinned" {\n  version = "1.0.0"\n}\n',
        pins,
      ),
    ).toThrow("has no pin");
  });
});

describe("binding generation", () => {
  test("keeps the bare source for the default registry and spells out another", () => {
    expect(
      bindingSpecification({
        registryUrl: "https://registry.opentofu.org",
        source: "integrations/github",
        version: "6.13.0",
      }),
    ).toEqual({
      name: "github",
      source: "integrations/github",
      version: "6.13.0",
    });
    expect(
      bindingSpecification({
        registryUrl: "https://registry.terraform.io",
        source: "alpaca744/discord",
        version: "0.1.3",
      }),
    ).toEqual({
      name: "discord",
      source: "registry.terraform.io/alpaca744/discord",
      version: "0.1.3",
    });
  });

  test("two providers of one type generate into different directories", async () => {
    const pins = await loadProviderPins();
    const names = pins.map((pin) => bindingSpecification(pin).name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("openai");
    expect(names).toContain("openaikeys");
  });
});

describe("lock refresh", () => {
  test("locks exactly the pinned versions, by full registry address", () => {
    expect(
      JSON.parse(
        exactPinConfiguration([
          {
            registryUrl: "https://registry.opentofu.org",
            source: "integrations/github",
            version: "6.13.0",
          },
          {
            registryUrl: "https://registry.terraform.io",
            source: "alpaca744/discord",
            version: "0.1.3",
          },
        ]),
      ),
    ).toEqual({
      terraform: {
        required_providers: {
          p0: {
            source: "registry.opentofu.org/integrations/github",
            version: "6.13.0",
          },
          p1: {
            source: "registry.terraform.io/alpaca744/discord",
            version: "0.1.3",
          },
        },
      },
    });
  });

  test("keeps each stack's own constraint over the scratch module's exact one", () => {
    const fresh = [
      'provider "registry.opentofu.org/1password/onepassword" {',
      '  version     = "3.4.1"',
      '  constraints = "3.4.1"',
      "  hashes = [",
      '    "h1:new=",',
      "  ]",
      "}",
      "",
      'provider "registry.opentofu.org/argoproj-labs/argocd" {',
      '  version     = "7.17.1"',
      '  constraints = "7.17.1"',
      "}",
      "",
    ].join("\n");
    const previous = [
      'provider "registry.opentofu.org/argoproj-labs/argocd" {',
      '  version     = "7.17.1"',
      '  constraints = "~> 7.0"',
      "}",
      "",
      'provider "registry.opentofu.org/1password/onepassword" {',
      '  version     = "3.3.1"',
      '  constraints = "~> 3.0"',
      "  hashes = [",
      '    "h1:old=",',
      "  ]",
      "}",
      "",
    ].join("\n");
    expect(withConstraintsOf(fresh, previous)).toBe(
      fresh
        .replace('constraints = "3.4.1"', 'constraints = "~> 3.0"')
        .replace('constraints = "7.17.1"', 'constraints = "~> 7.0"'),
    );
  });

  test("the committed github lock is what a refresh of its pins would write", async () => {
    // Same versions and constraints in, same file out: the rewrite is a no-op.
    const lock = await lockOf("github");
    expect(withConstraintsOf(lock, lock)).toBe(lock);
  });
});
