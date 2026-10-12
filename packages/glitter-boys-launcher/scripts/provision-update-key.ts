import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import { fileURLToPath } from "node:url";
import { readProfile } from "./release-profile.ts";
const root = fileURLToPath(new URL("..", import.meta.url));
export const UPDATE_KEY_REF =
  "op://Private/Glitter Boys launcher release/update-signing-key";
export async function readUpdateKey(): Promise<string> {
  const child = Bun.spawn(["op", "read", UPDATE_KEY_REF], {
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  });
  const secret = await new Response(child.stdout).text();
  if ((await child.exited) !== 0)
    throw new Error("Unlock 1Password to read the launcher update signing key");
  return secret.trim();
}
if (import.meta.main) {
  const profile = await readProfile(root);
  if (profile.public_keys.length)
    throw new Error(
      "Update trust is already configured; use a reviewed key rotation instead",
    );
  const list = Bun.spawn(
    ["op", "item", "list", "--vault", "Private", "--format", "json"],
    { stdout: "pipe", stderr: "pipe", timeout: 60_000 },
  );
  const items: { title: string }[] = await new Response(list.stdout).json();
  if ((await list.exited) !== 0)
    throw new Error("Unlock 1Password before provisioning update trust");
  if (!items.some((item) => item.title === "Glitter Boys launcher release")) {
    const { privateKey } = generateKeyPairSync("ed25519");
    const item = {
      title: "Glitter Boys launcher release",
      category: "SECURE_NOTE",
      fields: [
        {
          id: "update-signing-key",
          label: "update-signing-key",
          type: "CONCEALED",
          value: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
        },
      ],
    };
    const create = Bun.spawn(
      ["op", "item", "create", "--vault", "Private", "--format", "json", "-"],
      {
        timeout: 60_000,
        stdin: new Blob([JSON.stringify(item)]),
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    if ((await create.exited) !== 0)
      throw new Error("Could not save the update key in 1Password");
  }
  const privateKey = createPrivateKey(await readUpdateKey());
  const publicKey = createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("hex");
  await Bun.write(
    `${root}/release-profile.json`,
    JSON.stringify(
      {
        ...profile,
        public_keys: [publicKey],
        publisher:
          "CN=Jerred Shepherd, O=Jerred Shepherd, L=Seattle, S=wa, C=US",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Update verification configured; the private key stays in 1Password.",
  );
}
