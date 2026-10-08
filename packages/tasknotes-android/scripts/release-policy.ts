import { isAbsolute, relative, resolve, sep } from "node:path";

export function outsideRepository(repo: string, path: string): boolean {
  const location = relative(resolve(repo), resolve(path));
  return (
    isAbsolute(location) || location === ".." || location.startsWith(".." + sep)
  );
}

export interface SigningConfiguration {
  schemaVersion: 1;
  keystorePath: string;
  storeType: "JKS" | "PKCS12";
  alias: string;
  certificateSHA256: string;
  storePasswordReference: string;
  keyPasswordReference: string;
}

export function signingConfiguration(
  value: unknown,
  repo: string,
): SigningConfiguration {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid signing bootstrap configuration.");
  const fields = Object.fromEntries(Object.entries(value));
  const keys = [
    "schemaVersion",
    "keystorePath",
    "storeType",
    "alias",
    "certificateSHA256",
    "storePasswordReference",
    "keyPasswordReference",
  ];
  if (
    Object.keys(fields).length !== keys.length ||
    keys.some((key) => !(key in fields)) ||
    fields["schemaVersion"] !== 1
  )
    throw new Error("Unsupported signing bootstrap configuration.");
  const keystorePath = fields["keystorePath"];
  const storeType = fields["storeType"];
  const alias = fields["alias"];
  const certificateSHA256 = fields["certificateSHA256"];
  const storePasswordReference = fields["storePasswordReference"];
  const keyPasswordReference = fields["keyPasswordReference"];
  if (typeof keystorePath !== "string" || !isAbsolute(keystorePath))
    throw new Error("An existing external secure keystore path is required.");
  if (!outsideRepository(repo, keystorePath))
    throw new Error("Signing key material must remain outside the repository.");
  if (storeType !== "JKS" && storeType !== "PKCS12")
    throw new Error("Unsupported signing keystore type.");
  if (
    typeof alias !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(alias)
  )
    throw new Error("Invalid signing alias.");
  if (
    typeof certificateSHA256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(certificateSHA256)
  )
    throw new Error("An exact reviewed upload certificate SHA256 is required.");
  const reference = (input: unknown): input is string => {
    if (
      typeof input !== "string" ||
      !input.startsWith("op://") ||
      /[\x00-\x1f\x7f?#]/.test(input)
    )
      return false;
    const segments = input.slice(5).split("/");
    return (
      (segments.length === 3 || segments.length === 4) &&
      segments.every(
        (segment) =>
          segment.trim().length > 0 && /^[A-Za-z0-9_. -]+$/.test(segment),
      )
    );
  };
  if (!reference(storePasswordReference) || !reference(keyPasswordReference))
    throw new Error(
      "Passwords require configured 1Password secret references.",
    );
  return {
    schemaVersion: 1,
    keystorePath,
    storeType,
    alias,
    certificateSHA256,
    storePasswordReference,
    keyPasswordReference,
  };
}

export function signingCommand(
  configuration: SigningConfiguration,
  unsigned: string,
  signed: string,
): string[] {
  return [
    "op",
    "run",
    "--",
    "jarsigner",
    "-keystore",
    configuration.keystorePath,
    "-storetype",
    configuration.storeType,
    "-storepass:env",
    "FACET_STORE_PASSWORD",
    "-keypass:env",
    "FACET_KEY_PASSWORD",
    "-digestalg",
    "SHA-256",
    "-signedjar",
    signed,
    unsigned,
    configuration.alias,
  ];
}

export function signatureVerificationCommand(
  configuration: SigningConfiguration,
  signed: string,
): string[] {
  return [
    "op",
    "run",
    "--",
    "jarsigner",
    "-verify",
    "-strict",
    "-keystore",
    configuration.keystorePath,
    "-storetype",
    configuration.storeType,
    "-storepass:env",
    "FACET_STORE_PASSWORD",
    signed,
    configuration.alias,
  ];
}
