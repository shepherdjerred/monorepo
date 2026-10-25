import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { nativeInputs } from "./native-inputs";

/** Live, read-only gate for native consumers. The producer's existing inventory owns every source hash. */
export async function verifyNativeArtifacts(packageRoot: string) {
  const inventory = await nativeInputs(packageRoot);
  const output = resolve(packageRoot, "build/rust-jni");
  async function artifact(name: string) {
    const path = resolve(output, name);
    const metadata = await lstat(path).catch(() => {
      throw new Error(
        `Native artifact is missing: ${name}. Run android:native first.`,
      );
    });
    if (!metadata.isFile() || metadata.size === 0)
      throw new Error(
        `Native artifact is not a nonempty regular file: ${name}.`,
      );
    return Bun.file(path);
  }
  const stamp = (await (await artifact("source.sha256")).text()).trim();
  if (!/^[a-f0-9]{64}$/.test(stamp) || stamp !== inventory.fingerprint)
    throw new Error(
      "Native source stamp is invalid or stale. Run android:native first.",
    );
  const recorded: unknown = await (
    await artifact("source.manifest.json")
  ).json();
  if (JSON.stringify(recorded) !== JSON.stringify(inventory))
    throw new Error(
      "Native source manifest is invalid or stale. Run android:native first.",
    );
  for (const [abi, machine] of [
    ["arm64-v8a", 183],
    ["x86_64", 62],
  ] as const) {
    const name = `${abi}/libtasknotes_core_ffi.so`;
    const file = await artifact(name);
    const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (
      header.length !== 64 ||
      header[0] !== 0x7f ||
      header[1] !== 0x45 ||
      header[2] !== 0x4c ||
      header[3] !== 0x46 ||
      header[4] !== 2 ||
      header[5] !== 1 ||
      header[6] !== 1 ||
      new DataView(header.buffer).getUint16(16, true) !== 3 ||
      new DataView(header.buffer).getUint16(18, true) !== machine ||
      new DataView(header.buffer).getUint32(20, true) !== 1 ||
      new DataView(header.buffer).getUint16(52, true) !== 64
    )
      throw new Error(`Native artifact has an invalid ELF identity: ${name}.`);
  }
  return inventory;
}
