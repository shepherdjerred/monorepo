import { expect, test } from "vitest";
import {
  signingConfiguration,
  signingCommand,
  signatureVerificationCommand,
} from "./release-policy";

const configuration = {
  schemaVersion: 1,
  keystorePath: "/secure/facet-upload.p12",
  storeType: "PKCS12",
  alias: "facet-upload",
  certificateSHA256: "a".repeat(64),
  storePasswordReference: "op://test-vault/test-item/store-password",
  keyPasswordReference: "op://test-vault/test-item/key-password",
};

test("release signing injects credentials only into the signing child and pins strict verification", () => {
  const parsed = signingConfiguration(configuration, "/workspace/repo");
  const command = signingCommand(parsed, "unsigned.aab", "signed.aab");
  expect(command).toContain("-storepass:env");
  expect(command).toContain("-keypass:env");
  expect(command.join(" ")).not.toContain("op://");
  expect(signatureVerificationCommand(parsed, "signed.aab")).toContain(
    "-strict",
  );
  expect(signatureVerificationCommand(parsed, "signed.aab").at(-1)).toBe(
    "facet-upload",
  );
});

test("release bootstrap rejects plaintext, unknown versions, unpinned certificates and repository keys", () => {
  for (const change of [
    { schemaVersion: 2 },
    { certificateSHA256: "unknown" },
    { storePasswordReference: "plaintext" },
    { keyPasswordReference: "plaintext" },
    { keystorePath: "/workspace/repo/signing.p12" },
    { keystorePath: "relative.p12" },
    { keystorePath: "/workspace/repo/..signing.p12" },
    { alias: "-other" },
    { unknown: true },
  ])
    expect(() =>
      signingConfiguration({ ...configuration, ...change }, "/workspace/repo"),
    ).toThrow();
});

test("password references preserve ordinary spaces and optional sections without permitting controls or queries", () => {
  for (const reference of [
    "op://Release Vault/Facet Upload Key/store password",
    "op://Release Vault/Facet Upload Key/Upload Credentials/key password",
  ]) {
    expect(
      signingConfiguration(
        { ...configuration, storePasswordReference: reference },
        "/workspace/repo",
      ).storePasswordReference,
    ).toBe(reference);
  }
  for (const reference of [
    "op://vault//field",
    "op://vault/item/ ",
    "op://vault/item/field/extra/other",
    "op://vault/item/field?attribute=otp",
    "op://vault/item/field#fragment",
    "op://vault/item/field\n",
    "op://vault/item/\tfield",
  ]) {
    expect(() =>
      signingConfiguration(
        { ...configuration, storePasswordReference: reference },
        "/workspace/repo",
      ),
    ).toThrow();
  }
});
