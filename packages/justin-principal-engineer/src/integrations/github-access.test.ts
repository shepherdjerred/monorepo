import { afterEach, describe, expect, test, vi } from "vitest";
import { ConfigSchema } from "#src/domain/schemas.ts";
import { checkBranchProtectionAccess } from "#src/integrations/github-access.ts";

afterEach(() => vi.restoreAllMocks());

async function repository() {
  const config = ConfigSchema.parse(
    await Bun.file(
      new URL("../../config.example.json", import.meta.url),
    ).json(),
  );
  return config.repository;
}

describe("GitHub App branch protection preflight", () => {
  test("reads protection on the configured branch with the bot credential", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({}));
    const value = { ...(await repository()), baseBranch: "release/test" };
    await checkBranchProtectionAccess(value, "fixture-credential");
    expect(request).toHaveBeenCalledWith(
      `https://api.github.com/repos/${value.slug}/branches/release%2Ftest/protection`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fixture-credential",
        }),
      }),
    );
  });

  test("accepts GitHub's explicit unprotected-branch response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ message: "Branch not protected" }, { status: 404 }),
    );
    await expect(
      checkBranchProtectionAccess(await repository(), "fixture"),
    ).resolves.toBeUndefined();
  });

  test("rejects a missing branch instead of treating every 404 as unprotected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ message: "Not Found" }, { status: 404 }),
    );
    await expect(
      checkBranchProtectionAccess(await repository(), "fixture"),
    ).rejects.toThrow("HTTP 404");
  });

  test("reports the missing permission without echoing a response body", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("credential-echo-fixture", { status: 403 }),
    );
    await expect(
      checkBranchProtectionAccess(await repository(), "fixture"),
    ).rejects.toThrow("Administration read access");
    await expect(
      checkBranchProtectionAccess(await repository(), "fixture"),
    ).rejects.not.toThrow("credential-echo-fixture");
  });

  test("keeps provider failures separate from permission failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 500 }),
    );
    await expect(
      checkBranchProtectionAccess(await repository(), "fixture"),
    ).rejects.toThrow("HTTP 500");
  });
});
