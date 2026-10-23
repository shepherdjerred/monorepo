import path from "node:path";
import { z } from "zod";

/**
 * Argo constructs a client even for local policy evaluation. This deliberately
 * unreachable kubeconfig keeps a test from inheriting any operator context or
 * credentials. Returns the file's path inside `directory`.
 */
export async function writeOfflineKubeconfig(
  directory: string,
): Promise<string> {
  const kubeconfig = path.join(directory, "kubeconfig");
  await Bun.write(
    kubeconfig,
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      clusters: [
        { name: "offline", cluster: { server: "http://127.0.0.1:1" } },
      ],
      users: [{ name: "offline", user: {} }],
      contexts: [
        { name: "offline", context: { cluster: "offline", user: "offline" } },
      ],
      "current-context": "offline",
    }),
  );
  return kubeconfig;
}

export type ArgoRbacQuery = {
  subject: string;
  action: string;
  resource: string;
  /** `<project>/<application>` */
  object: string;
  policyFile: string;
  kubeconfig: string;
  /** HOME for the CLI: the test's own scratch directory. */
  home: string;
  /** Whether ArgoCD's built-in roles (`role:readonly`, `role:admin`) apply. */
  builtinPolicy: boolean;
};

/** Ask the native `argocd admin settings rbac can` evaluator for one decision. */
export async function argoRbacAllows(query: ArgoRbacQuery): Promise<boolean> {
  const child = Bun.spawn(
    [
      "argocd",
      "admin",
      "settings",
      "rbac",
      "can",
      query.subject,
      query.action,
      query.resource,
      query.object,
      "--policy-file",
      query.policyFile,
      `--use-builtin-policy=${String(query.builtinPolicy)}`,
      "--kubeconfig",
      query.kubeconfig,
    ],
    {
      env: { PATH: Bun.env["PATH"] ?? "", HOME: query.home },
      timeout: 4000,
      killSignal: "SIGKILL",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0 && code !== 1)
    throw new Error(`Native Argo policy evaluation failed: ${stderr}`);
  const result = z.enum(["Yes", "No"]).safeParse(stdout.trim());
  if (!result.success)
    throw new Error(
      `Native Argo policy evaluator returned no decision: ${stderr}`,
    );
  return result.data === "Yes";
}
