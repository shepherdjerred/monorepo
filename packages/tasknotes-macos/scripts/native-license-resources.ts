import { join } from "node:path";

/** Validate every shipped executable bundle, including app extensions. */
export async function validateNativeLicenseResources(
  resources: string,
  generated: string,
  rootLicense: string,
): Promise<void> {
  const expectedLicense = await Bun.file(rootLicense).arrayBuffer();
  for (const name of [
    "FirstPartyLicense.txt",
    "ThirdPartyNotices.txt",
    "native-license-inventory.json",
  ]) {
    const file = Bun.file(join(resources, name));
    if (!(await file.exists()))
      throw new Error(`Archive is missing native license resource: ${name}.`);
    const actual = await file.arrayBuffer();
    const expected =
      name === "FirstPartyLicense.txt"
        ? expectedLicense
        : await Bun.file(join(generated, name)).arrayBuffer();
    if (
      !actual.byteLength ||
      new Bun.CryptoHasher("sha256").update(actual).digest("hex") !==
        new Bun.CryptoHasher("sha256").update(expected).digest("hex")
    ) {
      throw new Error(
        `Archive native license resource does not match the current producer: ${name}.`,
      );
    }
  }
}
