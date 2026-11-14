import { describe, expect, test } from "vitest";
import { testAccountId } from "#src/testing/test-ids.ts";
import {
  authenticateOperationsMachine,
  type OperationsMachineCredential,
} from "#src/operations/machine-credential.ts";

function digest(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

const FIRST = `sop_${"a".repeat(43)}`;
const SECOND = `sop_${"b".repeat(43)}`;
const credentials: OperationsMachineCredential[] = [
  {
    label: "first",
    operator: testAccountId("930000001"),
    tokenDigest: digest(FIRST),
  },
  {
    label: "second",
    operator: testAccountId("930000002"),
    tokenDigest: digest(SECOND),
  },
];

describe("authenticateOperationsMachine", () => {
  test("a token selects exactly the credential whose digest it matches", () => {
    expect(
      authenticateOperationsMachine(`Bearer ${SECOND}`, credentials)?.label,
    ).toBe("second");
    expect(
      authenticateOperationsMachine(`Bearer ${FIRST}`, credentials)?.label,
    ).toBe("first");
  });

  test.each([
    ["no header", null],
    ["an unknown token", `Bearer sop_${"c".repeat(43)}`],
    ["a different scheme", `Basic ${FIRST}`],
    ["a non-operations bearer token", `Bearer sct_${"a".repeat(43)}`],
    ["a lowercase scheme", `bearer ${FIRST}`],
  ])("%s authenticates nothing", (_name, header) => {
    expect(authenticateOperationsMachine(header, credentials)).toBeNull();
  });

  test("no configured credentials authenticate nothing", () => {
    expect(authenticateOperationsMachine(`Bearer ${FIRST}`, [])).toBeNull();
  });
});
