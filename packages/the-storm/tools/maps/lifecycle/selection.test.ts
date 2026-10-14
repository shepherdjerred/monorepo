import { describe, expect, it, vi } from "vitest";
import { runtimeSequence, selectRuntimeMap } from "./selection.ts";

const catalog = [
  "warlords-castles",
  "modified-tropicals",
  "training-yard",
] satisfies [string, string, string];
const limits = { minimumRotations: 3, catalog, requiredMaps: catalog };

describe("explicit private resource sequence", () => {
  it("keeps ordinary random rotation as the default and permits a deliberate retirement revisit", () => {
    expect(runtimeSequence(undefined, limits)).toBeUndefined();
    const planned = [...catalog, "modified-tropicals"];
    expect(runtimeSequence(planned, limits)).toEqual(planned);
  });

  it("rejects short, overlong, unknown or incomplete sequences before any operator selection", () => {
    expect(() => runtimeSequence(catalog.slice(0, 2), limits)).toThrow();
    expect(() =>
      runtimeSequence(
        Array.from({ length: 13 }, () => catalog[0]),
        limits,
      ),
    ).toThrow();
    expect(() => runtimeSequence([...catalog, "unknown"], limits)).toThrow(
      "unknown",
    );
    expect(() =>
      runtimeSequence([catalog[0], catalog[1], catalog[0]], limits),
    ).toThrow("omits");
  });

  it("uses the normal operator command and requires its accepted response", async () => {
    const command = vi.fn(
      async () => "The next match is played on Warlords Castles.",
    );
    await expect(
      selectRuntimeMap(catalog[0], catalog, command),
    ).resolves.toContain("Warlords");
    expect(command).toHaveBeenCalledExactlyOnceWith(
      "rwf admin setmap warlords-castles",
    );
  });

  it("rejects an unknown target without writing and a refused selection without retrying", async () => {
    const command = vi.fn(async () => "The map is locked.");
    await expect(selectRuntimeMap("unknown", catalog, command)).rejects.toThrow(
      "unknown",
    );
    expect(command).not.toHaveBeenCalled();
    await expect(
      selectRuntimeMap(catalog[0], catalog, command),
    ).rejects.toThrow("refused");
    expect(command).toHaveBeenCalledTimes(1);
  });
});
