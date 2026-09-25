import path from "node:path";
import { providerSubprocessUid } from "#shared/agent/agent-subprocess-identity.ts";

export async function prepareProviderWorkspace(
  workdir: string,
  providerUid: number | undefined,
): Promise<void> {
  if (providerUid === undefined) return;
  if (
    !path.isAbsolute(workdir) ||
    path.resolve(workdir) === path.parse(workdir).root
  ) {
    throw new TypeError("Provider workdir must be an absolute path");
  }
  const subprocess = Bun.spawn(
    ["chown", "-R", providerUid.toString(), workdir],
    { stdout: "ignore", stderr: "pipe" },
  );
  const [exitCode, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Could not transfer the provider workspace to uid ${providerUid.toString()}: ${stderr.trim()}`,
    );
  }
}

export async function restoreProviderWorkspace(workdir: string): Promise<void> {
  if (providerSubprocessUid() === undefined) return;
  const workerUid = process.getuid?.();
  if (workerUid === undefined)
    throw new Error("Provider isolation requires a Unix worker uid");
  // Git and other post-turn checks run as the worker and require owned checkouts.
  await prepareProviderWorkspace(workdir, workerUid);
}
