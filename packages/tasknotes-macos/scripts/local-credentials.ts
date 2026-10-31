import { installLocalHelper } from "./local-credentials/helper.ts";
import { enrollFromDesktop } from "./local-credentials/enrollment.ts";
import {
  LocalCredentialFailure,
  recordKey,
  type CredentialLocator,
} from "./local-credentials/payload.ts";
import { PasswordManagerFailure } from "../../tasks-for-obsidian/scripts/apple-sync-live/transport/execution/credential-host.ts";

export function parseLocalCredentialArguments(
  args: string[],
):
  | { operation: "install"; identity: string; team: string }
  | { operation: "enroll"; locator: CredentialLocator } {
  const [operation, ...rest] = args;
  if (operation !== "install" && operation !== "enroll")
    throw new Error("Choose install or enroll");
  const options = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index],
      value = rest[index + 1];
    if (name === undefined || value === undefined || options.has(name))
      throw new Error("Specify each nonsecret setup option once");
    options.set(name, value);
  }
  if (operation === "install") {
    if (
      options.size !== 2 ||
      !options.has("--identity") ||
      !options.has("--team")
    )
      throw new Error("Install requires explicit identity and team");
    return {
      operation,
      identity: options.get("--identity") ?? "",
      team: options.get("--team") ?? "",
    };
  }
  if (
    options.size !== 3 ||
    !["--account", "--vault", "--item"].every((key) => options.has(key))
  )
    throw new Error("Enrollment requires exact nonsecret source locators");
  const locator = {
    account: options.get("--account") ?? "",
    vault: options.get("--vault") ?? "",
    item: options.get("--item") ?? "",
  };
  recordKey(locator);
  return { operation, locator };
}

if (import.meta.main) {
  try {
    const parsed = parseLocalCredentialArguments(Bun.argv.slice(2));
    console.log(
      JSON.stringify(
        parsed.operation === "install"
          ? installLocalHelper(parsed.identity, parsed.team)
          : enrollFromDesktop(parsed.locator),
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "blocked",
        reason:
          error instanceof LocalCredentialFailure ||
          error instanceof PasswordManagerFailure
            ? error.classification
            : "local_credentials_setup_invalid",
        automaticRetry: false,
      }),
    );
    process.exitCode = 1;
  }
}
