import {
  registryLocation,
  resolveManifestDigest,
} from "@shepherdjerred/delivery/oci-registry";

export async function publishOciBootstrapChart(
  archivePath: string,
  version: string,
  runCommand: (command: readonly string[]) => Promise<void>,
): Promise<string> {
  const ociUser = Bun.env["DOCKERHUB_USERNAME"]?.trim();
  const ociToken = Bun.env["DOCKERHUB_PUBLISH_TOKEN"]?.trim();
  if (
    ociUser !== undefined &&
    ociUser !== "" &&
    ociToken !== undefined &&
    ociToken !== ""
  ) {
    const login = Bun.spawn(
      [
        "helm",
        "registry",
        "login",
        "registry-1.docker.io",
        "--username",
        ociUser,
        "--password-stdin",
      ],
      {
        stdin: new Blob([ociToken]),
        env: { ...Bun.env, OP_SERVICE_ACCOUNT_TOKEN: undefined },
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    const loginExit = await login.exited;
    if (loginExit !== 0) {
      throw new Error(
        `helm registry login registry-1.docker.io failed (${String(loginExit)})`,
      );
    }
  }
  await runCommand([
    "helm",
    "push",
    archivePath,
    "oci://registry-1.docker.io/shepherdjerred",
  ]);
  return resolveManifestDigest(
    registryLocation(
      "https://registry-1.docker.io",
      "shepherdjerred/charts-bootstrap",
    ),
    version,
    fetch,
  );
}
