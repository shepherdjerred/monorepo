import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const directory = new URL("../config/bazarr/", import.meta.url).pathname;
const providerDirectory =
  "/app/bazarr/bin/custom_libs/subliminal_patch/providers";
const subprocess = Bun.spawn(
  [
    "docker",
    "run",
    "--rm",
    "--network",
    "none",
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
    `ghcr.io/linuxserver/bazarr:${versions["linuxserver/bazarr"]}`,
    "/fixtures/test_subhd.py",
  ],
  { stdout: "inherit", stderr: "inherit" },
);
process.exit(await subprocess.exited);
