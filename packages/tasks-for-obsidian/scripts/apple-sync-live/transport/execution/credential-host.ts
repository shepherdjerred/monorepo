import { spawnSync } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import {
  childEnvironment,
  classifyPasswordManagerFailure,
  selectCredentials,
  assertSecret,
  root,
} from "tasknotes-macos/scripts/mac-account-contract.ts";

const ItemParametersSchema = z.strictObject({
  "--account": z.string().regex(/^[A-Za-z0-9]{20,32}$/u),
  "--vault": z.string().regex(/^[A-Za-z0-9]{20,32}$/u),
  "--item": z.string().regex(/^[A-Za-z0-9]{20,32}$/u),
});
export type HostCredentialParameters = z.infer<typeof ItemParametersSchema>;
function captureSecret(argv: string[], timeout: number): string {
  const result = spawnSync(argv[0] ?? "", argv.slice(1), {
    env: childEnvironment(Bun.env),
    encoding: "utf8",
    timeout,
    maxBuffer: 1_048_576,
  });
  if (result.error || result.signal || result.status !== 0)
    throw new Error(
      `password_manager_${classifyPasswordManagerFailure(result.stderr)}`,
    );
  return result.stdout;
}
/** Host memory only. Callers must prove and then revalidate their exact owned native form. */
export function readHostCredentialItem(parameters: {
  "--account": string;
  "--vault": string;
  "--item": string;
}) {
  const selected = ItemParametersSchema.parse(parameters);
  const output = captureSecret(
    [
      "/opt/homebrew/bin/op",
      "item",
      "get",
      selected["--item"],
      "--vault",
      selected["--vault"],
      "--account",
      selected["--account"],
      "--format",
      "json",
      "--reveal",
    ],
    60_000,
  );
  return selectCredentials(
    JSON.parse(output),
    selected["--item"],
    selected["--vault"],
  );
}
export function readHostVerificationCode(
  parameters: HostCredentialParameters,
): string {
  const selected = ItemParametersSchema.parse(parameters);
  const code = captureSecret(
    [
      "/opt/homebrew/bin/op",
      "item",
      "get",
      selected["--item"],
      "--vault",
      selected["--vault"],
      "--account",
      selected["--account"],
      "--otp",
    ],
    60_000,
  ).trim();
  assertSecret(code, 6);
  return z
    .string()
    .regex(/^\d{6}$/u)
    .parse(code);
}
/** Choose Desktop explicitly for a Personal item; no backend fallback or credential copying. */
export function readHostVaultPassword(
  reference: string,
  backend: "service-account" | "desktop" = "service-account",
): string {
  z.string()
    .regex(/^op:\/\/[A-Za-z0-9]{20,32}\/[A-Za-z0-9]{20,32}\/password$/u)
    .parse(reference);
  z.enum(["service-account", "desktop"]).parse(backend);
  const argv =
    backend === "service-account"
      ? [
          path.join(root, "scripts/onepassword/with-service-account.sh"),
          "/opt/homebrew/bin/op",
          "read",
          reference,
        ]
      : ["/opt/homebrew/bin/op", "read", reference];
  const password = captureSecret(argv, 30_000).replace(/\n$/u, "");
  assertSecret(password, 512);
  return password;
}
