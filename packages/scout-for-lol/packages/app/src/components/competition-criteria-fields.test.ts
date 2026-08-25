import { describe, expect, test } from "vitest";
import { QueueTypeSchema } from "@scout-for-lol/data";
import { queueOptionsForVariant } from "#src/components/competition-criteria-fields.tsx";

describe("competition queue selector", () => {
  test("partitions every one of the 21 canonical queues by game variant", () => {
    const modern = queueOptionsForVariant("MODERN");
    const classic = queueOptionsForVariant("CLASSIC");
    const concrete = [...modern.slice(1), ...classic.slice(1)];

    expect(modern[0]).toBe("ALL");
    expect(classic[0]).toBe("ALL");
    expect(concrete).toHaveLength(21);
    expect(new Set(concrete)).toEqual(new Set(QueueTypeSchema.options));
    expect(classic).toEqual(["ALL", "classic", "classic aram mayhem"]);
    expect(modern).not.toContain("classic");
    expect(modern).not.toContain("classic aram mayhem");
  });

  test("includes Ranked 5s and every Doom Bots difficulty", () => {
    expect(queueOptionsForVariant("MODERN")).toEqual(
      expect.arrayContaining([
        "ranked 5s",
        "easy doom bots",
        "normal doom bots",
        "hard doom bots",
      ]),
    );
  });
});
