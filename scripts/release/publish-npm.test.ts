import { describe, expect, test } from "vitest";

import {
  assertNotDeliveryChannelRelease,
  buildWorkflowDispatchArgs,
  normalizePackageDir,
  parseLsRemoteRefs,
  resolveDispatchSource,
  type GitInspector,
} from "./npm-publish-dispatch.ts";
import {
  EXPIRY_WARNING_DAYS,
  expiryWarning,
  verifyTokenBypasses2fa,
  parseArgs,
  type TokenIntrospectionFetcher,
} from "./publish-npm.ts";

const now = new Date("2026-08-21T00:00:00Z");

function respondWith(body: unknown, status = 200): TokenIntrospectionFetcher {
  return async () => Response.json(body, { status });
}

function inDays(days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

describe("expiryWarning", () => {
  test("stays quiet for a token that is not close to expiring", () => {
    expect(
      expiryWarning({ expiry: inDays(EXPIRY_WARNING_DAYS + 1) }, now),
    ).toBeNull();
  });

  test("stays quiet for a token with no expiry", () => {
    expect(expiryWarning({}, now)).toBeNull();
    expect(expiryWarning({ expiry: "" }, now)).toBeNull();
  });

  test("warns inside the window and names the rotation target", () => {
    const warning = expiryWarning({ expiry: inDays(3) }, now);
    expect(warning).toContain("expires in 3 day(s)");
    expect(warning).toContain("CI npm Credentials");
  });

  // The outage this exists to prevent: an already-lapsed token 401s every
  // call, which reads as an unrelated failure unless something says so.
  test("reports a token that already lapsed", () => {
    const warning = expiryWarning({ expiry: inDays(-2) }, now);
    expect(warning).toContain("2 day(s) AGO");
  });

  test("refuses an unparsable expiry rather than ignoring it", () => {
    expect(() => expiryWarning({ expiry: "not-a-date" }, now)).toThrow(
      "unparsable expiry",
    );
  });
});

describe("verifyTokenBypasses2fa", () => {
  const token = `npm_${"x".repeat(36)}`;
  const maskedEntry = (extra: Record<string, unknown>) => ({
    token: `${token.slice(0, 8)}...${token.slice(-4)}`,
    name: "1Password",
    bypass_2fa: true,
    ...extra,
  });

  test("calls a 401 a credential rotation, not an introspection failure", async () => {
    const failure: unknown = await verifyTokenBypasses2fa(token, {
      fetcher: respondWith({}, 401),
      now,
    }).catch((error: unknown) => error);

    const message = failure instanceof Error ? failure.message : "";
    expect(message).toContain("npm rejected NPM_TOKEN (HTTP 401)");
    expect(message).toContain("expired, revoked");
    expect(message).not.toContain("introspection failed");
  });

  test("still reports other HTTP failures as introspection failures", async () => {
    const failure: unknown = await verifyTokenBypasses2fa(token, {
      fetcher: respondWith({}, 500),
      now,
    }).catch((error: unknown) => error);

    expect(failure instanceof Error ? failure.message : "").toContain(
      "npm token introspection failed (page 1)",
    );
  });

  test("rejects a token that does not bypass 2FA", async () => {
    const failure: unknown = await verifyTokenBypasses2fa(token, {
      fetcher: respondWith({
        objects: [maskedEntry({ bypass_2fa: false })],
      }),
      now,
    }).catch((error: unknown) => error);

    expect(failure instanceof Error ? failure.message : "").toContain(
      "does not bypass 2FA",
    );
  });

  test("warns through the injected warner when expiry is near", async () => {
    const warnings: string[] = [];
    await verifyTokenBypasses2fa(token, {
      fetcher: respondWith({ objects: [maskedEntry({ expiry: inDays(5) })] }),
      now,
      warn: (message) => warnings.push(message),
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("expires in 5 day(s)");
  });

  test("says nothing when a healthy token is far from expiry", async () => {
    const warnings: string[] = [];
    await verifyTokenBypasses2fa(token, {
      fetcher: respondWith({ objects: [maskedEntry({ expiry: inDays(89) })] }),
      now,
      warn: (message) => warnings.push(message),
    });

    expect(warnings).toEqual([]);
  });

  test("follows pagination to find a token on a later page", async () => {
    const pages: string[] = [];
    const fetcher: TokenIntrospectionFetcher = async (url) => {
      pages.push(url);
      return pages.length === 1
        ? Response.json({
            objects: [],
            urls: { next: "/-/npm/v1/tokens?page=2" },
          })
        : Response.json({ objects: [maskedEntry({})] });
    };

    await verifyTokenBypasses2fa(token, { fetcher, now });
    expect(pages).toHaveLength(2);
    expect(pages[1]).toBe("https://registry.npmjs.org/-/npm/v1/tokens?page=2");
  });
});

describe("normalizePackageDir", () => {
  test("normalizes dot directory relative to package root", () => {
    expect(normalizePackageDir(".", "/repo/packages/webring", "/repo")).toBe(
      "packages/webring",
    );
  });

  test("normalizes repo-relative path", () => {
    expect(normalizePackageDir("packages/webring", "/repo", "/repo")).toBe(
      "packages/webring",
    );
  });

  test("normalizes nested package directory", () => {
    expect(
      normalizePackageDir(
        ".",
        "/repo/packages/homelab/src/helm-types",
        "/repo",
      ),
    ).toBe("packages/homelab/src/helm-types");
  });
});

const MAIN_SHA = "a".repeat(40);
const FEATURE_SHA = "b".repeat(40);
const TAG_OBJECT_SHA = "c".repeat(40);
const TAG_COMMIT_SHA = "d".repeat(40);
const OLD_MAIN_SHA = "e".repeat(40);

function makeGitInspector(overrides: Partial<GitInspector> = {}): GitInspector {
  return {
    statusPorcelain: async () => "",
    headSha: async () => FEATURE_SHA,
    symbolicRef: async () => "refs/heads/feat/test-branch",
    lsRemoteOrigin: async () =>
      [
        `${MAIN_SHA}\trefs/heads/main`,
        `${FEATURE_SHA}\trefs/heads/feat/test-branch`,
      ].join("\n"),
    supportsSourceShaAtHead: async () => true,
    isAncestorOfOriginMain: async () => false,
    ...overrides,
  };
}

describe("assertNotDeliveryChannelRelease", () => {
  test("rejects production releases of Delivery channel package webring", () => {
    expect(() =>
      assertNotDeliveryChannelRelease({
        packageDir: "packages/webring",
        tag: "latest",
        devSuffix: "",
      }),
    ).toThrow("Delivery webring/latest channel");
  });

  test("rejects dev tag without devSuffix or latest tag with devSuffix on webring", () => {
    expect(() =>
      assertNotDeliveryChannelRelease({
        packageDir: "packages/webring",
        tag: "dev",
        devSuffix: "",
      }),
    ).toThrow("Delivery webring/latest channel");

    expect(() =>
      assertNotDeliveryChannelRelease({
        packageDir: "packages/webring",
        tag: "latest",
        devSuffix: "4",
      }),
    ).toThrow("Delivery webring/latest channel");
  });

  test("permits ephemeral dev releases of webring and production releases of non-channel packages", () => {
    expect(() =>
      assertNotDeliveryChannelRelease({
        packageDir: "packages/webring",
        tag: "dev",
        devSuffix: "4",
      }),
    ).not.toThrow();

    expect(() =>
      assertNotDeliveryChannelRelease({
        packageDir: "packages/astro-opengraph-images",
        tag: "latest",
        devSuffix: "",
      }),
    ).not.toThrow();
  });
});

describe("parseLsRemoteRefs", () => {
  test("parses branch heads and resolves peeled annotated tag commits", () => {
    const parsed = parseLsRemoteRefs(
      [
        `${MAIN_SHA}\trefs/heads/main`,
        `${TAG_OBJECT_SHA}\trefs/tags/astro-opengraph-images-v1.18.0`,
        `${TAG_COMMIT_SHA}\trefs/tags/astro-opengraph-images-v1.18.0^{}`,
      ].join("\n"),
    );

    expect(parsed.heads.get("refs/heads/main")).toBe(MAIN_SHA);
    expect(parsed.tags.get("refs/tags/astro-opengraph-images-v1.18.0")).toBe(
      TAG_COMMIT_SHA,
    );
  });
});

describe("resolveDispatchSource", () => {
  test("rejects uncommitted or untracked local changes", async () => {
    await expect(
      resolveDispatchSource(
        makeGitInspector({
          statusPorcelain: async () => " M packages/webring/src/index.ts\n",
        }),
      ),
    ).rejects.toThrow("uncommitted or untracked local changes");
  });

  test("rejects a local branch whose HEAD differs from origin", async () => {
    await expect(
      resolveDispatchSource(
        makeGitInspector({
          lsRemoteOrigin: async () =>
            `${MAIN_SHA}\trefs/heads/feat/test-branch`,
        }),
      ),
    ).rejects.toThrow("differs from origin");
  });

  test("rejects an unpushed local branch with unpublished commits", async () => {
    await expect(
      resolveDispatchSource(
        makeGitInspector({
          lsRemoteOrigin: async () => `${MAIN_SHA}\trefs/heads/main`,
        }),
      ),
    ).rejects.toThrow("is not published on origin");
  });

  test("resolves a pushed feature branch with workflowRef, sourceRef, and sourceSha", async () => {
    await expect(resolveDispatchSource(makeGitInspector())).resolves.toEqual({
      workflowRef: "feat/test-branch",
      sourceRef: "refs/heads/feat/test-branch",
      sourceSha: FEATURE_SHA,
    });
  });

  test("omits workflowRef when checked-out commit predates source_sha workflow input", async () => {
    await expect(
      resolveDispatchSource(
        makeGitInspector({
          supportsSourceShaAtHead: async () => false,
        }),
      ),
    ).resolves.toEqual({
      sourceRef: "refs/heads/feat/test-branch",
      sourceSha: FEATURE_SHA,
    });
  });

  test("resolves detached HEAD at a published annotated release tag", async () => {
    await expect(
      resolveDispatchSource(
        makeGitInspector({
          headSha: async () => TAG_COMMIT_SHA,
          symbolicRef: async () => null,
          lsRemoteOrigin: async () =>
            [
              `${MAIN_SHA}\trefs/heads/main`,
              `${TAG_OBJECT_SHA}\trefs/tags/helm-types-v1.3.0`,
              `${TAG_COMMIT_SHA}\trefs/tags/helm-types-v1.3.0^{}`,
            ].join("\n"),
        }),
      ),
    ).resolves.toEqual({
      workflowRef: "helm-types-v1.3.0",
      sourceRef: "refs/tags/helm-types-v1.3.0",
      sourceSha: TAG_COMMIT_SHA,
    });
  });

  test("resolves detached HEAD at an older ancestor commit on origin/main", async () => {
    await expect(
      resolveDispatchSource(
        makeGitInspector({
          headSha: async () => OLD_MAIN_SHA,
          symbolicRef: async () => null,
          lsRemoteOrigin: async () => `${MAIN_SHA}\trefs/heads/main`,
          isAncestorOfOriginMain: async (head, main) =>
            head === OLD_MAIN_SHA && main === MAIN_SHA,
        }),
      ),
    ).resolves.toEqual({
      sourceRef: OLD_MAIN_SHA,
      sourceSha: OLD_MAIN_SHA,
    });
  });

  test("rejects detached HEAD that is not published on origin", async () => {
    await expect(
      resolveDispatchSource(
        makeGitInspector({
          headSha: async () => OLD_MAIN_SHA,
          symbolicRef: async () => null,
          lsRemoteOrigin: async () => `${MAIN_SHA}\trefs/heads/main`,
          isAncestorOfOriginMain: async () => false,
        }),
      ),
    ).rejects.toThrow("Detached HEAD");
  });
});

describe("buildWorkflowDispatchArgs", () => {
  test("formats workflow dispatch command arguments with explicit source ref and sha", () => {
    const args = buildWorkflowDispatchArgs({
      packageDir: "packages/astro-opengraph-images",
      tag: "latest",
      workflowRef: "main",
      sourceRef: "refs/heads/main",
      sourceSha: MAIN_SHA,
    });
    expect(args).toEqual([
      "workflow",
      "run",
      "npm-publish.yml",
      "--ref",
      "main",
      "-F",
      "package_dir=packages/astro-opengraph-images",
      "-F",
      "tag=latest",
      "-F",
      "source_ref=refs/heads/main",
      "-F",
      `source_sha=${MAIN_SHA}`,
    ]);
  });

  test("includes dev suffix and dry-run flags and omits --ref when running default-branch workflow", () => {
    const args = buildWorkflowDispatchArgs({
      packageDir: "packages/astro-opengraph-images",
      tag: "dev",
      sourceRef: OLD_MAIN_SHA,
      sourceSha: OLD_MAIN_SHA,
      devSuffix: "15",
      dryRun: true,
    });
    expect(args).toEqual([
      "workflow",
      "run",
      "npm-publish.yml",
      "-F",
      "package_dir=packages/astro-opengraph-images",
      "-F",
      "tag=dev",
      "-F",
      `source_ref=${OLD_MAIN_SHA}`,
      "-F",
      `source_sha=${OLD_MAIN_SHA}`,
      "-F",
      "dev_suffix=15",
      "-F",
      "dry_run=true",
    ]);
  });
});

describe("parseArgs", () => {
  test("defaults dispatch to true when NPM_TOKEN is unset in environment", () => {
    const parsed = parseArgs(["packages/webring"], {});
    expect(parsed.dispatch).toBe(true);
    expect(parsed.tag).toBe("latest");
    expect(parsed.pkgDir).toBe("packages/webring");
  });

  test("defaults dispatch to false when NPM_TOKEN is present in environment", () => {
    const parsed = parseArgs(["packages/webring"], {
      NPM_TOKEN: "npm_test123",
    });
    expect(parsed.dispatch).toBe(false);
  });

  test("allows explicitly forcing --dispatch even with NPM_TOKEN set", () => {
    const parsed = parseArgs(["packages/webring", "--dispatch"], {
      NPM_TOKEN: "npm_test123",
    });
    expect(parsed.dispatch).toBe(true);
  });

  test("allows explicitly forcing --no-dispatch even with NPM_TOKEN unset", () => {
    const parsed = parseArgs(["packages/webring", "--no-dispatch"], {});
    expect(parsed.dispatch).toBe(false);
  });

  test("infers dev tag when devSuffix is passed", () => {
    const parsed = parseArgs(["packages/webring", "--dev-suffix", "3"], {});
    expect(parsed.tag).toBe("dev");
    expect(parsed.devSuffix).toBe("3");
  });
});

describe("npm-publish.yml workflow contract", () => {
  test("prefixes package directories with ./ so npm never parses two-segment paths as github: shorthand", async () => {
    const workflow = await Bun.file(
      new URL("../../.github/workflows/npm-publish.yml", import.meta.url),
    ).text();
    expect(workflow).toContain('npm publish "./${PKG_DIR}"');
    expect(workflow).not.toContain('npm publish "${PKG_DIR}"');
  });
});
