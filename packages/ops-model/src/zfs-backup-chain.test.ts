import { describe, expect, test } from "vitest";
import {
  protectZfsBackupChains,
  readZfsStreamHeader,
} from "./zfs-backup-chain.ts";

describe("ZFS backup ancestry", () => {
  test.each([true, false])(
    "reads endian=%s GUIDs without precision loss",
    (little) => {
      const bytes = new Uint8Array(312);
      const view = new DataView(bytes.buffer);
      view.setBigUint64(8, 0x2_f5_ba_cb_acn, little);
      view.setBigUint64(40, 18_446_744_073_709_551_615n, little);
      expect(readZfsStreamHeader(bytes)).toEqual({
        toGuid: "18446744073709551615",
        fromGuid: "0",
      });
      expect(() => readZfsStreamHeader(bytes.subarray(0, 100))).toThrow(
        /Incomplete/,
      );
    },
  );
  test("retains expired parents and reports missing roots instead of approving deletion", () => {
    const base = {
      key: "base",
      backupName: "expired",
      volume: "pv",
      toGuid: "1",
      fromGuid: "0",
    };
    const root = {
      ...base,
      key: "root",
      backupName: "live",
      toGuid: "2",
      fromGuid: "1",
    };
    expect(protectZfsBackupChains([base, root], ["live"])).toEqual({
      protectedBackupNames: ["expired", "live"],
      incompleteRoots: [],
    });
    expect(protectZfsBackupChains([root], ["live"]).incompleteRoots).toEqual([
      "root",
    ]);
    expect(() => protectZfsBackupChains([base, base], ["live"])).toThrow(
      /Ambiguous/,
    );
    expect(() =>
      protectZfsBackupChains([{ ...base, fromGuid: "2" }, root], ["live"]),
    ).toThrow(/Cyclic/);
  });
});
