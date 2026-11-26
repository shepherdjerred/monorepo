import { expect, it } from "vitest";

it("loads the router module: no procedure uses a name tRPC reserves", async () => {
  const { appRouter } = await import("./router.ts");
  const procedures = Object.keys(appRouter._def.procedures);
  expect(procedures).toContain("boards.applyOps");
  expect(procedures).not.toContain("boards.apply");
  expect(procedures).toEqual(
    expect.arrayContaining([
      "boards.list",
      "artifacts.get",
      "versions.rotateToken",
      "threads.reply",
      "feedback.claim",
      "inbox.list",
      "maintenance.cleanup",
    ]),
  );
});
