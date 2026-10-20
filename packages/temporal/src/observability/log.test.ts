import { afterEach, describe, expect, test, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { log } from "./log.ts";

describe("Temporal worker log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("keeps the reason of an SDK Activity failure error field", () => {
    const lines: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((line: string) => {
      lines.push(line);
    });
    const failure = ApplicationFailure.create({
      message: "Discord returned 503",
      type: "DiscordUnavailable",
      cause: new TypeError("socket closed"),
    });

    log("warning", "Activity failed", { sdk: "temporal", error: failure });

    const [line] = lines;
    if (line === undefined) throw new Error("log wrote no line");
    const entry: unknown = JSON.parse(line);
    expect(entry).toMatchObject({
      msg: "Activity failed",
      error: {
        name: "ApplicationFailure",
        message: "Discord returned 503",
        cause: { name: "TypeError", message: "socket closed" },
      },
    });
  });
});
