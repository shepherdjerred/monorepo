import { expect, test, vi } from "vitest";
import {
  helperSigningForReceipt,
  installLocalHelper,
  requireHelperProvenance,
  signatureRequirement,
} from "./helper.ts";

const originalIdentity = "C445EC1DD505AB262B88427771DCF284D43B613C";
const miniIdentity = "24A3B092357E0CF905EF748F63104EBE6ED64C79";
const team = "63ZAG7X889";
const identifier = "red.sjer.facet.acceptance.credentials";
function receipt(identity: string) {
  return {
    schemaVersion: 1,
    kind: "facet-local-credential-helper",
    identity,
    team,
    identifier,
    compilerVersion: "Apple Swift version synthetic",
    helperSHA256: "a".repeat(64),
    sourceFiles: {
      "LocalCredentialStore.swift": "b".repeat(64),
      "main.swift": "c".repeat(64),
    },
  };
}

test.each([
  [originalIdentity, miniIdentity],
  [miniIdentity, originalIdentity],
])("receipt for %s selects only its exact trusted leaf", (identity, other) => {
  const retained = receipt(identity);
  const signing = helperSigningForReceipt(retained);
  expect(signing).toEqual({ identity, team, identifier });
  expect(() =>
    requireHelperProvenance(retained, receipt(identity)),
  ).not.toThrow();
  const requirement = signatureRequirement(signing.identity, signing.team);
  expect(requirement).toBe(
    `=identifier "${identifier}" and certificate leaf = H"${identity}" and certificate leaf[subject.OU] = "${team}"`,
  );
  expect(requirement).not.toContain(other);
});

test.each([
  null,
  {},
  { ...receipt(originalIdentity), identity: "a".repeat(40) },
  { ...receipt(miniIdentity), team: "OTHERTEAM1" },
  { ...receipt(miniIdentity), identifier: "red.sjer.toolkit" },
  { ...receipt(miniIdentity), identity: miniIdentity.toLowerCase() },
])(
  "unknown or changed signing profiles fail before signature dispatch",
  (value) => {
    expect(() => helperSigningForReceipt(value)).toThrow(
      "local_credentials_helper_provenance",
    );
  },
);

test("a second trusted leaf cannot replace an existing receipt's signer", () => {
  expect(() =>
    requireHelperProvenance(receipt(miniIdentity), receipt(originalIdentity)),
  ).toThrow("local_credentials_helper_provenance");
  expect(() =>
    requireHelperProvenance(receipt(originalIdentity), receipt(miniIdentity)),
  ).toThrow("local_credentials_helper_provenance");
});

test.each([
  ["a".repeat(40), team],
  [miniIdentity, "OTHERTEAM1"],
])(
  "setup rejects an untrusted identity/team before any tool",
  (identity, selectedTeam) => {
    const run = vi.fn();
    expect(() => installLocalHelper(identity, selectedTeam, run)).toThrow(
      "local_credentials_helper_signing_identity",
    );
    expect(run).not.toHaveBeenCalled();
    expect(() => signatureRequirement(identity, selectedTeam)).toThrow(
      "local_credentials_helper_signing_identity",
    );
  },
);
