import { afterEach, describe, expect, test, vi } from "vitest";
import { ConfigSchema } from "#src/domain/schemas.ts";
import { checkConnections } from "#src/integrations/preflight.ts";
import type { CommandRunner } from "#src/runtime/process.ts";

afterEach(() => vi.restoreAllMocks());
async function config() {
  return ConfigSchema.parse(
    await Bun.file(
      new URL("../../config.example.json", import.meta.url),
    ).json(),
  );
}
const run: CommandRunner = async () => ({
  exitCode: 0,
  stdout: "fixture-credential",
  stderr: "",
  timedOut: false,
});

describe("connection preflight", () => {
  test("rejects a wrong-provider credential before reaching CI without echoing the response body", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("credential-echo-fixture", { status: 401 }),
      );
    await expect(checkConnections(await config(), run)).rejects.toThrow(
      "native OpenAI credential",
    );
    expect(request).toHaveBeenCalledTimes(1);
    await expect(checkConnections(await config(), run)).rejects.not.toThrow(
      "credential-echo-fixture",
    );
  });
  test("validates both native model access and the exact CI repository", async () => {
    const value = await config();
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id: value.agents.codex.model }))
      .mockResolvedValueOnce(
        Response.json({
          id: value.woodpecker.repoId,
          full_name: value.repository.slug,
        }),
      );
    await checkConnections(value, run);
    expect(request.mock.calls[0]?.[0]).toBe(
      `https://api.openai.com/v1/models/${value.agents.codex.model}`,
    );
    expect(request.mock.calls[1]?.[0]).toEqual(
      new URL("https://woodpecker.sjer.red/api/repos/1"),
    );
  });
  test("rejects valid credentials pointing at a different repository", async () => {
    const value = await config();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id: value.agents.codex.model }))
      .mockResolvedValueOnce(
        Response.json({ id: 1, full_name: "other/repository" }),
      );
    await expect(checkConnections(value, run)).rejects.toThrow(
      "does not match repository.slug",
    );
  });
  test("reports CI authorization separately from OpenAI authentication", async () => {
    const value = await config();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id: value.agents.codex.model }))
      .mockResolvedValueOnce(new Response("", { status: 403 }));
    await expect(checkConnections(value, run)).rejects.toThrow(
      "Woodpecker repository access failed (HTTP 403)",
    );
  });
});
