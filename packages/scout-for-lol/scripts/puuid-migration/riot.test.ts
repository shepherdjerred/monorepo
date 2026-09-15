import { describe, expect, test } from "vitest";

process.env["OLD_RIOT_API_KEY"] = "test-old";
process.env["NEW_RIOT_API_KEY"] = "test-new";

/**
 * The crash that turned a five-day job into a fifty-two-day one.
 *
 * Riot answers an identifier it cannot decrypt with 400, not 404. Every object
 * written since the cutover carries identifiers minted under the OTHER key, so
 * the old key meets them constantly — and treating the answer as a fault exited
 * the process, which a supervisor restarted into a ten-minute cold-start wait
 * before it reached the next one.
 */
describe("an undecryptable identifier", () => {
  test("is read as data rather than a fault", async () => {
    const { classifyForTest } = await import("./riot.ts");
    const response = Response.json(
      {
        status: {
          message: "Bad Request - Exception decrypting abc",
          status_code: 400,
        },
      },
      { status: 400 },
    );
    await expect(classifyForTest(response, 0)).resolves.toEqual({
      kind: "absent",
    });
  });

  test("a genuinely malformed request is still a fault", async () => {
    const { classifyForTest } = await import("./riot.ts");
    const response = Response.json(
      { status: { message: "Bad request", status_code: 400 } },
      { status: 400 },
    );
    await expect(classifyForTest(response, 0)).rejects.toThrow(/HTTP 400/);
  });

  test("a missing account is still absent", async () => {
    const { classifyForTest } = await import("./riot.ts");
    await expect(
      classifyForTest(new Response("", { status: 404 }), 0),
    ).resolves.toEqual({ kind: "absent" });
  });
});
