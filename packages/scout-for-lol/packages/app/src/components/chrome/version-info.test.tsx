import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { VersionResponse } from "#src/lib/build-info.ts";

const ARCHIVE = `scout-site@sha256:${"0123456789abcdef".repeat(4)}`;

function backendVersion(
  overrides: Partial<VersionResponse> = {},
): VersionResponse {
  return {
    version: "2.0.0-6017",
    gitSha: "24e5a5ebe4302e6dc99efc1c3706e7541d9b33dc",
    contractHash: "api-hash",
    canViewContractMismatch: true,
    ...overrides,
  };
}

/**
 * `buildInfo` reads `import.meta.env` once at module load, so each case stubs
 * the release env and re-imports the component to get a bundle identity.
 */
async function renderBanner(
  env: Record<string, string>,
  backend: VersionResponse | undefined,
): Promise<string> {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  // The chip remembers dismissals in localStorage, which Bun does not provide.
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  });
  const { ContractMismatchBanner } = await import("./version-info.tsx");
  const queryClient = new QueryClient();
  if (backend !== undefined)
    queryClient.setQueryData(["backend-version"], backend);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ContractMismatchBanner />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ContractMismatchBanner", () => {
  test("renders nothing before the backend version has loaded", async () => {
    expect(
      await renderBanner({ VITE_CONTRACT_HASH: "app-hash" }, undefined),
    ).toBe("");
  });

  test("renders nothing for a session that may not view the diagnostic", async () => {
    expect(
      await renderBanner(
        { VITE_CONTRACT_HASH: "app-hash" },
        backendVersion({ canViewContractMismatch: false }),
      ),
    ).toBe("");
  });

  test("renders nothing when both sides share a contract hash", async () => {
    expect(
      await renderBanner({ VITE_CONTRACT_HASH: "api-hash" }, backendVersion()),
    ).toBe("");
  });

  test("renders nothing in a dev bundle even against a real backend hash", async () => {
    expect(await renderBanner({}, backendVersion())).toBe("");
  });

  test("names the archive identity and the backend version, never a baked app version", async () => {
    const markup = await renderBanner(
      { VITE_CONTRACT_HASH: "app-hash", VITE_BUGSINK_RELEASE: ARCHIVE },
      backendVersion(),
    );
    expect(markup).toContain(
      "Version mismatch (app scout-site@sha256:0123456789ab, api 2.0.0-6017)",
    );
    expect(markup).toContain("Reload");
    expect(markup).toContain('aria-label="Dismiss"');
  });

  test("reports no archive identity outside a release build", async () => {
    const markup = await renderBanner(
      { VITE_CONTRACT_HASH: "app-hash" },
      backendVersion(),
    );
    expect(markup).toContain("Version mismatch (app none, api 2.0.0-6017)");
  });
});

describe("mismatchChipLabel", () => {
  test("pairs the short archive identity with the backend version", async () => {
    const { mismatchChipLabel } = await import("./version-info.tsx");
    expect(
      mismatchChipLabel(
        { release: ARCHIVE, contractHash: "app-hash" },
        backendVersion(),
      ),
    ).toBe(
      "Version mismatch (app scout-site@sha256:0123456789ab, api 2.0.0-6017)",
    );
  });
});
