import { parseArgs } from "node:util";
import {
  SHARE_EXIT_CODES,
  shareCommand,
  SHARE_USAGE,
} from "#commands/share/share.ts";

const HELP = `${SHARE_USAGE}

Upload files or directories to SeaweedFS and print a URL for each path.

  public   https://public.sjer.red/ - readable by anyone on the internet.
           Use only when the user asked for public sharing.
  private  https://private.tailnet-1a49.ts.net/ - these URLs only open on the
           tailnet. Prefer this for anything the user did not ask to publish.

Options:
  --keep             Store under share/keep/ (never expires). Default is
                     share/tmp/, which expires after 30 days.
  --name <name>      Name of the stored file or directory (one path only).
                     Default: the path's basename.
  --json             Print one JSON object on stdout:
                     {visibility, expires: "30d"|"never",
                      items: [{path, url, key, bytes, contentType}]}
                     Progress and messages go to stderr.
  --profile <name>   AWS profile (default: agent-share).

Objects land at share/{tmp|keep}/<yyyy-mm-dd>/<random>/<name>, so every URL is
unique and immutable. Directories upload recursively (dotfiles and symlinks
are skipped); the URL ends in '/'. An asciinema .cast also uploads a player
page and GIF preview (needs agg); its URL is the player page.

Exit codes: 0 shared; 2 usage, missing path, credentials, or S3 error.
`;

export async function handleShareCommand(
  visibility: string | undefined,
  args: string[],
): Promise<void> {
  if (
    visibility === undefined ||
    visibility === "--help" ||
    visibility === "-h" ||
    args.includes("--help") ||
    args.includes("-h")
  ) {
    console.log(HELP);
    return;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        keep: { type: "boolean", default: false },
        name: { type: "string" },
        json: { type: "boolean", default: false },
        profile: { type: "string" },
      },
      allowPositionals: true,
    });
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(SHARE_USAGE);
    process.exitCode = SHARE_EXIT_CODES.error;
    return;
  }
  process.exitCode = await shareCommand(visibility, parsed.positionals, {
    keep: parsed.values.keep,
    name: parsed.values.name,
    json: parsed.values.json,
    profile: parsed.values.profile,
  });
}
