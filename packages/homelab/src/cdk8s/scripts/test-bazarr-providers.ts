import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { parseArgs } from "node:util";
import { z } from "zod";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    live: { type: "boolean", default: false },
    "browser-url": { type: "string" },
    "browser-config": { type: "string" },
    release: { type: "string" },
    series: { type: "string" },
    season: { type: "string" },
    episode: { type: "string" },
    runs: { type: "string", default: "2" },
    "restart-browser": { type: "boolean", default: false },
  },
});
if (positionals.length > 0) throw new Error("Unexpected positional arguments");

const liveArguments: string[] = [];
const liveEnvironment: Record<string, string> = {};
if (values.live) {
  const input = z
    .object({
      "browser-url": z.url(),
      "browser-config": z.string().min(1),
      release: z.string().min(1),
      series: z.string().min(1),
      season: z.coerce.number().int().min(0),
      episode: z.coerce.number().int().min(1),
      runs: z.coerce.number().int().min(2).max(5),
    })
    .parse(values);
  let browserToken = Bun.env["PINCHTAB_TOKEN"];
  if (browserToken === undefined) {
    let configData: unknown;
    try {
      configData = await Bun.file(input["browser-config"]).json();
    } catch {
      throw new Error("PinchTab bootstrap config could not be read");
    }
    const config = z
      .object({ server: z.object({ token: z.string().min(1) }) })
      .safeParse(configData);
    if (!config.success)
      throw new Error("PinchTab bootstrap config is invalid");
    browserToken = config.data.server.token;
  }
  if (browserToken.length === 0)
    throw new Error("PinchTab bootstrap token is empty");
  liveEnvironment["SUBHD_PINCHTAB_TOKEN"] = browserToken;
  liveEnvironment["SUBHD_PINCHTAB_URL"] = input["browser-url"];
  liveEnvironment["SUBHD_PINCHTAB_PROFILE"] = "subtitle-provider-smoke";
  if (values["restart-browser"]) liveArguments.push("--restart-browser");
  for (const name of [
    "release",
    "series",
    "season",
    "episode",
    "runs",
  ] as const) {
    liveArguments.push(`--${name}`, String(input[name]));
  }
}

const directory = new URL("../config/bazarr/", import.meta.url).pathname;
const providerDirectory =
  "/app/bazarr/bin/custom_libs/subliminal_patch/providers";
const subprocess = Bun.spawn(
  [
    "docker",
    "run",
    "--rm",
    ...(values.live
      ? [
          "-e",
          "SUBHD_PINCHTAB_TOKEN",
          "-e",
          "SUBHD_PINCHTAB_URL",
          "-e",
          "SUBHD_PINCHTAB_PROFILE",
        ]
      : ["--network", "none"]),
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--entrypoint",
    "python3",
    "-e",
    "PYTHONDONTWRITEBYTECODE=1",
    "-e",
    "PYTHONPATH=/app/bazarr/bin/custom_libs:/app/bazarr/bin/libs:/app/bazarr/bin",
    "-v",
    `${directory}:/fixtures:ro`,
    "-v",
    `${directory}subhd.py:${providerDirectory}/subhd.py:ro`,
    "-v",
    `${directory}zimuku.py:${providerDirectory}/zimuku.py:ro`,
    "-v",
    `${directory}chinese_script.py:${providerDirectory}/chinese_script.py:ro`,
    "-v",
    `${directory}assrt.py:${providerDirectory}/assrt.py:ro`,
    `ghcr.io/linuxserver/bazarr:${versions["linuxserver/bazarr"]}`,
    values.live ? "/fixtures/smoke.py" : "/fixtures/test_subhd.py",
    ...liveArguments,
  ],
  {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...Bun.env, ...liveEnvironment },
  },
);
process.exit(await subprocess.exited);
